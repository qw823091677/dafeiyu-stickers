// 路径与全局常量。
//
// 默认所有数据都在仓库内 `data/`；也允许用环境变量把数据目录搬到别处
// （例如放进 QQ 桥接的 state/ 以便发图白名单直接覆盖）：
//   DAFEIYU_DATA_DIR   数据根目录（默认 <repo>/data）
//   DAFEIYU_IMAGE_DIR  图片目录（默认 <data>/images）
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

export const SITE_ORIGIN = 'https://fisharchive.cc';
export const MANIFEST_URL = `${SITE_ORIGIN}/stickers/index.json`;
export const GALLERY_URL = `${SITE_ORIGIN}/gallery`;
export const ARCHIVE_GITHUB = 'https://github.com/EDMOK/blue-fish-archive';

export const PROJECT_NAME = 'dafeiyu-stickers';
export const SCHEMA_VERSION = 1;

// 抓取礼貌：站点 llms.txt 明确请求「请勿高频批量抓取」。
export const USER_AGENT =
  'dafeiyu-stickers/0.1.0 (+https://github.com/qw823091677/dafeiyu-stickers; sticker index for personal chat bot)';

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
