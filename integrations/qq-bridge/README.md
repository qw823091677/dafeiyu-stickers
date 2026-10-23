# 手动接入 qq-bridge / DSH

自动脚本：`node scripts/install-dsh.mjs`。下面是它做的事，方便你理解或手工维护。

涉及 4 个文件（路径按本机实际情况替换）：

| # | 文件 | 作用 |
| --- | --- | --- |
| 1 | `$DSH_HOME/profiles/<profile>/cordis.patch.yml` | 注册 MCP server |
| 2 | `qq-bridge/plugins/qq-agent-presets/qq-tool-restrict.mjs`（及 DSH 安装副本） | 放行工具前缀 |
| 3 | `qq-bridge/config.json` | 允许发送图片目录 |
| 4 | `qq-agent-presets/presets/qq-chat-v2.patch.yml`（及 DSH 安装副本） | 告诉 bot 什么时候用 |

## 1. 注册 MCP server

在 `cordis.patch.yml` 的 qq-bridge MCP 区块后追加（完整示例见 [../dsh/mcp-block.yml](../dsh/mcp-block.yml)）：

```yaml
# === dafeiyu-stickers MCP BEGIN ===
- insert:
    - id: mcp-dafeiyu-stickers
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: dafeiyu-stickers
        transport: stdio
        command: 'E:\node\node.exe'
        args:
          - 'D:\path\to\dafeiyu-stickers\src\mcp-server.mjs'
        toolCallTimeoutMs: 60000
# === dafeiyu-stickers MCP END ===
```

`serverName` 决定工具前缀：`dafeiyu-stickers` → `mcp__dafeiyu-stickers__*`。

> **注意 profile 选对**：DSH 桌面版加载的是 `$DSH_HOME/profiles/desktop`，`dsh web` 才是
> `$DSH_HOME/profiles/web`。只改了一个 profile 时，MCP 进程根本不会启动，表现是"配置明明写了，
> 工具列表里却没有"。`install-dsh.mjs` 默认两个都写。

## 2. 放行工具前缀

`qq-tool-restrict.mjs` 的执行期白名单只允许 `mcp__snowluma__` / `mcp__snowluma-host__` / `mcp__web-search-safe__`。
不加入新前缀的话，工具能出现在列表里，但**调用会被拒绝**：

```
工具 "mcp__dafeiyu-stickers__sticker_search" 不在 QQ 桥接白名单内，已拒绝
```

在 `SAFE_PREFIXES` 数组里加一行：

```js
const SAFE_PREFIXES = [
  'mcp__snowluma__',
  'mcp__snowluma-host__',
  'mcp__web-search-safe__',
  'mcp__dafeiyu-stickers__',
]
```

## 3. 允许发送表情目录

`qq_send_image` 只允许 `qq-bridge` 根目录、`state/` 和 `socialV2.imageSend.roots` 下的真实图片。
在 `config.json` 里追加：

```json
{
  "socialV2": {
    "imageSend": {
      "enabled": true,
      "roots": ["D:\\path\\to\\dafeiyu-stickers\\data\\images"]
    }
  }
}
```

否则发送会报：`图片路径不在允许的目录内（见 socialV2.imageSend.roots）`。

> 也可以把 `DAFEIYU_IMAGE_DIR` 指向 `qq-bridge/state/dafeiyu/images`，这样无需改 `roots`；
> 但那样图片会被同步进桥接的 state，换机器/清理 state 时注意别误删。

## 4. 告诉 bot 何时用

在 `qq-chat-v2.patch.yml` 的 `prefix: |-` 块里加一行（缩进保持一致）：

```text
                【本地表情库】 想发表情、接梗、卖萌、吐槽但 QQ 收藏里没有合适的，先用 mcp__dafeiyu-stickers__sticker_search（tags/关键词，如 开心、工作、睡觉、无语、卖萌）或 mcp__dafeiyu-stickers__sticker_random 找；返回的 path 原样传给 mcp__snowluma__qq_send_image 的 images 数组（一次 1~3 张，别刷屏）。素材来自蓝色大肥鱼档案馆，CC BY-NC-SA 4.0，禁止商用；正式/敏感话题别硬塞。
```

不加这一行工具也能被调用（MCP 工具描述里有说明），但模型不一定会想到它。

> `presets/*.patch.yml` 是 `scripts/build-agent-preset-patches.mjs` 的生成物；
> 如果之后重跑了 qq-bridge 的生成脚本或 `setup-dsh.mjs`，提示词可能被覆盖，重新运行 `install-dsh.mjs` 即可。

## 5. 重启与验证

1. 重启 DSH（MCP 与 preset 启动时加载）；
2. 重启 qq-bridge（`socialV2.imageSend.roots` 启动时读取）；
3. 新建 QQ 会话，工具列表里应出现 `mcp__dafeiyu-stickers__sticker_search` 等 5 个工具；
4. 群里说「来张困困的表情」，bot 应先 `sticker_search`/`sticker_random`，再用 `qq_send_image` 发本地文件。

## 排错

| 现象 | 原因 / 处理 |
| --- | --- |
| 工具列表没有 `mcp__dafeiyu-stickers__*` | cordis.patch.yml 路径错 / DSH 没重启 / `node src/mcp-server.mjs --check` 不通过 |
| 工具出现但调用被拒 | 第 2 步白名单没加，或 DSH 用的是旧的安装副本 |
| `图片路径不在允许的目录内` | 第 3 步 roots 没加，或桥接没重启，或图片目录被移动 |
| `找不到索引 …index.json` | 目标机器还没跑 `npm run sync` |
| 连续发同一张 | 让 bot 在 `sticker_random` 里传 `excludeIds`（最近发过的 id） |
| 单张超过 10 MB | qq-bridge 单条媒体上限 10 MB；本库最大的两张动图约 10.3 MB（在限内），但一次只发一张 |
