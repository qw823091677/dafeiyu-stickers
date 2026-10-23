# 数据格式

## `data/manifest.source.json`

站点 `https://fisharchive.cc/stickers/index.json` 的**原始快照**，由 `sync --refresh-manifest` 更新。
字段（站方定义，本项目不改写）：

| 字段 | 说明 |
| --- | --- |
| `alt` | 图片注释（人工写的场景描述，检索的主要文本来源） |
| `tags` | 站方标签数组 |
| `width` / `height` | **预览展示尺寸**，不是原图尺寸 |
| `original` | 原图绝对 URL（下载源） |
| `preview` / `large` | WebP 预览 / 大图 URL |

## `data/index.json`

由 `src/index-builder.mjs` 生成，入库便于审阅。顶层：

| 字段 | 说明 |
| --- | --- |
| `schemaVersion` | 当前为 1 |
| `source.manifestSha256` | 清单快照的 sha256，用于判断"索引对的是哪一版站点数据" |
| `license` / `attribution` | 许可与署名，逐条对应站点「关于」页 |
| `stats` | 数量、标签数、动图数、总字节、`dataVersion`（清单哈希前 12 位） |
| `tags` | `{name, count, group}`，按数量倒序 |
| `stickers` | 条目数组，见下 |

单条：

| 字段 | 说明 |
| --- | --- |
| `id` | 站点文件名去扩展名，稳定、唯一（271 个） |
| `file` | 本地文件名（沿用站点原扩展名） |
| `caption` | 站点 `alt` 原文 |
| `tags` / `groups` | 站点标签 / 标签所属组 |
| `width` / `height` | **原图真实尺寸**（解析图片头得到） |
| `archiveSize` | 站点展示尺寸（原清单里的 `width`/`height`） |
| `mime` | 实际图片类型（按文件头判断，不信任扩展名） |
| `bytes` | 文件字节数 |
| `animated` | GIF / APNG / 动态 WebP |
| `sha256` | 原图哈希，`verify` 的比对基准 |
| `source` | `{page, original, preview, large}`，出处 |

## `data/tags.json`

人工维护，参与检索（不写回图片标签）：

```jsonc
{
  "groups": { "情绪": ["开心", "难过"], "社交": ["卖萌"], "日常": ["吃饭"] },
  "aliases": { "开心": ["高兴", "好耶", "快乐"] }
}
```

- `groups`：标签组，`search --group` 与 MCP 的 `group` 参数用；
- `aliases`：口语同义词，`search` 会把查询词映射到标准标签。

## `data/sync-state.json`（不入库）

每张图的 `file / url / sha256 / bytes / mime / width / height / archiveWidth / archiveHeight / animated / fetchedAt`。
用于增量同步与 `verify`；删除后重新 `sync` 会重新计算，不影响正确性。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `DAFEIYU_DATA_DIR` | 数据根目录（默认 `<repo>/data`） |
| `DAFEIYU_IMAGE_DIR` | 图片目录（默认 `<data>/images`） |

## 完整性约定

1. 下载先写临时文件、再原子 rename，避免半截文件；
2. 跳过的已有文件会重新计算 sha256 并与 `sync-state` 比对，不一致则重新下载；
3. `verify` 会重算全部文件哈希并与 `index.json` 比对，缺失 / 不符都返回非零退出码；
4. 任何"站内尺寸与实际尺寸不一致"只记录为 `archiveSize`，**不修改文件**。
