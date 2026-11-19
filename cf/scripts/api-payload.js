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
  bindings: [{ type: 'durable_object_namespace', name: 'ROOMS', class_name: 'Room' }],
  migrations: { new_tag: 'v1', new_sqlite_classes: ['Room'] },
  observability: { enabled: true },
};
process.stdout.write(`async () => {
  const mods = ${JSON.stringify(mods)};
  const meta = ${JSON.stringify(metadata)};
  const name = 'accusation-online';
  let cur = null;
  try { cur = (await cloudflare.request({ method: 'GET', path: \`/accounts/\${accountId}/workers/scripts/\${name}/settings\` })).result; } catch (e) {}
  if (cur) delete meta.migrations; // 已部署過：v1 migration 已套用
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  for (const m of mods) form.append(m.name, new Blob([m.body], { type: m.type }), m.name);
  const r = await cloudflare.request({ method: 'PUT', path: \`/accounts/\${accountId}/workers/scripts/\${name}\`, body: form });
  return { success: r.success, id: r.result && r.result.id, etag: r.result && r.result.etag, migrated: !cur, errors: r.errors };
}
`);
