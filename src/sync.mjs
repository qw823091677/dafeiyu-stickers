// 同步：把档案馆的原始表情文件下载到本地，逐张校验并记录 sha256。
//
// 原则：
// - 原始字节原样保存，不转码、不压缩、不加水印；文件名沿用站点 slug + 原扩展名。
// - 先写临时文件再原子 rename，避免半截文件被当成完整图片。
// - 任何「格式/尺寸与站内索引不符」都只记录警告，不改文件——保留证据比"看起来能用"重要。

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fetchBuffer, sleep } from './http.mjs';
import { readImageMeta, sniffMime } from './image-meta.mjs';
import {
  EXCLUDED_FILE,
  IMAGES_DIR,
  MANIFEST_FILE,
  MANIFEST_URL,
  SYNC_STATE_FILE,
  USER_AGENT
} from './paths.mjs';

const STATE_VERSION = 1;

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function slugOf(entry) {
  // 补充来源的条目可以自带 id（站点文件名只是数字编号时，用它才有可读性）。
  const explicit = typeof entry?.slug === 'string' ? entry.slug.trim() : '';
  if (explicit) return explicit;
  const original = String(entry?.original || '');
  const base = decodeURIComponent(original.split('/').pop() || '');
  return path.basename(base, path.extname(base)).trim();
}

export function fileNameOf(entry) {
  const explicit = typeof entry?.file === 'string' ? path.basename(entry.file.trim()) : '';
  if (explicit) return explicit;
  const original = String(entry?.original || '');
  const base = decodeURIComponent(original.split('/').pop() || '');
  return path.basename(base);
}

export function isValidSlug(slug) {
  return typeof slug === 'string' && slug.length > 0 && slug.length <= 120 && /^[A-Za-z0-9._-]+$/.test(slug);
}

function readManifestPart(file, { optional = false } = {}) {
  if (!fs.existsSync(file)) {
    if (optional) return null;
    throw new Error(`找不到站内索引 ${file}；先运行 \`node src/cli.mjs sync --refresh-manifest\``);
  }
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const parsed = JSON.parse(raw);
  const stickers = Array.isArray(parsed?.stickers) ? parsed.stickers : null;
  if (!stickers || stickers.length === 0) throw new Error(`${file} 里没有 stickers 数组`);
  return { file, raw, data: parsed, stickers };
}

/**
 * 读取本地去重排除表。返回 Map<slug, 原因>；文件不存在视为没有排除项。
 */
export function loadExcluded(file = EXCLUDED_FILE) {
  const map = new Map();
  if (!fs.existsSync(file)) return map;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    for (const item of parsed?.items || []) {
      const slug = typeof item?.slug === 'string' ? item.slug.trim() : '';
      if (slug) map.set(slug, String(item.reason || '已在本地去重表排除'));
    }
  } catch {
    // 排除表损坏不应阻断同步：当作没有排除项，索引会多出重复条目而已。
  }
  return map;
}

/**
 * 读取主清单，并按本地去重排除表过滤。
 *
 * 其它来源（如梗鲸 aigengtu.com）的图不在这里合并：它们属于本地收藏库
 * （collection/），由 `type: local` 的索引单独管理，不混进档案馆。
 */
export function loadManifest(file = MANIFEST_FILE) {
  const main = readManifestPart(file);
  const excluded = loadExcluded();
  const stickers = main.stickers.filter((entry) => !excluded.has(slugOf(entry)));

  const seen = new Set();
  for (const entry of stickers) {
    const slug = slugOf(entry);
    if (!isValidSlug(slug)) throw new Error(`站内索引里的 slug 不合法：${JSON.stringify(slug)}`);
    if (seen.has(slug)) throw new Error(`站内索引里 slug 重复：${slug}`);
    seen.add(slug);
    if (!entry.original) throw new Error(`条目 ${slug} 缺少 original`);
  }
  return {
    file,
    raw: main.raw,
    data: main.data,
    excluded,
    stickers
  };
}

export async function fetchManifest({ log = () => {} } = {}) {
  log(`拉取站内索引 ${MANIFEST_URL}`);
  const { buffer } = await fetchBuffer(MANIFEST_URL, { timeoutMs: 30_000, retries: 3 });
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed?.stickers) || parsed.stickers.length === 0) {
    throw new Error('站内索引格式异常：没有 stickers 数组');
  }
  fs.mkdirSync(path.dirname(MANIFEST_FILE), { recursive: true });
  const tmp = `${MANIFEST_FILE}.tmp`;
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, MANIFEST_FILE);
  log(`站内索引已更新：${parsed.stickers.length} 张（${buffer.length} 字节）`);
  return { data: parsed, raw: text };
}

export function loadState(file = SYNC_STATE_FILE) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    return {
      version: STATE_VERSION,
      updatedAt: parsed?.updatedAt || '',
      items: parsed?.items && typeof parsed.items === 'object' ? parsed.items : {}
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return { version: STATE_VERSION, updatedAt: '', items: {} };
    throw new Error(`同步状态文件损坏（${file}）：${error.message}`);
  }
}

export function saveState(state, file = SYNC_STATE_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(
    tmp,
    JSON.stringify({ version: STATE_VERSION, updatedAt: new Date().toISOString(), items: state.items }, null, 2)
  );
  fs.renameSync(tmp, file);
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * 同步全部表情。
 * @param {object} options
 * @param {boolean} [options.force]        忽略本地文件，全部重新下载
 * @param {boolean} [options.verify]       只校验本地文件，不下载缺失（缺失仍会提示）
 * @param {boolean} [options.prune]        删除不在站内索引里的多余图片
 * @param {number}  [options.concurrency]  并发数，默认 3（站点请求「勿高频」）
 * @param {number}  [options.gapMs]        每次请求之间的最小间隔，默认 150ms
 * @param {Function}[options.log]
 */
export async function syncAll(options = {}) {
  const {
    force = false,
    verify = false,
    prune = false,
    concurrency = 3,
    gapMs = 150,
    log = () => {}
  } = options;

  const { stickers, data, raw } = loadManifest();
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  const state = loadState();
  const summary = { total: stickers.length, downloaded: 0, skipped: 0, failed: 0, pruned: 0, bytes: 0, sizeMismatch: 0, warnings: [], failures: [] };
  let lastRequestAt = 0;

  const persist = () => {
    try {
      saveState(state);
    } catch (error) {
      log(`⚠️ 同步状态写入失败：${error.message}`);
    }
  };

  const tasks = stickers.map((entry) => ({ entry, slug: slugOf(entry), file: fileNameOf(entry) }));
  let done = 0;

  const processOne = async ({ entry, slug, file }) => {
    const target = path.join(IMAGES_DIR, file);
    const record = state.items[slug] || {};
    let existing = null;
    try {
      const stat = await fsp.stat(target);
      if (stat.isFile() && stat.size > 0) existing = stat;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    if (existing && !force) {
      const buffer = await fsp.readFile(target);
      const hash = sha256(buffer);
      const meta = readImageMeta(buffer);
      const knownHash = record.sha256;
      const matchesKnown = knownHash ? knownHash === hash : true;
      if (verify) {
        if (!meta || meta.damaged) throw new Error(`文件已损坏（无法解析图片头）：${file}`);
        if (knownHash && !matchesKnown) throw new Error(`sha256 与同步记录不符：${file}`);
        summary.skipped += 1;
        state.items[slug] = {
          ...record,
          file,
          url: entry.original,
          sha256: hash,
          bytes: buffer.length,
          mime: meta?.mime || record.mime || '',
          width: meta?.width || entry.width || 0,
          height: meta?.height || entry.height || 0,
          archiveWidth: entry.width || record.archiveWidth || 0,
          archiveHeight: entry.height || record.archiveHeight || 0,
          animated: Boolean(meta?.animated),
          verifiedAt: new Date().toISOString()
        };
        return;
      }
      if (matchesKnown) {
        summary.skipped += 1;
        summary.bytes += buffer.length;
        state.items[slug] = {
          ...record,
          file,
          url: entry.original,
          sha256: hash,
          bytes: buffer.length,
          mime: meta?.mime || record.mime || '',
          width: meta?.width || entry.width || 0,
          height: meta?.height || entry.height || 0,
          archiveWidth: entry.width || record.archiveWidth || 0,
          archiveHeight: entry.height || record.archiveHeight || 0,
          animated: Boolean(meta?.animated)
        };
        return;
      }
      log(`↻ ${slug} 本地文件与记录不符，重新下载`);
    }

    if (verify) {
      throw new Error(`缺失本地文件：${file}（先运行 sync）`);
    }

    const wait = Math.max(0, gapMs - (Date.now() - lastRequestAt));
    if (wait) await sleep(wait);
    lastRequestAt = Date.now();

    const { buffer } = await fetchBuffer(entry.original, {
      timeoutMs: 60_000,
      retries: 3,
      maxBytes: 30 * 1024 * 1024,
      onRetry: ({ attempt, status, waitMs }) => log(`… ${slug} 重试 #${attempt + 1}（HTTP ${status}，等待 ${waitMs}ms）`)
    });

    const mime = sniffMime(buffer);
    if (!mime) throw new Error(`下载内容不是受支持的图片（${buffer.length} 字节）`);
    const meta = readImageMeta(buffer);
    if (!meta || meta.damaged) throw new Error(`图片头无法解析：${file}`);

    const tmp = path.join(IMAGES_DIR, `.${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
    await fsp.writeFile(tmp, buffer);
    await fsp.rename(tmp, target);

    const hash = sha256(buffer);
    summary.downloaded += 1;
    summary.bytes += buffer.length;
    // 站内 width/height 记录的是预览展示尺寸，original 才是原图，两者不一致是常态。
    if (entry.width && (entry.width !== meta.width || entry.height !== meta.height)) {
      summary.sizeMismatch += 1;
    }
    state.items[slug] = {
      file,
      url: entry.original,
      sha256: hash,
      bytes: buffer.length,
      mime: meta.mime,
      width: meta.width,
      height: meta.height,
      archiveWidth: entry.width || 0,
      archiveHeight: entry.height || 0,
      animated: meta.animated,
      fetchedAt: new Date().toISOString()
    };
  };

  const results = await runPool(tasks, concurrency, async (task) => {
    try {
      await processOne(task);
    } catch (error) {
      summary.failed += 1;
      summary.failures.push({ id: task.slug, file: task.file, url: task.entry.original, error: String(error?.message || error) });
      log(`✗ ${task.slug}：${error?.message || error}`);
    } finally {
      done += 1;
      const record = state.items[task.slug];
      const size = record?.bytes ? `，${(record.bytes / 1024).toFixed(0)}KB` : '';
      log(`[${done}/${tasks.length}] ${task.slug}${size}`);
      if (done % 20 === 0) persist();
    }
    return task.slug;
  });

  persist();

  if (prune) {
    const known = new Set(tasks.map((task) => task.file));
    for (const name of await fsp.readdir(IMAGES_DIR).catch(() => [])) {
      if (name.startsWith('.')) continue;
      if (known.has(name)) continue;
      await fsp.unlink(path.join(IMAGES_DIR, name));
      summary.pruned += 1;
    }
    // 清掉已不在索引里的同步记录
    const slugs = new Set(tasks.map((task) => task.slug));
    for (const slug of Object.keys(state.items)) {
      if (!slugs.has(slug)) delete state.items[slug];
    }
    persist();
  }

  summary.manifest = {
    count: stickers.length,
    site: data?.site || '',
    name: data?.name || '',
    license: data?.license?.name || '',
    sha256: sha256(Buffer.from(raw, 'utf8')),
    unique: new Set(results).size
  };
  return summary;
}

export async function hashFile(file) {
  const handle = await fsp.open(file, 'r');
  try {
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

export { USER_AGENT };
