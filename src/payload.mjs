// 统一的结果载荷：CLI 的 --json 与 MCP 工具输出保持同一结构，方便 bot / 脚本复用。

import { ARCHIVE, ATTRIBUTION, LICENSE, SITE_ORIGIN } from './paths.mjs';

export const CREDIT_LINE = `${ARCHIVE.name}（${ARCHIVE.author} 整理）· 画师与出处见站点「来源与致谢」`;
export const SEND_HINT =
  '把 path 原样传给 mcp__snowluma__qq_send_image 的 images 数组发送（一次 1~3 张），不要用 read/read_image 打开文件。';
export const LICENSE_HINT = `图片版权归原作者所有，按 ${LICENSE.name} 使用：禁止商用、转载须署名并以相同方式共享。`;

export function imagePayload(item) {
  return {
    id: item.id,
    path: item.path,
    available: item.available,
    caption: item.caption,
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
    credit: CREDIT_LINE,
    sourceUrl: item.source?.original || item.source?.page || SITE_ORIGIN,
    pageUrl: item.source?.page || `${SITE_ORIGIN}/gallery`
  };
}

export function searchPayload(result) {
  return {
    ok: true,
    query: result.query,
    matchedTags: result.tags,
    queryTags: result.queryTags || [],
    unmatchedTags: result.filters?.unmatchedTags || [],
    group: result.filters?.group || '',
    total: result.total,
    returned: result.returned,
    images: result.results.map(imagePayload),
    hint: result.results.length ? SEND_HINT : '没有匹配结果；试试更宽的关键词、tags 或 group，或改用 sticker_random。',
    license: LICENSE_HINT
  };
}

export function randomPayload(result) {
  if (!result.found) {
    return {
      ok: false,
      reason: result.reason || '没有符合条件且已同步到本地的表情',
      query: result.query,
      unmatchedTags: result.filters?.unmatchedTags || [],
      hint: '换一个 tags/group，或先去 QQ 桥接机器上运行 npm run sync。'
    };
  }
  return {
    ok: true,
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

export function tagsPayload(summary) {
  return {
    ok: true,
    total: summary.total,
    groups: summary.groups,
    tags: summary.tags,
    hint: 'tags 参数支持这些标准标签及其口语同义词；group 用于按组过滤。',
    license: LICENSE_HINT
  };
}

export function creditPayload(options = {}) {
  const { image = null, dataVersion = '' } = options;
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
      repo: ARCHIVE.github
    },
    image: image
      ? {
          id: image.id,
          caption: image.caption,
          sourceUrl: image.source?.original || '',
          pageUrl: image.source?.page || '',
          credit: CREDIT_LINE
        }
      : undefined,
    suggestedCitation: `表情素材：${ARCHIVE.name}（${ARCHIVE.author}），${ARCHIVE.site}；角色原作：上善无形；鲸鱼娘二次设计：ZipZipPipe。依 ${LICENSE.name} 使用，禁止商用。`,
    notice: '本站为非官方同人整理项目，不代表任何官方立场；如作者不希望作品被收录，请联系档案馆处理。'
  };
}
