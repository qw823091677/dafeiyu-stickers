import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addCollectedImage } from '../src/collection.mjs';
import { makeFixture, pngFile } from './fixtures.mjs';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'mcp-server.mjs');

function startServer(dataDir, extraEnv = {}) {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, DAFEIYU_DATA_DIR: dataDir, ...extraEnv },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });
  let buffer = '';
  let nextId = 1;
  const pending = new Map();

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    while (true) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const waiter = pending.get(message.id);
      if (waiter) {
        pending.delete(message.id);
        waiter.resolve(message);
      }
    }
  });
  child.stderr.on('data', () => {});

  const request = (method, params, timeoutMs = 5000) =>
    new Promise((resolve, reject) => {
      const id = nextId;
      nextId += 1;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP 请求超时：${method}`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        }
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });

  return {
    request,
    stop() {
      child.stdin.end();
      child.kill();
    }
  };
}

test('MCP：initialize / tools/list / tools/call 全链路', async (t) => {
  const { dir } = makeFixture();
  const collectionDir = path.join(dir, 'collection');
  pngFile(dir, 'local-tmp.png', 360, 360);
  const localBuffer = fs.readFileSync(path.join(dir, 'local-tmp.png'));
  const collected = await addCollectedImage({
    buffer: localBuffer,
    note: '本地收藏测试：困了',
    tags: ['睡觉'],
    dir: collectionDir,
    archiveIndexFile: path.join(dir, 'index.json')
  });
  assert.equal(collected.created, true);

  const server = startServer(dir, { DAFEIYU_COLLECTION_DIR: collectionDir });
  t.after(() => server.stop());

  const init = await server.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' }
  });
  assert.equal(init.jsonrpc, '2.0');
  assert.equal(init.result.serverInfo.name, 'dafeiyu-stickers');
  assert.match(init.result.instructions, /sticker_search/);

  const list = await server.request('tools/list', {});
  const names = list.result.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, [
    'sticker_collect',
    'sticker_credit',
    'sticker_get',
    'sticker_random',
    'sticker_search',
    'sticker_tags'
  ]);
  const searchTool = list.result.tools.find((tool) => tool.name === 'sticker_search');
  assert.equal(searchTool.inputSchema.type, 'object');

  const search = await server.request('tools/call', {
    name: 'sticker_search',
    arguments: { tags: ['开心'], limit: 3 }
  });
  assert.equal(search.result.isError, undefined);
  const payload = JSON.parse(search.result.content[0].text);
  assert.equal(payload.ok, true);
  assert.equal(payload.images[0].id, 'happy-eat');
  assert.equal(payload.images[0].path, path.join(dir, 'images', 'happy-eat.png'));
  assert.match(payload.images[0].license, /CC BY-NC-SA/);
  assert.match(payload.hint, /qq_send_image/);

  const localSearch = await server.request('tools/call', {
    name: 'sticker_search',
    arguments: { library: 'local', tags: ['睡觉'] }
  });
  const localPayload = JSON.parse(localSearch.result.content[0].text);
  assert.equal(localPayload.library, 'local');
  assert.equal(localPayload.images.length, 1);
  assert.equal(localPayload.images[0].library, 'local');
  assert.ok(localPayload.images[0].path.startsWith(collectionDir));

  const allSearch = await server.request('tools/call', {
    name: 'sticker_search',
    arguments: { library: 'all', tags: ['睡觉'], limit: 5 }
  });
  const allPayload = JSON.parse(allSearch.result.content[0].text);
  assert.equal(allPayload.library, 'all');
  assert.ok(allPayload.images.some((item) => item.library === 'archive'));
  assert.ok(allPayload.images.some((item) => item.library === 'local'));

  const localTags = await server.request('tools/call', {
    name: 'sticker_tags',
    arguments: { library: 'local' }
  });
  const localTagsPayload = JSON.parse(localTags.result.content[0].text);
  assert.equal(localTagsPayload.library, 'local');
  const daily = localTagsPayload.groups['日常'] || [];
  assert.equal(daily.find((tag) => tag.name === '睡觉')?.count, 1);

  const get = await server.request('tools/call', { name: 'sticker_get', arguments: { id: 'sleepy' } });
  const getPayload = JSON.parse(get.result.content[0].text);
  assert.equal(getPayload.image.id, 'sleepy');

  const missing = await server.request('tools/call', { name: 'sticker_get', arguments: { id: 'nope' } });
  const missingPayload = JSON.parse(missing.result.content[0].text);
  assert.equal(missingPayload.ok, false);

  const collectMissing = await server.request('tools/call', {
    name: 'sticker_collect',
    arguments: { key: 'group:1' }
  });
  assert.equal(collectMissing.result.isError, true);

  const credit = await server.request('tools/call', { name: 'sticker_credit', arguments: {} });
  const creditPayload = JSON.parse(credit.result.content[0].text);
  assert.equal(creditPayload.license.name, 'CC BY-NC-SA 4.0');
  assert.ok(creditPayload.attribution.length >= 1);
  assert.equal(creditPayload.collection.count, 1);
});

test('MCP：未知工具返回参数错误', async (t) => {
  const { dir } = makeFixture();
  const server = startServer(dir);
  t.after(() => server.stop());
  await server.request('initialize', { protocolVersion: '2024-11-05' });
  const response = await server.request('tools/call', { name: 'no_such_tool', arguments: {} });
  assert.equal(response.error.code, -32602);
});
