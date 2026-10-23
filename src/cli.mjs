#!/usr/bin/env node
// 命令行入口：同步档案馆、构建索引、检索、收藏 QQ 图片、查看署名。
// 所有命令都支持 --json，方便脚本 / bot 直接消费。

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { addCollectedImage, collectionLibrary, collectionStats, removeCollectedImage } from './collection.mjs';
import { buildIndex } from './index-builder.mjs';
import { formatBytes } from './image-meta.mjs';
import { COLLECTION_DIR, COLLECTION_IMAGES_DIR, INDEX_FILE, LICENSE } from './paths.mjs';
import { collectPayload, getPayload, LICENSE_HINT, randomPayload, searchPayload, tagsPayload, creditPayload } from './payload.mjs';
import { collectFromQqMessage } from './qq-media.mjs';
import { getById, libraryStats, loadLibrary, randomPick, search, tagSummary } from './search.mjs';
import { fetchManifest, hashFile, syncAll } from './sync.mjs';

const HELP = `dafeiyu-stickers — 蓝色大肥鱼档案馆表情包本地化工具

用法：
  node src/cli.mjs sync [选项]              同步档案馆原图（默认也会重建索引）
  node src/cli.mjs verify                   校验本地文件与索引哈希
  node src/cli.mjs build-index [选项]       只重建索引
  node src/cli.mjs search <关键词...> [选项] 检索表情（--library local/all）
  node src/cli.mjs random [选项]            随机抽一张
  node src/cli.mjs get <id> [--json]        按 id 查看（支持 local- 收藏）
  node src/cli.mjs tags [--library local]   列出标签与同义词
  node src/cli.mjs credits [id] [--json]    查看版权署名
  node src/cli.mjs stats [--json]           查看两个库的统计
  node src/cli.mjs collect-file <图片路径> [--note ...] [--tags a,b]
                                            把本地图片收进收藏库
  node src/cli.mjs collect-qq --key group:123 --message-id 456 --token <会话令牌> [--index 1] [--note ...] [--tags a,b]
                                            从 QQ 消息收藏（调试用；bot 走 MCP 工具）
  node src/cli.mjs forget <id>              从收藏库删除一张

sync 选项：
  --refresh-manifest   先从 fisharchive.cc 重新拉取站内索引
  --force              忽略本地文件，全部重新下载
  --prune              删除不在站内索引里的多余图片
  --concurrency <n>    并发下载数（默认 3，站点请求勿高频）
  --no-index           同步后不重建索引

search / random 选项：
  --library <archive|local|all>  检索范围，默认 archive
  --tags <a,b>         标签过滤，支持口语同义词
  --group <组名>       情绪 / 社交 / 日常
  --limit <n>          search 返回数量（默认 5，最大 20）

通用选项：
  --json               输出机器可读 JSON
  -h, --help           显示帮助

示例：
  npm run sync
  npm run search -- 好困 --tags 睡觉 --limit 3
  npm run search -- 无语 --library local
  node src/cli.mjs collect-file D:\\pics\\cat.png --note "猫猫震惊，适合接离谱消息" --tags 震惊,搞笑
  node src/cli.mjs get local-1a2b3c4d5e
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

function normalizeLibrary(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'local' || text === 'collection') return 'local';
  if (text === 'all') return 'all';
  return 'archive';
}

function printImage(item, index) {
  const prefix = index == null ? '' : `${index + 1}. `;
  const width = item.width ?? item.size?.width;
  const height = item.height ?? item.size?.height;
  const bytes = item.bytes ?? item.size?.bytes;
  const animated = item.animated ?? item.size?.animated;
  const mime = item.mime || '';
  const flags = [mime.replace('image/', '').toUpperCase(), `${width}×${height}`, formatBytes(bytes)];
  if (animated) flags.push('动图');
  if (item.available === false) flags.push('⚠️ 本地缺失');
  const library = item.library || (String(item.id || '').startsWith('local-') || item.source?.platform === 'qq' || item.source?.platform === 'file' ? 'local' : 'archive');
  console.log(`${prefix}${item.caption || '(无注释)'}`);
  console.log(`   id: ${item.id}  [${library}]`);
  if (item.note) console.log(`   note: ${item.note}`);
  console.log(`   tags: ${(item.tags || []).join(' / ') || '—'}`);
  console.log(`   file: ${item.path}`);
  console.log(`   ${flags.join(' · ')}`);
}

function printLicense() {
  console.log(`\n${LICENSE.name} · ${LICENSE_HINT}`);
}

function withCollectionPath(entry) {
  if (!entry) return entry;
  return { ...entry, path: path.join(COLLECTION_IMAGES_DIR, entry.file), available: true };
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

function printSearch(result, label = '') {
  const tags = result.tags.length ? `标签：${result.tags.join(' / ')}` : '标签：—';
  console.log(`${label}「${result.query || '*' }」 ${tags} · 命中 ${result.total} 张，显示 ${result.returned} 张`);
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
}

function cmdSearch(values, positionals) {
  const mode = normalizeLibrary(values.library);
  const query = positionals.slice(1).join(' ');
  const options = {
    query,
    tags: splitTags(values.tags),
    group: values.group || '',
    limit: Number(values.limit) || 5
  };
  if (mode === 'local') {
    const result = search(collectionLibrary(), options);
    if (values.json) {
      console.log(JSON.stringify(searchPayload(result, { library: 'local' }), null, 2));
      return 0;
    }
    printSearch(result, '[本地收藏] ');
    printLicense();
    return 0;
  }
  if (mode === 'all') {
    const archive = search(loadLibrary(), options);
    const local = search(collectionLibrary(), options);
    if (values.json) {
      console.log(
        JSON.stringify(
          {
            library: 'all',
            archive: searchPayload(archive, { library: 'archive' }),
            local: searchPayload(local, { library: 'local' })
          },
          null,
          2
        )
      );
      return 0;
    }
    printSearch(archive, '[档案馆] ');
    console.log('');
    printSearch(local, '[本地收藏] ');
    printLicense();
    return 0;
  }
  const result = search(loadLibrary(), options);
  if (values.json) {
    console.log(JSON.stringify(searchPayload(result, { library: 'archive' }), null, 2));
    return 0;
  }
  printSearch(result, '[档案馆] ');
  printLicense();
  return 0;
}

function cmdRandom(values, positionals) {
  const mode = normalizeLibrary(values.library);
  const options = {
    query: values.query || positionals.slice(1).join(' '),
    tags: splitTags(values.tags),
    group: values.group || ''
  };
  const pickOne = (library) => randomPick(library, options);
  let chosen;
  if (mode === 'local') chosen = { library: 'local', result: pickOne(collectionLibrary()) };
  else if (mode === 'archive') chosen = { library: 'archive', result: pickOne(loadLibrary()) };
  else {
    const archive = pickOne(loadLibrary());
    const local = pickOne(collectionLibrary());
    const pool = [
      ...(archive.found ? [{ library: 'archive', result: archive }] : []),
      ...(local.found ? [{ library: 'local', result: local }] : [])
    ];
    chosen = pool.length ? pool[Math.floor(Math.random() * pool.length)] : { library: 'all', result: archive };
  }
  if (values.json) {
    console.log(JSON.stringify(randomPayload(chosen.result, { library: chosen.library }), null, 2));
    return 0;
  }
  if (!chosen.result.found) {
    console.log(`没抽到：${chosen.result.reason || '没有符合条件的表情'}`);
    return 1;
  }
  console.log(`随机一张（${chosen.library === 'local' ? '本地收藏' : '档案馆'}，候选 ${chosen.result.poolSize} 张）：\n`);
  printImage(chosen.result.result);
  printLicense();
  return 0;
}

function cmdGet(values, positionals) {
  const id = positionals[1];
  if (!id) die('用法：node src/cli.mjs get <id>');
  let item = getById(loadLibrary(), id);
  if (!item) item = getById(collectionLibrary(), id);
  if (values.json) {
    console.log(JSON.stringify(getPayload(item), null, 2));
    return item ? 0 : 1;
  }
  if (!item) {
    console.log(`没有 id 为 ${id} 的表情。先 npm run search 找 id。`);
    return 1;
  }
  printImage(item);
  console.log(`\n出处：${item.source?.original || item.source?.url || item.source?.page || '—'}`);
  printLicense();
  return 0;
}

function cmdTags(values) {
  const mode = normalizeLibrary(values.library) === 'local' ? 'local' : 'archive';
  const library = mode === 'local' ? collectionLibrary() : loadLibrary();
  const summary = tagSummary(library);
  if (values.json) {
    console.log(JSON.stringify(tagsPayload(summary, { library: mode }), null, 2));
    return 0;
  }
  if (!Object.keys(summary.groups).length) {
    console.log(`${mode === 'local' ? '收藏库' : '档案馆'}里还没有图片。`);
    return 0;
  }
  for (const [group, tags] of Object.entries(summary.groups)) {
    console.log(`\n【${group}】`);
    for (const tag of tags) {
      const aliases = tag.aliases.length ? `（${tag.aliases.join('、')}）` : '';
      console.log(`  ${tag.name} ${String(tag.count).padStart(3)} 张 ${aliases}`);
    }
  }
  printLicense();
  return 0;
}

function cmdCredits(values, positionals) {
  const archiveLibrary = loadLibrary();
  const id = positionals[1];
  let image = id ? getById(archiveLibrary, id) : null;
  if (!image && id) image = getById(collectionLibrary(), id);
  const payload = creditPayload({
    image,
    dataVersion: libraryStats(archiveLibrary).dataVersion,
    collection: collectionStats({ dir: COLLECTION_DIR })
  });
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
    console.log(`图片注释：${payload.image.note || payload.image.caption}`);
    console.log(`原始出处：${payload.image.sourceUrl || '—'}`);
  }
  console.log('');
  console.log(`本地收藏库：${payload.collection.count ?? 0} 张（与档案馆分开）`);
  console.log(payload.suggestedCitation);
  console.log(payload.notice);
  return 0;
}

function cmdStats(values) {
  const archive = libraryStats(loadLibrary());
  const local = collectionStats({ dir: COLLECTION_DIR });
  if (values.json) {
    console.log(JSON.stringify({ ok: true, archive, local }, null, 2));
    return 0;
  }
  console.log(archive.name);
  console.log(`  ${archive.count} 张 / ${archive.tags} 个标签 / 动图 ${archive.animated} 张 / ${formatBytes(archive.totalBytes)}`);
  console.log(`  数据版本：${archive.dataVersion}`);
  console.log(`  站点：${archive.source.site}（清单 sha256 ${String(archive.source.manifestSha256).slice(0, 12)}…）`);
  console.log(`  许可：${archive.license.name}`);
  console.log('');
  console.log('本地收藏库（QQ）');
  console.log(`  ${local.count} 张 / ${local.tags} 个标签 / 动图 ${local.animated} 张 / ${formatBytes(local.totalBytes)}`);
  console.log(`  目录：${COLLECTION_IMAGES_DIR}${local.exists ? '' : '（还没有收藏）'}`);
  if (local.updatedAt) console.log(`  最近更新：${local.updatedAt}`);
  return 0;
}

async function cmdCollectFile(values, positionals) {
  const file = positionals[1];
  if (!file) die('用法：node src/cli.mjs collect-file <图片路径> [--note ...] [--tags a,b]');
  let buffer;
  try {
    buffer = fs.readFileSync(file);
  } catch (error) {
    die(`读不到文件：${error.message}`);
  }
  const result = await addCollectedImage({
    buffer,
    note: values.note || '',
    tags: splitTags(values.tags),
    source: { platform: 'file', collectedAt: new Date().toISOString() }
  });
  if (result.created && result.entry) result.entry = withCollectionPath(result.entry);
  if (result.entry) result.entry = withCollectionPath(result.entry);
  const payload = collectPayload(result, { key: 'file', messageId: path.basename(file) });
  if (values.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else if (payload.created) {
    console.log(`已收藏：${payload.image.id}`);
    printImage(payload.image);
  } else {
    console.log(payload.reason || '未收藏');
  }
  return 0;
}

async function cmdCollectQq(values) {
  const key = values.key;
  const messageId = values['message-id'];
  const token = values.token;
  if (!key || !messageId || !token) die('用法：node src/cli.mjs collect-qq --key <group:xxx|private:xxx> --message-id <id> --token <会话令牌>');
  const result = await collectFromQqMessage({
    key,
    messageId,
    token,
    index: Number(values.index) || 1,
    note: values.note || '',
    tags: splitTags(values.tags)
  });
  if (result.entry) result.entry = withCollectionPath(result.entry);
  const payload = collectPayload(result, { key, messageId });
  if (values.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else if (payload.created) {
    console.log(`已收藏：${payload.image.id}（原始文件保留：${result.picked?.preservedOriginal ? '是' : '否，动图可能已静态化'}）`);
    printImage(payload.image);
  } else {
    console.log(payload.reason || '未收藏');
  }
  return 0;
}

async function cmdForget(values, positionals) {
  const id = positionals[1];
  if (!id) die('用法：node src/cli.mjs forget <local-id>');
  const result = await removeCollectedImage(id);
  if (values.json) {
    console.log(JSON.stringify({ ok: result.removed, ...result }, null, 2));
    return result.removed ? 0 : 1;
  }
  console.log(result.removed ? `已删除：${id}` : `收藏库里没有 ${id}`);
  return result.removed ? 0 : 1;
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      json: { type: 'boolean', default: false },
      library: { type: 'string' },
      tags: { type: 'string' },
      group: { type: 'string' },
      limit: { type: 'string' },
      query: { type: 'string' },
      note: { type: 'string' },
      key: { type: 'string' },
      'message-id': { type: 'string' },
      token: { type: 'string' },
      index: { type: 'string' },
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
    case 'collect-file':
      return cmdCollectFile(values, positionals);
    case 'collect-qq':
      return cmdCollectQq(values);
    case 'forget':
      return cmdForget(values, positionals);
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
