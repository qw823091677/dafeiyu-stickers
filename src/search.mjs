// 检索核心：标签 / 口语同义词 / 注释关键词 → 表情条目。
//
// 设计目标：
// - 纯函数、零依赖，CLI 与 MCP 共用同一套打分，避免"命令行能搜到、bot 搜不到"。
// - 中文不加词典：站点的 alt 注释本身就是最准确的关键词来源，标签同义词覆盖口语。
// - 同分随机打散：同一个查询连续调用不会永远推同一张，减少 bot 复读同图。

import fs from 'node:fs';
import path from 'node:path';
import { IMAGES_DIR, INDEX_FILE, TAGS_FILE } from './paths.mjs';
import { groupOfTag, loadTagCatalog } from './index-builder.mjs';

const PUNCT = /[\s\u3000，。！？!?、：:；;'"“”‘’（）()\[\]【】<>《》{}~～`|\\/+\-—–_=*#@&%$^·….,]/g;

export function normalize(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(PUNCT, '');
}

export function tokenize(query) {
  return String(query ?? '')
    .split(/[\s\u3000，。！？!?、：:；;'"“”‘’（）()\[\]【】<>《》{}~～`|\\/+\-—–_=*#@&%$^·….,]+/)
    .map((token) => normalize(token))
    .filter((token) => token.length > 0);
}

export function loadLibrary(options = {}) {
  const indexFile = options.indexFile || INDEX_FILE;
  const tagsFile = options.tagsFile || TAGS_FILE;
  const allowEmpty = options.allowEmpty === true;
  let index;
  try {
    index = JSON.parse(fs.readFileSync(indexFile, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      if (!allowEmpty) {
        throw new Error(`找不到索引 ${indexFile}；先运行 \`node src/cli.mjs sync\`（会顺带构建索引）`);
      }
      index = { schemaVersion: 1, name: '空库', stats: { count: 0 }, tags: [], stickers: [] };
    } else {
      throw new Error(`索引读取失败（${indexFile}）：${error.message}`);
    }
  }
  if (!Array.isArray(index.stickers)) {
    throw new Error(`索引格式异常（缺少 stickers 数组）：${indexFile}`);
  }
  if (index.stickers.length === 0 && !allowEmpty) {
    throw new Error(`索引里没有表情条目：${indexFile}`);
  }
  const catalog = loadTagCatalog(tagsFile);
  const tagNames = Array.isArray(index.tags) ? index.tags.map((item) => item.name) : [];
  // 本地收藏库可能还没有任何标签；把 catalog 里的标准标签补进来，
  // 这样 sticker_search({library:"local", tags:["睡觉"]}) 在收藏第一张之前也能正确解析。
  if (options.includeCatalogTags) {
    for (const names of Object.values(catalog.groups || {})) {
      for (const name of Array.isArray(names) ? names : []) {
        if (!tagNames.includes(name)) tagNames.push(name);
      }
    }
  }
  const tagNorm = new Map(tagNames.map((name) => [name, normalize(name)]));
  const aliases = new Map(tagNames.map((name) => [name, (catalog.aliases?.[name] || []).map(normalize).filter(Boolean)]));
  const entries = index.stickers.map((entry) => ({
    ...entry,
    tagsNorm: (entry.tags || []).map(normalize),
    captionNorm: normalize(entry.caption),
    idNorm: normalize(entry.id)
  }));
  const tagMeta = new Map((index.tags || []).map((item) => [item.name, item]));
  for (const name of tagNames) {
    if (!tagMeta.has(name)) tagMeta.set(name, { name, count: 0, group: groupOfTag(catalog, name) });
  }
  return {
    index,
    catalog,
    entries,
    byId: new Map(entries.map((entry) => [entry.id, entry])),
    tagNames,
    tagNorm,
    aliases,
    tagMeta,
    imagesDir: options.imagesDir || IMAGES_DIR
  };
}

/**
 * 把用户/模型给的标签解析成站内标准标签集合。
 * 支持：标准标签、同义词、组名、部分匹配。
 */
export function resolveTagFilters(library, tags = []) {
  const resolved = [];
  const unmatched = [];
  for (const raw of Array.isArray(tags) ? tags : []) {
    const text = String(raw ?? '').trim();
    if (!text) continue;
    const norm = normalize(text);
    if (!norm) continue;

    const exact = library.tagNames.filter((name) => library.tagNorm.get(name) === norm);
    if (exact.length) {
      resolved.push({ input: text, tags: exact, via: 'tag' });
      continue;
    }
    const viaAlias = library.tagNames.filter((name) =>
      (library.aliases.get(name) || []).some((alias) => alias === norm || (alias.length >= 2 && norm.includes(alias)))
    );
    if (viaAlias.length) {
      resolved.push({ input: text, tags: viaAlias, via: 'alias' });
      continue;
    }
    const partial = library.tagNames.filter((name) => {
      const tagNorm = library.tagNorm.get(name);
      return tagNorm.length >= 2 && (tagNorm.includes(norm) || norm.includes(tagNorm));
    });
    if (partial.length) {
      resolved.push({ input: text, tags: partial, via: 'partial' });
      continue;
    }
    unmatched.push(text);
  }
  return { resolved, unmatched };
}

function scoreToken(library, entry, token) {
  let best = 0;
  let bestTag = '';
  let via = '';

  for (let i = 0; i < entry.tags.length; i += 1) {
    const tag = entry.tags[i];
    const normTag = entry.tagsNorm[i];
    if (normTag === token) return { score: 140, tag, via: 'tag' };
    if (token.length >= 2 && token.includes(normTag)) {
      if (95 > best) {
        best = 95;
        bestTag = tag;
        via = 'tag';
      }
    } else if (normTag.includes(token) && token.length >= 2 && 70 > best) {
      best = 70;
      bestTag = tag;
      via = 'tag';
    }
  }

  for (const tag of entry.tags) {
    for (const alias of library.aliases.get(tag) || []) {
      let score = 0;
      if (alias === token) score = 90;
      else if (alias.length >= 2 && token.includes(alias)) score = 75;
      else if (token.length >= 2 && alias.includes(token)) score = 45;
      if (score > best) {
        best = score;
        bestTag = tag;
        via = 'alias';
      }
    }
  }

  if (token.length >= 2 && entry.captionNorm.includes(token)) {
    if (45 > best) {
      best = 45;
      bestTag = '';
      via = 'caption';
    }
  }
  if (token.length >= 2 && entry.idNorm.includes(token)) {
    if (25 > best) {
      best = 25;
      bestTag = '';
      via = 'id';
    }
  }
  return { score: best, tag: bestTag, via };
}

function scoreEntry(library, entry, tokens, whole) {
  if (!tokens.length) return { score: 0, matchedTags: new Set(), reasons: [] };
  let score = 0;
  const matchedTags = new Set();
  const reasons = new Set();
  for (const token of tokens) {
    const result = scoreToken(library, entry, token);
    score += result.score;
    if (result.tag) matchedTags.add(result.tag);
    if (result.via) reasons.add(result.via);
  }
  if (whole && whole.length >= 2 && whole !== tokens.join('') && entry.captionNorm.includes(whole)) {
    score += 30;
    reasons.add('caption');
  }
  return { score, matchedTags, reasons: [...reasons] };
}

function withPath(library, entry) {
  const filePath = path.join(library.imagesDir, entry.file);
  let available = false;
  try {
    available = fs.statSync(filePath).isFile();
  } catch {
    available = false;
  }
  return {
    id: entry.id,
    file: entry.file,
    path: filePath,
    available,
    caption: entry.caption,
    note: entry.note || '',
    selfMade: Boolean(entry.selfMade),
    tags: entry.tags,
    groups: entry.groups,
    width: entry.width,
    height: entry.height,
    orientation: entry.orientation,
    mime: entry.mime,
    bytes: entry.bytes,
    animated: entry.animated,
    source: entry.source
  };
}

export function search(library, options = {}) {
  const {
    query = '',
    tags = [],
    group = '',
    limit = 5,
    offset = 0,
    rng = Math.random,
    includeUnavailable = false
  } = options;

  const { resolved, unmatched } = resolveTagFilters(library, tags);
  const groupTags = group ? new Set(library.catalog.groups?.[group] || []) : null;
  const groupUnknown = Boolean(group) && (!library.catalog.groups?.[group] || library.catalog.groups[group].length === 0);
  const tokens = tokenize(query);
  const whole = normalize(query);

  const scored = [];
  const queryTagCounts = new Map();
  for (const entry of library.entries) {
    if (resolved.length) {
      const ok = resolved.every((filter) => entry.tags.some((tag) => filter.tags.includes(tag)));
      if (!ok) continue;
    }
    if (groupTags) {
      if (!entry.tags.some((tag) => groupTags.has(tag))) continue;
    }
    const scoredEntry = scoreEntry(library, entry, tokens, whole);
    if (tokens.length && scoredEntry.score <= 0) continue;
    for (const tag of scoredEntry.matchedTags) {
      queryTagCounts.set(tag, (queryTagCounts.get(tag) || 0) + 1);
    }
    scored.push({ entry, ...scoredEntry, tie: rng() });
  }

  scored.sort((a, b) => b.score - a.score || a.tie - b.tie);
  const queryTags = [...queryTagCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }));

  const start = Math.max(0, Number(offset) || 0);
  const size = Math.min(50, Math.max(1, Number(limit) || 5));
  const picked = scored.slice(start, start + size);
  const all = picked.map((item) => ({ ...withPath(library, item.entry), score: item.score, matchedTags: [...item.matchedTags], reasons: item.reasons }));
  const results = includeUnavailable ? all : all.filter((item) => item.available);

  return {
    query: String(query || ''),
    tags: resolved.flatMap((item) => item.tags),
    queryTags,
    filters: {
      inputTags: Array.isArray(tags) ? tags.map(String) : [],
      resolvedTags: resolved,
      unmatchedTags: unmatched,
      group: group || '',
      groupUnknown
    },
    total: scored.length,
    returned: results.length,
    results
  };
}

export function randomPick(library, options = {}) {
  const { query = '', tags = [], group = '', exclude = [], rng = Math.random, includeUnavailable = false } = options;
  const { resolved, unmatched } = resolveTagFilters(library, tags);
  const groupTags = group ? new Set(library.catalog.groups?.[group] || []) : null;
  const tokens = tokenize(query);
  const whole = normalize(query);
  const excluded = new Set(Array.isArray(exclude) ? exclude.map(String) : []);

  const pool = [];
  for (const entry of library.entries) {
    if (excluded.has(entry.id)) continue;
    if (resolved.length && !resolved.every((filter) => entry.tags.some((tag) => filter.tags.includes(tag)))) continue;
    if (groupTags && !entry.tags.some((tag) => groupTags.has(tag))) continue;
    if (tokens.length) {
      const scored = scoreEntry(library, entry, tokens, whole);
      if (scored.score <= 0) continue;
      pool.push({ entry, score: scored.score, matchedTags: scored.matchedTags });
    } else {
      pool.push({ entry, score: 0, matchedTags: new Set() });
    }
  }

  if (!pool.length) {
    return {
      found: false,
      query: String(query || ''),
      filters: { inputTags: tags, resolvedTags: resolved, unmatchedTags: unmatched, group: group || '' },
      poolSize: 0
    };
  }

  // 有查询词时只从最高分档里随机，避免"随机"把相关性冲掉；纯标签/无查询时全池随机。
  const maxScore = Math.max(...pool.map((item) => item.score));
  const candidates = maxScore > 0 ? pool.filter((item) => item.score >= maxScore * 0.75) : pool;
  const chosen = candidates[Math.floor(rng() * candidates.length)];
  const result = {
    ...withPath(library, chosen.entry),
    score: chosen.score,
    matchedTags: [...chosen.matchedTags]
  };
  if (!includeUnavailable && !result.available) {
    return {
      found: false,
      query: String(query || ''),
      reason: '图片文件未同步到本地',
      candidate: result.id
    };
  }
  return {
    found: true,
    query: String(query || ''),
    filters: { inputTags: tags, resolvedTags: resolved, unmatchedTags: unmatched, group: group || '' },
    poolSize: pool.length,
    result
  };
}

export function getById(library, id) {
  const entry = library.byId.get(String(id || '').trim());
  if (!entry) return null;
  return withPath(library, entry);
}

export function tagSummary(library, options = {}) {
  const groups = {};
  for (const [group, names] of Object.entries(library.catalog.groups || {})) {
    groups[group] = names
      .map((name) => ({ name, count: library.tagMeta.get(name)?.count || 0, aliases: library.catalog.aliases?.[name] || [] }))
      .filter((item) => item.count > 0 || options.includeEmpty);
  }
  return {
    total: library.tagNames.length,
    tags: library.tagNames.map((name) => ({
      name,
      count: library.tagMeta.get(name)?.count || 0,
      group: library.tagMeta.get(name)?.group || '',
      aliases: library.catalog.aliases?.[name] || []
    })),
    groups
  };
}

export function libraryStats(library) {
  const index = library.index;
  return {
    name: index.name,
    count: index.stats?.count ?? library.entries.length,
    tags: index.stats?.tags ?? library.tagNames.length,
    animated: index.stats?.animated ?? 0,
    selfMade: index.stats?.selfMade ?? 0,
    totalBytes: index.stats?.totalBytes ?? 0,
    dataVersion: index.stats?.dataVersion || '',
    license: index.license,
    attribution: index.attribution,
    source: index.source
  };
}
