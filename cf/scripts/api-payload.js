// 由 `wrangler deploy --dry-run --outdir dist -c wrangler.api.jsonc` 的輸出產生一段
// 「Cloudflare API 上傳 Worker」的 JS（供只能呼叫 API 的部署工具使用）。
// 用法：node scripts/api-payload.js dist > /tmp/cf-upload.js
const fs = require('fs'), path = require('path');
const dir = process.argv[2] || 'dist';
const files = fs.readdirSync(dir).filter(f => !f.endsWith('.map') && f !== 'README.md');
const mods = files.map(f => ({ name: f, type: f === 'worker.js' ? 'application/javascript+module' : 'text/plain', body: fs.readFileSync(path.join(dir, f), 'utf8') }));
const metadata = {
  main_module: 'worker.js',
  compatibility_date: '2025-09-01',
  bindings: [{ type: 'durable_object_namespace', name: 'ROOMS', class_name: 'Room' }, { type: 'durable_object_namespace', name: 'DECKS', class_name: 'PublicDecks' }],
  // 全新部署：一次套用 v1+v2；已部署過：只套用 v1→v2（新增 PublicDecks）
  migrations: { new_tag: 'v2', steps: [{ new_sqlite_classes: ['Room'] }, { new_sqlite_classes: ['PublicDecks'] }] },
  observability: { enabled: true },
};
process.stdout.write(`async () => {
  const mods = ${JSON.stringify(mods)};
  const meta = ${JSON.stringify(metadata)};
  const name = 'accusation-online';
  let cur = null;
  try { cur = (await cloudflare.request({ method: 'GET', path: \`/accounts/\${accountId}/workers/scripts/\${name}/settings\` })).result; } catch (e) {}
  if (cur) meta.migrations = { old_tag: 'v1', new_tag: 'v2', steps: [{ new_sqlite_classes: ['PublicDecks'] }] };
  const put = async m => {
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(m)], { type: 'application/json' }));
    for (const x of mods) form.append(x.name, new Blob([x.body], { type: x.type }), x.name);
    return cloudflare.request({ method: 'PUT', path: \`/accounts/\${accountId}/workers/scripts/\${name}\`, body: form });
  };
  let r, retried = false;
  try { r = await put(meta); } catch (e) { r = { success: false, errors: [String(e && e.message || e)] }; }
  if (!r.success && cur) { // 已是 v2：不帶 migration 重試
    const m2 = Object.assign({}, meta); delete m2.migrations; retried = true;
    try { r = await put(m2); } catch (e) { r = { success: false, errors: [String(e && e.message || e)] }; }
  }
  return { success: r.success, id: r.result && r.result.id, etag: r.result && r.result.etag, existed: !!cur, retriedWithoutMigration: retried, errors: r.errors };
}
`);
