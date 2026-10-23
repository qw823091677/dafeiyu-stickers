#!/usr/bin/env node
// 生成 docs/STICKERS.md：271 张表情的可读清单（不包含图片本体，只列注释 / 标签 / 出处）。
// 用法：node scripts/build-docs.mjs

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, INDEX_FILE, LICENSE } from '../src/paths.mjs';

const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
const stickers = [...index.stickers].sort((a, b) => a.id.localeCompare(b.id));

function cell(text) {
  return String(text ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n+/g, ' ')
    .trim();
}

const lines = [];
lines.push('# 表情总览');
lines.push('');
lines.push(`共 **${index.stats.count}** 张 · ${index.stats.tags} 个标签 · 动图 ${index.stats.animated} 张 · 站长自作 ${index.stats.selfMade || 0} 张 · 约 ${(index.stats.totalBytes / 1024 / 1024).toFixed(1)} MB（原图）。`);
lines.push('');
lines.push(`数据版本 \`${index.stats.dataVersion}\` ｜ 许可 **${LICENSE.name}**（禁止商用，转载须署名）。`);
lines.push('');
lines.push('> 本页由 `npm run docs` 从 `data/index.json` 生成。图片不在 Git 仓库里，运行 `npm run sync` 下载；');
lines.push('> 「原图」列直接指向档案馆的原始文件，可作为署名出处引用。');
lines.push('');
lines.push('| id | 注释 | 标签 | 尺寸 | 原图 |');
lines.push('| --- | --- | --- | --- | --- |');
for (const item of stickers) {
  const size = `${item.width}×${item.height}${item.animated ? ' · 动图' : ''}`;
  const badge = item.selfMade ? '**（站长自作）** ' : '';
  lines.push(
    `| \`${item.id}\` | ${badge}${cell(item.caption)} | ${cell(item.tags.join(' / '))} | ${size} | [原始出处](${item.source.original}) |`
  );
}
lines.push('');
lines.push('## 标签统计');
lines.push('');
lines.push('| 标签 | 数量 | 分组 |');
lines.push('| --- | ---: | --- |');
for (const tag of index.tags) {
  lines.push(`| ${tag.name} | ${tag.count} | ${tag.group || '—'} |`);
}
lines.push('');

const target = path.join(DATA_DIR, '..', 'docs', 'STICKERS.md');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, `${lines.join('\n')}\n`);
process.stdout.write(`已生成 ${target}（${stickers.length} 行）\n`);
