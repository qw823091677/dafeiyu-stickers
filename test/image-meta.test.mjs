import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, readImageMeta, sniffMime } from '../src/image-meta.mjs';

function pngHeader(width, height, { apng = false } = {}) {
  const parts = [];
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  parts.push(signature);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8;
  ihdr[17] = 6;
  parts.push(ihdr);
  if (apng) {
    // 规范要求 IHDR 是第一个块；acTL 位于 IHDR 之后、IDAT 之前。
    const actl = Buffer.alloc(16);
    actl.writeUInt32BE(8, 0);
    actl.write('acTL', 4, 'ascii');
    actl.writeUInt32BE(2, 8);
    actl.writeUInt32BE(0, 12);
    parts.push(actl);
  }
  return Buffer.concat(parts);
}

function gifHeader(width, height, { animated = false } = {}) {
  const head = Buffer.alloc(13);
  head.write('GIF89a', 0, 'ascii');
  head.writeUInt16LE(width, 6);
  head.writeUInt16LE(height, 8);
  const frames = Buffer.from(animated ? '\x21\xf9\x04\x00\x00\x00\x00\x00\x2c\x21\xf9\x04' : '\x21\xf9\x04', 'latin1');
  return Buffer.concat([head, frames]);
}

function webpHeader(width, height, { animated = false } = {}) {
  const buffer = Buffer.alloc(30);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(22, 4);
  buffer.write('WEBP', 8, 'ascii');
  buffer.write('VP8X', 12, 'ascii');
  buffer.writeUInt32LE(10, 16);
  buffer[20] = animated ? 0x02 : 0x00;
  buffer.writeUIntLE(width - 1, 24, 3);
  buffer.writeUIntLE(height - 1, 27, 3);
  return buffer;
}

function jpegHeader(width, height) {
  const buffer = Buffer.alloc(20);
  buffer[0] = 0xff;
  buffer[1] = 0xd8;
  buffer[2] = 0xff;
  buffer[3] = 0xc0;
  buffer.writeUInt16BE(17, 4);
  buffer[6] = 8;
  buffer.writeUInt16BE(height, 7);
  buffer.writeUInt16BE(width, 9);
  return buffer;
}

test('识别 PNG 尺寸与 APNG 动图标记', () => {
  assert.equal(sniffMime(pngHeader(480, 480)), 'image/png');
  const still = readImageMeta(pngHeader(380, 480));
  assert.deepEqual({ ...still }, { mime: 'image/png', width: 380, height: 480, animated: false, damaged: false });
  const animated = readImageMeta(pngHeader(480, 480, { apng: true }));
  assert.equal(animated.animated, true);
});

test('识别 GIF 尺寸与动图', () => {
  const still = readImageMeta(gifHeader(320, 480));
  assert.equal(still.mime, 'image/gif');
  assert.equal(still.width, 320);
  assert.equal(still.height, 480);
  assert.equal(still.animated, false);
  assert.equal(readImageMeta(gifHeader(320, 480, { animated: true })).animated, true);
});

test('识别 WebP VP8X 尺寸与动图', () => {
  const meta = readImageMeta(webpHeader(480, 270, { animated: true }));
  assert.equal(meta.mime, 'image/webp');
  assert.equal(meta.width, 480);
  assert.equal(meta.height, 270);
  assert.equal(meta.animated, true);
});

test('识别 JPEG 尺寸', () => {
  const meta = readImageMeta(jpegHeader(480, 456));
  assert.equal(meta.mime, 'image/jpeg');
  assert.equal(meta.width, 480);
  assert.equal(meta.height, 456);
});

test('非图片内容不误判', () => {
  assert.equal(sniffMime(Buffer.from('hello world, not an image')), '');
  assert.equal(readImageMeta(Buffer.from('hello world, not an image')), null);
});

test('formatBytes', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(3 * 1024 * 1024), '3.00 MB');
  assert.equal(formatBytes(-1), '?');
});
