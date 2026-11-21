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

const { repairsSheet } = require(path.join(__dirname, '..', 'Prototype integration complete', 'soc-export.js'));
test('repair jobs: newest first, filtered by period, status group and topic', () => {
  const wb = new ExcelJS.Workbook();
  const sheet = (name, head, rows) => { const ws = wb.addWorksheet(name); ws.addRow(head); rows.forEach(r => ws.addRow(r)); return ws; };
  const rows = [
    { code: 'R1', created_at: '2026-11-02T08:00:00', topic: 'CCTV', status: 'done', faults: [{ label: 'ภาพไม่ขึ้น' }] },
    { code: 'R2', created_at: '2026-11-05T08:00:00', topic: 'ห้องน้ำ', status: 'pending', faults: [] },
    { code: 'R3', created_at: '2026-10-30T08:00:00', topic: 'CCTV', status: 'pending', faults: [] },
    { code: 'R4', created_at: '2026-11-03T08:00:00', topic: 'ACC', status: 'repairing', faults: [] }
  ];
  const inRange = (d) => d >= '2026-11-01' && d <= '2026-11-30';
  assert.strictEqual(repairsSheet({ sheet, rows, inRange }), 3);
  const ws = wb.getWorksheet('งานซ่อม');
  assert.deepStrictEqual([2, 3, 4].map(r => ws.getRow(r).getCell(1).value), ['R2', 'R4', 'R1']);
  assert.strictEqual(ws.getRow(4).getCell(6).value, 'ซ่อมเสร็จ');
  const wb2 = new ExcelJS.Workbook();
  const sheet2 = (name, head, rs) => { const w = wb2.addWorksheet(name); rs.forEach(r => w.addRow(r)); return w; };
  assert.strictEqual(repairsSheet({ sheet: sheet2, rows, inRange, filters: { st: ['open'], topic: ['อื่นๆ'] } }), 1);
});

const { filterRecords } = require(path.join(__dirname, '..', 'Prototype integration complete', 'soc-export.js'));
const ctxOf = (mod, kind, picks, extra) => Object.assign({ mod, kind, fieldPrefix: 'traffic', golfCarts: ['golf_cart_1', 'golf_cart_2'],
  groups: Object.keys(picks).concat(['_unused']), pick: (k) => picks[k] || null, parkingFields: [] }, extra);

test('filters: nothing picked returns the records untouched', () => {
  const recs = [{ data: { a: 1 } }];
  assert.strictEqual(filterRecords(recs, ctxOf('traffic', 'traffic', {})), recs);
});

test('filters: traffic day + car blanks night and motorcycle columns, keeps the row', () => {
  const r = { data: { traffic_car_in_day: 5, traffic_car_in_night: 7, traffic_moto_in_day: 9 } };
  const [out] = filterRecords([r], ctxOf('traffic', 'traffic', { shift: ['day'], veh: ['car'] }));
  assert.strictEqual(out.data.traffic_car_in_day, 5);
  assert.strictEqual(out.data.traffic_car_in_night, 0);
  assert.strictEqual(out.data.traffic_moto_in_day, 0);
  assert.strictEqual(r.data.traffic_car_in_night, 7, 'original record not changed');
});

test('filters: golf by shift drops rows, by cart blanks the other carts', () => {
  const recs = [{ data: { golf_shift: 'กะกลางวัน', golf_cart_1: 3, golf_cart_2: 4 } }, { data: { golf_shift: 'กะกลางคืน', golf_cart_1: 1, golf_cart_2: 2 } }];
  const out = filterRecords(recs, ctxOf('golf', 'golf', { shift: ['night'], cart: ['golf_cart_2'] }));
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].data.golf_cart_1, '');
  assert.strictEqual(out[0].data.golf_cart_2, 2);
});

test('filters: visitors by type and parking by column', () => {
  const [v] = filterRecords([{ data: { visitor_general_count: 3, visitor_contractor_count: 2 } }], ctxOf('visitors', 'visitors', { type: ['visitor_contractor_count'] }));
  assert.deepStrictEqual([v.data.visitor_general_count, v.data.visitor_contractor_count], [0, 2]);
  const [p] = filterRecords([{ data: { tt_staff_cars: 5, tt_other_cars: 1 } }], ctxOf('traffic_tt', 'parking', { cols: ['tt_staff_cars'] }, { parkingFields: ['tt_staff_cars', 'tt_other_cars'] }));
  assert.deepStrictEqual([p.data.tt_staff_cars, p.data.tt_other_cars], [5, '']);
});
