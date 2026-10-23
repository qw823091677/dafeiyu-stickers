// 零依赖图片头解析：识别真实格式、尺寸与动图标记。
//
// 这些信息用于校验「站点声明的尺寸/扩展名」与「实际文件」是否一致。
// 注意：只解析文件头，**绝不修改图片字节**——下载下来的原始文件原样保存。

import path from 'node:path';

export const MIME_BY_EXT = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.apng': 'image/apng',
  '.avif': 'image/avif'
});

export function sniffMime(buffer) {
  if (!buffer || buffer.length < 12) return '';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buffer.toString('ascii', 4, 8) === 'ftyp' && buffer.toString('ascii', 8, 12).includes('avif')) return 'image/avif';
  return '';
}

export function mimeByExt(file) {
  return MIME_BY_EXT[path.extname(file).toLowerCase()] || '';
}

function pngMeta(buffer) {
  if (buffer.length < 33) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  // APNG 在第一个 IDAT 之前会有 acTL 块。
  let animated = false;
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (type === 'acTL') {
      animated = true;
      break;
    }
    if (type === 'IDAT' || type === 'IEND') break;
    offset += 12 + length;
  }
  return { width, height, animated };
}

function jpegMeta(buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    // 无长度的标记
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
        animated: false
      };
    }
    offset += 2 + length;
  }
  return null;
}

function gifMeta(buffer) {
  if (buffer.length < 13) return null;
  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);
  const text = buffer.toString('latin1');
  const frames = (text.match(/\x21\xf9\x04/g) || []).length;
  const animated = frames > 1 || text.includes('NETSCAPE2.0') || text.includes('ANIMEXTS1.0');
  return { width, height, animated };
}

function webpMeta(buffer) {
  if (buffer.length < 30) return null;
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    const width = 1 + buffer.readUIntLE(24, 3);
    const height = 1 + buffer.readUIntLE(27, 3);
    const flags = buffer[20];
    return { width, height, animated: (flags & 0x02) !== 0 };
  }
  if (chunk === 'VP8 ') {
    // 关键帧头：3 字节帧标签 + 起始码 9D 01 2A，随后 14 位宽 / 14 位高。
    const start = buffer.indexOf(Buffer.from([0x9d, 0x01, 0x2a]), 20);
    if (start < 0) return null;
    const width = buffer.readUInt16LE(start + 3) & 0x3fff;
    const height = buffer.readUInt16LE(start + 5) & 0x3fff;
    return { width, height, animated: false };
  }
  if (chunk === 'VP8L') {
    const bits = buffer.readUInt32LE(21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { width, height, animated: false };
  }
  return null;
}

/**
 * 解析图片头。
 * @returns {{mime:string,width:number,height:number,animated:boolean}|null}
 */
export function readImageMeta(buffer) {
  const mime = sniffMime(buffer);
  if (!mime) return null;
  let meta = null;
  try {
    if (mime === 'image/png') meta = pngMeta(buffer);
    else if (mime === 'image/jpeg') meta = jpegMeta(buffer);
    else if (mime === 'image/gif') meta = gifMeta(buffer);
    else if (mime === 'image/webp') meta = webpMeta(buffer);
  } catch {
    meta = null;
  }
  if (!meta || !meta.width || !meta.height) {
    return { mime, width: 0, height: 0, animated: false, damaged: true };
  }
  return { mime, ...meta, damaged: false };
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '?';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
}
