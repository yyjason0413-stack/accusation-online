# Cloudflare 版（Workers + Durable Objects）

- `src/worker.js`：Worker 入口＋`Room` Durable Object（每個房間一個 DO，SQLite 後端，WebSocket Hibernation）＋`PublicDecks` Durable Object（全域單一實例，SQLite 儲存公開牌組，`/api/decks*`）。
- Migrations：`v1` 新增 `Room`，`v2` 新增 `PublicDecks`。`scripts/api-payload.js` 對已部署的 Worker 會套用 v1→v2，若已是 v2 則自動不帶 migration 重試。
- 規則引擎直接沿用 `../engine/*.js`（CommonJS，由 wrangler/esbuild 打包），不需修改。
- 房間狀態以「亂數種子＋玩家決定的事件紀錄」存在 DO storage；DO 被逐出或重新部署後，會重播事件重建對局（`test/replay.test.js` 驗證可決定性重播）。房間 12 小時無動作後以 alarm 清除。
- 隱藏資訊仍只在伺服器端（每位玩家只收到自己的 `view`）。單人 AI 在 DO 內執行。
- 只支援 WebSocket（`/config.json` 回 `poll:false`，前端不會改用 HTTP 長輪詢）。
- 連線：`/ws?new=1` 建立新房間（Worker 產生 4 碼房號並確認未被使用）、`/ws?room=ABCD` 加入／重連。

## 本機測試
```
cd cf && npm install
npx wrangler dev                          # 有 Static Assets（public/ 全部，含卡圖）
npx wrangler dev -c wrangler.api.jsonc    # 無 Static Assets：HTML/JS/CSS 內嵌、卡圖代理自 accusation-card-tool.pages.dev
node ../test/e2e.js http://127.0.0.1:8787 300 /tmp/shots   # 兩支手機 390×844 連線對戰
node ../test/ai-e2e.js http://127.0.0.1:8787 /tmp/shots    # 單人 AI
```

## 部署
- 用 wrangler：`npx wrangler login`（或設定 `CLOUDFLARE_API_TOKEN`＋`CLOUDFLARE_ACCOUNT_ID`），然後 `npx wrangler deploy`。
- 不用 wrangler（只有 API 權限、無法上傳 Static Assets）：`npx wrangler deploy --dry-run --outdir dist -c wrangler.api.jsonc`，再以 Workers Scripts API 上傳 `dist/` 內的模組（見 `scripts/api-payload.js`）。
