#!/usr/bin/env node
// 把本地表情库接进 DSH / qq-bridge：
//   1) 在 DSH profile 的 cordis.patch.yml 注册 MCP server（mcp__<serverName>__*）
//   2) 在 qq-bridge 的 qq-tool-restrict.mjs 白名单里放行这个前缀
//   3) 在 qq-bridge config.json 的 socialV2.imageSend.roots 里加入图片目录
//   4) 在 qq-chat-v2 preset 的提示词里加一行「本地表情库」用法
//
// 所有改动都可逆：首次修改前备份为 <文件>.bak-dafeiyu；--uninstall 逐项还原。
// 幂等：重复执行只更新自己维护的块，不碰其他配置。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO_ROOT, DATA_DIR, IMAGES_DIR } from '../src/paths.mjs';

const MCP_START = '# === dafeiyu-stickers MCP BEGIN ===';
const MCP_END = '# === dafeiyu-stickers MCP END ===';
const PROMPT_MARK = '【本地表情库】';
const PROMPT_TEXT =
  '【本地表情库】 想发表情、接梗、卖萌、吐槽但 QQ 收藏里没有合适的，先用 mcp__dafeiyu-stickers__sticker_search（tags/关键词，如 开心、工作、睡觉、无语、卖萌）或 mcp__dafeiyu-stickers__sticker_random 找；返回的 path 原样传给 mcp__snowluma__qq_send_image 的 images 数组（一次 1~3 张，别刷屏）。素材来自蓝色大肥鱼档案馆，CC BY-NC-SA 4.0，禁止商用；正式/敏感话题别硬塞。';
const PROMPT_ANCHOR = '【操作即动作，不是 API】';

function parseArgs(argv) {
  const options = {
    dshHome: process.env.DSH_HOME || path.join(os.homedir(), '.dsh'),
    profile: 'auto',
    bridge: process.env.QQ_BRIDGE || path.resolve(REPO_ROOT, '..', 'qq-bridge'),
    imagesRoot: IMAGES_DIR,
    serverName: 'dafeiyu-stickers',
    dryRun: false,
    uninstall: false,
    guard: true,
    imageRoots: true,
    prompt: true,
    repoPreset: true
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    switch (arg) {
      case '--dsh-home':
        options.dshHome = path.resolve(next());
        break;
      case '--profile':
        options.profile = next();
        break;
      case '--bridge':
        options.bridge = path.resolve(next());
        break;
      case '--images-root':
        options.imagesRoot = path.resolve(next());
        break;
      case '--server-name':
        options.serverName = next();
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--uninstall':
        options.uninstall = true;
        break;
      case '--no-guard':
        options.guard = false;
        break;
      case '--no-image-roots':
        options.imageRoots = false;
        break;
      case '--no-prompt':
        options.prompt = false;
        break;
      case '--no-repo-preset':
        options.repoPreset = false;
        break;
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`未知参数：${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`用法：node scripts/install-dsh.mjs [选项]

  --dsh-home <dir>    DSH 数据目录（默认 $DSH_HOME 或 ~/.dsh）
  --profile <name>    只安装到指定 profile；默认写入所有已存在的 profile
                      （DSH 桌面版用 desktop、dsh web 用 web，两个都写最稳）
  --bridge <dir>      qq-bridge 目录（默认仓库同级的 ../qq-bridge）
  --images-root <dir> 表情图片目录（默认本仓库 data/images）
  --server-name <n>   MCP server 名（默认 dafeiyu-stickers → 工具前缀 mcp__dafeiyu-stickers__）
  --no-guard          不修改 qq-tool-restrict 白名单
  --no-image-roots    不修改 qq-bridge config.json 的发图根目录
  --no-prompt         不修改 qq-chat-v2 的提示词
  --no-repo-preset    只改 DSH 安装副本，不改 qq-bridge 仓库里的 preset 源文件
  --uninstall         撤销以上全部改动
  --dry-run           只打印将要做什么，不写文件
`);
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

/**
 * 解析要写入的 profile。
 *
 * DSH 桌面版和 `dsh web` 用的是不同 profile 目录（desktop / web），同一个 3080 端口
 * 可能来自任意一个。只写一个很容易出现「配置看起来对、MCP 却根本没启动」，
 * 所以默认把所有带 cordis.patch.yml 的 profile 都写上；用 --profile 可收窄。
 */
function resolveProfiles(options) {
  if (options.profile && options.profile !== 'auto') return [options.profile];
  const root = path.join(options.dshHome, 'profiles');
  if (!fs.existsSync(root)) return ['web'];
  const profiles = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(root, name, 'cordis.patch.yml')))
    .sort();
  return profiles.length ? profiles : ['web'];
}

function backupOnce(file) {
  const backup = `${file}.bak-dafeiyu`;
  if (!fs.existsSync(backup)) {
    fs.copyFileSync(file, backup);
    log(`  备份：${backup}`);
  }
}

function writeTextAtomic(file, text, options) {
  if (options.dryRun) {
    log(`  [dry-run] 写入 ${file}（${Buffer.byteLength(text)} 字节）`);
    return;
  }
  backupOnce(file);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function yamlSingleQuote(value) {
  return String(value).replace(/'/g, "''");
}

function mcpBlock(options) {
  const serverPath = path.join(REPO_ROOT, 'src', 'mcp-server.mjs');
  return [
    MCP_START,
    '# 由 dafeiyu-stickers/scripts/install-dsh.mjs 维护；整块会被替换，勿手改内部条目。',
    '- insert:',
    `    - id: mcp-${options.serverName}`,
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    `        serverName: ${options.serverName}`,
    '        transport: stdio',
    `        command: '${yamlSingleQuote(process.execPath)}'`,
    '        args:',
    `          - '${yamlSingleQuote(serverPath)}'`,
    '        toolCallTimeoutMs: 60000',
    MCP_END
  ].join('\n');
}

function updateCordis(options, profileName) {
  const file = path.join(options.dshHome, 'profiles', profileName, 'cordis.patch.yml');
  log(`\n[1/4] DSH MCP 注册（profile: ${profileName}）：${file}`);
  if (!fs.existsSync(file)) {
    if (options.uninstall) {
      log('  文件不存在，跳过');
      return;
    }
    if (options.dryRun) {
      log('  [dry-run] 文件不存在，将创建');
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '[]\n');
      log('  文件不存在，已创建空 profile patch');
    }
  }
  const original = fs.existsSync(file) ? readText(file) : '[]\n';
  let text = original;
  const start = text.indexOf(MCP_START);
  const end = text.indexOf(MCP_END);
  const hasBlock = start >= 0 && end > start;

  if (options.uninstall) {
    if (!hasBlock) {
      log('  没有本工具的 MCP 块，跳过');
      return;
    }
    text = text
      .replace(new RegExp(`\\n?${MCP_START}[\\s\\S]*?${MCP_END}\\n?`, 'g'), '\n')
      .replace(/\n{3,}/g, '\n\n');
  } else if (hasBlock) {
    text = `${text.slice(0, start)}${mcpBlock(options)}\n${text.slice(end + MCP_END.length).replace(/^\n+/, '\n')}`;
  } else {
    const bridgeEnd = '# === qq-bridge MCP END ===';
    const anchor = text.indexOf(bridgeEnd);
    if (anchor >= 0) {
      const insertAt = anchor + bridgeEnd.length;
      text = `${text.slice(0, insertAt)}\n\n${mcpBlock(options)}${text.slice(insertAt)}`;
    } else {
      text = `${text.replace(/\s+$/, '')}\n\n${mcpBlock(options)}\n`;
    }
  }
  if (text !== original) {
    writeTextAtomic(file, text, options);
    log(options.uninstall ? '  已移除 MCP 块' : '  已写入 MCP 块');
  } else {
    log('  已是最新，无需修改');
  }
}

function updateGuard(file, options, label) {
  log(`  ${label}：${file}`);
  if (!fs.existsSync(file)) {
    log('  文件不存在，跳过');
    return;
  }
  const prefix = `mcp__${options.serverName}__`;
  const original = readText(file);
  let lines = original.split('\n');
  const hasPrefix = lines.some((line) => line.trim().startsWith(`'${prefix}'`));
  if (options.uninstall) {
    if (!hasPrefix) {
      log('  没有本工具的白名单条目，跳过');
      return;
    }
    lines = lines.filter((line) => !line.trim().startsWith(`'${prefix}'`));
  } else {
    if (hasPrefix) {
      log('  已放行，无需修改');
      return;
    }
    const anchorIndex = lines.findIndex((line) => line.includes('const SAFE_PREFIXES = ['));
    if (anchorIndex < 0) {
      log('  ⚠️ 找不到 SAFE_PREFIXES 数组，跳过（需手动把前缀加进工具白名单）');
      return;
    }
    lines.splice(anchorIndex + 1, 0, `  '${prefix}',`);
  }
  writeTextAtomic(file, lines.join('\n'), options);
  log(options.uninstall ? '  已移除白名单条目' : '  已加入工具白名单');
}

function updateGuards(options) {
  log('\n[2/4] qq-bridge 工具白名单');
  const files = [
    [path.join(options.bridge, 'plugins', 'qq-agent-presets', 'qq-tool-restrict.mjs'), '仓库副本'],
    [path.join(options.dshHome, 'plugins', 'qq-agent-presets', 'qq-tool-restrict.mjs'), 'DSH 安装副本']
  ];
  for (const [file, label] of files) updateGuard(file, options, label);
}

function updateImageRoots(options) {
  log('\n[3/4] qq-bridge 发图白名单');
  const file = path.join(options.bridge, 'config.json');
  if (!fs.existsSync(file)) {
    log(`  ⚠️ 找不到 ${file}，跳过`);
    return;
  }
  const original = readText(file);
  let config;
  try {
    config = JSON.parse(original.replace(/^\uFEFF/, ''));
  } catch (error) {
    log(`  ⚠️ config.json 解析失败（${error.message}），跳过`);
    return;
  }
  config.socialV2 = config.socialV2 && typeof config.socialV2 === 'object' ? config.socialV2 : {};
  config.socialV2.imageSend = config.socialV2.imageSend && typeof config.socialV2.imageSend === 'object' ? config.socialV2.imageSend : {};
  const roots = Array.isArray(config.socialV2.imageSend.roots) ? config.socialV2.imageSend.roots.map(String) : [];
  const normalized = path.resolve(options.imagesRoot);
  const exists = roots.some((item) => {
    try {
      return path.resolve(item) === normalized;
    } catch {
      return false;
    }
  });
  if (options.uninstall) {
    if (!exists) {
      log('  没有本工具的根目录，跳过');
      return;
    }
    config.socialV2.imageSend.roots = roots.filter((item) => {
      try {
        return path.resolve(item) !== normalized;
      } catch {
        return true;
      }
    });
    // 原本没有 imageSend、卸载后也没有其他字段时，把空壳一起收掉，避免留下无用配置。
    if (config.socialV2.imageSend.roots.length === 0) {
      delete config.socialV2.imageSend.roots;
      if (Object.keys(config.socialV2.imageSend).length === 0) delete config.socialV2.imageSend;
      if (Object.keys(config.socialV2).length === 0) delete config.socialV2;
    }
  } else {
    if (exists) {
      log('  已包含图片目录，无需修改');
      return;
    }
    config.socialV2.imageSend.roots = [...roots, normalized];
  }
  const text = `${JSON.stringify(config, null, 2)}\n`;
  writeTextAtomic(file, text, options);
  log(options.uninstall ? '  已移除图片目录' : `  已加入 ${normalized}`);
  log('  ⚠️ 该配置在 qq-bridge 启动时读取，需要重启桥接后生效');
}

function updatePromptFile(file, options, label, indent = 16) {
  log(`  ${label}：${file}`);
  if (!fs.existsSync(file)) {
    log('  文件不存在，跳过');
    return;
  }
  const promptLine = `${' '.repeat(indent)}${PROMPT_TEXT}`;
  const original = readText(file);
  const lines = original.split('\n');
  const existingIndex = lines.findIndex((line) => line.includes(PROMPT_MARK) && line.includes('mcp__dafeiyu-stickers__'));
  if (options.uninstall) {
    if (existingIndex < 0) {
      log('  没有本工具的提示行，跳过');
      return;
    }
    lines.splice(existingIndex, 1);
  } else {
    if (existingIndex >= 0) {
      if (lines[existingIndex] === promptLine) {
        log('  已存在且内容一致，无需修改');
        return;
      }
      lines[existingIndex] = promptLine;
    } else {
      const anchorIndex = lines.findIndex((line) => line.includes(PROMPT_ANCHOR));
      if (anchorIndex < 0) {
        log(`  ⚠️ 找不到锚点「${PROMPT_ANCHOR}」，跳过（需手动把提示加进 preset）`);
        return;
      }
      lines.splice(anchorIndex, 0, promptLine);
    }
  }
  writeTextAtomic(file, lines.join('\n'), options);
  log(options.uninstall ? '  已移除提示行' : '  已写入提示行');
}

function updatePrompts(options) {
  log('\n[4/4] qq-chat-v2 提示词');
  const targets = [];
  if (options.repoPreset) {
    // patch 是生成物；源文件是 agent.cordis.yml（重新生成后仍能保留提示）。
    targets.push([
      path.join(options.bridge, 'dsh', 'agent-presets', 'qq-chat-v2', 'agent.cordis.yml'),
      '仓库源文件',
      6
    ]);
    targets.push([
      path.join(options.bridge, 'plugins', 'qq-agent-presets', 'presets', 'qq-chat-v2.patch.yml'),
      '仓库 patch 副本',
      16
    ]);
  }
  targets.push([
    path.join(options.dshHome, 'plugins', 'qq-agent-presets', 'presets', 'qq-chat-v2.patch.yml'),
    'DSH 安装副本',
    16
  ]);
  for (const [file, label, indent] of targets) updatePromptFile(file, options, label, indent);
}

function checkServer(options) {
  const server = path.join(REPO_ROOT, 'src', 'mcp-server.mjs');
  log('\n自检');
  log(`  MCP server：${server}`);
  log(`  图片目录：${path.resolve(options.imagesRoot)}（${fs.existsSync(options.imagesRoot) ? '存在' : '不存在，先运行 npm run sync'}）`);
  const indexPath = path.join(DATA_DIR, 'index.json');
  log(`  索引文件：${indexPath}（${fs.existsSync(indexPath) ? '存在' : '不存在'}）`);
  if (!fs.existsSync(server)) throw new Error('MCP server 源文件缺失');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const profiles = resolveProfiles(options);
  log(`dafeiyu-stickers 安装器${options.dryRun ? '（dry-run）' : ''}${options.uninstall ? '（卸载）' : ''}`);
  log(`  DSH_HOME：${options.dshHome}`);
  log(`  profile：${profiles.join(', ')}`);
  log(`  qq-bridge：${options.bridge}`);
  log(`  图片目录：${path.resolve(options.imagesRoot)}`);

  if (!fs.existsSync(options.bridge)) {
    throw new Error(`找不到 qq-bridge 目录：${options.bridge}（用 --bridge 指定）`);
  }
  if (!fs.existsSync(path.join(options.bridge, 'config.json'))) {
    throw new Error(`${options.bridge} 下没有 config.json，确认这是 qq-bridge 仓库根目录`);
  }

  for (const profile of profiles) updateCordis(options, profile);
  if (options.guard) updateGuards(options);
  if (options.imageRoots) updateImageRoots(options);
  if (options.prompt) updatePrompts(options);
  checkServer(options);

  if (options.uninstall) {
    log('\n已撤销接入。重启 DSH 后工具会消失。');
  } else {
    log('\n接入完成。下一步：');
    log('  1) 重启 DSH（MCP 工具与 preset 提示词在启动时加载）');
    log('  2) 重启 qq-bridge（socialV2.imageSend.roots 在启动时读取）');
    log('  3) new 一个 QQ 会话，确认工具列表出现 mcp__dafeiyu-stickers__sticker_search');
    log('  4) 群里试一句「来张困困的表情」，bot 应检索并调用 qq_send_image');
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`安装失败：${error?.message || error}\n`);
  process.exitCode = 1;
}
