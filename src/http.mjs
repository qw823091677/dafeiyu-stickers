// 极简 HTTP 客户端：超时、重试、429 退避、礼貌 User-Agent。
// 只依赖 Node 内置 fetch（>=18.17）。

import { USER_AGENT } from './paths.mjs';

export class HttpError extends Error {
  constructor(message, { status = 0, url = '', body = '' } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(response) {
  const raw = response.headers.get('retry-after');
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

/**
 * 下载一个 URL，返回 { buffer, response }。
 * 只对可重试的错误重试；4xx（除 408/425/429）直接抛出，避免无意义重试。
 */
export async function fetchBuffer(url, options = {}) {
  const {
    timeoutMs = 45_000,
    retries = 3,
    headers = {},
    signal,
    maxBytes = 30 * 1024 * 1024,
    onRetry = () => {}
  } = options;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: signal ?? AbortSignal.timeout(timeoutMs),
        headers: {
          'user-agent': USER_AGENT,
          accept: '*/*',
          ...headers
        }
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const error = new HttpError(`HTTP ${response.status} ${response.statusText}`, {
          status: response.status,
          url,
          body: body.slice(0, 300)
        });
        if (!RETRYABLE_STATUS.has(response.status) || attempt === retries) throw error;
        const wait = Math.max(retryAfterMs(response), 600 * 2 ** attempt) + Math.random() * 300;
        onRetry({ attempt, url, status: response.status, waitMs: Math.round(wait) });
        await sleep(wait);
        lastError = error;
        continue;
      }

      const length = Number(response.headers.get('content-length') || 0);
      if (length && length > maxBytes) {
        throw new HttpError(`文件过大（${length} 字节，上限 ${maxBytes}）`, { status: response.status, url });
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > maxBytes) {
        throw new HttpError(`文件过大（${buffer.length} 字节，上限 ${maxBytes}）`, { status: response.status, url });
      }
      return { buffer, response };
    } catch (error) {
      const isAbort = error?.name === 'AbortError' || error?.name === 'TimeoutError';
      const retryable = isAbort || error instanceof TypeError || (error instanceof HttpError && RETRYABLE_STATUS.has(error.status));
      if (!retryable || attempt === retries) {
        if (isAbort) throw new HttpError(`请求超时：${url}`, { url });
        throw error;
      }
      const wait = 600 * 2 ** attempt + Math.random() * 400;
      onRetry({ attempt, url, status: 0, waitMs: Math.round(wait), error });
      await sleep(wait);
      lastError = error;
    }
  }
  throw lastError;
}

export { sleep };
