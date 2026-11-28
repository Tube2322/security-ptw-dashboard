/* Weekly CCTV readings: turns the check list (newest first) into each camera's current readings, kept
   apart by source — 'nvr_export' is the recorder's own log ("จากระบบ"), anything else is a hand check
   ("ตรวจเอง"); the hand-noted 'excel' baseline is not a reading. A camera's status follows its file
   reading when it has one, and a camera the recorder reports broken carries no hand reading.
   Plain functions of their inputs, used by the Admin Console and tested in Node (tests/cctv.test.js). */
(function (root) {
  function readings(checks) {
    const latest = {}, history = {}, nvrLast = {}, latestFile = {}, latestHand = {}, nvrFile = {}, nvrHand = {};
    (checks || []).forEach(ch => {
      if (ch.source === 'excel') return;
      const file = ch.source === 'nvr_export';
      if (!nvrLast[ch.nvr]) nvrLast[ch.nvr] = ch;
      if (file && !nvrFile[ch.nvr]) nvrFile[ch.nvr] = ch;
      if (!file && !nvrHand[ch.nvr]) nvrHand[ch.nvr] = ch;
      (ch.items || []).forEach(it => {
        const row = { date: ch.check_date, days: it.days, ok: it.ok !== false, note: it.note || '', checker: ch.checker, file };
        if (!latest[it.name]) latest[it.name] = row;
        if (file && !latestFile[it.name]) latestFile[it.name] = row;
        if (!file && !latestHand[it.name]) latestHand[it.name] = row;
        (history[it.name] = history[it.name] || []).push(row);
      });
    });
    Object.keys(latestFile).forEach(n => { latest[n] = latestFile[n]; });
    Object.keys(latestFile).forEach(n => { if (!latestFile[n].ok) delete latestHand[n]; });
    return { latest, history, nvrLast, latestFile, latestHand, nvrFile, nvrHand };
  }
  /* days short of what the camera can hold (its capacity); 0 when fine, broken or unknown */
  function shortOf(cam, r) { return r && r.ok && r.days != null && cam.capacity ? Math.max(0, cam.capacity - r.days) : 0; }
  /* 'none' | 'bad' | 'short' | 'ok' from a camera's current reading */
  function status(cam, r) { return !r ? 'none' : !r.ok ? 'bad' : shortOf(cam, r) > 0 ? 'short' : 'ok'; }
  function readText(r) { return !r ? '—' : !r.ok ? 'เสีย' : r.days == null ? '—' : String(r.days); }
  /* the NVR's "Recording Status Log" export (sheet rows as arrays) → one nvr_export check per NVR.
     Cameras are matched to the register by name (spaces and the FD- prefix ignored) and take the
     register's NVR. 0 days = no footage; a recording that ended before the newest end date = stopped. */
  function parseLog(rows, cams) {
    const norm = s => String(s == null ? '' : s).replace(/\s+/g, '').replace(/^(FD-)+/i, '').toUpperCase();
    let at = '';
    const data = [];
    (rows || []).forEach(r => {
      const a = String(r[0] == null ? '' : r[0]), m = a.match(/Export Time:\s*(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/);
      if (m) at = { date: m[1] + '-' + m[2] + '-' + m[3], time: m[4] + ':' + m[5] };
      else if (/^NVR\s*\d/i.test(String(r[2] || '')) && a) data.push({ key: norm(a), end: String(r[5] || ''), days: parseInt(r[6], 10) || 0 });
    });
    const lastEnd = data.map(d => d.end).sort().pop() || '';
    const byKey = {}; data.forEach(d => { byKey[d.key] = d; });
    const by = {}, missing = [], broken = [];
    (cams || []).forEach(c => {
      const d = byKey[norm(c.name)];
      if (!d) { missing.push(c.name); return; }
      delete byKey[norm(c.name)];
      const note = d.days === 0 ? 'ไม่มีภาพบันทึก (0 วัน)' : d.end && d.end < lastEnd ? 'หยุดบันทึกตั้งแต่ ' + d.end : '';
      const it = { name: c.name, days: d.days, ok: !note };
      if (note) { it.note = note; broken.push(c.name + ' · ' + note); }
      (by[c.nvr] = by[c.nvr] || []).push(it);
    });
    const checks = Object.keys(by).map(n => ({ check_date: at.date || '', nvr: Number(n), source: 'nvr_export',
      checker: 'Recording Status Log (export ' + (at.date ? at.date.slice(8) + '/' + at.date.slice(5, 7) + ' ' + at.time : '') + ')', items: by[n] }));
    return { date: at.date || '', checks, missing, extra: Object.keys(byKey), broken, total: data.length };
  }
  const api = { readings, shortOf, status, readText, parseLog };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SOCCctv = api;
})(typeof window !== 'undefined' ? window : globalThis);
