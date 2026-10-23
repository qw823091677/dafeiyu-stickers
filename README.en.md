# dafeiyu-stickers

Local index + MCP tools for the [Blue Big Fish Archive](https://fisharchive.cc/) (blue-whale-girl DeepSeek fan stickers).

- **271 original images** (PNG/JPEG/WebP/GIF), downloaded as-is — no re-encoding, no watermark.
- Keeps the archive's own `alt` captions and `tags`, adds colloquial synonym search (e.g. "sleepy" → 睡觉, "boss changed requirements" → 工作).
- Every entry stores `sha256`, byte size, real dimensions and source URL; `npm run verify` re-checks integrity.
- Ships a **CLI** and a **stdio MCP server** (`sticker_search`, `sticker_random`, `sticker_collect`, `sticker_get`, `sticker_tags`, `sticker_credit`).
  Tool results contain a local absolute `path` that can be passed straight to `qq_send_image`.
- **Separate local collection**: images the bot finds in QQ chats can be saved into `collection/` with a note and tags,
  deduplicated by sha256 and kept apart from the archive index (`sticker_search({library:"local"})`).
- `scripts/install-dsh.mjs` wires it into a local DSH + qq-bridge install (MCP registration, tool allow-list, image-send roots, prompt hints) and can undo everything.

## Quick start

```bash
# Node.js >= 18.17, no npm install needed
npm run sync            # download 271 images (~247 MB) and build the index
npm run stats
npm run search -- 好困 --limit 3
npm run random -- --tags 卖萌
node src/mcp-server.mjs --check
```

Install into DSH / qq-bridge (requires restarting both afterwards):

```bash
node scripts/install-dsh.mjs --dry-run
node scripts/install-dsh.mjs
```

## License

- Code: **MIT** ([LICENSE](LICENSE))
- Images and character designs: **CC BY-NC-SA 4.0**, all rights belong to their creators — **no commercial use**, attribution and share-alike required. See [CREDITS.md](CREDITS.md).
- `selfMade: true` marks the 5 images drawn by the archive author (EDMOK); CLI and MCP output label them as 站长自作.
- This is an unofficial fan project, not affiliated with DeepSeek or the archive.

Original character: 上善无形 ([Bilibili](https://space.bilibili.com/4456176)) · Whale-girl redesign: ZipZipPipe ([Bilibili](https://space.bilibili.com/4168597)) · Archive: EDMOK ([Bilibili](https://space.bilibili.com/291892724)).
