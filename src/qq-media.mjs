// 从 QQ 消息里取图并收进本地收藏库。
//
// 取图链路（不改 qq-bridge 源码，完全复用它的媒体能力）：
//   1. 调 qq-bridge 本地控制台 /api/images/message
//      需要两个头：x-console-token（控制台令牌，本地 state/console-token）+ x-agent-token（会话令牌，bot 传入）
//   2. 优先按返回的原始 URL 下载 —— 这样 GIF/动图能保留原样
//   3. 原始 URL 抓不到（rkey 过期、防盗链）时，回退到桥接返回的 base64（动图可能已被桥接转成静态 PNG）
//
// 安全：只接受 QQ 会话 key + messageId，不接受任意 URL/本地路径，避免变成 SSRF/任意文件读取。

import fs from 'node:fs';
import path from 'node:path';
import { fetchBuffer } from './http.mjs';
import { readImageMeta } from './image-meta.mjs';
import { QQ_BRIDGE_DIR, QQ_BRIDGE_URL } from './paths.mjs';
import { addCollectedImage } from './collection.mjs';

const MAX_BYTES = 20 * 1024 * 1024;

export class BridgeError extends Error {
  constructor(message, { status = 0, code = '' } = {}) {
    super(message);
    this.name = 'BridgeError';
    this.status = status;
    this.code = code;
  }
}

export function readBridgeSettings() {
  const dir = path.resolve(QQ_BRIDGE_DIR);
  const configPath = path.join(dir, 'config.json');
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new BridgeError(`读不到 qq-bridge 配置（${configPath}）：${error.message}；可设置 QQ_BRIDGE_DIR 指向桥接目录`);
  }
  const port = Number(config.consolePort) || 3100;
  const baseUrl = QQ_BRIDGE_URL || `http://127.0.0.1:${port}`;
  let consoleToken = '';
  try {
    consoleToken = fs.readFileSync(path.join(dir, 'state', 'console-token'), 'utf8').trim();
  } catch {
    consoleToken = '';
  }
  if (!consoleToken) {
    throw new BridgeError('缺少 qq-bridge 控制台令牌（state/console-token）；先在桥接控制台完成初始化');
  }
  return { dir, baseUrl, consoleToken };
}

export function validateSessionKey(key) {
  const value = String(key ?? '').trim();
  if (!/^(group|private):\d+$/.test(value)) {
    throw new BridgeError('key 格式应为 group:群号 或 private:QQ号');
  }
  return value;
}

async function requestImages({ key, messageId, token }) {
  const settings = readBridgeSettings();
  const params = new URLSearchParams({ key, messageId: String(messageId) });
  const url = `${settings.baseUrl}/api/images/message?${params.toString()}`;
  let response;
  try {
    response = await fetch(url, {
      headers: { 'x-console-token': settings.consoleToken, 'x-agent-token': token },
      signal: AbortSignal.timeout(90_000)
    });
  } catch (error) {
    throw new BridgeError(`连不上 qq-bridge（${settings.baseUrl}）：${error?.message || error}`);
  }
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BridgeError(`qq-bridge 返回了非 JSON 内容（HTTP ${response.status}）`, { status: response.status });
  }
  if (response.status === 401) throw new BridgeError('qq-bridge 控制台令牌无效（state/console-token 可能已重新生成）', { status: 401 });
  if (response.status === 403) throw new BridgeError(`qq-bridge 拒绝读取：${data?.error || '会话令牌无效或工具未启用'}`, { status: 403 });
  if (!response.ok || data?.ok === false) {
    throw new BridgeError(`qq-bridge 读取失败：${data?.error || `HTTP ${response.status}`}`, { status: response.status });
  }
  return data;
}

async function downloadOriginal(url) {
  if (!url) return null;
  try {
    const { buffer } = await fetchBuffer(String(url), {
      timeoutMs: 45_000,
      retries: 1,
      maxBytes: MAX_BYTES,
      headers: {
        // QQ 多媒体 CDN 对 UA/Referer 有时敏感；失败会自动回退到桥接 base64。
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        referer: 'https://q.qq.com/'
      }
    });
    const meta = readImageMeta(buffer);
    if (!meta || meta.damaged) return null;
    return { buffer, mime: meta.mime };
  } catch {
    return null;
  }
}

/**
 * 取一条消息里的第 index 张图片。
 * @returns {Promise<{buffer:Buffer,mime:string,url:string,preservedOriginal:boolean,bridgeMime:string,kind:string,count:number}>}
 */
export async function pickMessageImage({ key, messageId, token, index = 1 }) {
  const sessionKey = validateSessionKey(key);
  const id = String(messageId ?? '').trim();
  if (!id) throw new BridgeError('messageId 不能为空');
  const agentToken = String(token ?? '').trim();
  if (!agentToken) throw new BridgeError('缺少会话令牌 token（唤醒提示里的【会话令牌】）');

  const data = await requestImages({ key: sessionKey, messageId: id, token: agentToken });
  const images = Array.isArray(data.images) ? data.images : [];
  if (!images.length) {
    const media = Array.isArray(data.media) ? data.media : [];
    throw new BridgeError(media.length ? '消息里有媒体，但没有可取回的图片（可能获取失败）' : '这条消息没有图片/表情');
  }
  const position = Math.min(Math.max(1, Number(index) || 1), images.length);
  const image = images[position - 1] || {};
  const bridgeMime = String(image.mimeType || '');
  const url = String(image.url || '');
  const kind = image.kind === 'face' ? 'face' : 'image';

  let picked = url ? await downloadOriginal(url) : null;
  let preservedOriginal = Boolean(picked);
  if (!picked) {
    if (!image.data) {
      throw new BridgeError(`第 ${position} 张图片获取失败（桥接没有返回数据）`);
    }
    const buffer = Buffer.from(String(image.data), 'base64');
    const meta = readImageMeta(buffer);
    if (!meta || meta.damaged) throw new BridgeError('桥接返回的图片数据无法解析');
    picked = { buffer, mime: meta.mime };
  }

  return {
    buffer: picked.buffer,
    mime: picked.mime,
    url,
    preservedOriginal,
    bridgeMime,
    kind,
    count: images.length
  };
}

/**
 * 从 QQ 消息收藏一张图片到本地收藏库。
 */
export async function collectFromQqMessage({ key, messageId, token, index = 1, note, tags }) {
  const sessionKey = validateSessionKey(key);
  const picked = await pickMessageImage({ key: sessionKey, messageId, token, index });
  const result = await addCollectedImage({
    buffer: picked.buffer,
    note,
    tags,
    caption: note ? String(note).trim() : `从 QQ ${sessionKey} 收藏的图片`,
    source: {
      platform: 'qq',
      key: sessionKey,
      messageId: String(messageId ?? '').trim(),
      url: picked.url,
      originalMime: picked.bridgeMime || picked.mime,
      preservedOriginal: picked.preservedOriginal,
      collectedAt: new Date().toISOString()
    }
  });
  return {
    ...result,
    picked: {
      index: Math.min(Math.max(1, Number(index) || 1), picked.count),
      count: picked.count,
      mime: picked.mime,
      preservedOriginal: picked.preservedOriginal,
      kind: picked.kind
    }
  };
}
