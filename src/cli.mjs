#!/usr/bin/env node
// 命令行入口：同步原图、构建索引、检索、查看署名。
// 所有命令都支持 --json，方便脚本 / bot 直接消费。

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { buildIndex } from './index-builder.mjs';
import { formatBytes } from './image-meta.mjs';
import { INDEX_FILE, LICENSE } from './paths.mjs';
import { creditPayload, getPayload, LICENSE_HINT, randomPayload, searchPayload, tagsPayload } from './payload.mjs';
import { getById, libraryStats, loadLibrary, randomPick, search, tagSummary } from './search.mjs';
import { fetchManifest, hashFile, syncAll } from './sync.mjs';

const HELP = `dafeiyu-stickers — 蓝色大肥鱼档案馆表情包本地化工具

用法：
  node src/cli.mjs sync [选项]              同步原图（默认也会重建索引）
  node src/cli.mjs verify                   校验本地文件与索引哈希
  node src/cli.mjs build-index [选项]       只重建索引
  node src/cli.mjs search <关键词...> [选项] 检索表情
  node src/cli.mjs random [选项]            随机抽一张
  node src/cli.mjs get <id> [--json]        按 id 查看
  node src/cli.mjs tags [--json]            列出标签与同义词
  node src/cli.mjs credits [id] [--json]    查看版权署名
  node src/cli.mjs stats [--json]           查看库统计

sync 选项：
  --refresh-manifest   先从 fisharchive.cc 重新拉取站内索引
  --force              忽略本地文件，全部重新下载
  --prune              删除不在站内索引里的多余图片
  --concurrency <n>    并发下载数（默认 3，站点请求勿高频）
  --no-index           同步后不重建索引

search / random 选项：
  --tags <a,b>         标签过滤，支持口语同义词
  --group <组名>       情绪 / 社交 / 日常
  --limit <n>          search 返回数量（默认 5，最大 20）

通用选项：
  --json               输出机器可读 JSON
  -h, --help           显示帮助

示例：
  npm run sync
  npm run search -- 好困 --tags 睡觉 --limit 3
  npm run random -- --tags 卖萌
  node src/cli.mjs get deepseek-bao-bi-jujue --json
`;

function die(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function log(message) {
  process.stderr.write(`${message}\n`);
}

function splitTags(value) {
  if (!value) return [];
  return String(value)
    .split(/[,，、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function printImage(item, index) {
  const prefix = index == null ? '' : `${index + 1}. `;
  const flags = [item.mime?.replace('image/', '').toUpperCase(), `${item.width}×${item.height}`, formatBytes(item.bytes)];
  if (item.animated) flags.push('动图');
  if (!item.available) flags.push('⚠️ 本地缺失');
  console.log(`${prefix}${item.caption || '(无注释)'}`);
  console.log(`   id: ${item.id}`);
  console.log(`   tags: ${(item.tags || []).join(' / ') || '—'}`);
  console.log(`   file: ${item.path}`);
  console.log(`   ${flags.join(' · ')}`);
}

function printLicense() {
  console.log(`\n${LICENSE.name} · ${LICENSE_HINT}`);
}

async function cmdSync(values) {
  if (values['refresh-manifest']) await fetchManifest({ log });
  const summary = await syncAll({
    force: Boolean(values.force),
    prune: Boolean(values.prune),
    concurrency: Number(values.concurrency) || 3,
    log
  });
  log('');
  log(`同步完成：共 ${summary.total} 张，下载 ${summary.downloaded}，跳过 ${summary.skipped}，失败 ${summary.failed}，${formatBytes(summary.bytes)}`);
  if (summary.sizeMismatch) {
    log(`原图尺寸与站内展示尺寸不同：${summary.sizeMismatch} 张（正常：original 是原图，站内 width/height 是预览尺寸）`);
  }
  if (summary.warnings.length) {
    log(`警告 ${summary.warnings.length} 条：`);
    for (const warning of summary.warnings.slice(0, 10)) log(`  - ${warning}`);
  }
  if (summary.failures.length) {
    log(`失败清单：`);
    for (const failure of summary.failures) log(`  - ${failure.id}: ${failure.error}`);
  }
  if (!values['no-index'] && summary.failed === 0) {
    buildIndex({ log });
  } else if (!values['no-index'] && summary.failed > 0) {
    log('有失败项，跳过索引构建（修好后重跑 sync 即可）。');
  }
  return summary.failed > 0 ? 1 : 0;
}

async function cmdVerify(values) {
  // 逐张进度在这里没有意义：下面会统一汇总缺失/不符，失败项才值得打印。
  await syncAll({ verify: true, log: () => {} });
  let index;
  try {
    index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  } catch (error) {
    die(`索引不可读（${INDEX_FILE}）：${error.message}`);
  }
  const library = loadLibrary();
  let missing = 0;
  let mismatched = 0;
  let checked = 0;
  for (const entry of index.stickers) {
    const target = path.join(library.imagesDir, entry.file);
    if (!fs.existsSync(target)) {
      missing += 1;
      log(`✗ 缺失：${entry.id}`);
      continue;
    }
    const hash = await hashFile(target);
    checked += 1;
    if (hash !== entry.sha256) {
      mismatched += 1;
      log(`✗ 哈希不符：${entry.id}`);
    }
  }
  log('');
  log(`校验完成：${checked} 张通过，缺失 ${missing}，哈希不符 ${mismatched}`);
  if (values.json) {
    console.log(JSON.stringify({ ok: missing === 0 && mismatched === 0, checked, missing, mismatched }, null, 2));
  }
  return missing || mismatched ? 1 : 0;
}

function cmdBuildIndex(values) {
  const index = buildIndex({ allowMissing: Boolean(values['allow-missing']), log });
  if (values.json) console.log(JSON.stringify(index.stats, null, 2));
  return 0;
}

function printSearch(result) {
  const tags = result.tags.length ? `标签：${result.tags.join(' / ')}` : '标签：—';
  console.log(`「${result.query || '*' }」 ${tags} · 命中 ${result.total} 张，显示 ${result.returned} 张`);
  if (result.filters.unmatchedTags.length) console.log(`未识别标签：${result.filters.unmatchedTags.join('、')}`);
  console.log('');
  if (!result.results.length) {
    console.log('没有匹配结果。试试更宽的关键词、--tags，或 npm run tags 看可用标签。');
    return;
  }
  result.results.forEach((item, index) => {
    printImage(item, index);
    if (index !== result.results.length - 1) console.log('');
  });
  printLicense();
}

function cmdSearch(values, positionals) {
  const library = loadLibrary();
  const query = positionals.slice(1).join(' ');
  const result = search(library, {
    query,
    tags: splitTags(values.tags),
    group: values.group || '',
    limit: Number(values.limit) || 5
  });
  if (values.json) {
    console.log(JSON.stringify(searchPayload(result), null, 2));
    return 0;
  }
  printSearch(result);
  return 0;
}

function cmdRandom(values, positionals) {
  const library = loadLibrary();
  const result = randomPick(library, {
    query: values.query || positionals.slice(1).join(' '),
    tags: splitTags(values.tags),
    group: values.group || ''
  });
  if (values.json) {
    console.log(JSON.stringify(randomPayload(result), null, 2));
    return 0;
  }
  if (!result.found) {
    console.log(`没抽到：${result.reason || '没有符合条件的表情'}`);
    return 1;
  }
  console.log(`随机一张（候选 ${result.poolSize} 张）：\n`);
  printImage(result.result);
  printLicense();
  return 0;
}

function cmdGet(values, positionals) {
  const id = positionals[1];
  if (!id) die('用法：node src/cli.mjs get <id>');
  const library = loadLibrary();
  const item = getById(library, id);
  if (values.json) {
    console.log(JSON.stringify(getPayload(item), null, 2));
    return item ? 0 : 1;
  }
  if (!item) {
    console.log(`没有 id 为 ${id} 的表情。先 npm run search 找 id。`);
    return 1;
  }
  printImage(item);
  console.log(`\n出处：${item.source?.original || item.source?.page || '—'}`);
  printLicense();
  return 0;
}

function cmdTags(values) {
  const library = loadLibrary();
  const summary = tagSummary(library);
  if (values.json) {
    console.log(JSON.stringify(tagsPayload(summary), null, 2));
    return 0;
  }
  for (const [group, tags] of Object.entries(summary.groups)) {
    console.log(`【${group}】`);
    for (const tag of tags) {
      const aliases = tag.aliases.length ? `（${tag.aliases.join('、')}）` : '';
      console.log(`  ${tag.name} ${String(tag.count).padStart(3)} 张 ${aliases}`);
    }
    console.log('');
  }
  printLicense();
  return 0;
}

function cmdCredits(values, positionals) {
  const library = loadLibrary();
  const id = positionals[1];
  const image = id ? getById(library, id) : null;
  const payload = creditPayload({ image, dataVersion: libraryStats(library).dataVersion });
  if (values.json) {
    console.log(JSON.stringify(payload, null, 2));
    return id && !image ? 1 : 0;
  }
  if (id && !image) die(`没有 id 为 ${id} 的表情`);
  console.log(`${payload.archive.name} · ${payload.archive.site}`);
  console.log(`数据版本：${payload.dataVersion || '—'}`);
  console.log(`许可：${payload.license.name} — ${payload.license.url}`);
  console.log('');
  for (const item of payload.attribution) console.log(`${item.label}：${item.name} — ${item.url}`);
  if (payload.image) {
    console.log('');
    console.log(`图片注释：${payload.image.caption}`);
    console.log(`原始出处：${payload.image.sourceUrl}`);
  }
  console.log('');
  console.log(payload.suggestedCitation);
  console.log(payload.notice);
  return 0;
}

function cmdStats(values) {
  const library = loadLibrary();
  const stats = libraryStats(library);
  if (values.json) {
    console.log(JSON.stringify({ ok: true, ...stats }, null, 2));
    return 0;
  }
  console.log(`${stats.name}`);
  console.log(`  ${stats.count} 张 / ${stats.tags} 个标签 / 动图 ${stats.animated} 张 / ${formatBytes(stats.totalBytes)}`);
  console.log(`  数据版本：${stats.dataVersion}`);
  console.log(`  站点：${stats.source.site}（清单 sha256 ${String(stats.source.manifestSha256).slice(0, 12)}…）`);
  console.log(`  许可：${stats.license.name}`);
  return 0;
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      json: { type: 'boolean', default: false },
      tags: { type: 'string' },
      group: { type: 'string' },
      limit: { type: 'string' },
      query: { type: 'string' },
      'refresh-manifest': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      prune: { type: 'boolean', default: false },
      'no-index': { type: 'boolean', default: false },
      'allow-missing': { type: 'boolean', default: false },
      concurrency: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false }
    }
  });

  const command = positionals[0] || '';
  if (values.help || !command) {
    console.log(HELP);
    return 0;
  }

  switch (command) {
    case 'sync':
      return cmdSync(values);
    case 'verify':
      return cmdVerify(values);
    case 'build-index':
      return cmdBuildIndex(values);
    case 'search':
      return cmdSearch(values, positionals);
    case 'random':
      return cmdRandom(values, positionals);
    case 'get':
      return cmdGet(values, positionals);
    case 'tags':
      return cmdTags(values);
    case 'credits':
      return cmdCredits(values, positionals);
    case 'stats':
      return cmdStats(values);
    default:
      die(`未知命令：${command}\n\n${HELP}`);
  }
}

main()
  .then((code) => {
    process.exitCode = code || 0;
  })
  .catch((error) => {
    process.stderr.write(`出错：${error?.message || error}\n`);
    if (process.env.DEBUG) process.stderr.write(`${error?.stack || ''}\n`);
    process.exitCode = 1;
  });
