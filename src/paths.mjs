// 路径与全局常量。
//
// 默认所有数据都在仓库内 `data/`；也允许用环境变量把数据目录搬到别处
// （例如放进 QQ 桥接的 state/ 以便发图白名单直接覆盖）：
//   DAFEIYU_DATA_DIR        档案馆数据根目录（默认 <repo>/data）
//   DAFEIYU_IMAGE_DIR       档案馆图片目录（默认 <data>/images）
//   DAFEIYU_COLLECTION_DIR  本地收藏库根目录（默认 <repo>/collection，与档案馆完全分开）
//   QQ_BRIDGE_DIR           qq-bridge 目录（默认仓库同级的 ../qq-bridge）
//   QQ_BRIDGE_URL           覆盖桥接控制台地址（默认读 config.consolePort）
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.resolve(process.env.DAFEIYU_DATA_DIR || path.join(REPO_ROOT, 'data'));
export const IMAGES_DIR = path.resolve(process.env.DAFEIYU_IMAGE_DIR || path.join(DATA_DIR, 'images'));
export const MANIFEST_FILE = path.join(DATA_DIR, 'manifest.source.json');
export const INDEX_FILE = path.join(DATA_DIR, 'index.json');
export const TAGS_FILE = path.join(DATA_DIR, 'tags.json');
export const SYNC_STATE_FILE = path.join(DATA_DIR, 'sync-state.json');
export const USAGE_FILE = path.join(DATA_DIR, 'usage.json');

// 本地收藏库：从 QQ 群聊/私聊里收藏的图片，独立目录、独立索引，不与档案馆混在一起。
export const COLLECTION_DIR = path.resolve(process.env.DAFEIYU_COLLECTION_DIR || path.join(REPO_ROOT, 'collection'));
export const COLLECTION_INDEX_FILE = path.join(COLLECTION_DIR, 'index.json');
export const COLLECTION_IMAGES_DIR = path.join(COLLECTION_DIR, 'images');

// qq-bridge：收藏工具通过它的本地控制台 API 读取消息媒体（需要控制台令牌 + 会话令牌）。
export const QQ_BRIDGE_DIR = path.resolve(process.env.QQ_BRIDGE_DIR || path.join(REPO_ROOT, '..', 'qq-bridge'));
export const QQ_BRIDGE_URL = String(process.env.QQ_BRIDGE_URL || '').trim();

export const SITE_ORIGIN = 'https://fisharchive.cc';
export const MANIFEST_URL = `${SITE_ORIGIN}/stickers/index.json`;
export const GALLERY_URL = `${SITE_ORIGIN}/gallery`;
export const ARCHIVE_GITHUB = 'https://github.com/EDMOK/blue-fish-archive';

export const PROJECT_NAME = 'dafeiyu-stickers';
export const SCHEMA_VERSION = 1;

// 抓取礼貌：站点 llms.txt 明确请求「请勿高频批量抓取」。
export const USER_AGENT =
  'dafeiyu-stickers/0.2.0 (+https://github.com/qw823091677/dafeiyu-stickers; sticker index for personal chat bot)';

export const LICENSE = Object.freeze({
  name: 'CC BY-NC-SA 4.0',
  url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
  note: '角色二次设计依 CC BY-NC-SA 4.0 授权；单张作品的相关权利归各自创作者。禁止商业使用，转载须署名并以相同方式共享。'
});

// 站点「关于 / 来源与致谢」页明确列出的署名，逐字保留原文，方便二手使用者原样转载。
export const ATTRIBUTION = Object.freeze([
  { role: 'character', label: '鲸鱼娘角色形象原作', name: '上善无形', url: 'https://space.bilibili.com/291892724' },
  {
    role: 'design',
    label: 'DeepSeek 元素女仆鲸鱼娘二次设计',
    name: 'ZipZipPipe',
    url: 'https://space.bilibili.com/4168597'
  },
  { role: 'archive', label: '蓝色大肥鱼档案馆（网站作者 / 整理）', name: 'EDMOK', url: 'https://space.bilibili.com/4456176' }
].map(Object.freeze));

export const ARCHIVE = Object.freeze({
  name: '蓝色大肥鱼档案馆',
  site: SITE_ORIGIN,
  author: 'EDMOK',
  github: ARCHIVE_GITHUB
});
