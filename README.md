# dafeiyu-stickers（蓝色大肥鱼表情库工具）

[![test](https://github.com/qw823091677/dafeiyu-stickers/actions/workflows/test.yml/badge.svg)](https://github.com/qw823091677/dafeiyu-stickers/actions/workflows/test.yml)

把 [蓝色大肥鱼档案馆](https://fisharchive.cc/)（鲸鱼娘 DeepSeek 非官方同人表情站）的表情包**原图**同步到本地，
建立带标签/注释/哈希的索引，并提供 **CLI** 与 **MCP 工具**，让 QQ 机器人（qq-bridge / DSH）在聊天时能按情绪、场景直接检索和发送。

另外提供一个**独立的本地收藏库**：bot 在 QQ 群聊/私聊里看到值得留的图，可以收进 `collection/`（与档案馆索引分开），
自己写注释、打标签，之后按同样方式检索发送。

- 数据来源：[fisharchive.cc](https://fisharchive.cc/) · 站内清单 `https://fisharchive.cc/stickers/index.json`
- 当前数据版本：271 张 / 31 个标签 / 约 247 MB（原图，不转码、不压缩、不加水印）
- 代码许可：MIT ｜ 图片与角色：**CC BY-NC-SA 4.0（禁止商用）**，详见 [CREDITS.md](CREDITS.md)

> 这不是官方项目，也不代表 DeepSeek 或档案馆立场。图片版权归原作者所有，本项目只做本地化整理与检索工具。

## 它解决什么问题

QQ 收藏表情是"手动收藏、手动备注"的，bot 很难在合适的时机找到合适的图。
这个工具把档案馆的 271 张同人表情变成一份**可检索的本地图库**：

- 站内已有的 `alt` 注释与 `tags` 标签被完整保留，不重新编造；
- 补了一层口语同义词（"好困"→睡觉、"老板改需求"→工作），模型用自然语言也能搜到；
- 每张图记录 `sha256` / 字节数 / 真实尺寸 / 原始出处，可随时校验完整性；
- MCP 工具直接返回本地绝对路径，传给 `qq_send_image` 就能发，不需要模型读图或猜测。

## 特性

- **零依赖**：只用 Node.js 内置模块（`fetch` / `crypto` / `fs`），没有 npm 安装步骤。
- **原图保真**：按站点 `original` 字段下载，文件名与扩展名沿用站点，逐张校验图片头。
- **礼貌抓取**：默认 3 并发 + 150ms 间隔，遵守站点"请勿高频批量抓取"的要求。
- **可检索**：标签 AND 过滤、标签组（情绪/社交/日常）、自然语言 + 同义词、注释全文匹配。
- **可收藏**：bot 在 QQ 里看到有价值的图，可收进独立的本地收藏库；按 sha256 去重，与档案馆索引分开。
- **可校验**：`verify` 重新计算哈希并与索引比对；半截文件、磁盘损坏都能发现。
- **可接入**：一条命令接进 DSH / qq-bridge（MCP 注册 + 工具白名单 + 发图白名单 + 提示词），可 `--uninstall` 撤销。
- **可署名**：索引、CLI、MCP 输出都带许可与出处；不会把同人图说成"官方素材"。

## 快速开始

要求 **Node.js >= 18.17**（Windows / macOS / Linux 均可）。

```bash
git clone https://github.com/qw823091677/dafeiyu-stickers.git
cd dafeiyu-stickers

# 1) 下载 271 张原图（约 247 MB），完成后自动构建索引
npm run sync

# 2) 看看有什么
npm run stats
npm run tags
npm run search -- 好困 --limit 3
npm run random -- --tags 卖萌
```

> 不需要 `npm install`：项目没有运行时依赖。
> 只想校验已有文件：`npm run verify`。
> 站点更新后：`npm run sync -- --refresh-manifest`；需要全部重下：`npm run sync -- --force`。

## CLI

```bash
node src/cli.mjs sync [--refresh-manifest] [--force] [--prune] [--concurrency 3] [--no-index]
node src/cli.mjs verify                    # 重算 sha256 并和索引比对
node src/cli.mjs build-index [--allow-missing]
node src/cli.mjs search <关键词...> [--tags a,b] [--group 情绪|社交|日常] [--library archive|local|all] [--limit 5] [--json]
node src/cli.mjs random [--tags ...] [--group ...] [--library ...] [--json]
node src/cli.mjs get <id> [--json]
node src/cli.mjs tags [--library local] [--json]
node src/cli.mjs credits [id] [--json]
node src/cli.mjs stats [--json]
node src/cli.mjs collect-file <图片路径> [--note ...] [--tags a,b]
node src/cli.mjs collect-qq --key group:123 --message-id 456 --token <会话令牌> [--note ...] [--tags a,b]
node src/cli.mjs forget <local-id>
```

示例输出：

```text
$ node src/cli.mjs search 今天好困 --limit 2
「今天好困」 标签：— · 命中 9 张，显示 2 张

1. deepseek娘趴平冒着Z字，深度思考这次真睡到断线。
   id: deepseek-pa-zhe-shui-jiao
   tags: 卖萌 / 睡觉
   file: .../data/images/deepseek-pa-zhe-shui-jiao.webp
   WEBP · 512×512 · 38.8 KB
```

`--json` 输出的结构与 MCP 工具一致，方便脚本消费。

## MCP 工具（给 bot 用）

`src/mcp-server.mjs` 是一个 stdio MCP server，提供 6 个工具（除 `sticker_collect` 外都是只读）：

| 工具 | 作用 | 关键参数 |
| --- | --- | --- |
| `sticker_search` | 按标签/关键词检索，返回本地路径 | `query` / `tags` / `group` / `library` / `limit` |
| `sticker_random` | 在候选池里随机抽一张 | `tags` / `query` / `group` / `library` / `excludeIds` |
| `sticker_collect` | 把 QQ 消息里的图收进本地收藏库 | `key` / `messageId` / `token` / `index` / `note` / `tags` |
| `sticker_get` | 按 id 取单张（含 `local-` 收藏） | `id` |
| `sticker_tags` | 列出标签、数量、分组、同义词 | `library` |
| `sticker_credit` | 返回许可、署名、单张原始出处 | `id`（可选） |

`library` 取值：`archive`（默认，档案馆）、`local`（本地收藏库）、`all`（两边一起搜）。

调用示例（模型侧）：

```json
{"name": "sticker_search", "arguments": {"tags": ["睡觉"], "limit": 3}}
```

返回（节选）：

```json
{
  "ok": true,
  "images": [
    {
      "id": "deepseek-pa-zhe-shui-jiao",
      "path": "D:\\...\\data\\images\\deepseek-pa-zhe-shui-jiao.webp",
      "caption": "deepseek娘趴平冒着Z字，深度思考这次真睡到断线。",
      "tags": ["卖萌", "睡觉"],
      "size": {"width": 512, "height": 512, "bytes": 39724, "animated": false},
      "license": "CC BY-NC-SA 4.0"
    }
  ],
  "hint": "把 path 原样传给 mcp__snowluma__qq_send_image 的 images 数组发送（一次 1~3 张）…"
}
```

手动起服务调试：

```bash
node src/mcp-server.mjs --check   # 校验索引与图片目录
node src/mcp-server.mjs           # 等待 JSON-RPC（换行分隔）
```

## 本地收藏库（与档案馆分开）

`collection/` 是从 QQ 群聊/私聊里收藏的图片库，**不写进档案馆的 `data/index.json`**：

```text
collection/
├─ index.json    # 收藏索引：id / 注释 / 标签 / sha256 / 来源会话与消息 id
└─ images/       # 收藏的原图
```

流程（bot 侧）：

1. 消息带图时先 `qq_get_message_images` 看图；
2. 觉得值得留（少见/好用/好笑/以后想发），调用 `sticker_collect({key, messageId, token, note, tags})`；
3. 服务端通过 qq-bridge 本地 API 取图（优先原始 URL，失败回退桥接 base64），按 sha256 去重后落盘；
4. 之后用 `sticker_search({library:"local", tags:["无语"]})` 就能找到并发送。

- 收藏注释由模型写（一句话图意/适用场景），标签建议用标准标签；想手动整理可以用 `collect-file` / `forget`。
- 档案馆里已经存在的图不会重复收藏（返回 archive 命中）。
- **动图注意**：qq-bridge 返回给 DSH 的图片会把 GIF 转成静态 PNG（避免解码崩溃）；收藏时若原始 URL 能下到就保留原始 GIF，否则记录 `preservedOriginal:false`。
- **隐私**：收藏库会记录来源会话 key / messageId；`collection/` 已被 `.gitignore` 排除，只留在本机。不要公开再分发群友的图。
- **版权**：收藏图仍归原作者，CC BY-NC-SA 4.0，禁止商用。

## 接入 qq-bridge / DSH

一键接入本机的 DSH + qq-bridge：

```bash
node scripts/install-dsh.mjs --dry-run   # 先看会改哪些文件
node scripts/install-dsh.mjs
```

脚本会做四件事（全部幂等，首次修改前备份为 `*.bak-dafeiyu`）：

1. `$DSH_HOME/profiles/*/cordis.patch.yml`：注册 MCP server `dafeiyu-stickers`（默认写入所有 profile：桌面版是 `desktop`，`dsh web` 是 `web`）；
2. `qq-tool-restrict.mjs`（仓库副本 + DSH 安装副本）：放行 `mcp__dafeiyu-stickers__` 前缀，否则工具会被 QQ 安全白名单拒绝；
3. `qq-bridge/config.json`：把 `data/images` 与 `collection/images` 加进 `socialV2.imageSend.roots`，否则 `qq_send_image` 会拒绝发送这两个目录的图；
4. `qq-chat-v2` preset：加两行"本地表情库 / 收藏表情"用法，让模型知道先检索再发图、看到值得留的图再收藏。

改完需要**重启 DSH 和 qq-bridge**（两处配置都是启动时读取；DSH 有时会热加载 profile patch，但重启最稳）。撤销：

```bash
node scripts/install-dsh.mjs --uninstall
```

如果你不用自动脚本，参考 [integrations/qq-bridge/README.md](integrations/qq-bridge/README.md) 手动配置。
默认会写入**所有已存在的 DSH profile**（`desktop` 和 `web`）：DSH 桌面版实际加载的是 `desktop`，
只写 `web` 会出现「配置看起来对、MCP 却根本没启动」。用 `--dsh-home`、`--profile`、`--bridge`、`--images-root` 可覆盖。

> 图片目录被移走或换机器后，`qq_send_image` 会报"路径不在允许的目录内"：
> 重新运行安装脚本并重启桥接即可。

## 索引与注释

`data/index.json` 由 `sync` / `build-index` 生成（已入库，便于审阅与 diff）：

```jsonc
{
  "schemaVersion": 1,
  "source": { "site": "https://fisharchive.cc", "manifestSha256": "…" },
  "license": { "name": "CC BY-NC-SA 4.0", "url": "…" },
  "stats": { "count": 271, "tags": 31, "animated": 4, "totalBytes": 258992342, "dataVersion": "e78238e601c0" },
  "tags": [{ "name": "搞笑", "count": 87, "group": "社交" }],
  "stickers": [
    {
      "id": "deepseek-pa-zhe-shui-jiao",
      "file": "deepseek-pa-zhe-shui-jiao.webp",
      "caption": "deepseek娘趴平冒着Z字，深度思考这次真睡到断线。", // 站内 alt，原样保留
      "tags": ["卖萌", "睡觉"],
      "groups": ["社交", "日常"],
      "width": 512, "height": 512,          // 原图真实尺寸（用图片头解析）
      "archiveSize": { "width": 480, "height": 480 }, // 站点展示尺寸
      "mime": "image/webp", "bytes": 39724, "animated": false,
      "sha256": "…",
      "source": { "page": "…/gallery", "original": "…/media/…", "preview": "…", "large": "…" }
    }
  ]
}
```

- 注释来自档案馆的 `alt` 与 `tags`，本项目**不重写、不翻译、不擅自加戏**；
- `data/tags.json` 是人工维护的标签组与口语同义词（可自行扩充）；
- 站点的 `width/height` 是预览尺寸，原图通常更大，所以额外记录 `archiveSize`；
- `data/manifest.source.json` 是站内清单原始快照，`data/images/` 默认不入库（见 `.gitignore`）。

### 为什么原图不入库

一张同人图几 MB，271 张约 247 MB，直接塞进 Git 会让 clone 和 diff 都很难受；图片版权也属于原作者。
本仓库只提交**索引与校验信息**，`npm run sync` 会在本机重建图片目录。索引里的 `sha256` 保证你下到的是同一张图。

## 目录结构

```text
dafeiyu-stickers/
├─ src/
│  ├─ cli.mjs            # 命令行入口
│  ├─ sync.mjs           # 下载 + 校验 + 断点续传
│  ├─ index-builder.mjs  # 合并站内注释与本地校验结果
│  ├─ search.mjs         # 标签/同义词/注释检索
│  ├─ collection.mjs     # 本地收藏库（独立索引、去重、增删）
│  ├─ qq-media.mjs       # 从 qq-bridge 取 QQ 消息图片
│  ├─ mcp-server.mjs     # MCP stdio server（6 个工具）
│  ├─ payload.mjs        # CLI 与 MCP 共用的输出结构
│  ├─ image-meta.mjs     # 零依赖图片头解析（尺寸/动图）
│  └─ paths.mjs          # 路径、许可、署名常量
├─ data/
│  ├─ manifest.source.json  # 站内清单原始快照（入库）
│  ├─ index.json            # 增强索引（入库）
│  ├─ tags.json             # 标签组 + 口语同义词（入库）
│  └─ images/               # 原图（不入库，npm run sync 生成）
├─ collection/              # 本地收藏库（不入库，只在本机）
├─ scripts/install-dsh.mjs  # DSH / qq-bridge 接入器
├─ test/                    # node:test（21 项）
├─ integrations/            # 手动接入说明与配置片段
└─ docs/                    # 数据格式、表情总览
```

## 版权与署名（重要）

- 角色形象原作：**上善无形**（[Bilibili](https://space.bilibili.com/291892724)）
- DeepSeek 元素女仆鲸鱼娘二次设计：**ZipZipPipe**（[Bilibili](https://space.bilibili.com/4168597)），依 CC BY-NC-SA 4.0 授权
- 档案馆整理与网站：**EDMOK**（[Bilibili](https://space.bilibili.com/4456176) / [GitHub](https://github.com/EDMOK/blue-fish-archive)）
- 单张表情的相关权利归各自创作者；本项目**不主张**图片版权。
- 本地收藏库里的图片来自 QQ 聊天，版权仍归原作者；如果图主不希望被保存/传播，用 `forget <local-id>` 删除对应条目。

使用图片请遵守 **CC BY-NC-SA 4.0**：

- **禁止商业使用**（包括付费群、带货、商业 bot 服务等）；
- 转载/二次分发须**署名**并注明来源（蓝色大肥鱼档案馆 + 上述作者）；
- 修改后的作品须以**相同协议**共享；
- 保留出处链接，不要去除署名。

如果你的作品不希望被收录，或发现署名有误，请通过档案馆的 QQ 群 / GitHub 联系站方处理；本仓库会同步移除索引条目。
完整声明见 [CREDITS.md](CREDITS.md)。

## 开发

```bash
node --test test/*.test.mjs   # 21 项：图片头解析 / 检索 / 收藏库 / MCP 协议
```

- 新增标签组或同义词：改 `data/tags.json`，跑 `npm run build-index`（索引里的 `group` 会更新）；
- 站点新增表情：`npm run sync -- --refresh-manifest`；
- 修改 MCP 工具：同步更新 `src/payload.mjs` 与 README 的工具表。

## License

- **代码**（`src/`、`scripts/`、`test/`）：[MIT](LICENSE)。MIT 只覆盖代码，**不覆盖**任何表情图片。
- **索引整理与注释编排**：CC BY-NC-SA 4.0
- **图片与角色形象**：归原作者所有，依 CC BY-NC-SA 4.0 使用，**禁止商用**
