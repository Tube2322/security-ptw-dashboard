/* Excel builders kept out of the Admin Console so they can be read and tested on their own.
   SOCExport.cctvWorkbook fills an ExcelJS workbook with the weekly CCTV report: a monthly summary
   (camera × week, led by the baseline or the last reading before the period) and one sheet per
   week closing on Saturday. Inputs are plain data; nothing here touches the page or the network. */
(function (root) {
  /* opts: { sheet(name, head, rows, widths) -> worksheet, cams: {rows}, chk: {rows}, b: {from, to},
     inRange(day) -> bool, label, filters: { nvr, src, st } (null = all) }; returns rows written */
  function cctvWorkbook(opts) {
    const sheet = opts.sheet, cams = opts.cams, chk = opts.chk, b = opts.b, inRange = opts.inRange,
      label = opts.label, filters = opts.filters || {};
    let count = 0;
    const camOf = {}; cams.rows.forEach(c => { camOf[c.name] = c; });
    /* a camera renamed or retired since still shows in the months it was checked */
    chk.rows.filter(c => inRange(c.check_date) && c.source !== 'excel').forEach(ch => (ch.items || []).forEach(it => {
      if (!camOf[it.name]) { camOf[it.name] = { name: it.name, nvr: ch.nvr, sort: 9999, capacity: null }; cams.rows.push(camOf[it.name]); } }));
    /* same rules as the page: the hand-noted baseline is not exported, and a camera the
       recorder reports broken carries no hand reading */
    const checks = chk.rows.filter(c => inRange(c.check_date) && c.source !== 'excel')
      .sort((x, y) => String(y.check_date + (y.submitted_at || '')).localeCompare(String(x.check_date + (x.submitted_at || ''))));
    /* one sheet per weekly report, named after the Saturday that closes the week (Sun–Sat);
       several checks in one week: the latest wins */
    const fN = filters.nvr, fS = filters.src, fSt = filters.st;
    const wantF = !fS || fS.includes('file'), wantH = !fS || fS.includes('hand');
    const MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const satOf = (day) => { const d = new Date(day + 'T00:00:00'); d.setDate(d.getDate() + (6 - d.getDay()));
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    const thDate = (day, short) => { const [y, m, d] = day.split('-').map(Number); return d + ' ' + MON[m - 1] + ' ' + (short ? String(y + 543).slice(2) : y + 543); };
    const weeks = {};
    checks.forEach(ch => { const k = satOf(ch.check_date); (weeks[k] = weeks[k] || []).push(ch); });
    const keys = Object.keys(weeks).sort();
    const head = ['NVR', 'วันที่ตรวจ', 'กล้อง'].concat(wantF ? ['ดูย้อนหลังได้ อิงจากระบบ'] : [], wantH ? ['ดูย้อนหลังได้ ที่ตรวจสอบเอง'] : [], ['สรุปวันที่หายไป', 'หมายเหตุ']);
    const widths = [10, 13, 16].concat(wantF ? [24] : [], wantH ? [26] : [], [17, 40]);
    /* one colour per NVR zone: dark band on the NVR cell, light tint across the row,
       a heavier rule where a new NVR starts */
    const BAND = { 1: 'FF2B6CB0', 2: 'FF2F855A', 3: 'FFB7791F', 4: 'FF805AD5', 5: 'FFC05621', 6: 'FF2C7A7B' };
    const TINT = { 1: 'FFE3F0FB', 2: 'FFE6F4EA', 3: 'FFFFF4D6', 4: 'FFF3E5F5', 5: 'FFFDE7DD', 6: 'FFE0F4F4' };
    const paint = (ws, first, nvrs, cols) => nvrs.forEach((nv, i) => {
      const row = ws.getRow(first + i), start = i === 0 || nvrs[i - 1] !== nv;
      for (let c = 1; c <= cols; c++) { const cell = row.getCell(c);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c === 1 ? BAND[nv] : TINT[nv] } };
        if (start) cell.border = { top: { style: 'medium', color: { argb: BAND[nv] } } }; }
      row.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    });
    /* report finish: one readable Thai face, hairline grid, centred numbers, A4 landscape
       print that fits the width and repeats the header on every page */
    const NL = String.fromCharCode(10), FONT = 'Tahoma', GRID = { style: 'thin', color: { argb: 'FFBFC5CC' } };
    const finish = (ws, cols, textCols) => {
      ws.getRow(1).font = { name: FONT, bold: true, size: 14 }; ws.getRow(1).height = 26;
      ws.getRow(1).alignment = { vertical: 'middle' };
      const h = ws.getRow(2);
      h.font = { name: FONT, bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      h.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; h.height = 36;
      ws.eachRow((row, r) => { if (r < 2) return;
        if (r > 2) row.height = 18;
        for (let c = 1; c <= cols; c++) { const cell = row.getCell(c);
          const top = cell.border && cell.border.top && cell.border.top.style === 'medium' ? cell.border.top : GRID;
          cell.border = { top: r === 2 ? GRID : top, left: GRID, bottom: GRID, right: GRID };
          if (r > 2) { cell.font = Object.assign({ name: FONT, size: 10 }, cell.font || {}, { name: FONT, size: 10 });
            cell.alignment = { vertical: 'middle', horizontal: textCols.includes(c) ? 'left' : 'center', indent: textCols.includes(c) ? 1 : 0 }; } } });
      ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '2:2',
        margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } };
      ws.headerFooter = { oddFooter: '&L&8' + 'SOC Command Center' + '&R&8หน้า &P / &N' };
    };
    const maps = {};
    keys.forEach(k => {
      const F = {}, H = {};
      weeks[k].forEach(ch => { (ch.items || []).forEach(it => { const T = ch.source === 'nvr_export' ? F : H; if (!T[it.name]) T[it.name] = { ch, it }; }); });
      Object.keys(H).forEach(n => { if (F[n] && F[n].it.ok === false) delete H[n]; });
      maps[k] = { F, H };
    });
    /* monthly summary first: camera × week, the system reading (own check where the system has
       none), led by the original pre-adjustment figures when that baseline falls in the period */
    /* lead column: the original baseline when it falls inside the period, otherwise each camera's
       last reading before the period starts, so every month picks up where the last one ended */
    const base = chk.rows.filter(c => c.source === 'excel' && inRange(c.check_date));
    const prior = b.from ? chk.rows.filter(c => c.check_date < b.from) : [];
    const leadSrc = base.length ? base : prior;
    const B = {}; leadSrc.slice().sort((x, y) => (y.source === 'nvr_export') - (x.source === 'nvr_export'))
      .sort((x, y) => (y.check_date > x.check_date) - (y.check_date < x.check_date))
      .forEach(ch => (ch.items || []).forEach(it => { if (!(it.name in B)) B[it.name] = it; }));
    const baseDay = base.length ? base.map(c => c.check_date).sort()[0] : prior.length ? prior.map(c => c.check_date).sort().pop() : null;
    const leadLabel = base.length ? 'ข้อมูลเดิม' : 'ยกมาจากครั้งก่อน';
    if (keys.length || baseDay) {
      const lastK = keys[keys.length - 1];
      const sumCams = cams.rows.filter(c => (!fN || fN.includes(String(c.nvr)))).sort((a, c) => a.nvr - c.nvr || a.sort - c.sort).filter(c => {
        if (!fSt || !lastK) return true; const e = maps[lastK].F[c.name] || maps[lastK].H[c.name]; if (!e) return fSt.includes('ยังไม่ตรวจ');
        return fSt.includes(e.it.ok === false ? 'เสีย' : c.capacity && e.it.days < c.capacity ? 'ขาดวัน' : 'ครบ'); });
      const sHead = ['NVR', 'กล้อง'].concat(baseDay ? ['สัปดาห์ 1' + NL + thDate(baseDay) + ' (' + leadLabel + ')']: [], keys.map((k, i) => 'สัปดาห์ ' + (i + 1 + (baseDay ? 1 : 0)) + NL + 'เสาร์ที่ ' + thDate(k)), ['หมายเหตุ']);
      const sRows = sumCams.map(c => {
        const cells = keys.map(k => { const e = maps[k].F[c.name] || maps[k].H[c.name]; return !e ? '' : e.it.ok === false ? 'เสีย' : e.it.days; });
        const lastBad = lastK && (maps[lastK].F[c.name] || {}).it && maps[lastK].F[c.name].it.ok === false;
        const b = B[c.name];
        return ['NVR ' + c.nvr, c.name].concat(baseDay ? [!b ? '' : b.ok === false ? 'เสีย' : b.days] : [], cells,
          [lastBad ? 'กล้องเสีย ไม่มีข้อมูล' + (maps[lastK].F[c.name].it.note ? ' — ' + maps[lastK].F[c.name].it.note : '') : c.sort === 9999 ? 'ไม่อยู่ในรายชื่อกล้องปัจจุบัน' : '']);
      });
      const ws = sheet('สรุปรายเดือน', sHead, sRows, [10, 16].concat(baseDay ? [22] : [], keys.map(() => 20), [40]));
      ws.spliceRows(1, 0, ['ตรวจสอบการบันทึกย้อนหลังกล้อง CCTV · ' + label]);
      ws.mergeCells(1, 1, 1, sHead.length);
      ws.getRow(1).font = { bold: true, size: 14 }; ws.getRow(1).fill = { type: 'pattern', pattern: 'none' };
      ws.getRow(2).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F6F5E' } };
      ws.getRow(2).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; ws.getRow(2).height = 36;
      ws.views = [{ state: 'frozen', ySplit: 2 }];
      ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: sHead.length } };
      paint(ws, 3, sumCams.map(c => c.nvr), sHead.length);
      sRows.forEach((r, i) => { if (r[r.length - 1]) ws.getRow(3 + i).getCell(sHead.length).font = { bold: true, color: { argb: 'FFC53030' } }; });
      finish(ws, sHead.length, [2, sHead.length]);
    }
    keys.forEach(k => {
      const { F, H } = maps[k];
      const rows = cams.rows.filter(c => (!fN || fN.includes(String(c.nvr))) && (F[c.name] || H[c.name]))
        .sort((a, c) => a.nvr - c.nvr || a.sort - c.sort).map(c => {
          const f = F[c.name], h = H[c.name], bad = (f || h).it.ok === false;
          const st = bad ? 'เสีย' : (c.capacity && Math.min(f ? f.it.days : 1e9, h ? h.it.days : 1e9) < c.capacity ? 'ขาดวัน' : 'ครบ');
          if (fSt && !fSt.includes(st)) return null;
          const when = [f, h].filter(Boolean).map(e => e.ch.check_date).sort().pop();
          const d = f && h && f.it.days != null && h.it.days != null ? h.it.days - f.it.days : null;
          /* ตรวจเอง counts today, the recorder log does not — one day over is expected */
          const gap = bad ? 'กล้องเสีย ไม่มีข้อมูล' : d == null ? '' : d > 0 ? 'เกิน ' + d + ' วัน (รวมวันนี้)' : d < 0 ? 'ขาด ' + (-d) + ' วัน' : 'ตรงกัน';
          return ['NVR ' + c.nvr, thDate(when)].concat([c.name], wantF ? [!f ? '' : f.it.ok === false ? 'เสีย' : f.it.days] : [],
            wantH ? [!h ? '' : h.it.days] : [], [gap, [f && f.it.note, h && h.it.note].filter(Boolean).join(' / ')]);
        }).filter(Boolean);
      const ws = sheet('เสาร์ที่ ' + thDate(k, true), head, rows, widths);
      ws.spliceRows(1, 0, ['รายงานประจำสัปดาห์ เสาร์ที่ ' + thDate(k)]);
      ws.mergeCells(1, 1, 1, head.length);
      ws.getRow(1).font = { bold: true, size: 14 }; ws.getRow(1).fill = { type: 'pattern', pattern: 'none' };
      ws.getRow(2).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F6F5E' } };
      ws.views = [{ state: 'frozen', ySplit: 2 }];
      ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: head.length } };
      paint(ws, 3, rows.map(r => Number(r[0].slice(4))), head.length);
      finish(ws, head.length, [3, head.length - 1, head.length]);
      count += rows.length;
    });
    if (!keys.length && !baseDay) sheet('ไม่มีข้อมูล', ['ไม่มีการตรวจในช่วงที่เลือก'], [], [30]);
    return count;
  }
  /* repair jobs, newest first, filtered by period, status group and topic; returns rows written */
  function repairsSheet(opts) {
    const sheet = opts.sheet, inRange = opts.inRange, f = opts.filters || {}, fSt = f.st, fT = f.topic;
    const res = { rows: opts.rows || [] };
    const KNOWN = ['ACC', 'CCTV', 'ถังดับเพลิง', 'ประตูหนีไฟ', 'รถกอล์ฟ'];
    const group = (st) => st === 'rejected' ? 'rejected' : (st === 'done' || st === 'closed') ? 'done' : 'open';
    const rows = res.rows.filter(r => inRange(String(r.created_at || '').slice(0, 10))
        && (!fSt || fSt.includes(group(r.status)))
        && (!fT || fT.includes(KNOWN.includes(r.topic) ? r.topic : 'อื่นๆ')))
      .sort((a, c) => String(c.created_at).localeCompare(String(a.created_at)));
    const STATUS = { pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', sent: 'ส่งช่างแล้ว', accepted: 'ช่างรับงาน', repairing: 'กำลังซ่อม', done: 'ซ่อมเสร็จ', closed: 'ปิดงาน', rejected: 'ไม่อนุมัติ' };
    const loc = (r) => r.loc || {};
    const day = (t) => String(t || '').slice(0, 10);
    /* one row per job: where (building / floor / department or spot), what was broken, how it went */
    const ws = sheet('งานซ่อม', ['เลขงาน', 'เลขงานช่าง', 'วันที่แจ้ง', 'หัวข้อ', 'อาคาร', 'ชั้น', 'แผนก/จุด', 'สิ่งที่ซ่อม',
        'รายละเอียด', 'ผู้แจ้ง', 'สถานะ', 'สถานะฝั่งช่าง', 'ซ่อมเสร็จ', 'ปิดงาน'],
      rows.map(r => { const t = r.times || {};
        return [r.code, r.ext_code || '', day(r.created_at), r.topic || '', loc(r).building || '', loc(r).floor || '',
          loc(r).department || r.place || '',
          (Array.isArray(r.faults) ? r.faults : []).map(x => x.label + (x.value ? ': ' + x.value : '')).join(' / '),
          r.detail || '', (r.reporter || {}).name || '', STATUS[r.status] || r.status || '', r.ext_status || '',
          day(t.done), day(t.closed)]; }),
      [14, 14, 12, 14, 18, 12, 24, 40, 40, 20, 13, 18, 12, 12]);
    /* summary per month of the period: how many jobs, by topic and by floor */
    const months = {};
    rows.forEach(r => { const m = day(r.created_at).slice(0, 7); const o = months[m] || (months[m] = { n: 0, done: 0, topic: {}, floor: {} });
      o.n++; if (r.status === 'done' || r.status === 'closed') o.done++;
      const tp = r.topic || 'อื่นๆ', fl = [loc(r).building, loc(r).floor].filter(Boolean).join(' ') || '—';
      o.topic[tp] = (o.topic[tp] || 0) + 1; o.floor[fl] = (o.floor[fl] || 0) + 1; });
    const list = (o) => Object.keys(o).sort((a, c) => o[c] - o[a]).map(k => k + ' ' + o[k]).join(', ');
    if (rows.length && opts.summary !== false) {
      sheet('สรุปรายเดือน', ['เดือน', 'แจ้งซ่อม (งาน)', 'ซ่อมเสร็จ/ปิด', 'ยังไม่เสร็จ', 'แยกตามหัวข้อ', 'แยกตามอาคาร/ชั้น'],
        Object.keys(months).sort().reverse().map(m => { const o = months[m];
          return [m, o.n, o.done, o.n - o.done, list(o.topic), list(o.floor)]; }),
        [10, 14, 14, 12, 40, 50]);
    }
    void ws;
    return rows.length;
  }
  /* ACC door map as a presentation workbook, one month per pair of sheets: a floor summary (checked /
     register per floor, building colour bands) and a door list (status, date, fault or note). views:
     [{ label, view }] with view = SOCAcc.monthView(records of that month); returns doors written. */
  function accWorkbook(opts) {
    const sheet = opts.sheet, views = opts.views || [];
    const BAND = { 'อาคารโรงพยาบาล': 'FF2B6CB0', 'อาคารบริการ': 'FF2F855A' };
    const TINT = { 'อาคารโรงพยาบาล': 'FFE3F0FB', 'อาคารบริการ': 'FFE6F4EA' };
    const ST = { ok: ['ตรวจแล้ว', 'FFD9F2E6'], bad: ['พบผิดปกติ', 'FFFBE3E1'], none: ['ยังไม่ตรวจ', 'FFF1F3F5'], partial: ['ตรวจบางส่วน', 'FFFFF4D6'] };
    const FST = { ok: 'ตรวจครบ', bad: 'พบผิดปกติ', partial: 'ตรวจบางส่วน', none: 'ยังไม่ตรวจ' };
    const GRID = { style: 'thin', color: { argb: 'FFBFC5CC' } };
    const finish = (ws, cols, title, textCols) => {
      ws.spliceRows(1, 0, [title]);
      ws.mergeCells(1, 1, 1, cols);
      ws.getRow(1).font = { name: 'Tahoma', bold: true, size: 14 }; ws.getRow(1).height = 26;
      const h = ws.getRow(2);
      h.font = { name: 'Tahoma', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F6F5E' } };
      h.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; h.height = 30;
      ws.eachRow((row, r) => { if (r < 3) return; row.height = 18;
        for (let c = 1; c <= cols; c++) { const cell = row.getCell(c);
          cell.border = { top: GRID, left: GRID, bottom: GRID, right: GRID };
          cell.font = Object.assign({}, cell.font || {}, { name: 'Tahoma', size: 10 });
          cell.alignment = { vertical: 'middle', horizontal: textCols.includes(c) ? 'left' : 'center', indent: textCols.includes(c) ? 1 : 0 }; } });
      ws.views = [{ state: 'frozen', ySplit: 2 }];
      ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: cols } };
      ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '2:2' };
    };
    const band = (ws, r, b, cols) => { const row = ws.getRow(r);
      for (let c = 1; c <= cols; c++) row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c === 1 ? BAND[b] : TINT[b] } };
      row.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; };
    let doors = 0;
    views.forEach(({ label, view }) => {
      const fRows = [], fMeta = [];
      view.buildings.forEach(b => b.floors.forEach(f => {
        fRows.push([b.name, f.label, f.total, f.checked, f.bad, FST[f.state]]); fMeta.push([b.name, f.state]); }));
      fRows.push(['รวม', '', view.total, view.checked, view.bad, '']);
      const ws = sheet('สรุปรายชั้น ' + label, ['อาคาร', 'ชั้น', 'ประตูตามทะเบียน', 'ตรวจแล้ว', 'ผิดปกติ', 'สถานะ'], fRows, [18, 10, 16, 12, 10, 16]);
      finish(ws, 6, 'สรุปตรวจประตู ACC รายชั้น · ' + label, [1, 2, 6]);
      fMeta.forEach(([b, st], i) => { band(ws, 3 + i, b, 6); ws.getRow(3 + i).getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ST[st][1] } }; });
      ws.getRow(3 + fMeta.length).font = { name: 'Tahoma', bold: true, size: 10 };
      const dRows = [], dMeta = [];
      view.buildings.forEach(b => b.floors.forEach(f => f.doors.forEach(d => {
        dRows.push([b.name, f.label, d.code, d.room || '', ST[d.state][0], d.date || '', (d.faults || []).concat(d.notes || []).join(', ')]);
        dMeta.push([b.name, d.state]); })));
      const wd = sheet('รายประตู ' + label, ['อาคาร', 'ชั้น', 'รหัสประตู', 'ห้อง/จุด', 'สถานะ', 'วันที่ตรวจ', 'ผลผิดปกติ / หมายเหตุ'], dRows, [18, 10, 14, 30, 14, 13, 40]);
      finish(wd, 7, 'รายการประตู ACC · ' + label, [1, 2, 3, 4, 7]);
      dMeta.forEach(([b, st], i) => { band(wd, 3 + i, b, 7); wd.getRow(3 + i).getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ST[st][1] } };
        if (st === 'bad') wd.getRow(3 + i).getCell(7).font = { name: 'Tahoma', size: 10, bold: true, color: { argb: 'FFC53030' } }; });
      doors += dRows.length;
    });
    return doors;
  }
  /* Per-topic export filters. Row filters drop whole records; column filters blank the fields that
     weren't picked (a traffic record holds day AND night, car AND motorcycle, so dropping the row would
     lose the other half). Nothing picked in a group = everything.
     ctx: { mod, kind, fieldPrefix, golfCarts, groups: [filter keys], pick(key) -> ids|null, parkingFields } */
  function filterRecords(recs, ctx) {
    const P = ctx.pick, mod = ctx.mod;
    if (!(ctx.groups || []).some(k => P(k))) return recs;
    const blank = (r, keys, v) => { const d = Object.assign({}, r.data); keys.forEach(k => { d[k] = v; }); return Object.assign({}, r, { data: d }); };
    if (ctx.kind === 'traffic') {
      const sh = P('shift') || ['day', 'night'], vh = P('veh') || ['car', 'moto'], drop = [];
      ['car', 'moto'].forEach(v => ['in', 'out'].forEach(dir => ['day', 'night'].forEach(x => {
        if (!sh.includes(x) || !vh.includes(v)) drop.push(ctx.fieldPrefix + '_' + v + '_' + dir + '_' + x); })));
      return recs.map(r => blank(r, drop, 0));
    }
    if (mod === 'golf') {
      const sh = P('shift'), carts = P('cart');
      return recs.filter(r => !sh || sh.includes(/กลางคืน/.test(String((r.data || {}).golf_shift || '')) ? 'night' : 'day'))
        .map(r => carts ? blank(r, ctx.golfCarts.filter(c => !carts.includes(c)), '') : r);
    }
    if (ctx.kind === 'parking') {
      const cols = P('cols');
      return recs.map(r => blank(r, ctx.parkingFields.filter(k => !cols.includes(k)), ''));
    }
    if (mod === 'visitors') {
      const t = P('type');
      return recs.map(r => blank(r, ['visitor_general_count', 'visitor_contractor_count'].filter(k => !t.includes(k)), 0));
    }
    /* every other filter is a field on the record itself: a plain row filter */
    return recs.filter(r => ctx.groups.every(k => { const p = P(k); return !p || p.includes((r.data || {})[k]); }));
  }
  const api = { cctvWorkbook: cctvWorkbook, repairsSheet: repairsSheet, filterRecords: filterRecords, accWorkbook: accWorkbook };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SOCExport = api;
})(typeof window !== 'undefined' ? window : globalThis);
