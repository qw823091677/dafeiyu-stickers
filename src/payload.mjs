// 统一的结果载荷：CLI 的 --json 与 MCP 工具输出保持同一结构，方便 bot / 脚本复用。

import { ARCHIVE, ATTRIBUTION, LICENSE, SITE_ORIGIN } from './paths.mjs';

export const CREDIT_LINE = `${ARCHIVE.name}（${ARCHIVE.author} 整理）· 画师与出处见站点「来源与致谢」`;
export const LOCAL_CREDIT_LINE = '本地收藏（来自 QQ 聊天）· 版权归原作者，禁止商用';
export const AIGENGTU_CREDIT_LINE = '梗鲸（aigengtu.com）· 版权归原作者，禁止商用';
export const SEND_HINT =
  '把 path 原样传给 mcp__snowluma__qq_send_image 的 images 数组发送（一次 1~3 张），不要用 read/read_image 打开文件。';
export const COLLECT_HINT =
  '收藏成功。之后用 sticker_search({library:"local"}) 检索本地收藏；收藏库与档案馆索引分开存放。';
export const LICENSE_HINT = `图片版权归原作者所有，按 ${LICENSE.name} 使用：禁止商用、转载须署名并以相同方式共享。`;

export function isLocalEntry(item) {
  return Boolean(item?.source?.platform) || String(item?.id || '').startsWith('local-');
}

export function localCreditLine(item) {
  const platform = item?.source?.platform;
  if (platform === 'aigengtu') return AIGENGTU_CREDIT_LINE;
  if (platform === 'qq') return LOCAL_CREDIT_LINE;
  return '本地收藏 · 版权归原作者，禁止商用';
}

export function imagePayload(item) {
  const local = isLocalEntry(item);
  const selfMade = Boolean(item.selfMade);
  return {
    id: item.id,
    library: local ? 'local' : 'archive',
    path: item.path,
    available: item.available,
    caption: item.caption,
    note: item.note || '',
    selfMade,
    tags: item.tags,
    groups: item.groups,
    size: {
      width: item.width,
      height: item.height,
      bytes: item.bytes,
      animated: Boolean(item.animated)
    },
    mime: item.mime,
    license: LICENSE.name,
    credit: local ? localCreditLine(item) : selfMade ? '站长自作（EDMOK）· 依 CC BY-NC-SA 4.0 使用' : CREDIT_LINE,
    sourceUrl: local ? item.source?.url || item.source?.original || '' : item.source?.original || item.source?.page || SITE_ORIGIN,
    pageUrl: local ? item.source?.page || '' : item.source?.page || `${SITE_ORIGIN}/gallery`,
    origin: local
      ? {
          platform: item.source?.platform || '',
          key: item.source?.key || '',
          messageId: item.source?.messageId || '',
          page: item.source?.page || '',
          collectedAt: item.source?.collectedAt || '',
          preservedOriginal: Boolean(item.source?.preservedOriginal)
        }
      : undefined
  };
}

export function searchPayload(result, options = {}) {
  return {
    ok: true,
    library: options.library || 'archive',
    query: result.query,
    matchedTags: result.tags,
    queryTags: result.queryTags || [],
    unmatchedTags: result.filters?.unmatchedTags || [],
    group: result.filters?.group || '',
    total: result.total,
    returned: result.returned,
    images: result.results.map(imagePayload),
    hint: result.results.length
      ? SEND_HINT
      : options.library === 'local'
        ? '本地收藏库还没有匹配的图；让 bot 在 QQ 里看到值得收藏的图时用 sticker_collect 收藏。'
        : '没有匹配结果；试试更宽的关键词、tags 或 group，或改用 sticker_random。',
    license: LICENSE_HINT
  };
}

export function randomPayload(result, options = {}) {
  if (!result.found) {
    return {
      ok: false,
      library: options.library || 'archive',
      reason: result.reason || '没有符合条件且已同步到本地的表情',
      query: result.query,
      unmatchedTags: result.filters?.unmatchedTags || [],
      hint:
        options.library === 'local'
          ? '本地收藏库还没有符合条件的图；先在 QQ 里用 sticker_collect 收藏几张。'
          : '换一个 tags/group，或先去 QQ 桥接机器上运行 npm run sync。'
    };
  }
  return {
    ok: true,
    library: options.library || 'archive',
    query: result.query,
    poolSize: result.poolSize,
    image: imagePayload(result.result),
    hint: SEND_HINT,
    license: LICENSE_HINT
  };
}

export function getPayload(item) {
  if (!item) {
    return { ok: false, error: '没有这张表情', hint: '用 sticker_search 找 id，或直接按标签检索。' };
  }
  return { ok: true, image: imagePayload(item), hint: SEND_HINT, license: LICENSE_HINT };
}

export function collectPayload(result, options = {}) {
  const { key = '', messageId = '' } = options;
  if (!result.created) {
    if (result.reason === 'archive_exists') {
      return {
        ok: true,
        created: false,
        library: 'archive',
        reason: '档案馆索引里已经有同一张图，没有重复收藏',
        archive: result.archive,
        hint: `直接用 sticker_search({query:"${result.archive?.caption || ''}"}) 或 sticker_get({id:"${result.archive?.id || ''}"}) 取用。`
      };
    }
    if (result.reason === 'collection_exists') {
      return {
        ok: true,
        created: false,
        library: 'local',
        reason: '本地收藏库已有同一张图（按 sha256 去重）',
        image: imagePayload({ ...result.entry, path: result.entry.path || '', available: true })
      };
    }
    return { ok: false, created: false, reason: result.reason || '未收藏' };
  }
  return {
    ok: true,
    created: true,
    library: 'local',
    image: imagePayload(result.entry),
    source: { key, messageId },
    hint: COLLECT_HINT,
    license: LICENSE_HINT
  };
}

export function tagsPayload(summary, options = {}) {
  return {
    ok: true,
    library: options.library || 'archive',
    total: summary.total,
    groups: summary.groups,
    tags: summary.tags,
    hint: 'tags 参数支持这些标准标签及其口语同义词；group 用于按组过滤。',
    license: LICENSE_HINT
  };
}

export function creditPayload(options = {}) {
  const { image = null, dataVersion = '', collection = null, selfMade = 0 } = options;
  return {
    ok: true,
    dataVersion,
    license: LICENSE,
    attribution: ATTRIBUTION.map((item) => ({
      role: item.role,
      label: item.label,
      name: item.name,
      url: item.url
    })),
    archive: {
      name: ARCHIVE.name,
      site: ARCHIVE.site,
      author: ARCHIVE.author,
      repo: ARCHIVE.github,
      selfMade: Number(selfMade) || 0
    },
    collection: {
      name: '本地收藏库（QQ + 梗鲸）',
      note: '从 QQ 群聊/私聊收藏的图片，以及从梗鲸（aigengtu.com）导入的补充图；与档案馆索引分开，版权仍归原作者，可能涉及聊天中的他人作品，请仅本地使用、不要公开再分发。梗鲸来源的授权请在再分发前自行核实。',
      ...(collection || {})
    },
    image: image
      ? {
          id: image.id,
          caption: image.caption,
          note: image.note || '',
          selfMade: Boolean(image.selfMade),
          platform: image.source?.platform || '',
          sourceUrl: image.source?.url || image.source?.original || '',
          pageUrl: image.source?.page || '',
          credit: isLocalEntry(image) ? localCreditLine(image) : image.selfMade ? '站长自作（EDMOK）· 依 CC BY-NC-SA 4.0 使用' : CREDIT_LINE
        }
      : undefined,
    suggestedCitation: `表情素材：${ARCHIVE.name}（${ARCHIVE.author}），${ARCHIVE.site}；角色原作：上善无形；鲸鱼娘二次设计：ZipZipPipe。依 ${LICENSE.name} 使用，禁止商用。`,
    notice: '本站为非官方同人整理项目，不代表任何官方立场；如作者不希望作品被收录，请联系档案馆处理。'
  };
}
