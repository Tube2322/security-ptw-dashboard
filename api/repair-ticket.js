/* Bridge between our repair_jobs and the technicians' repair site (ptw.pypl-engineering.online,
   hospital slug phayathai-bowin). Their public form posts multipart to /jobs and their public
   tracker reads /jobs/search?q=<job number>; this file does the same two calls server side, so the
   browser never has to talk to another origin.

   Every call carries the admin's own Supabase session (Authorization: Bearer <access token>) and
   reads/writes repair_jobs and the repair-photos bucket AS that user, so the existing admin-only RLS
   is the permission check: a caller who is not an admin simply cannot see the job and gets 403.

   POST { action: 'locations' }          -> { buildings: [{ name, floors: [name], departments: [{ id, name, floor }] }] }
   POST { action: 'send', jobId }        -> { ok, extCode }   files one job once; filed again only if their site still has no such ticket after 10 min
   POST { action: 'sync' }               -> also finds the job number of any job whose reply was lost
                                            { ok, changed }   pulls the status of every open job that has a job number */
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://mxlrxivnwtxtiloifksr.supabase.co';
const PUBLISHABLE = 'sb_publishable_9_W9xONvn3Gw89F4V_QPZw_mOmoGIF2';
const TECH = 'https://ptw.pypl-engineering.online/api/phayathai-bowin';

/* their status -> our step. Clear = fixed and waiting for the requester's rating, Clear1 = waiting
   for parts after the fix; both mean the work itself is done. Close is their own final close — we
   still leave our close to the admin's acknowledge button. */
const STEP = { Register: 'sent', Assign: 'accepted', 'Work On': 'repairing', Clear: 'done', Clear1: 'done', Close: 'done' };
const ORDER = { pending: 0, sent: 1, accepted: 2, repairing: 3, done: 4, closed: 5, rejected: 5 };
const LABEL = { Register: 'ยังไม่รับงาน', Assign: 'รับแล้ว รอเริ่ม', 'Work On': 'กำลังซ่อม', Clear: 'ซ่อมเสร็จ รอประเมิน', Clear1: 'ซ่อมเสร็จ รอเบิกอะไหล่', Close: 'ช่างปิดงานแล้ว', Cancel: 'ช่างยกเลิกงาน' };

const RESEND_AFTER = 10 * 60 * 1000;   // how long a filed-but-unnumbered ticket is searched for before filing it again
const MAX_ATTEMPTS = 2;                 // the first filing plus at most one automatic re-file; after that a person decides
const SCAN_LIMIT = 400;                // most ticket numbers read in one look-up
const FIRST_KNOWN = 1174;              // PTW/2569/1174 — the number scan never starts below a ticket we know exists
const stamp = (iso) => (iso ? new Date(iso) : new Date()).toISOString().slice(0, 16).replace('T', ' ');

async function techJson(path, init) {
  const res = await fetch(TECH + path, Object.assign({ signal: AbortSignal.timeout(20000) }, init || {}));
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body && body.error) || ('เว็บช่างตอบกลับ ' + res.status));
  return body;
}

async function locations() {
  const data = await techJson('/data/initial-data');
  return (data.buildings || []).map(b => ({
    name: b.name,
    floors: (b.floors || []).map(f => f.name),
    departments: (b.departments || []).map(d => ({ id: d.id, name: d.name, floor: d.floor_id }))
  }));
}

/* A POST that timed out may still have been filed. Every ticket we file carries 'อ้างอิง <our code>'
   in its description. Their search matches whole values only (job number, phone, requester name),
   so try each way the reporter could have been stored. Returns { hit, sure }: sure is false when any
   search failed, and only a sure miss may ever lead to filing again. */
async function findFiled(sb, job) {
  const byWho = await findByReporter(job);
  if (byWho.hit) return byWho;
  /* second, independent check: their job numbers run in sequence (PTW/2569/1174, 1175, ...), and the
     public search finds any of them by number. Walk forward from the newest number we already hold
     to the end of their list, reading every ticket filed since. Only reaching the end with no match
     and no failed request counts as sure. */
  const byNumber = await findByNumber(sb, job);
  return { hit: byNumber.hit, sure: byWho.sure && byNumber.sure };
}

async function findByNumber(sb, job) {
  const year = new Date(Date.now() + 7 * 3600000).getUTCFullYear() + 543, prefix = 'PTW/' + year + '/';
  const known = await sb.from('repair_jobs').select('ext_code').like('ext_code', prefix + '%');
  if (known.error) return { hit: null, sure: false };
  let n = Math.max(FIRST_KNOWN - 1, ...(known.data || []).map(r => parseInt(String(r.ext_code).slice(prefix.length), 10) || 0));
  const since = job.ext_sending_at ? new Date(job.ext_sending_at).getTime() - 60000 : 0;
  let misses = 0;
  for (let i = 0; i < SCAN_LIMIT; i++) {
    n++;
    let found;
    try { found = await techJson('/jobs/search?q=' + encodeURIComponent(prefix + n)); } catch (e) { return { hit: null, sure: false }; }
    const t = (Array.isArray(found) ? found : []).find(j => j.job_number === prefix + n);
    if (!t) { if (++misses >= 3) return { hit: null, sure: true }; continue; }
    misses = 0;
    if (new Date(t.register_time).getTime() >= since && String(t.description || '').indexOf('อ้างอิง ' + job.code) !== -1) return { hit: t, sure: true };
  }
  return { hit: null, sure: false };   // ran out of budget before the end of their list: not sure
}

async function findByReporter(job) {
  const who = job.reporter || {};
  const phone = String(who.phone || '').trim(), digits = phone.replace(/\D/g, '');
  const terms = [...new Set([phone, digits, String(who.name || '').trim()].filter(t => t.length >= 3))];
  if (!terms.length) return { hit: null, sure: false };
  let sure = true;
  for (const t of terms) {
    try {
      const found = await techJson('/jobs/search?q=' + encodeURIComponent(t));
      const hit = (Array.isArray(found) ? found : []).find(j => String(j.description || '').indexOf('อ้างอิง ' + job.code) !== -1);
      if (hit) return { hit, sure: true };
    } catch (e) { sure = false; }
  }
  return { hit: null, sure };
}

async function markSent(sb, job, jobNumber, jobId) {
  const patch = {
    status: 'sent', ext_code: jobNumber || null, ext_id: jobId != null ? String(jobId) : null,
    ext_status: LABEL.Register, times: Object.assign({}, job.times || {}, { sent: (job.times || {}).sent || stamp() }), last_error: null,
    ext_synced_at: new Date().toISOString(), updated_at: new Date().toISOString()
  };
  let r = await sb.from('repair_jobs').update(patch).eq('id', job.id);
  if (r.error) r = await sb.from('repair_jobs').update(patch).eq('id', job.id);
  return r.error ? r.error.message : '';
}

async function send(sb, jobId) {
  const { data: job, error } = await sb.from('repair_jobs').select('*').eq('id', jobId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!job) return { status: 403, body: { ok: false, error: 'ไม่พบงาน หรือไม่มีสิทธิ์' } };
  if (job.ext_code) return { status: 409, body: { ok: false, error: 'งานนี้ส่งเข้าเว็บช่างแล้ว (' + job.ext_code + ')' } };
  const loc = job.loc || {}, who = job.reporter || {};
  const photos = Array.isArray(job.photos) ? job.photos.filter(p => /^inbox\//.test(p)) : [];
  const missing = [!loc.building && 'อาคาร', !loc.floor && 'ชั้น', !loc.department && 'แผนก', !who.name && 'ชื่อผู้แจ้ง', !who.phone && 'เบอร์โทร', !photos.length && 'รูป'].filter(Boolean);
  if (missing.length) return { status: 400, body: { ok: false, error: 'ข้อมูลไม่ครบ: ' + missing.join(', ') } };

  const title = (Array.isArray(job.faults) && job.faults[0] && job.faults[0].label) || job.topic;
  const desc = [title, job.place && 'จุด: ' + job.place, job.detail, 'อ้างอิง ' + job.code].filter(Boolean).join('\n');
  const fd = new FormData();
  fd.append('building', loc.building); fd.append('floor', loc.floor); fd.append('department', loc.department);
  fd.append('desc', desc); fd.append('requester', who.name); fd.append('telephone', who.phone);
  for (const p of photos.slice(0, 6)) {
    const dl = await sb.storage.from('repair-photos').download(p);
    if (dl.error) throw new Error('โหลดรูปไม่ได้: ' + dl.error.message);
    fd.append('files', new Blob([await dl.data.arrayBuffer()], { type: 'image/jpeg' }), p.split('/').pop());
  }

  /* One filing per attempt. The claim (ext_sending_at) blocks every other post of this job — a second
     click, a second admin — until sync() has searched their site for it and come up empty for
     RESEND_AFTER; only then is the claim released for another attempt, up to MAX_ATTEMPTS in all. */
  const attempts = Number((job.times || {}).attempts || 0);
  if (attempts >= MAX_ATTEMPTS) return { status: 409, body: { ok: false, error: 'ส่งไปแล้ว ' + attempts + ' ครั้ง ยังไม่พบใบงานในเว็บช่าง · ตรวจสอบกับช่างโดยตรง' } };
  if (attempts > 0) {
    const again = await findFiled(sb, job);
    if (again.hit) {
      const err = await markSent(sb, job, again.hit.job_number, again.hit.id);
      return { status: 200, body: { ok: true, extCode: again.hit.job_number, warning: err } };
    }
    if (!again.sure) return { status: 409, body: { ok: false, error: 'ยังตรวจไม่ได้ว่าใบเดิมเข้าเว็บช่างหรือยัง · ไม่ส่งซ้ำ' } };
  }
  const claim = await sb.from('repair_jobs').update({ ext_sending_at: new Date().toISOString(), last_error: null,
    times: Object.assign({}, job.times || {}, { attempts: attempts + 1 }) })
    .eq('id', job.id).is('ext_code', null).is('ext_sending_at', null).select('id');
  if (!(claim.data && claim.data.length)) return { status: 409, body: { ok: false, error: 'งานนี้ส่งเข้าเว็บช่างไปแล้ว' } };

  let out = null, postError = '';
  try { out = await techJson('/jobs', { method: 'POST', body: fd }); } catch (e) { postError = e.message; }
  const number = out && out.jobNumber ? out : await findFiled(sb, job).then(f => f.hit && { jobNumber: f.hit.job_number, jobId: f.hit.id });
  if (number) {
    const err = await markSent(sb, job, number.jobNumber, number.jobId);
    return { status: 200, body: { ok: true, extCode: number.jobNumber, warning: err ? 'ส่งแล้ว แต่บันทึกเลขใบงานไม่สำเร็จ ระบบจะหาเลขให้เองในรอบถัดไป' : '' } };
  }
  /* number not known yet: from here on sync() keeps looking for it */
  await sb.from('repair_jobs').update({
    status: 'sent', ext_status: 'ส่งแล้ว · กำลังหาเลขใบงาน', times: Object.assign({}, job.times || {}, { sent: stamp(), attempts: attempts + 1 }),
    last_error: postError ? 'เว็บช่างตอบกลับไม่ครบ (' + postError + ') · ระบบจะหาเลขใบงานให้เอง' : null, updated_at: new Date().toISOString()
  }).eq('id', job.id);
  return { status: 200, body: { ok: true, extCode: '', warning: 'ส่งแล้ว · ระบบกำลังหาเลขใบงานจากเว็บช่างให้เอง' } };
}

/* Repair requests made by an inspector in the entry portal (supabase/repair_inspector_request.sql): the
   tick in the form IS the approval, so these are filed on the technicians' site without an admin pressing
   send. Runs from the 5-minute scheduler only, never from a browser. Off until
   portal_settings.repair_tracking.inspector_auto_send is true, and each job gets exactly one automatic
   try (times.auto_tried) — a failure is written to last_error and left for an admin, never retried blind. */
async function sendInspectorRequests(sb) {
  const cfg = await sb.from('portal_settings').select('repair_tracking').limit(1).maybeSingle();
  if (!(cfg.data && cfg.data.repair_tracking && cfg.data.repair_tracking.inspector_auto_send === true)) return 0;
  const { data: jobs } = await sb.from('repair_jobs').select('*').eq('status', 'pending').is('ext_code', null).is('ext_sending_at', null)
    .order('created_at', { ascending: true }).limit(10);
  let filed = 0;
  for (const job of (jobs || []).filter(j => Array.isArray(j.faults) && j.faults[0] && j.faults[0].field_id === 'inspector_request' && !(j.times || {}).auto_tried)) {
    const times = Object.assign({}, job.times || {}, { auto_tried: stamp() });
    const mark = await sb.from('repair_jobs').update({ times }).eq('id', job.id).eq('status', 'pending').select('id');
    if (!(mark.data && mark.data.length)) continue;
    let r;
    try { r = await send(sb, job.id); } catch (e) { r = { status: 500, body: { error: e.message || String(e) } }; }
    if (r.status === 200) filed++;
    else await sb.from('repair_jobs').update({ last_error: 'ส่งอัตโนมัติไม่สำเร็จ: ' + ((r.body && r.body.error) || r.status) }).eq('id', job.id);
  }
  return filed;
}

async function sync(sb) {
  let changed = 0;
  /* filed but the number never came back: look it up first; only a ticket that still is not on their
     site after RESEND_AFTER counts as not filed, and is filed again */
  const lost = await sb.from('repair_jobs').select('*').is('ext_code', null).not('ext_sending_at', 'is', null);
  for (const job of lost.data || []) {
    const f = await findFiled(sb, job);
    if (f.hit) { if (!(await markSent(sb, job, f.hit.job_number, f.hit.id))) changed++; continue; }
    /* a search that failed proves nothing: never re-file on it */
    if (!f.sure || Date.now() - new Date(job.ext_sending_at).getTime() < RESEND_AFTER) continue;
    const n = Number((job.times || {}).attempts || 0);
    if (n >= MAX_ATTEMPTS) {
      const msg = 'ส่งไป ' + n + ' ครั้ง ยังไม่พบใบงานในเว็บช่าง · ตรวจสอบกับช่างโดยตรง';
      if (job.last_error !== msg) { await sb.from('repair_jobs').update({ last_error: msg, ext_status: 'ไม่พบใบงาน' }).eq('id', job.id); changed++; }
      continue;
    }
    const free = await sb.from('repair_jobs').update({ ext_sending_at: null }).eq('id', job.id).eq('ext_sending_at', job.ext_sending_at).select('id');
    if (free.data && free.data.length) { await send(sb, job.id); changed++; }
  }
  const { data: jobs, error } = await sb.from('repair_jobs').select('*').not('ext_code', 'is', null).in('status', ['sent', 'accepted', 'repairing', 'done']);
  if (error) throw new Error(error.message);
  /* their sub-status comes as a code (On-Hold-Resource); the names live in their initial data */
  let workName = {};
  if ((jobs || []).length) {
    try { (await techJson('/data/initial-data')).workStatuses.forEach(w => { workName[w.code] = w.name; }); } catch (e) {}
  }
  for (const job of jobs || []) {
    let hit;
    try {
      const found = await techJson('/jobs/search?q=' + encodeURIComponent(job.ext_code));
      hit = (Array.isArray(found) ? found : []).find(j => String(j.job_number) === job.ext_code);
    } catch (e) { continue; }
    if (!hit) continue;
    const step = STEP[hit.status];
    /* on hold = Work On with an On-Hold-* sub-status; 'since' is kept while the same hold continues */
    const onHold = hit.status === 'Work On' && /^On-Hold/i.test(String(hit.status_work || ''));
    const prev = job.ext_hold || null;
    const hold = onHold ? { code: hit.status_work, name: workName[hit.status_work] || hit.status_work, reason: hit.hold_reason || '',
      since: prev && prev.code === hit.status_work ? prev.since : new Date().toISOString() } : null;
    const label = (LABEL[hit.status] || hit.status) + (hold ? ' · พักงาน' : '');
    const patch = { ext_status: label, ext_hold: hold, ext_synced_at: new Date().toISOString() };
    /* only ever move forward; their timestamps become ours so the timeline shows when it really happened */
    if (step && ORDER[step] > ORDER[job.status]) {
      const times = Object.assign({}, job.times || {});
      if ((hit.assign_time || hit.start_time) && !times.accepted) times.accepted = stamp(hit.assign_time || hit.start_time);
      if (hit.start_time && !times.repairing) times.repairing = stamp(hit.start_time);
      if (hit.clear_time && !times.done) times.done = stamp(hit.clear_time);
      if (!times[step]) times[step] = stamp();
      Object.assign(patch, { status: step, times, updated_at: new Date().toISOString() });
    }
    if (hit.status === 'Cancel') patch.last_error = 'ช่างยกเลิกงานนี้ในเว็บช่าง';
    if (!patch.status && patch.ext_status === job.ext_status && (patch.last_error || null) === (job.last_error || null)
        && JSON.stringify(hold) === JSON.stringify(prev)) {
      await sb.from('repair_jobs').update({ ext_synced_at: patch.ext_synced_at }).eq('id', job.id);
      continue;
    }
    changed++;
    await sb.from('repair_jobs').update(patch).eq('id', job.id).eq('status', job.status);
  }
  return { ok: true, changed };
}

/* The Supabase scheduler (pg_cron, every 5 minutes, supabase/repair_cron.sql) calls { action: 'sync' }
   with a shared secret instead of an admin session, so statuses move even when nobody has the page
   open. The secret is generated inside Postgres and lives only in public.repair_cron, a table with RLS
   on and no policies — readable by the service role alone — so it is never typed or copied anywhere.
   It unlocks sync and nothing else. */
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'POST only' }); return; }
  const cron = String(req.headers['x-cron-secret'] || '');
  if (cron) {
    if (!SERVICE_KEY) { res.status(403).json({ ok: false, error: 'forbidden' }); return; }
    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const row = await svc.from('repair_cron').select('secret').eq('id', 1).maybeSingle();
    const want = String((row.data && row.data.secret) || '');
    if (!want || cron.length !== want.length || !require('crypto').timingSafeEqual(Buffer.from(cron), Buffer.from(want))) {
      res.status(403).json({ ok: false, error: 'forbidden' }); return;
    }
    try {
      const filed = await sendInspectorRequests(svc);
      const out = await sync(svc);
      res.status(200).json(Object.assign({ filed }, out));
    } catch (e) { res.status(500).json({ ok: false, error: e.message || String(e) }); }
    return;
  }
  /* the entry portal (no login) offers the technicians' own building / floor / department lists while an
     inspector files a repair request; that list is public on their site and carries nothing of ours */
  const bodyIn = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; } })() : (req.body || {});
  if (bodyIn.action === 'locations') {
    try { res.status(200).json({ ok: true, buildings: await locations() }); } catch (e) { res.status(502).json({ ok: false, error: e.message || String(e) }); }
    return;
  }
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) { res.status(401).json({ ok: false, error: 'ต้องเข้าสู่ระบบ' }); return; }
  const sb = createClient(SUPABASE_URL, PUBLISHABLE, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: 'Bearer ' + token } }
  });
  /* admin check: repair_jobs is admin-only under RLS, so an admin can count it and nobody else can */
  const probe = await sb.rpc('is_admin');
  if (probe.error || probe.data !== true) { res.status(403).json({ ok: false, error: 'เฉพาะแอดมิน' }); return; }
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); }
  catch (e) { res.status(400).json({ ok: false, error: 'bad JSON' }); return; }
  try {
    if (body.action === 'locations') { res.status(200).json({ ok: true, buildings: await locations() }); return; }
    if (body.action === 'send') { const r = await send(sb, body.jobId); res.status(r.status).json(r.body); return; }
    if (body.action === 'sync') { res.status(200).json(await sync(sb)); return; }
    res.status(400).json({ ok: false, error: 'unknown action' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
};
