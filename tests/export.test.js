// Unit tests for soc-export.js (the weekly CCTV Excel). Runs in plain Node with the vendored
// ExcelJS — no browser, no network.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const ExcelJS = require(path.join(__dirname, '..', 'Prototype integration complete', 'vendor', 'exceljs.min.js'));
const { cctvWorkbook } = require(path.join(__dirname, '..', 'Prototype integration complete', 'soc-export.js'));

function build(chkRows, opts) {
  const wb = new ExcelJS.Workbook();
  const sheet = (name, head, rows, widths) => {
    const ws = wb.addWorksheet(name);
    ws.columns = head.map((h, i) => ({ header: h, width: widths[i] || 14 }));
    rows.forEach(r => ws.addRow(r));
    return ws;
  };
  const b = (opts && opts.b) || { from: '2026-11-01', to: '2026-11-30' };
  const cams = { rows: [
    { name: 'FD-1-1', nvr: 1, sort: 1, capacity: 28 },
    { name: 'FD-1-2', nvr: 1, sort: 2, capacity: 28 },
    { name: 'FD-2-1', nvr: 2, sort: 1, capacity: 34 }
  ] };
  const count = cctvWorkbook({ sheet, cams, chk: { rows: chkRows }, b, label: 'พฤศจิกายน 2569',
    inRange: (d) => d >= b.from && d <= b.to, filters: (opts && opts.filters) || {} });
  return { wb, count };
}
const check = (date, source, nvr, items, at) => ({ check_date: date, source, nvr, items, submitted_at: at || date + 'T10:00:00', checker: 't' });
const values = (ws, r) => ws.getRow(r).values.slice(1);

test('baseline leads the summary as week 1, each later week a column', () => {
  const { wb, count } = build([
    check('2026-11-10', 'excel', 1, [{ name: 'FD-1-1', days: 28, ok: true }, { name: 'FD-1-2', days: 28, ok: true }]),
    check('2026-11-14', 'nvr_export', 1, [{ name: 'FD-1-1', days: 32, ok: true }, { name: 'FD-1-2', ok: false, note: 'stopped' }]),
    check('2026-11-14', 'portal', 1, [{ name: 'FD-1-1', days: 33, ok: true }, { name: 'FD-1-2', days: 30, ok: true }])
  ]);
  assert.deepStrictEqual(wb.worksheets.map(w => w.name), ['สรุปรายเดือน', 'เสาร์ที่ 14 พ.ย. 69']);
  const sum = wb.worksheets[0];
  assert.match(values(sum, 2)[2], /สัปดาห์ 1[\s\S]*10 พ.ย. 2569 \(ข้อมูลเดิม\)/);
  assert.match(values(sum, 2)[3], /สัปดาห์ 2[\s\S]*เสาร์ที่ 14 พ.ย. 2569/);
  assert.deepStrictEqual(values(sum, 3).slice(0, 4), ['NVR 1', 'FD-1-1', 28, 32]);
  /* broken by the recorder: shown broken, its hand reading dropped */
  assert.deepStrictEqual(values(sum, 4).slice(0, 4), ['NVR 1', 'FD-1-2', 28, 'เสีย']);
  assert.match(values(sum, 4)[4], /กล้องเสีย ไม่มีข้อมูล — stopped/);
  assert.strictEqual(count, 2);
});

test('weekly sheet compares own check with the system reading', () => {
  const { wb } = build([
    check('2026-11-14', 'nvr_export', 1, [{ name: 'FD-1-1', days: 32, ok: true }, { name: 'FD-1-2', days: 30, ok: true }]),
    check('2026-11-14', 'portal', 1, [{ name: 'FD-1-1', days: 33, ok: true }, { name: 'FD-1-2', days: 29, ok: true }])
  ]);
  const wk = wb.getWorksheet('เสาร์ที่ 14 พ.ย. 69');
  assert.deepStrictEqual(values(wk, 2), ['NVR', 'วันที่ตรวจ', 'กล้อง', 'ดูย้อนหลังได้ อิงจากระบบ', 'ดูย้อนหลังได้ ที่ตรวจสอบเอง', 'สรุปวันที่หายไป', 'หมายเหตุ']);
  assert.strictEqual(values(wk, 3)[5], 'เกิน 1 วัน (รวมวันนี้)');
  assert.strictEqual(values(wk, 4)[5], 'ขาด 1 วัน');
});

test('a month with no baseline carries the last earlier reading forward', () => {
  const { wb } = build([
    check('2026-11-28', 'nvr_export', 1, [{ name: 'FD-1-1', days: 31, ok: true }]),
    check('2026-12-05', 'nvr_export', 1, [{ name: 'FD-1-1', days: 30, ok: true }])
  ], { b: { from: '2026-12-01', to: '2026-12-31' } });
  const sum = wb.worksheets[0];
  assert.match(values(sum, 2)[2], /28 พ.ย. 2569 \(ยกมาจากครั้งก่อน\)/);
  assert.deepStrictEqual(values(sum, 3).slice(0, 4), ['NVR 1', 'FD-1-1', 31, 30]);
});

test('NVR filter keeps only the chosen recorder', () => {
  const { wb } = build([
    check('2026-11-14', 'nvr_export', 1, [{ name: 'FD-1-1', days: 32, ok: true }]),
    check('2026-11-14', 'nvr_export', 2, [{ name: 'FD-2-1', days: 40, ok: true }])
  ], { filters: { nvr: ['2'] } });
  const wk = wb.getWorksheet('เสาร์ที่ 14 พ.ย. 69');
  assert.strictEqual(wk.rowCount, 3);
  assert.strictEqual(values(wk, 3)[2], 'FD-2-1');
});

test('nothing checked in the period gives a single explanatory sheet', () => {
  const { wb, count } = build([], { b: { from: '2026-10-01', to: '2026-10-31' } });
  assert.deepStrictEqual(wb.worksheets.map(w => w.name), ['ไม่มีข้อมูล']);
  assert.strictEqual(count, 0);
});
