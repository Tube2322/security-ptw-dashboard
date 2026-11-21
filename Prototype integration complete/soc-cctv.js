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
  const api = { readings, shortOf, status, readText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SOCCctv = api;
})(typeof window !== 'undefined' ? window : globalThis);
