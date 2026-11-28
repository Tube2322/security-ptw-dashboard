// Unit tests for soc-cctv.js (weekly CCTV readings and status). Plain Node.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const C = require(path.join(__dirname, '..', 'Prototype integration complete', 'soc-cctv.js'));

const ck = (date, source, nvr, items) => ({ check_date: date, source, nvr, checker: 'x', items });
/* newest first, as the database returns them */
const checks = [
  ck('2026-11-14', 'portal', 1, [{ name: 'A', days: 33, ok: true }, { name: 'B', days: 30, ok: true }, { name: 'C', days: 20, ok: true }]),
  ck('2026-11-14', 'nvr_export', 1, [{ name: 'A', days: 32, ok: true }, { name: 'B', ok: false, note: 'stopped' }]),
  ck('2026-11-10', 'excel', 1, [{ name: 'A', days: 28, ok: true }, { name: 'D', days: 28, ok: true }])
];

test('file reading decides the status even when a hand check is newer', () => {
  const r = C.readings(checks);
  assert.strictEqual(r.latest.A.days, 32);
  assert.strictEqual(r.latest.A.file, true);
  assert.strictEqual(r.latestHand.A.days, 33);
});

test('a camera the recorder reports broken has no hand reading', () => {
  const r = C.readings(checks);
  assert.strictEqual(r.latest.B.ok, false);
  assert.strictEqual(r.latestHand.B, undefined);
});

test('the hand-noted excel baseline is not a reading', () => {
  const r = C.readings(checks);
  assert.strictEqual(r.latest.D, undefined);
  assert.strictEqual(r.history.A.length, 2);
});

test('status: ok, short, bad, none against capacity', () => {
  const r = C.readings(checks);
  assert.strictEqual(C.status({ capacity: 28 }, r.latest.A), 'ok');
  assert.strictEqual(C.status({ capacity: 28 }, r.latest.C), 'short');
  assert.strictEqual(C.shortOf({ capacity: 28 }, r.latest.C), 8);
  assert.strictEqual(C.status({ capacity: 28 }, r.latest.B), 'bad');
  assert.strictEqual(C.status({ capacity: 28 }, undefined), 'none');
  assert.strictEqual(C.readText(r.latest.B), 'เสีย');
});

test('per-NVR latest check is tracked by source', () => {
  const r = C.readings(checks);
  assert.strictEqual(r.nvrFile[1].source, 'nvr_export');
  assert.strictEqual(r.nvrHand[1].source, 'portal');
});

test('parseLog: Recording Status Log rows become one nvr_export check per NVR, broken cameras noted', () => {
  const cams = [{ name: 'FD-1-1', nvr: 1 }, { name: 'FD-7-2', nvr: 4 }, { name: 'RF-1-1', nvr: 5 }, { name: 'FD-9-9', nvr: 4 }];
  const rows = [['Export Time:2026/11/28 16:20:26'], ['Name', 'IP', 'Device'],
    ['FD-1-1', 'ip', 'NVR1', 's', '2026-10-17', '2026-11-27', '42'],
    ['FD- 7-2', 'ip', 'NVR4', 's', '2026-03-01', '2026-04-29', '12'],
    ['RF-1-1', 'ip', 'NVR5', 's', null, null, '0'],
    ['FD-X-1', 'ip', 'NVR2', 's', '2026-10-17', '2026-11-27', '40']];
  const p = C.parseLog(rows, cams);
  assert.strictEqual(p.date, '2026-11-28');
  assert.deepStrictEqual(p.checks.map(c => c.nvr), [1, 4, 5]);
  assert.match(p.checks[0].checker, /28\/11 16:20/);
  const n4 = p.checks[1].items[0];
  assert.strictEqual(n4.ok, false); assert.match(n4.note, /2026-04-29/);
  assert.strictEqual(p.checks[2].items[0].note, 'ไม่มีภาพบันทึก (0 วัน)');
  assert.deepStrictEqual(p.missing, ['FD-9-9']); assert.deepStrictEqual(p.extra, ['X-1']);
});
