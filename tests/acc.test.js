// Unit tests for soc-acc.js (ACC door register and month view). Plain Node.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const A = require(path.join(__dirname, '..', 'Prototype integration complete', 'soc-acc.js'));

const rec = (floor, extra) => ({ reportDate: '2026-11-23', data: Object.assign({ mi_acc_floor: floor, mi_acc_reader_status: 'ปกติ' }, extra) });

test('register has both buildings and skips cancelled doors', () => {
  assert.deepStrictEqual(A.BUILDINGS.map(b => b.name), ['อาคารโรงพยาบาล', 'อาคารบริการ']);
  const codes = A.doorOptions().map(o => o.split(' · ')[0]);
  assert.ok(codes.includes('G-DMC-1') && codes.includes('4S-DM-1'));
  assert.ok(!codes.includes('1-DMC-9') && !codes.includes('6-DMC-2'), 'cancelled doors left out');
});

test('floor counts and states from floor-only records', () => {
  const v = A.monthView([rec('3'), rec('3'), rec('2'), rec('G', { mi_acc_electric_lock: 'กลอนหลวม' })]);
  const fl = (id) => v.buildings[0].floors.find(f => f.id === id);
  assert.strictEqual(fl('3').state, 'ok');
  assert.strictEqual(fl('2').state, 'partial');
  assert.strictEqual(fl('G').state, 'bad');
  assert.strictEqual(fl('7').state, 'none');
  assert.strictEqual(v.bad, 1);
});

test('a record naming its door lights that door', () => {
  const v = A.monthView([rec('1', { mi_acc_door: '1-DMC-2 · ห้องจัดยา' }), rec('1', { mi_acc_door: '1-DMC-3', mi_acc_magnet: 'ไม่ทำงาน' })]);
  const doors = v.buildings[0].floors.find(f => f.id === '1').doors;
  assert.strictEqual(doors.find(d => d.code === '1-DMC-2').state, 'ok');
  assert.strictEqual(doors.find(d => d.code === '1-DMC-3').state, 'bad');
  assert.strictEqual(doors.find(d => d.code === '1-DMC-1').state, 'none');
});

const ExcelJS = require(path.join(__dirname, '..', 'Prototype integration complete', 'vendor', 'exceljs.min.js'));
const { accWorkbook } = require(path.join(__dirname, '..', 'Prototype integration complete', 'soc-export.js'));
test('Excel: a floor summary and a door list per month, faults shown', () => {
  const wb = new ExcelJS.Workbook();
  const sheet = (name, head, rows, widths) => { const ws = wb.addWorksheet(name); ws.columns = head.map((h, i) => ({ header: h, width: widths[i] })); rows.forEach(r => ws.addRow(r)); return ws; };
  const view = A.monthView([rec('1', { mi_acc_door: '1-DMC-3', mi_acc_magnet: 'ไม่ทำงาน' }), rec('3'), rec('3')]);
  const n = accWorkbook({ sheet, views: [{ label: 'พ.ย. 69', view }] });
  assert.deepStrictEqual(wb.worksheets.map(w => w.name), ['สรุปรายชั้น พ.ย. 69', 'รายประตู พ.ย. 69']);
  assert.strictEqual(n, view.buildings.reduce((a, b) => a + b.floors.reduce((x, f) => x + f.doors.length, 0), 0));
  const sum = wb.worksheets[0], last = sum.getRow(sum.rowCount).values.slice(1);
  assert.strictEqual(last[0], 'รวม');
  assert.strictEqual(last[3], 3);
  const doorRow = []; wb.worksheets[1].eachRow(r => { if (r.getCell(3).value === '1-DMC-3') doorRow.push(r.values.slice(1)); });
  assert.strictEqual(doorRow[0][4], 'พบผิดปกติ');
  assert.match(doorRow[0][6], /ไม่ทำงาน/);
});

test('doors still being installed are shown and offered but not counted until checked', () => {
  const g = A.monthView([]).buildings[0].floors.find(f => f.id === 'G');
  assert.strictEqual(g.total, 5);
  assert.strictEqual(g.doors.find(d => d.code === 'G-DMC-5').state, 'pending');
  assert.ok(A.doorsFor('G').some(o => o.startsWith('G-DMC-5')));
  const found = A.monthView([{ reportDate: '2026-12-01', data: { mi_acc_floor: 'G', mi_acc_door: 'G-DMC-5' } }]).buildings[0].floors.find(f => f.id === 'G');
  assert.strictEqual(found.doors.find(d => d.code === 'G-DMC-5').state, 'ok');
});
