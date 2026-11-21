// Weekly database backup (run by .github/workflows/db-backup.yml).
// Reads every table the REST API exposes, page by page (PostgREST returns at most 1000 rows per
// request), and writes one JSON file per table into ./backup. The workflow then packs and encrypts
// the folder before uploading it, because this repository is public.
const fs = require('fs');
const path = require('path');

const URL_BASE = 'https://mxlrxivnwtxtiloifksr.supabase.co/rest/v1/';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY is not set'); process.exit(1); }
const headers = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const PAGE = 1000;

async function tables() {
  const res = await fetch(URL_BASE, { headers: Object.assign({ Accept: 'application/openapi+json' }, headers) });
  if (!res.ok) throw new Error('schema read failed: ' + res.status);
  const spec = await res.json();
  return Object.keys(spec.definitions || {}).sort();
}

async function dump(table) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(URL_BASE + encodeURIComponent(table) + '?select=*', {
      headers: Object.assign({ Range: from + '-' + (from + PAGE - 1), 'Range-Unit': 'items' }, headers)
    });
    if (!res.ok) throw new Error(table + ': ' + res.status + ' ' + (await res.text()).slice(0, 200));
    const page = await res.json();
    rows.push.apply(rows, page);
    if (page.length < PAGE) return rows;
  }
}

(async () => {
  const out = path.join(process.cwd(), 'backup');
  fs.mkdirSync(out, { recursive: true });
  const summary = {};
  let failed = 0;
  for (const t of await tables()) {
    try {
      const rows = await dump(t);
      fs.writeFileSync(path.join(out, t + '.json'), JSON.stringify(rows));
      summary[t] = rows.length;
    } catch (e) {
      // views or tables the API can't page are noted, not fatal; a records failure is
      if (t === 'records') throw e;
      summary[t] = 'skipped: ' + e.message;
      failed++;
    }
  }
  fs.writeFileSync(path.join(out, '_summary.json'), JSON.stringify({ at: new Date().toISOString(), tables: summary }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.records) { console.error('records table is empty or missing'); process.exit(1); }
  if (failed) console.log('::warning::' + failed + ' table(s) skipped');
})().catch(e => { console.error(e.message); process.exit(1); });
