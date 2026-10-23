#!/usr/bin/env node
// MCP stdio server：把本地表情库暴露成 5 个只读工具，供 qq-bridge / DSH 的 bot 调用。
//
// 协议：JSON-RPC 2.0，按行分隔（MCP stdio transport）。
// 注意：stdout 只能写协议消息；日志一律走 stderr。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getById, libraryStats, loadLibrary, randomPick, search, tagSummary } from './search.mjs';
import { creditPayload, getPayload, LICENSE_HINT, randomPayload, searchPayload, tagsPayload } from './payload.mjs';
import { INDEX_FILE } from './paths.mjs';

const PKG = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));

const SERVER_INSTRUCTIONS = [
  '这是「蓝色大肥鱼档案馆」本地表情库（鲸鱼娘 / DeepSeek 同人表情）。',
  '当你想发表情、接梗、吐槽、卖萌、安慰或回应情绪时，先用 sticker_search 或 sticker_random 找图；',
  '返回的 path 是本地文件，原样传给 qq_send_image 的 images 数组发送。',
  '图片版权归原作者，按 CC BY-NC-SA 4.0 使用：禁止商用，转载保留署名。'
].join('');

let cache = null;
let cacheError = null;

function getLibrary() {
  if (cache) return cache;
  if (cacheError) throw cacheError;
  try {
    cache = loadLibrary();
    return cache;
  } catch (error) {
    cacheError = error;
    throw error;
  }
}

function coerceTags(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string') return value.split(/[,，、\s]+/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

const TOOLS = [
  {
    name: 'sticker_search',
    title: '搜索本地表情库',
    description:
      '按标签、标签组或自然语言关键词检索鲸鱼娘表情。返回每张图的 id、caption（站内注释）、tags、本地绝对路径 path。拿到 path 后原样传给 qq_send_image 的 images 数组即可发送。',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '关键词/自然语言，例如「好困」「被老板骂」「开心地吃饭」「无语」。'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: '标准标签或口语同义词，例如 ["开心","吃饭"]。多个标签是「同时满足」。'
        },
        group: {
          type: 'string',
          enum: ['情绪', '社交', '日常'],
          description: '按标签组过滤：情绪 / 社交 / 日常。'
        },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: '返回数量，默认 5。' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'sticker_random',
    title: '随机抽一张表情',
    description:
      '在满足标签/关键词的候选里随机抽一张（同分档内随机），适合想发表情但没想好发哪张。返回本地 path，可直接交给 qq_send_image。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '可选：限定语义范围，例如「无语」「加油」。' },
        tags: { type: 'array', items: { type: 'string' }, description: '可选：标准标签或同义词。' },
        group: { type: 'string', enum: ['情绪', '社交', '日常'], description: '可选：标签组。' },
        excludeIds: {
          type: 'array',
          items: { type: 'string' },
          description: '可选：最近发过的 id，避免连续重复。'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'sticker_get',
    title: '按 id 取表情',
    description: '按 id 取单张表情的完整信息与本地路径。id 来自 sticker_search / sticker_random 的结果。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '表情 id，例如 deepseek-bao-bi-jujue。' } },
      required: ['id'],
      additionalProperties: false
    }
  },
  {
    name: 'sticker_tags',
    title: '列出标签与同义词',
    description: '列出全部标准标签、数量、所属标签组与口语同义词，用于挑选更准确的检索词。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'sticker_credit',
    title: '获取版权署名',
    description:
      '返回表情库的数据版本、许可协议、角色原作/二次设计/整理者署名与转载要求。传 id 可同时拿到该图的原始出处。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '可选：表情 id。' } },
      additionalProperties: false
    }
  }
];

function jsonText(payload) {
  return JSON.stringify(payload, null, 2);
}

function toolError(message) {
  return { content: [{ type: 'text', text: jsonText({ ok: false, error: message }) }], isError: true };
}

async function callTool(name, args = {}) {
  const library = getLibrary();
  switch (name) {
    case 'sticker_search': {
      const result = search(library, {
        query: String(args.query || ''),
        tags: coerceTags(args.tags),
        group: String(args.group || ''),
        limit: clampInt(args.limit, 1, 20, 5)
      });
      return { content: [{ type: 'text', text: jsonText(searchPayload(result)) }] };
    }
    case 'sticker_random': {
      const result = randomPick(library, {
        query: String(args.query || ''),
        tags: coerceTags(args.tags),
        group: String(args.group || ''),
        exclude: Array.isArray(args.excludeIds) ? args.excludeIds.map(String) : []
      });
      return { content: [{ type: 'text', text: jsonText(randomPayload(result)) }] };
    }
    case 'sticker_get': {
      const id = String(args.id || '').trim();
      if (!id) return toolError('缺少 id');
      return { content: [{ type: 'text', text: jsonText(getPayload(getById(library, id))) }] };
    }
    case 'sticker_tags':
      return { content: [{ type: 'text', text: jsonText(tagsPayload(tagSummary(library))) }] };
    case 'sticker_credit': {
      const id = String(args.id || '').trim();
      const image = id ? getById(library, id) : null;
      if (id && !image) return toolError(`没有 id 为 ${id} 的表情`);
      return {
        content: [{ type: 'text', text: jsonText(creditPayload({ image, dataVersion: libraryStats(library).dataVersion })) }]
      };
    }
    default:
      return null;
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handleMessage(message) {
  const { id, method, params } = message || {};
  const isRequest = id !== undefined && id !== null;

  if (typeof method !== 'string') {
    if (isRequest) replyError(id, -32600, 'Invalid Request');
    return;
  }

  if (method === 'initialize') {
    reply(id, {
      protocolVersion: params?.protocolVersion || '2024-11-05',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'dafeiyu-stickers', version: PKG.version },
      instructions: SERVER_INSTRUCTIONS
    });
    return;
  }
  if (method === 'notifications/initialized' || method.startsWith('notifications/')) return;

  if (method === 'ping') {
    if (isRequest) reply(id, {});
    return;
  }
  if (method === 'tools/list') {
    reply(id, { tools: TOOLS });
    return;
  }
  if (method === 'tools/call') {
    const name = params?.name;
    if (typeof name !== 'string') {
      replyError(id, -32602, '缺少工具名');
      return;
    }
    try {
      const result = await callTool(name, params?.arguments || {});
      if (!result) {
        replyError(id, -32602, `未知工具：${name}`);
        return;
      }
      reply(id, result);
    } catch (error) {
      process.stderr.write(`[dafeiyu-stickers] tool ${name} 失败：${error?.stack || error}\n`);
      reply(id, {
        content: [
          {
            type: 'text',
            text: jsonText({
              ok: false,
              error: String(error?.message || error),
              hint: `确认已运行 npm run sync，且索引存在：${INDEX_FILE}`
            })
          }
        ],
        isError: true
      });
    }
    return;
  }

  if (isRequest) replyError(id, -32601, `Method not found: ${method}`);
}

if (process.argv.includes('--check')) {
  try {
    const library = getLibrary();
    process.stderr.write(`[dafeiyu-stickers] 索引 OK：${library.entries.length} 张，图片目录 ${library.imagesDir}\n`);
    process.exit(0);
  } catch (error) {
    process.stderr.write(`[dafeiyu-stickers] 索引不可用：${error.message}\n`);
    process.exit(1);
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
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
      replyError(null, -32700, 'Parse error');
      continue;
    }
    handleMessage(message).catch((error) => {
      process.stderr.write(`[dafeiyu-stickers] 处理失败：${error?.stack || error}\n`);
      if (message?.id !== undefined && message?.id !== null) replyError(message.id, -32603, String(error?.message || error));
    });
  }
});
process.stdin.on('end', () => process.exit(0));
