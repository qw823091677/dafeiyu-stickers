// 本地收藏库：把 QQ 群聊/私聊里值得留的图片收进独立目录，并维护独立索引。
//
// 与档案馆数据（data/）完全分开：
//   collection/index.json  收藏库索引（含来源会话、消息、发送者）
//   collection/images/     收藏的原图
//
// 设计取舍：
// - 去重按 sha256：同一张图重复收藏只返回已有条目；档案馆已收录的图直接返回 archive 命中，不重复存。
// - 注释/标签由模型在收藏时提供（看图后写一句图意 + 2~4 个标签），这里只做清洗与限长。
// - 写文件/写索引都是原子写；索引损坏时拒绝继续写，避免把已有收藏覆盖成空库。

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { groupOfTag, loadTagCatalog, orientationOf } from './index-builder.mjs';
import { readImageMeta } from './image-meta.mjs';
import {
  COLLECTION_DIR,
  COLLECTION_IMAGES_DIR,
  COLLECTION_INDEX_FILE,
  INDEX_FILE,
  LICENSE,
  SCHEMA_VERSION,
  TAGS_FILE
} from './paths.mjs';
import { loadLibrary } from './search.mjs';
import { sha256 } from './sync.mjs';

const EXT_BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/apng': '.png',
  'image/avif': '.avif'
};

const MAX_NOTE = 300;
const MAX_TAGS = 10;
const MAX_TAG_LEN = 24;

export function collectionPaths(options = {}) {
  const dir = path.resolve(options.dir || COLLECTION_DIR);
  return {
    dir,
    indexFile: options.indexFile || path.join(dir, 'index.json'),
    imagesDir: options.imagesDir || path.join(dir, 'images')
  };
}

function emptyIndex() {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'collection',
    name: '本地收藏库（QQ 收藏）',
    description: '从 QQ 群聊/私聊收藏的图片，与蓝色大肥鱼档案馆索引分开存放。',
    license: LICENSE,
    source: { type: 'qq', reader: 'qq-bridge' },
    stats: { count: 0, tags: 0, animated: 0, totalBytes: 0, updatedAt: '' },
    tags: [],
    stickers: []
  };
}

export function loadCollection(options = {}) {
  const paths = collectionPaths(options);
  let text;
  try {
    text = fs.readFileSync(paths.indexFile, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { index: emptyIndex(), paths, exists: false };
    throw new Error(`收藏库索引读取失败（${paths.indexFile}）：${error.message}`);
  }
  try {
    const parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
    if (!parsed || !Array.isArray(parsed.stickers)) throw new Error('缺少 stickers 数组');
    return { index: parsed, paths, exists: true };
  } catch (error) {
    throw new Error(`收藏库索引损坏（${paths.indexFile}）：${error.message}；已拒绝继续写入`);
  }
}

export function saveCollectionIndex(index, options = {}) {
  const paths = collectionPaths(options);
  fs.mkdirSync(paths.dir, { recursive: true });
  const tmp = `${paths.indexFile}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(index, null, 2)}\n`);
  fs.renameSync(tmp, paths.indexFile);
}

export function rebuildCollectionIndex(entries, options = {}) {
  const catalog = options.catalog || loadTagCatalog(options.tagsFile || TAGS_FILE);
  const counts = new Map();
  let totalBytes = 0;
  let animated = 0;
  for (const entry of entries) {
    totalBytes += Number(entry.bytes) || 0;
    if (entry.animated) animated += 1;
    for (const tag of entry.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  const tags = [...counts.entries()]
    .map(([name, count]) => ({ name, count, group: groupOfTag(catalog, name) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
  return {
    ...emptyIndex(),
    license: LICENSE,
    stats: {
      count: entries.length,
      tags: tags.length,
      animated,
      totalBytes,
      updatedAt: new Date().toISOString()
    },
    tags,
    stickers: entries
  };
}

function cleanNote(value) {
  return String(value ?? '')
    .replace(/[\s\u00a0\u3000]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_NOTE);
}

function cleanTags(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(/[,，、\s]+/);
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const tag = cleanNote(raw).slice(0, MAX_TAG_LEN);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

function archiveDuplicate(hash, archiveIndexFile = INDEX_FILE) {
  try {
    const parsed = JSON.parse(fs.readFileSync(archiveIndexFile, 'utf8').replace(/^\uFEFF/, ''));
    const hit = (parsed.stickers || []).find((item) => item.sha256 === hash);
    return hit || null;
  } catch {
    return null;
  }
}

let writeChain = Promise.resolve();

function enqueue(task) {
  const next = writeChain.then(task);
  writeChain = next.catch(() => {});
  return next;
}

/**
 * 收藏一张图片。
 *
 * @param {object} options
 * @param {Buffer} options.buffer  图片字节（原始或桥接返回的静态化版本）
 * @param {string} [options.mime]  可省略，按文件头判断
 * @param {string} [options.note]  注释（一句话说明图意/适用场景）
 * @param {string[]|string} [options.tags] 标签
 * @param {object} [options.source] 来源：{platform,key,messageId,senderId,senderName,url,originalMime,preservedOriginal,collectedAt}
 * @param {string} [options.caption] 覆盖默认 caption
 * @param {string} [options.dir]    测试/多库时指定根目录
 * @returns {Promise<{created:boolean,reason?:string,entry?:object,archive?:object}>}
 */
export function addCollectedImage(options = {}) {
  return enqueue(() => addCollectedImageNow(options));
}

async function addCollectedImageNow(options = {}) {
  const buffer = Buffer.isBuffer(options.buffer) ? options.buffer : Buffer.from(options.buffer || []);
  if (!buffer.length) throw new Error('图片数据为空');
  if (buffer.length > 30 * 1024 * 1024) throw new Error('图片超过 30MB 上限');
  const meta = readImageMeta(buffer);
  if (!meta || meta.damaged) throw new Error('不是可识别的图片（PNG/JPEG/GIF/WebP）');
  const mime = meta.mime;
  const hash = sha256(buffer);

  const archive = archiveDuplicate(hash, options.archiveIndexFile || INDEX_FILE);
  if (archive) {
    return { created: false, reason: 'archive_exists', archive: { id: archive.id, caption: archive.caption, tags: archive.tags } };
  }

  const paths = collectionPaths(options);
  const { index } = loadCollection({ dir: paths.dir });
  const existing = index.stickers.find((item) => item.sha256 === hash);
  if (existing) {
    return { created: false, reason: 'collection_exists', entry: existing };
  }

  const note = cleanNote(options.note);
  const tags = cleanTags(options.tags);
  const catalog = loadTagCatalog(options.tagsFile || TAGS_FILE);
  const source = options.source && typeof options.source === 'object' ? options.source : {};
  const collectedAt = String(source.collectedAt || new Date().toISOString());
  const idBase = `local-${hash.slice(0, 10)}`;
  let id = idBase;
  for (let suffix = 2; index.stickers.some((item) => item.id === id); suffix += 1) {
    id = `${idBase}-${suffix}`;
  }
  const ext = EXT_BY_MIME[mime] || '.png';
  const file = `${id}${ext}`;
  fs.mkdirSync(paths.imagesDir, { recursive: true });
  const target = path.join(paths.imagesDir, file);
  const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, target);

  const entry = {
    id,
    file,
    caption: cleanNote(options.caption) || (note ? note : `从 QQ ${source.key || '聊天'} 收藏的图片`),
    note,
    tags,
    groups: [...new Set(tags.map((tag) => groupOfTag(catalog, tag)).filter(Boolean))],
    width: meta.width,
    height: meta.height,
    orientation: orientationOf(meta.width, meta.height),
    mime,
    bytes: buffer.length,
    animated: Boolean(meta.animated),
    sha256: hash,
    source: {
      platform: cleanNote(source.platform) || 'qq',
      key: cleanNote(source.key),
      messageId: cleanNote(source.messageId),
      senderId: cleanNote(source.senderId),
      senderName: cleanNote(source.senderName),
      url: String(source.url || ''),
      originalMime: cleanNote(source.originalMime),
      preservedOriginal: Boolean(source.preservedOriginal),
      collectedAt
    },
    addedAt: new Date().toISOString()
  };

  const nextEntries = [entry, ...index.stickers];
  try {
    saveCollectionIndex(rebuildCollectionIndex(nextEntries, { catalog }), { dir: paths.dir });
  } catch (error) {
    try {
      fs.unlinkSync(target);
    } catch {}
    throw error;
  }
  return { created: true, entry };
}

export function removeCollectedImage(id, options = {}) {
  return enqueue(() => {
    const paths = collectionPaths(options);
    const { index } = loadCollection({ dir: paths.dir });
    const entry = index.stickers.find((item) => item.id === String(id || '').trim());
    if (!entry) return { removed: false, reason: 'not_found' };
    try {
      fs.unlinkSync(path.join(paths.imagesDir, entry.file));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const catalog = loadTagCatalog(options.tagsFile || TAGS_FILE);
    const remaining = index.stickers.filter((item) => item.id !== entry.id);
    saveCollectionIndex(rebuildCollectionIndex(remaining, { catalog }), { dir: paths.dir });
    return { removed: true, entry };
  });
}

/**
 * 把收藏库加载成与档案馆相同的 library 结构，检索打分完全复用。
 * 空库也返回可用对象（entries 为空），避免"收藏第一张之前不能搜索"。
 */
export function collectionLibrary(options = {}) {
  const paths = collectionPaths(options);
  return loadLibrary({
    indexFile: paths.indexFile,
    imagesDir: paths.imagesDir,
    tagsFile: options.tagsFile || TAGS_FILE,
    allowEmpty: true,
    includeCatalogTags: true
  });
}

export function collectionStats(options = {}) {
  const { index, exists } = loadCollection(options);
  return {
    exists,
    count: index.stats?.count ?? index.stickers.length,
    tags: index.stats?.tags ?? index.tags?.length ?? 0,
    animated: index.stats?.animated ?? 0,
    totalBytes: index.stats?.totalBytes ?? 0,
    updatedAt: index.stats?.updatedAt || ''
  };
}
