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
