import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addCollectedImage,
  collectionLibrary,
  collectionStats,
  loadCollection,
  removeCollectedImage
} from '../src/collection.mjs';
import { search } from '../src/search.mjs';
import { sha256 } from '../src/sync.mjs';

function pngBuffer(width = 480, height = 480, seed = 0) {
  const buffer = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  buffer[24] = 8;
  buffer[25] = 6;
  buffer[26] = seed;
  return buffer;
}

function tempEnv(archiveEntries = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dafeiyu-collection-'));
  const archiveIndexFile = path.join(dir, 'archive-index.json');
  fs.writeFileSync(archiveIndexFile, JSON.stringify({ stickers: archiveEntries }));
  return { dir, archiveIndexFile };
}

test('收藏一张图：写文件、建索引、注释与标签', async () => {
  const { dir, archiveIndexFile } = tempEnv();
  const buffer = pngBuffer(480, 480, 1);
  const result = await addCollectedImage({
    buffer,
    note: '测试图：适合接「好耶」',
    tags: ['开心', '卖萌'],
    dir,
    archiveIndexFile,
    source: { platform: 'qq', key: 'group:123', messageId: '456' }
  });
  assert.equal(result.created, true);
  assert.match(result.entry.id, /^local-[0-9a-f]{10}$/);
  assert.equal(result.entry.note, '测试图：适合接「好耶」');
  assert.deepEqual(result.entry.tags, ['开心', '卖萌']);
  assert.equal(result.entry.sha256, sha256(buffer));
  assert.equal(result.entry.bytes, buffer.length);
  assert.equal(result.entry.width, 480);
  assert.equal(result.entry.source.key, 'group:123');
  assert.ok(fs.existsSync(path.join(dir, 'images', result.entry.file)));

  const { index } = loadCollection({ dir });
  assert.equal(index.stats.count, 1);
  assert.equal(index.tags.find((tag) => tag.name === '开心').count, 1);
  assert.equal(index.stats.totalBytes, buffer.length);
});

test('同一张图重复收藏按 sha256 去重', async () => {
  const { dir, archiveIndexFile } = tempEnv();
  const buffer = pngBuffer(480, 480, 2);
  const first = await addCollectedImage({ buffer, note: '第一次', dir, archiveIndexFile });
  const second = await addCollectedImage({ buffer, note: '第二次', dir, archiveIndexFile });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.reason, 'collection_exists');
  assert.equal(second.entry.id, first.entry.id);
  assert.equal(loadCollection({ dir }).index.stickers.length, 1);
});

test('档案馆已有的图不重复收藏', async () => {
  const buffer = pngBuffer(480, 480, 3);
  const { dir, archiveIndexFile } = tempEnv([
    { id: 'deepseek-test', caption: '已有', tags: ['开心'], sha256: sha256(buffer) }
  ]);
  const result = await addCollectedImage({ buffer, dir, archiveIndexFile });
  assert.equal(result.created, false);
  assert.equal(result.reason, 'archive_exists');
  assert.equal(result.archive.id, 'deepseek-test');
  assert.equal(loadCollection({ dir }).index.stickers.length, 0);
});

test('本地收藏库可独立检索，空库也不报错', async () => {
  const { dir, archiveIndexFile } = tempEnv();
  const empty = collectionLibrary({ dir });
  assert.equal(search(empty, { tags: ['睡觉'] }).results.length, 0);

  await addCollectedImage({
    buffer: pngBuffer(480, 480, 4),
    note: '好耶，开心干饭',
    tags: ['开心', '吃饭'],
    dir,
    archiveIndexFile
  });
  const library = collectionLibrary({ dir });
  const byTag = search(library, { tags: ['开心'] });
  assert.equal(byTag.results.length, 1);
  assert.equal(byTag.results[0].available, true);
  assert.equal(byTag.results[0].source.platform, 'qq');

  const byAlias = search(library, { query: '好耶' });
  assert.equal(byAlias.results.length, 1);

  const byGroup = search(library, { group: '日常' });
  assert.equal(byGroup.results.length, 1);
});

test('删除收藏会同时删文件和索引', async () => {
  const { dir, archiveIndexFile } = tempEnv();
  const result = await addCollectedImage({ buffer: pngBuffer(300, 300, 5), dir, archiveIndexFile });
  const target = path.join(dir, 'images', result.entry.file);
  assert.ok(fs.existsSync(target));
  const removed = await removeCollectedImage(result.entry.id, { dir });
  assert.equal(removed.removed, true);
  assert.equal(fs.existsSync(target), false);
  assert.equal(loadCollection({ dir }).index.stickers.length, 0);
  assert.equal(collectionStats({ dir }).count, 0);
});

test('并发收藏不会丢条目', async () => {
  const { dir, archiveIndexFile } = tempEnv();
  const results = await Promise.all(
    [6, 7, 8].map((seed) => addCollectedImage({ buffer: pngBuffer(480, 480, seed), dir, archiveIndexFile }))
  );
  assert.equal(results.filter((item) => item.created).length, 3);
  assert.equal(loadCollection({ dir }).index.stickers.length, 3);
});
