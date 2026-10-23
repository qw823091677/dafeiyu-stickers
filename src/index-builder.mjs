// 构建本地索引：把站内清单（alt/tags/尺寸）+ 本地文件校验结果（sha256/字节数/真实格式）
// 合并成一份可直接检索、也适合入库审阅的 index.json。

import fs from 'node:fs';
import path from 'node:path';
import { readImageMeta } from './image-meta.mjs';
import {
  ARCHIVE,
  ARCHIVE_GITHUB,
  ATTRIBUTION,
  IMAGES_DIR,
  INDEX_FILE,
  LICENSE,
  MANIFEST_URL,
  SCHEMA_VERSION,
  SITE_ORIGIN,
  TAGS_FILE
} from './paths.mjs';
import { loadManifest, loadState, sha256, slugOf, fileNameOf } from './sync.mjs';

export function loadTagCatalog(file = TAGS_FILE) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    if (error?.code === 'ENOENT') return { version: 0, groups: {}, aliases: {} };
    throw new Error(`标签表损坏（${file}）：${error.message}`);
  }
  return {
    version: parsed.version || 0,
    groups: parsed.groups && typeof parsed.groups === 'object' ? parsed.groups : {},
    aliases: parsed.aliases && typeof parsed.aliases === 'object' ? parsed.aliases : {}
  };
}

export function groupOfTag(catalog, tag) {
  for (const [group, tags] of Object.entries(catalog.groups || {})) {
    if (Array.isArray(tags) && tags.includes(tag)) return group;
  }
  return '';
}

export function orientationOf(width, height) {
  if (!width || !height) return 'unknown';
  if (Math.abs(width - height) <= 3) return 'square';
  return height > width ? 'portrait' : 'landscape';
}

function readHeaderMeta(file) {
  try {
    const buffer = fs.readFileSync(file);
    return readImageMeta(buffer);
  } catch {
    return null;
  }
}

export function buildIndex(options = {}) {
  const { log = () => {}, allowMissing = false, indexFile = INDEX_FILE } = options;
  const { stickers, raw } = loadManifest();
  const state = loadState();
  const catalog = loadTagCatalog();
  const entries = [];
  const missing = [];
  const warnings = [];
  let totalBytes = 0;
  let animated = 0;

  for (const entry of stickers) {
    const id = slugOf(entry);
    const file = fileNameOf(entry);
    const target = path.join(IMAGES_DIR, file);
    let stat;
    try {
      stat = fs.statSync(target);
    } catch {
      missing.push(id);
      continue;
    }
    if (!stat.isFile() || !stat.size) {
      missing.push(id);
      continue;
    }

    const record = state.items[id];
    let meta = null;
    let hash = record?.sha256 || '';
    if (record && record.bytes === stat.size && record.width && record.height) {
      meta = { mime: record.mime, width: record.width, height: record.height, animated: Boolean(record.animated), damaged: false };
    } else {
      meta = readHeaderMeta(target);
      if (meta && stat.size <= 30 * 1024 * 1024) {
        hash = sha256(fs.readFileSync(target));
      }
    }
    if (!meta || meta.damaged) {
      warnings.push(`${id} 图片头解析失败，已跳过`);
      missing.push(id);
      continue;
    }
    if (!hash) hash = sha256(fs.readFileSync(target));

    const tags = Array.isArray(entry.tags) ? entry.tags.filter((tag) => typeof tag === 'string' && tag.trim()) : [];
    const groups = [...new Set(tags.map((tag) => groupOfTag(catalog, tag)).filter(Boolean))];
    totalBytes += stat.size;
    if (meta.animated) animated += 1;

    entries.push({
      id,
      file,
      caption: String(entry.alt || '').trim(),
      tags,
      groups,
      width: meta.width,
      height: meta.height,
      archiveSize: {
        width: record?.archiveWidth || entry.width || meta.width,
        height: record?.archiveHeight || entry.height || meta.height
      },
      orientation: orientationOf(meta.width, meta.height),
      mime: meta.mime,
      bytes: stat.size,
      animated: Boolean(meta.animated),
      sha256: hash,
      source: {
        page: `${SITE_ORIGIN}/gallery`,
        original: String(entry.original || ''),
        preview: String(entry.preview || ''),
        large: String(entry.large || '')
      }
    });
  }

  if (missing.length && !allowMissing) {
    const sample = missing.slice(0, 8).join('、');
    throw new Error(
      `有 ${missing.length} 张图片不在本地（${sample}${missing.length > 8 ? ' 等' : ''}）；先运行 \`node src/cli.mjs sync\`，或加 --allow-missing`
    );
  }
  if (warnings.length) {
    for (const warning of warnings.slice(0, 10)) log(`⚠️ ${warning}`);
    if (warnings.length > 10) log(`⚠️ ……另有 ${warnings.length - 10} 条同类警告`);
  }

  const tagCounts = new Map();
  for (const entry of entries) {
    for (const tag of entry.tags) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
  }
  const tags = [...tagCounts.entries()]
    .map(([name, count]) => ({ name, count, group: groupOfTag(catalog, name) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));

  const manifestSha = sha256(Buffer.from(raw, 'utf8'));
  const index = {
    schemaVersion: SCHEMA_VERSION,
    project: 'dafeiyu-stickers',
    name: `${ARCHIVE.name} · 表情索引`,
    description: '鲸鱼娘 DeepSeek 非官方同人表情包的本地索引：站内 alt 注释 + 标签 + 校验哈希 + 出处。',
    source: {
      site: SITE_ORIGIN,
      manifest: MANIFEST_URL,
      manifestSha256: manifestSha,
      archiveRepo: ARCHIVE_GITHUB
    },
    license: LICENSE,
    attribution: ATTRIBUTION,
    stats: {
      count: entries.length,
      tags: tags.length,
      animated,
      totalBytes,
      dataVersion: manifestSha.slice(0, 12)
    },
    tags,
    stickers: entries
  };

  fs.mkdirSync(path.dirname(indexFile), { recursive: true });
  const tmp = `${indexFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(index, null, 2)}\n`);
  fs.renameSync(tmp, indexFile);
  log(`索引已生成：${entries.length} 张 / ${tags.length} 个标签 / ${(totalBytes / 1024 / 1024).toFixed(1)} MB → ${indexFile}`);
  if (missing.length) log(`⚠️ 跳过 ${missing.length} 张缺失图片（--allow-missing）`);
  return index;
}
