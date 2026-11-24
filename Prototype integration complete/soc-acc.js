/* ACC door map: the door register (from the installer's "ACC ตึกใหญ่" / "ACC บริการ" sheets, Nov 2026)
   and the month view the Admin Console draws as a building section. Plain data + one pure function,
   tested in Node (tests/acc.test.js). Doors marked ยกเลิก in the register are left out; floors 8–11 and
   the roof exist only on the test sheet with no serial numbers, so they are not in the register yet.
   A record matches a door by its door field (mi_acc_door, "G-DMC-1 · …") when it has one; older
   records only carry the floor, so those count toward the floor but cannot light a single door. */
(function (root) {
  /* pending = the register says it is still being installed: shown on the map and offered in the form,
     but not counted until a check names it */
  const D = (code, room, pending) => ({ code, room, pending: !!pending });
  const BUILDINGS = [
    { id: 'main', name: 'อาคารโรงพยาบาล', floors: [
      { id: '7', label: 'ชั้น 7', doors: [D('7-DMC-1', ''), D('7-DMC-2', ''), D('7-DMC-3', ''), D('7-DM-1', 'บันได')] },
      { id: '6', label: 'ชั้น 6', doors: [D('6-DMC-1', ''), D('6-DM-1', 'บันได')] },
      { id: '5', label: 'ชั้น 5', doors: [D('5-DMC-1', 'สำนักงานธุรการ'), D('5-DMC-2', 'แผนกบัญชี'), D('5-DMC-3', 'แผนก HR'),
        D('5-DMC-4', 'LAB บานเดี่ยว'), D('5-DMC-5', 'LAB บานคู่'), D('5-DMC-6', 'IT Room'), D('5-DMC-7', 'IPD CASHIER'),
        D('5-DMC-8', 'แผนกสิทธิประโยชน์'), D('5-DMC-9', 'แผนกเวชระเบียน'), D('5-DMC-10', 'ห้องพักแพทย์'), D('5-DM-1', 'บันได ST-2,1')] },
      { id: '4', label: 'ชั้น 4', doors: [D('4-DMC-1', 'ICU ทางเข้าแผนกผู้ป่วย'), D('4-DMC-2', 'ICU NEGATIVE'), D('4-DMC-3', 'OR ห้องน้ำส่วนกลาง'),
        D('4-DMC-4', 'OR หน้าประตูซักล้าง'), D('4-DMC-5', 'OR DAY SURGERY'), D('4-DMC-6', 'OR ทางเข้าแผนกผ่าตัด'), D('4-DMC-7', 'OR บันได ST-04'),
        D('4-DMC-8', 'LR ทางเข้าแผนกทำคลอด'), D('4-DMC-9', 'ห้อง IT'), D('4-DMC-10', 'ICU ห้องพักเจ้าหน้าที่'), D('4-DMC-11', 'LR แผนกทำคลอด'),
        D('4-DM-1', 'บันได ST-2,1')] },
      { id: '3', label: 'ชั้น 3', doors: [D('3-DMC-1', 'ห้อง IT'), D('3-DM-1', 'บันได ST-2,1')] },
      { id: '2', label: 'ชั้น 2', doors: [D('2-DMC-1', 'ทางเข้าการเงิน'), D('2-DMC-2', 'ห้องจัดยาผู้ป่วย'), D('2-DMC-3', 'ห้อง IT'), D('2-DM-1', 'บันได ST-2,1,4')] },
      { id: '1', label: 'ชั้น 1', doors: [D('1-DMC-1', 'สำนักงาน'), D('1-DMC-2', 'ห้องจัดยา'), D('1-DMC-3', 'ห้องการเงิน'), D('1-DMC-4', 'ห้องจัดยา'),
        D('1-DMC-5', 'โถงลิฟต์บริการ+ดับเพลิง'), D('1-DMC-6', 'ห้อง IT'), D('1-DMC-7', 'ห้องวิทยุ'), D('1-DMC-8', 'โถงทางเข้าแผนกฉุกเฉิน'),
        D('1-DMC-10', 'ห้องตรวจแยกโรค'), D('1-DMC-11', 'แผนกฉุกเฉิน'), D('1-DMC-12', 'ห้องนอนเวร'), D('1-DMC-13', 'ห้องนอนเวรแพทย์'), D('1-DM-1', 'บันได')] },
      { id: 'G', label: 'ชั้น G', doors: [D('G-DMC-1', 'การเงิน แผนกทางเดินหายใจ'), D('G-DMC-2', 'จ่ายยา แผนกทางเดินหายใจ'), D('G-DMC-3', 'จ่ายยา ประกันสังคม'),
        D('G-DMC-4', 'IT Room'), D('G-DMC-5', 'หน้าลิฟต์ Fire Man (กำลังติดตั้ง)', true), D('G-DM-1', 'บันไดหนีไฟ ST1, ST2')] }
    ] },
    { id: 'svc', name: 'อาคารบริการ', floors: [
      { id: 'ตึกบริการ 4', label: 'ชั้น 4', doors: [D('4S-DMC-1', 'ENGINEER'), D('4S-DMC-2', 'เครื่องมือแพทย์'), D('4S-DM-1', 'บันได ST5,6')] },
      { id: 'ตึกบริการ 3', label: 'ชั้น 3', doors: [D('3S-DMC-1', 'สำนักงาน IT'), D('3S-DMC-2', 'SERVER'), D('3S-DMC-3', 'ห้องเก็บของ'), D('3S-DMC-4', 'CAR WASH (รอประตู)', true), D('3S-DM-1', 'บันได ST5,6')] },
      { id: 'ตึกบริการ 2', label: 'ชั้น 2', doors: [D('2S-DMC-1', 'OFFICE HOSPITAL'), D('2S-DMC-2', 'พื้นที่ส่งของ'), D('2S-DMC-3', 'ห้องเก็บของเวชภัณฑ์'),
        D('2S-DMC-4', 'สำนักงาน'), D('2S-DMC-5', 'คลังยา'), D('2S-DMC-6', 'เก็บน้ำเกลือ'), D('2S-DM-1', 'บันได ST5,6')] },
      { id: 'ตึกบริการ 1', label: 'ชั้น 1', doors: [D('1S-DMC-1', 'CCTV ROOM'), D('1S-DMC-2', 'สำนักงานจ่ายผ้า'), D('1S-DMC-3', 'เก็บศพ'), D('1S-DM-1', 'บันได ST5,6')] }
    ] }
  ];
  /* answers that mean the door is fine; anything else on a record is a fault */
  const OK = { mi_acc_reader_status: 'ปกติ', mi_acc_electric_lock: 'ปกติ', mi_acc_magnet: 'ปกติ', mi_acc_alarm_light: 'มีไฟแจ้งเตือน',
    mi_acc_lock_status: 'ล็อคปกติ', mi_acc_sensor_box: 'ใช้ได้ปกติ', mi_acc_emergency_release: 'ปกติ' };
  const faults = (d) => Object.keys(OK).filter(k => d[k] && d[k] !== OK[k]).map(k => d[k]);
  const codeOf = (v) => String(v || '').split('·')[0].trim().toUpperCase();
  function doorOptions() {
    const out = [];
    BUILDINGS.forEach(b => b.floors.forEach(f => f.doors.forEach(d => out.push(d.code + (d.room ? ' · ' + d.room : '')))));
    return out;
  }
  /* recs: the month's ACC records ({ data }). Returns buildings → floors → doors with a state each
     ('ok' | 'bad' | 'none') plus per-floor counts, so the page only has to colour it. */
  function monthView(recs) {
    const byDoor = {}, byFloor = {};
    (recs || []).forEach(r => {
      const d = r.data || {}, f = String(d.mi_acc_floor || '').trim(), code = codeOf(d.mi_acc_door);
      const bad = faults(d);
      (byFloor[f] = byFloor[f] || { n: 0, bad: 0 }).n++;
      if (bad.length) byFloor[f].bad++;
      if (code) { const e = byDoor[code] || (byDoor[code] = { n: 0, faults: [], date: '' }); e.n++; e.faults = e.faults.concat(bad); if (d.mi_acc_note) e.notes = (e.notes || []).concat(d.mi_acc_note); e.date = r.reportDate || e.date; }
    });
    let total = 0, checked = 0, bad = 0;
    const buildings = BUILDINGS.map(b => ({ id: b.id, name: b.name, floors: b.floors.map(f => {
      const fl = byFloor[f.id] || { n: 0, bad: 0 };
      const doors = f.doors.map(d => { const e = byDoor[d.code];
        if (d.pending && !e) return { code: d.code, room: d.room, state: 'pending', faults: [], notes: [], date: '' };
        return { code: d.code, room: d.room, state: !e ? 'none' : e.faults.length ? 'bad' : 'ok', faults: e ? e.faults : [], notes: e && e.notes || [], date: e ? e.date : '' }; });
      const live = doors.filter(d => d.state !== 'pending').length;
      total += live; checked += Math.min(fl.n, live); bad += fl.bad;
      return { id: f.id, label: f.label, doors, total: live, checked: fl.n, bad: fl.bad,
        state: fl.bad ? 'bad' : fl.n >= live ? 'ok' : fl.n ? 'partial' : 'none' };
    }) }));
    return { buildings, total, checked, bad };
  }
  /* the doors of one floor (the form's floor value: 'G', '1'…'7', 'ตึกบริการ 1'…) as form options */
  function doorsFor(floorId) {
    const id = String(floorId || '').trim();
    for (const b of BUILDINGS) for (const f of b.floors) if (f.id === id) return f.doors.map(d => d.code + (d.room ? ' · ' + d.room : ''));
    return [];
  }
  const api = { BUILDINGS, doorOptions, doorsFor, monthView };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SOCAcc = api;
})(typeof window !== 'undefined' ? window : globalThis);
