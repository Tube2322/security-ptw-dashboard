// Automated checks for the parts that have broken before. Run: npm test
// Uses playwright-core (already a dependency) with the installed Chrome, and Node's built-in test
// runner — no extra packages. Nothing here writes to the real database: every write to Supabase is
// intercepted and answered by the test, and the only real requests are anonymous reads.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..', 'Prototype integration complete');
const ADMIN = '/SOC%20Admin%20Console%20v2.dc.html';
const ENTRY = '/User%20Entry%20Portal%20v2.dc.html';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

let server, base, browser;

test.before(async () => {
  server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});

test.after(async () => {
  if (browser) await browser.close();
  if (server) server.close();
});

/* opens a page with every Supabase write answered by `writes` (default: success) and collects
   page errors; reads still go to the real project as the anonymous guest */
async function open(url, writes) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && /logic class eval FAILED/.test(m.text())) errors.push(m.text()); });
  await page.route(/supabase\.co\/rest\/v1\//, (route) => {
    const r = route.request();
    if (r.method() === 'GET' || r.method() === 'HEAD') return route.continue();
    return (writes || ((rt) => rt.fulfill({ status: 201, contentType: 'application/json', body: '[]' })))(route);
  });
  await page.goto(base + url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.SOCCore && window.SOCCore.ready, null, { timeout: 20000 });
  return { page, errors };
}

test('admin console loads without a logic or script error', async () => {
  const { page, errors } = await open(ADMIN);
  await page.waitForTimeout(2000);
  assert.deepStrictEqual(errors, []);
  await page.close();
});

test('entry portal loads without a logic or script error', async () => {
  const { page, errors } = await open(ENTRY);
  await page.waitForTimeout(2000);
  assert.deepStrictEqual(errors, []);
  assert.match(await page.textContent('body'), /บันทึกข้อมูล/);
  await page.close();
});

test('a failed save is kept on the device, logged, then re-sent once the network is back', async () => {
  let fail = true;
  const logged = [];
  const { page } = await open(ENTRY, (route) => {
    const url = route.request().url();
    if (/submit_failures/.test(url)) { logged.push(route.request().postData()); return route.fulfill({ status: 201, body: '' }); }
    if (/\/records/.test(url)) return fail ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"offline"}' })
      : route.fulfill({ status: 201, body: '' });
    return route.fulfill({ status: 201, body: '' });
  });
  await page.evaluate(() => { localStorage.clear(); });
  const res = await page.evaluate(async () => {
    const rec = window.SOCCore.addRecord('visitors', { visitor_date: '2026-01-01', visitor_name: 'TEST' });
    await rec._saved;
    return { pending: window.SOCCore.pendingCount() };
  });
  assert.strictEqual(res.pending, 1, 'failed record waits in the queue');
  await page.waitForTimeout(500);
  assert.ok(logged.length >= 1, 'failure written to submit_failures');
  fail = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => window.SOCCore.pendingCount() === 0, null, { timeout: 10000 });
  await page.close();
});

test('reading all records pages past the 1000-row cap', async () => {
  const page = await browser.newPage();
  const row = (i) => ({ id: 'id-' + i, module: 'visitors', report_date: '2026-01-01', submitted_at: '2026-01-01T00:00:00', data: {} });
  await page.route(/supabase\.co\/rest\/v1\/records/, (route) => {
    const r = route.request();
    if (r.method() !== 'GET') return route.fulfill({ status: 201, body: '' });
    const m = /offset=(\d+)/.exec(r.url()) || [0, 0];
    const range = r.headers()['range'] || '';
    const from = Number((/^(\d+)-/.exec(range) || [0, m[1]])[1]);
    const n = from === 0 ? 1000 : from === 1000 ? 41 : 0;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(Array.from({ length: n }, (_, i) => row(from + i))) });
  });
  await page.goto(base + ADMIN, { waitUntil: 'load' });
  await page.waitForFunction(() => window.SOCCore && window.SOCCore.ready, null, { timeout: 20000 });
  const n = await page.evaluate(async () => { await window.SOCCore.ensureAll(); return window.SOCCore.allRecords().length; });
  assert.strictEqual(n, 1041);
  await page.close();
});

test('an anonymous visitor cannot read stored records', async () => {
  const cfg = fs.readFileSync(path.join(ROOT, 'soc-config.js'), 'utf8');
  const url = (cfg.match(/https:\/\/[a-z0-9]+\.supabase\.co/) || [])[0];
  const key = (cfg.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+|sb_publishable_[\w-]+/) || [])[0];
  assert.ok(url && key, 'soc-config.js has the project URL and anon key');
  for (const table of ['records', 'profiles', 'repair_jobs', 'cctv_checks', 'submit_failures', 'ms_forms_outbox']) {
    const r = await fetch(url + '/rest/v1/' + table + '?select=*&limit=1', { headers: { apikey: key } });
    const body = await r.json().catch(() => null);
    assert.ok(!Array.isArray(body) || body.length === 0, table + ' must not be readable without login');
  }
});
