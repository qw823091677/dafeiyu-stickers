// 测试夹具：一个包含 4 条记录（其中 1 条故意缺文件）的临时表情库。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function pngFile(dir, name, width = 480, height = 480) {
  const buffer = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  buffer[24] = 8;
  buffer[25] = 6;
  fs.writeFileSync(path.join(dir, name), buffer);
}

export function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dafeiyu-search-'));
  const imagesDir = path.join(dir, 'images');
  fs.mkdirSync(imagesDir);
  pngFile(imagesDir, 'happy-eat.png', 480, 480);
  pngFile(imagesDir, 'sleepy.png', 360, 480);
  pngFile(imagesDir, 'work-sad.png', 480, 270);
  // cute.png 故意不创建，用来测 available 过滤

  const tags = [
    { name: '开心', count: 1, group: '情绪' },
    { name: '吃饭', count: 1, group: '日常' },
    { name: '睡觉', count: 1, group: '日常' },
    { name: '工作', count: 1, group: '日常' },
    { name: '委屈', count: 1, group: '情绪' },
    { name: '卖萌', count: 1, group: '社交' }
  ];
  const stickers = [
    {
      id: 'happy-eat',
      file: 'happy-eat.png',
      caption: '鲸鱼娘端着大碗开心干饭：今天也要吃饱饱',
      tags: ['开心', '吃饭'],
      groups: ['情绪', '日常'],
      width: 480,
      height: 480,
      orientation: 'square',
      mime: 'image/png',
      bytes: 33,
      animated: false,
      sha256: 'a'.repeat(64),
      source: { page: 'https://fisharchive.cc/gallery', original: 'https://fisharchive.cc/media/happy-eat.png' }
    },
    {
      id: 'sleepy',
      file: 'sleepy.png',
      caption: '困得睁不开眼，先睡一会',
      tags: ['睡觉'],
      groups: ['日常'],
      width: 360,
      height: 480,
      orientation: 'portrait',
      mime: 'image/png',
      bytes: 33,
      animated: false,
      sha256: 'b'.repeat(64),
      source: { page: 'https://fisharchive.cc/gallery', original: 'https://fisharchive.cc/media/sleepy.png' }
    },
    {
      id: 'work-sad',
      file: 'work-sad.png',
      caption: '被需求折磨到委屈，但还得继续改',
      tags: ['工作', '委屈'],
      groups: ['日常', '情绪'],
      width: 480,
      height: 270,
      orientation: 'landscape',
      mime: 'image/png',
      bytes: 33,
      animated: false,
      sha256: 'c'.repeat(64),
      source: { page: 'https://fisharchive.cc/gallery', original: 'https://fisharchive.cc/media/work-sad.png' }
    },
    {
      id: 'cute',
      file: 'cute.png',
      caption: '卖萌贴贴',
      tags: ['卖萌'],
      groups: ['社交'],
      width: 480,
      height: 480,
      orientation: 'square',
      mime: 'image/png',
      bytes: 33,
      animated: false,
      sha256: 'd'.repeat(64),
      source: { page: 'https://fisharchive.cc/gallery', original: 'https://fisharchive.cc/media/cute.png' }
    }
  ];

  fs.writeFileSync(
    path.join(dir, 'index.json'),
    JSON.stringify({
      schemaVersion: 1,
      project: 'dafeiyu-stickers',
      name: 'test',
      source: { site: 'https://fisharchive.cc', manifest: '', manifestSha256: '', archiveRepo: '' },
      license: { name: 'CC BY-NC-SA 4.0', url: '', note: '' },
      attribution: [],
      stats: { count: stickers.length, tags: tags.length, animated: 0, totalBytes: 99, dataVersion: 'test' },
      tags,
      stickers
    })
  );
  fs.writeFileSync(
    path.join(dir, 'tags.json'),
    JSON.stringify({
      version: 1,
      groups: { 情绪: ['开心', '委屈'], 日常: ['吃饭', '睡觉', '工作'], 社交: ['卖萌'] },
      aliases: {
        开心: ['高兴', '好耶', '快乐'],
        睡觉: ['困', '好困', '困了', '晚安'],
        工作: ['上班', '老板', '需求'],
        委屈: ['被骂', '可怜'],
        卖萌: ['可爱', '贴贴']
      }
    })
  );

  return { dir, imagesDir };
}
