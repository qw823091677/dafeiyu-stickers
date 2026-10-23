import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixture } from './fixtures.mjs';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'mcp-server.mjs');

function startServer(dataDir) {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, DAFEIYU_DATA_DIR: dataDir },
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
  const server = startServer(dir);
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
  assert.deepEqual(names, ['sticker_credit', 'sticker_get', 'sticker_random', 'sticker_search', 'sticker_tags']);
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

  const get = await server.request('tools/call', { name: 'sticker_get', arguments: { id: 'sleepy' } });
  const getPayload = JSON.parse(get.result.content[0].text);
  assert.equal(getPayload.image.id, 'sleepy');

  const missing = await server.request('tools/call', { name: 'sticker_get', arguments: { id: 'nope' } });
  const missingPayload = JSON.parse(missing.result.content[0].text);
  assert.equal(missingPayload.ok, false);

  const credit = await server.request('tools/call', { name: 'sticker_credit', arguments: {} });
  const creditPayload = JSON.parse(credit.result.content[0].text);
  assert.equal(creditPayload.license.name, 'CC BY-NC-SA 4.0');
  assert.ok(creditPayload.attribution.length >= 1);
});

test('MCP：未知工具返回参数错误', async (t) => {
  const { dir } = makeFixture();
  const server = startServer(dir);
  t.after(() => server.stop());
  await server.request('initialize', { protocolVersion: '2024-11-05' });
  const response = await server.request('tools/call', { name: 'no_such_tool', arguments: {} });
  assert.equal(response.error.code, -32602);
});
