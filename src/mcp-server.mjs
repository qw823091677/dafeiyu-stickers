#!/usr/bin/env node
// MCP stdio server：把两个本地图库暴露给 qq-bridge / DSH 的 bot：
//   archive  蓝色大肥鱼档案馆（271 张，只读索引，来自 data/）
//   local    本地收藏库（从 QQ 群聊/私聊收藏，collection/，与档案馆分开）
//
// 协议：JSON-RPC 2.0，按行分隔（MCP stdio transport）。
// 注意：stdout 只能写协议消息；日志一律走 stderr。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectionLibrary, collectionStats, collectionPaths } from './collection.mjs';
import { collectFromQqMessage } from './qq-media.mjs';
import { getById, libraryStats, loadLibrary, randomPick, search, tagSummary } from './search.mjs';
import {
  collectPayload,
  creditPayload,
  getPayload,
  LICENSE_HINT,
  randomPayload,
  searchPayload,
  tagsPayload
} from './payload.mjs';
import { COLLECTION_DIR, COLLECTION_IMAGES_DIR, INDEX_FILE } from './paths.mjs';

const PKG = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));

const SERVER_INSTRUCTIONS = [
  '这是两个本地表情图库：archive 是「蓝色大肥鱼档案馆」271 张鲸鱼娘同人表情；local 是你在 QQ 群聊/私聊里收藏的图（与档案馆分开存放）。',
  '想发表情、接梗、吐槽、卖萌、安慰或回应情绪时，先用 sticker_search / sticker_random 找图（默认 archive；也可以 library:"local" 或 "all"）；返回的 path 原样传给 qq_send_image 的 images 数组发送。',
  '在 QQ 里看到特别有用/少见/好笑、值得留的图时，先 qq_get_message_images 看图确认，再调用 sticker_collect 收进 local 库：note 写一句图意，tags 用标准标签。同一张会自动去重，不要每张都收。',
  '图片版权归原作者，按 CC BY-NC-SA 4.0 使用：禁止商用，转载保留署名。收藏的群聊图片可能涉及他人作品/隐私，只本地使用。'
].join('');

let archiveCache = null;
let archiveKey = '';
let collectionCache = null;
let collectionKey = '';

function fileKey(file) {
  try {
    const stat = fs.statSync(file);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return 'missing';
  }
}

function getArchive() {
  const key = fileKey(INDEX_FILE);
  if (archiveCache && archiveKey === key) return archiveCache;
  try {
    archiveCache = loadLibrary();
    archiveKey = key;
    return archiveCache;
  } catch (error) {
    archiveCache = null;
    throw error;
  }
}

function getCollection() {
  const key = fileKey(path.join(COLLECTION_DIR, 'index.json'));
  if (collectionCache && collectionKey === key) return collectionCache;
  collectionCache = collectionLibrary({ dir: COLLECTION_DIR });
  collectionKey = key;
  return collectionCache;
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

function normalizeLibrary(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'local' || text === 'collection') return 'local';
  if (text === 'all') return 'all';
  return 'archive';
}

const LIBRARY_PROP = {
  type: 'string',
  enum: ['archive', 'local', 'all'],
  description: '检索范围：archive=档案馆（默认），local=本地收藏库，all=两边一起搜。'
};

const TOOLS = [
  {
    name: 'sticker_search',
    title: '搜索本地表情库',
    description:
      '按标签、标签组或自然语言关键词检索表情。archive 是蓝色大肥鱼档案馆（271 张）；local 是从 QQ 收藏的本地库；all 两边都搜。返回 id、caption、tags、本地 path，path 直接给 qq_send_image。',
    inputSchema: {
      type: 'object',
      properties: {
        library: LIBRARY_PROP,
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
      '在满足标签/关键词的候选里随机抽一张，适合想发表情但没想好发哪张。library 可指定 archive / local / all。返回本地 path，可直接交给 qq_send_image。',
    inputSchema: {
      type: 'object',
      properties: {
        library: LIBRARY_PROP,
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
    name: 'sticker_collect',
    title: '收藏 QQ 消息里的图片',
    description:
      '把指定 QQ 消息里的一张图片/表情收进本地收藏库（collection/，与档案馆索引分开）。看到值得留的图时：先用 qq_get_message_images 看图确认，再调用本工具；note 写一句图意/适用场景，tags 用标准标签（2~4 个）。按 sha256 去重，重复收藏返回已有条目；档案馆里已有的图不会重复存。',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: '会话 key，格式 group:群号 或 private:QQ号。' },
        messageId: {
          type: ['string', 'integer'],
          description: '消息 id（来自 qq_get_unread_messages / qq_get_recent_messages 的 messageId 或 seq）。'
        },
        token: { type: 'string', description: '二代会话令牌（唤醒提示里的【会话令牌】），必填。' },
        index: { type: 'integer', minimum: 1, maximum: 9, description: '消息里有多张图时收藏第几张，默认 1。' },
        note: { type: 'string', description: '收藏注释：一句话说明图意/适合什么场景，例如「被需求折磨，适合吐槽工作」。' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: '标签，建议用标准标签（开心/委屈/工作/睡觉/卖萌/无语…），最多 10 个。'
        }
      },
      required: ['key', 'messageId', 'token'],
      additionalProperties: false
    }
  },
  {
    name: 'sticker_get',
    title: '按 id 取表情',
    description: '按 id 取单张表情的完整信息与本地路径。id 来自 sticker_search / sticker_random 的结果（local- 开头的是本地收藏）。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '表情 id，例如 deepseek-bao-bi-jujue 或 local-1a2b3c4d5e。' } },
      required: ['id'],
      additionalProperties: false
    }
  },
  {
    name: 'sticker_tags',
    title: '列出标签与同义词',
    description: '列出标签、数量、所属标签组与口语同义词。library 默认 archive；local 查看收藏库的标签分布。',
    inputSchema: {
      type: 'object',
      properties: {
        library: { type: 'string', enum: ['archive', 'local'], description: '默认 archive；local 查看本地收藏库。' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'sticker_credit',
    title: '获取版权署名',
    description:
      '返回数据版本、许可协议、角色原作/二次设计/整理者署名与转载要求；同时说明本地收藏库与档案馆的分开存放。传 id 可拿单张出处。',
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

function toolError(message, hint = '') {
  return { content: [{ type: 'text', text: jsonText({ ok: false, error: message, ...(hint ? { hint } : {}) }) }], isError: true };
}

function mergeSearchResults(first, second, library) {
  const merged = [...first.results.map((item) => ({ ...item, library: 'archive' })), ...second.results.map((item) => ({ ...item, library: 'local' }))];
  merged.sort((a, b) => (b.score || 0) - (a.score || 0));
  const queryTagCounts = new Map();
  for (const item of [...first.queryTags, ...second.queryTags]) {
    queryTagCounts.set(item.name, (queryTagCounts.get(item.name) || 0) + item.count);
  }
  return {
    query: first.query,
    tags: first.tags,
    queryTags: [...queryTagCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    filters: first.filters,
    total: first.total + second.total,
    returned: merged.length,
    results: merged,
    library
  };
}

async function callTool(name, args = {}) {
  switch (name) {
    case 'sticker_search': {
      const libraryMode = normalizeLibrary(args.library);
      const options = {
        query: String(args.query || ''),
        tags: coerceTags(args.tags),
        group: String(args.group || ''),
        limit: clampInt(args.limit, 1, 20, 5)
      };
      if (libraryMode === 'local') {
        const result = search(getCollection(), options);
        return { content: [{ type: 'text', text: jsonText(searchPayload(result, { library: 'local' })) }] };
      }
      const archiveResult = search(getArchive(), options);
      if (libraryMode === 'archive') {
        return { content: [{ type: 'text', text: jsonText(searchPayload(archiveResult, { library: 'archive' })) }] };
      }
      const localResult = search(getCollection(), options);
      const merged = mergeSearchResults(archiveResult, localResult, 'all');
      merged.results = merged.results.slice(0, options.limit);
      merged.returned = merged.results.length;
      return { content: [{ type: 'text', text: jsonText(searchPayload(merged, { library: 'all' })) }] };
    }
    case 'sticker_random': {
      const libraryMode = normalizeLibrary(args.library);
      const options = {
        query: String(args.query || ''),
        tags: coerceTags(args.tags),
        group: String(args.group || ''),
        exclude: Array.isArray(args.excludeIds) ? args.excludeIds.map(String) : []
      };
      if (libraryMode === 'local') {
        const result = randomPick(getCollection(), options);
        return { content: [{ type: 'text', text: jsonText(randomPayload(result, { library: 'local' })) }] };
      }
      if (libraryMode === 'archive') {
        const result = randomPick(getArchive(), options);
        return { content: [{ type: 'text', text: jsonText(randomPayload(result, { library: 'archive' })) }] };
      }
      const candidates = [
        { library: 'archive', result: randomPick(getArchive(), options) },
        { library: 'local', result: randomPick(getCollection(), options) }
      ].filter((item) => item.result.found);
      if (!candidates.length) {
        return {
          content: [
            {
              type: 'text',
              text: jsonText({ ok: false, library: 'all', reason: '两个库都没有符合条件的图', hint: '换 tags/group，或先收藏几张。' })
            }
          ]
        };
      }
      const chosen = candidates[Math.floor(Math.random() * candidates.length)];
      return { content: [{ type: 'text', text: jsonText(randomPayload(chosen.result, { library: chosen.library })) }] };
    }
    case 'sticker_collect': {
      const key = String(args.key || '').trim();
      const messageId = String(args.messageId ?? '').trim();
      const token = String(args.token || '').trim();
      const index = clampInt(args.index, 1, 9, 1);
      if (!key || !messageId || !token) return toolError('缺少参数：key / messageId / token 都必填');
      const result = await collectFromQqMessage({
        key,
        messageId,
        token,
        index,
        note: args.note ? String(args.note) : '',
        tags: coerceTags(args.tags)
      });
      if (result.created && result.entry) {
        result.entry = { ...result.entry, path: path.join(COLLECTION_IMAGES_DIR, result.entry.file), available: true };
      } else if (result.entry) {
        result.entry = { ...result.entry, path: path.join(COLLECTION_IMAGES_DIR, result.entry.file), available: true };
      }
      const payload = collectPayload(result, { key, messageId });
      if (result.picked) payload.picked = result.picked;
      return { content: [{ type: 'text', text: jsonText(payload) }] };
    }
    case 'sticker_get': {
      const id = String(args.id || '').trim();
      if (!id) return toolError('缺少 id');
      let item = getById(getArchive(), id);
      if (!item) item = getById(getCollection(), id);
      return { content: [{ type: 'text', text: jsonText(getPayload(item)) }] };
    }
    case 'sticker_tags': {
      const libraryMode = String(args.library || 'archive').toLowerCase() === 'local' ? 'local' : 'archive';
      const library = libraryMode === 'local' ? getCollection() : getArchive();
      return { content: [{ type: 'text', text: jsonText(tagsPayload(tagSummary(library), { library: libraryMode })) }] };
    }
    case 'sticker_credit': {
      const id = String(args.id || '').trim();
      let image = id ? getById(getArchive(), id) : null;
      if (id && !image) image = getById(getCollection(), id);
      if (id && !image) return toolError(`没有 id 为 ${id} 的表情`);
      return {
        content: [
          {
            type: 'text',
            text: jsonText(
              creditPayload({
                image,
                dataVersion: libraryStats(getArchive()).dataVersion,
                collection: collectionStats({ dir: COLLECTION_DIR })
              })
            )
          }
        ]
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
      const hint =
        name === 'sticker_collect'
          ? '确认 qq-bridge 正在运行、state/console-token 存在，并且传入的是该会话的 token；图片本身在 QQ 侧过期时需要重新触发消息。'
          : `确认已运行 npm run sync，且索引存在：${INDEX_FILE}`;
      reply(id, {
        content: [{ type: 'text', text: jsonText({ ok: false, error: String(error?.message || error), hint }) }],
        isError: true
      });
    }
    return;
  }

  if (isRequest) replyError(id, -32601, `Method not found: ${method}`);
}

if (process.argv.includes('--check')) {
  try {
    const archive = getArchive();
    const collection = getCollection();
    const collectionInfo = collectionStats({ dir: COLLECTION_DIR });
    process.stderr.write(
      `[dafeiyu-stickers] archive: ${archive.entries.length} 张 (${archive.imagesDir})；local: ${collection.entries.length} 张 (${collectionInfo.exists ? collectionInfo.totalBytes : 0} 字节, ${collection.imagesDir})\n`
    );
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
