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
