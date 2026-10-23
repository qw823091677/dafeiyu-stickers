#!/usr/bin/env node
// 索引自检：不依赖图片文件，只校验已入库的 data/index.json 与站内快照是否一致。
//
// 借鉴原项目 sync_stickers.py --check 的思路：把"生成物是否与源一致"钉在 CI 里，
// 避免手工改索引、sync 到一半、或站点更新后忘了重建索引。
//
// 用法：node scripts/check-index.mjs

import crypto from 'node:crypto';
import fs from 'node:fs';
import { INDEX_FILE, MANIFEST_FILE } from '../src/paths.mjs';
import { slugOf } from '../src/sync.mjs';

const errors = [];
const fail = (message) => errors.push(message);

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    fail(`${label} 读取失败（${file}）：${error.message}`);
    return null;
  }
}

const manifestRaw = fs.existsSync(MANIFEST_FILE) ? fs.readFileSync(MANIFEST_FILE) : null;
const index = readJson(INDEX_FILE, '索引');
const manifest = manifestRaw ? readJson(MANIFEST_FILE, '站内快照') : null;

if (!manifestRaw) fail(`找不到站内快照：${MANIFEST_FILE}`);
if (index && manifest) {
  if (index.schemaVersion !== 1) fail(`schemaVersion 应为 1，实际 ${index.schemaVersion}`);

  const manifestSha = crypto.createHash('sha256').update(manifestRaw).digest('hex');
  if (index.source?.manifestSha256 !== manifestSha) {
    fail(`索引记录的 manifestSha256 与当前快照不一致：${index.source?.manifestSha256 || '(空)'} != ${manifestSha}`);
  }

  const expected = new Map();
  for (const entry of manifest.stickers || []) {
    expected.set(slugOf(entry), entry);
  }
  if (!Array.isArray(index.stickers)) {
    fail('索引缺少 stickers 数组');
  } else {
    if (index.stats?.count !== index.stickers.length) {
      fail(`stats.count=${index.stats?.count} 与条目数 ${index.stickers.length} 不一致`);
    }
    if (index.stickers.length !== expected.size) {
      fail(`索引 ${index.stickers.length} 条，站内快照 ${expected.size} 条`);
    }
    const seen = new Set();
    for (const item of index.stickers) {
      if (!item.id) {
        fail('有条目缺少 id');
        continue;
      }
      if (seen.has(item.id)) fail(`id 重复：${item.id}`);
      seen.add(item.id);
      const source = expected.get(item.id);
      if (!source) {
        fail(`索引里的 ${item.id} 不在站内快照中`);
        continue;
      }
      if (item.caption !== String(source.alt || '').trim()) {
        fail(`${item.id} 的 caption 与站内 alt 不一致`);
      }
      const expectedTags = Array.isArray(source.tags) ? source.tags : [];
      if (JSON.stringify(item.tags || []) !== JSON.stringify(expectedTags)) {
        fail(`${item.id} 的 tags 与站内快照不一致`);
      }
      if (Boolean(item.selfMade) !== Boolean(source.selfMade)) {
        fail(`${item.id} 的 selfMade 与站内快照不一致`);
      }
      if (!/^[0-9a-f]{64}$/.test(String(item.sha256 || ''))) fail(`${item.id} 的 sha256 格式不对`);
      if (!Number.isFinite(item.bytes) || item.bytes <= 0) fail(`${item.id} 的 bytes 无效`);
      if (!Number.isFinite(item.width) || !Number.isFinite(item.height) || item.width <= 0 || item.height <= 0) {
        fail(`${item.id} 的尺寸无效`);
      }
      if (!item.source?.original) fail(`${item.id} 缺少原始出处`);
    }
    const selfMade = index.stickers.filter((item) => item.selfMade).length;
    if (index.stats?.selfMade !== selfMade) fail(`stats.selfMade=${index.stats?.selfMade} 与实际 ${selfMade} 不一致`);
  }

  // 标签统计与条目是否自洽
  const counts = new Map();
  for (const item of index.stickers || []) {
    for (const tag of item.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  for (const tag of index.tags || []) {
    if (tag.count !== (counts.get(tag.name) || 0)) {
      fail(`标签统计不一致：${tag.name} 记录 ${tag.count}，实际 ${counts.get(tag.name) || 0}`);
    }
  }
}

if (errors.length) {
  console.error(`索引自检未通过（${errors.length} 项）：`);
  for (const message of errors.slice(0, 30)) console.error(`  - ${message}`);
  if (errors.length > 30) console.error(`  ……另有 ${errors.length - 30} 项`);
  process.exit(1);
}
console.log(`索引自检通过：${index.stickers.length} 张 / ${index.tags.length} 个标签 / 站长自作 ${index.stats.selfMade} 张。`);
