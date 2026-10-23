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
| `stats` | 数量、标签数、动图数、站长自作数（`selfMade`）、总字节、`dataVersion`（清单哈希前 12 位） |
| `tags` | `{name, count, group}`，按数量倒序 |
| `stickers` | 条目数组，见下 |

单条：

| 字段 | 说明 |
| --- | --- |
| `id` | 站点文件名去扩展名，稳定、唯一（271 个） |
| `file` | 本地文件名（沿用站点原扩展名） |
| `caption` | 站点 `alt` 原文 |
| `selfMade` | 站点 `selfMade`：站长自作（EDMOK），当前 5 张 |
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

## `collection/index.json`（本地收藏库，不入库）

与档案馆 `data/index.json` **分开**：从 QQ 群聊/私聊收藏的图片单独一份索引。

```jsonc
{
  "schemaVersion": 1,
  "kind": "collection",
  "name": "本地收藏库（QQ 收藏）",
  "license": { "name": "CC BY-NC-SA 4.0" },
  "stats": { "count": 3, "tags": 4, "animated": 0, "totalBytes": 1234567, "updatedAt": "…" },
  "tags": [{ "name": "无语", "count": 2, "group": "情绪" }],
  "stickers": [
    {
      "id": "local-a33313d8d2",
      "file": "local-a33313d8d2.png",
      "caption": "从 QQ group:984323959 收藏的图片",
      "note": "被需求折磨，适合吐槽工作",       // 收藏时由模型写
      "tags": ["无语", "工作"],
      "groups": ["情绪", "日常"],
      "width": 3840, "height": 2160, "orientation": "landscape",
      "mime": "image/png", "bytes": 4234270, "animated": false,
      "sha256": "…",
      "source": {
        "platform": "qq",
        "key": "group:984323959",
        "messageId": "-726217640",
        "url": "https://multimedia.nt.qq.com.cn/…",
        "originalMime": "image/png",
        "preservedOriginal": false,             // 原始 URL 没下到、用了桥接数据
        "collectedAt": "…"
      },
      "addedAt": "…"
    }
  ]
}
```

- 去重：按 `sha256`；档案馆已有的图不会重复收藏；
- `id` 固定为 `local-<sha256 前 10 位>`，可用 `forget <id>` 删除；
- `collection/images/` 与 `collection/index.json` 默认不入 Git（含会话/发送者信息）。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `DAFEIYU_DATA_DIR` | 档案馆数据根目录（默认 `<repo>/data`） |
| `DAFEIYU_IMAGE_DIR` | 档案馆图片目录（默认 `<data>/images`） |
| `DAFEIYU_COLLECTION_DIR` | 本地收藏库根目录（默认 `<repo>/collection`） |
| `QQ_BRIDGE_DIR` | qq-bridge 目录（默认仓库同级 `../qq-bridge`） |
| `QQ_BRIDGE_URL` | 覆盖桥接控制台地址（默认读 `config.consolePort`） |

## 完整性约定

1. 下载先写临时文件、再原子 rename，避免半截文件；
2. 跳过的已有文件会重新计算 sha256 并与 `sync-state` 比对，不一致则重新下载；
3. `verify` 会重算全部文件哈希并与 `index.json` 比对，缺失 / 不符都返回非零退出码；
4. 任何"站内尺寸与实际尺寸不一致"只记录为 `archiveSize`，**不修改文件**；
5. 收藏库写入也先写临时文件；索引损坏时**拒绝继续写入**，避免覆盖已有收藏。
