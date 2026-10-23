import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { getById, loadLibrary, normalize, randomPick, resolveTagFilters, search, tagSummary } from '../src/search.mjs';
import { makeFixture } from './fixtures.mjs';

function fixtureLibrary() {
  const { dir, imagesDir } = makeFixture();
  return loadLibrary({ indexFile: path.join(dir, 'index.json'), tagsFile: path.join(dir, 'tags.json'), imagesDir });
}

test('normalize 去掉空白与标点', () => {
  assert.equal(normalize('  开心，好耶！ '), '开心好耶');
  assert.equal(normalize('ＨＥＬＬＯ'), 'hello');
});

test('标签解析支持标准标签 / 同义词 / 分组', () => {
  const library = fixtureLibrary();
  const exact = resolveTagFilters(library, ['开心']);
  assert.deepEqual(exact.resolved[0].tags, ['开心']);
  assert.equal(exact.resolved[0].via, 'tag');

  const alias = resolveTagFilters(library, ['好困']);
  assert.deepEqual(alias.resolved[0].tags, ['睡觉']);
  assert.equal(alias.resolved[0].via, 'alias');

  const unknown = resolveTagFilters(library, ['不存在']);
  assert.deepEqual(unknown.unmatched, ['不存在']);
});

test('按标签检索（AND 语义）与分组过滤', () => {
  const library = fixtureLibrary();

  const result = search(library, { tags: ['开心'] });
  assert.deepEqual(result.results.map((item) => item.id), ['happy-eat']);

  const none = search(library, { tags: ['开心', '卖萌'] });
  assert.equal(none.results.length, 0);

  const daily = search(library, { group: '日常', limit: 10 });
  assert.deepEqual(new Set(daily.results.map((item) => item.id)), new Set(['happy-eat', 'sleepy', 'work-sad']));

  const social = search(library, { group: '社交' });
  // cute.png 不存在，默认不返回不可用的图
  assert.equal(social.results.length, 0);
  assert.equal(social.total, 1);
});

test('自然语言 / 同义词检索', () => {
  const library = fixtureLibrary();

  const sleepy = search(library, { query: '今天好困' });
  assert.equal(sleepy.results[0].id, 'sleepy');

  const happy = search(library, { query: '好耶' });
  assert.equal(happy.results[0].id, 'happy-eat');

  const boss = search(library, { query: '老板又改需求' });
  assert.equal(boss.results[0].id, 'work-sad');

  const caption = search(library, { query: '大碗' });
  assert.equal(caption.results[0].id, 'happy-eat');

  const empty = search(library, { query: '量子力学' });
  assert.equal(empty.results.length, 0);
});

test('结果带绝对路径、尺寸与出处，缺失文件标记 available=false', () => {
  const library = fixtureLibrary();
  const result = search(library, { tags: ['开心'] });
  const item = result.results[0];
  assert.equal(item.path, path.join(library.imagesDir, 'happy-eat.png'));
  assert.equal(item.available, true);
  assert.equal(item.width, 480);
  assert.equal(item.orientation, 'square');
  assert.match(item.source.original, /fisharchive\.cc/);

  const missing = getById(library, 'cute');
  assert.equal(missing.available, false);
});

test('random 只在候选池内抽，并支持 excludeIds', () => {
  const library = fixtureLibrary();
  for (let i = 0; i < 20; i += 1) {
    const picked = randomPick(library, { tags: ['工作'], rng: () => i / 20 });
    assert.equal(picked.found, true);
    assert.equal(picked.result.id, 'work-sad');
  }
  const excluded = randomPick(library, { tags: ['工作'], exclude: ['work-sad'], rng: () => 0.5 });
  assert.equal(excluded.found, false);
});

test('tagSummary 返回分组与同义词', () => {
  const library = fixtureLibrary();
  const summary = tagSummary(library);
  assert.equal(summary.total, 6);
  assert.deepEqual(summary.groups['日常'].map((item) => item.name), ['吃饭', '睡觉', '工作']);
  assert.ok(summary.groups['情绪'][0].aliases.includes('高兴'));
});
