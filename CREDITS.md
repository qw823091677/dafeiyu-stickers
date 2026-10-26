# 版权与署名（CREDITS）

本仓库是**非官方**的本地化工具与索引，不是表情的作者，也不代表 DeepSeek、蓝色大肥鱼档案馆或任何官方立场。

## 一、署名

| 角色 | 署名 | 链接 |
| --- | --- | --- |
| 鲸鱼娘角色形象原作 | 上善无形 | https://space.bilibili.com/4456176 |
| DeepSeek 元素女仆鲸鱼娘二次设计 | ZipZipPipe | https://space.bilibili.com/4168597 |
| 蓝色大肥鱼档案馆（整理 / 网站） | EDMOK | https://space.bilibili.com/291892724 · https://github.com/EDMOK/blue-fish-archive |
| 本地收藏库补充来源（梗鲸） | 梗鲸 aigengtu.com（单张图版权归原作者） | https://aigengtu.com/（授权/作者待核实） |
| 单张表情 | 各创作者 | 见每张图的 `source.original`（档案馆）或 `source.page`（梗鲸） |

索引里 `selfMade: true` 的 5 张（`deepseek-dui-zhe-diannao-tu-she`、`deepseek-jushou-dazhaohu`、`deepseek-liezui-xiao`、`deepseek-piezui`、`deepseek-woquan-ya-ya`）为**站长自作**，作者 EDMOK，依 CC BY-NC-SA 4.0 使用。

档案馆「关于本站」原文：

> 图片版权归原作者和各自创作者所有。标有「自作」的表情由网站作者制作。如果你不希望自己的作品出现在这里，或者发现署名有误、来源不明的内容，请在 QQ 群里告诉我们，会尽快处理。

## 二、许可协议

**CC BY-NC-SA 4.0**（Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International）
<https://creativecommons.org/licenses/by-nc-sa/4.0/>

使用图片时至少要做到：

1. **署名**：保留上表中的作者与来源（蓝色大肥鱼档案馆 + 上善无形 + ZipZipPipe，以及单张图的创作者）；
2. **非商业**：不得用于商业目的（付费群、带货、收费 bot / 订阅服务、广告物料等都不行）；
3. **相同方式共享**：修改、拼贴、二次创作后的作品必须以 CC BY-NC-SA 4.0（或兼容协议）发布；
4. **不额外设限**：不得用技术手段或附加条款限制他人依本协议使用。

> 本项目代码（`src/`、`scripts/`、`test/`）使用 MIT，与图片许可分开。MIT **不覆盖**任何表情图片。

## 三、本项目对图片做了什么

- 档案馆（`data/`）只从 `fisharchive.cc` 的 `original` 地址**原样下载**；不转码、不压缩、不裁剪、不加水印、不改文件名（仅去掉路径）。
- 本地收藏库（`collection/`）另外保存 QQ 聊天收藏，以及从梗鲸（`aigengtu.com`）导入的 300 张补充图；它们**不进入档案馆索引**，只在本地使用。
- 梗鲸补充图（id 以 `gj-` 开头）导入时先按感知哈希（pHash）与本地图库逐张比对，只留本地原先没有的图；它们的授权/作者尚未核实，**再分发前请自行确认**。
- 下载后计算 `sha256` 并写入索引，`npm run verify` 可校验文件是否被改动或损坏。
- 不把图片提交进 Git（`.gitignore` 排除 `data/images/` 与 `collection/`），只提交档案馆索引与出处；图片需要在本机运行 `npm run sync` 获取。
- 不在图片上叠加任何 logo / 二维码 / 引流信息。
- 不绕过站点的访问限制，默认 3 并发 + 150ms 间隔，遵守站点「请勿高频批量抓取」的说明。

## 四、转载 / 二次使用建议署名

```text
档案馆素材：蓝色大肥鱼档案馆（EDMOK 整理）https://fisharchive.cc
本地收藏来源：梗鲸 https://aigengtu.com（授权待核实）
角色原作：上善无形 https://space.bilibili.com/4456176
鲸鱼娘二次设计：ZipZipPipe https://space.bilibili.com/4168597
依 CC BY-NC-SA 4.0 使用，禁止商用。
```

## 五、下架与纠错

如果某张图不希望被本项目索引（或署名有误、来源不明）：

1. 通过档案馆的 QQ 群（群号 1041665197）或 [GitHub Issue](https://github.com/EDMOK/blue-fish-archive/issues) 联系站方；
2. 或在本仓库开 Issue / PR，说明图片 id（见 `data/index.json` 的 `id` 字段）；
3. 确认后会从 `data/manifest.source.json` 与 `data/index.json`（或本地收藏库 `collection/index.json`）中移除该条，并同步删除本地文件（`sync --prune` / `forget`）。

## 六、本地收藏库（`collection/`）

- 收藏库里的图片来自 QQ 群聊/私聊，由 bot 按使用者的意图收藏；另有从梗鲸导入的 300 张补充图。**版权仍归原作者**，不因被收藏而改变。
- 收藏索引会记录来源会话 key / messageId（QQ）或来源页（梗鲸）。`collection/` 默认被 `.gitignore` 排除，**请只在本机使用、不要公开再分发**。
- 梗鲸来源的图授权/作者尚未核实，再分发前请自行确认；它们不随档案馆索引分发。
- 如果图主或群友不希望图片被保存/传播，用 `node src/cli.mjs forget <id>` 删除对应条目与文件。
- 收藏图片同样适用 **CC BY-NC-SA 4.0**：禁止商业使用，转载须署名并以相同方式共享。
- 本项目不主动上传任何收藏图片；是否分享由使用者自行决定并承担相应责任。

## 七、免责声明

- 本项目按「现状」提供，不保证索引与站点永久同步；
- 使用者应自行确认所在场景符合 CC BY-NC-SA 4.0，尤其是**非商业**限制；
- 因使用本项目产生的版权纠纷由使用者自行承担，本项目不承担连带责任。
