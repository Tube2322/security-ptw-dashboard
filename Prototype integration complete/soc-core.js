/* ============================================================
   SOC Command Center — CENTRAL DATA LAYER (single source of truth)
   window.SOCCore
     • Form registry  : fields per module (stable fieldId, order, active)
     • Records        : reportDate vs submittedAt kept separate
     • Aggregation    : COUNT / SUM / AVERAGE / MIN / MAX / LATEST
     • Date index     : months → dates that actually have records
     • Reactive       : subscribe() fires on every write, cross-tab AND cross-device
     • Auth           : email/password session for the Admin Console only
   No UI code lives here. No dashboard keeps its own dataset.

   Backed by Supabase (see soc-config.js for the client). Every read method below (fields(),
   query(), allRecords(), ...) stays fully SYNCHRONOUS over an in-memory `state` object — nothing
   in either .dc.html file had to change to a Promise-based call. `state` starts empty and is
   populated by the initial fetch below; once it resolves, subscribe() fires exactly like it did
   for a localStorage write, so already-mounted components just re-render with real data.
   Row Level Security, not this file, is what actually keeps the data safe — see the
   `init_soc_schema` migration for the policies. This file only shapes rows into/out of the JS
   objects the dashboards expect.
   ============================================================ */
(function () {
  var sb = window.supabaseClient;
  var EVT = 'soc:core';
  var PORTAL_EVT = 'soc:portal';
  var AUTH_EVT = 'soc:auth';

  var PALETTE = { traffic: '#4aa3e8', golf: '#3fbf8f', visitors: '#a874e8', elevator: '#e0763f' };

  var MODULES = [
    { id: 'traffic', code: 'TR', name: 'รถเข้า-ออก', en: 'Traffic', formId: 'form_traffic',
      desc: 'บันทึกจำนวนรถเข้า-ออก แยกกะกลางวัน/กลางคืน', color: PALETTE.traffic,
      kind: 'traffic', fieldPrefix: 'traffic', dateField: 'traffic_date', nameField: 'traffic_name', inspectorField: 'traffic_inspector' },
    { id: 'traffic_tt', code: 'TT', name: 'รถเข้า-ออก ทะเลทอง', en: 'Traffic – Talay Thong', formId: 'form_traffic_tt',
      desc: 'บันทึกจำนวนรถเข้า-ออก พื้นที่ทะเลทอง แยกกะกลางวัน/กลางคืน', color: PALETTE.traffic,
      kind: 'traffic', fieldPrefix: 'tt', dateField: 'tt_date', nameField: 'tt_name', inspectorField: 'tt_inspector' },
    { id: 'golf', code: 'GF', name: 'รถกอล์ฟ', en: 'Golf Fleet', formId: 'form_golf',
      desc: 'บันทึกจำนวนรอบรถกอล์ฟรายคัน รองรับสถานะ OFF', color: PALETTE.golf,
      kind: 'golf', fieldPrefix: 'golf', dateField: 'golf_date', nameField: 'golf_name', inspectorField: 'golf_inspector' },
    { id: 'visitors', code: 'VS', name: 'ผู้มาเยือน', en: 'Visitors', formId: 'form_visitors',
      desc: 'บันทึกผู้มาเยือนทั่วไปและผู้รับเหมา', color: PALETTE.visitors,
      kind: 'visitors', fieldPrefix: 'visitor', dateField: 'visitor_date', nameField: 'visitor_name', inspectorField: 'visitor_inspector' },
    { id: 'elevator', code: 'EL', name: 'รายงานปุ่มฉุกเฉินลิฟท์', en: 'Elevator Emergency Button', formId: 'form_elevator',
      desc: 'บันทึกรายงานเมื่อมีการกดปุ่มฉุกเฉินในลิฟท์', color: PALETTE.elevator,
      kind: 'elevator', fieldPrefix: 'elevator', dateField: 'elevator_date', nameField: null, inspectorField: null }
  ];

  var TYPES = [
    { id: 'text', label: 'Short Text' },
    { id: 'textarea', label: 'Long Text' },
    { id: 'number', label: 'Number' },
    { id: 'select', label: 'Dropdown' },
    { id: 'radio', label: 'Multiple Choice' },
    { id: 'checkbox', label: 'Checkbox' },
    { id: 'date', label: 'Date' },
    { id: 'time', label: 'Time' }
  ];

  var OPERATORS = ['สมชาย ปานทอง', 'วิชัย สุขใจ', 'ณัฐพล กิตติ', 'อนันต์ ทองดี'];

  function emptyForms() { var o = {}; MODULES.forEach(function (m) { o[m.id] = []; }); return o; }
  function emptyCounts() { var o = {}; MODULES.forEach(function (m) { o[m.id] = 0; }); return o; }

  function f(id, label, type, o) {
    o = o || {};
    return {
      fieldId: id, label: label, type: type,
      required: !!o.required, active: true, order: 0,
      options: o.options || [], placeholder: o.placeholder || '',
      helper: o.helper || '', group: o.group || 'ข้อมูลทั่วไป',
      unit: o.unit || '', allowOff: !!o.allowOff, allowCustom: !!o.allowCustom, system: !!o.system
    };
  }

  /* The code's own definition of every field, and which ones a dashboard formula reads by
     fieldId (`system: true`). Used to (a) seed the database once, and (b) re-lock the `system`
     flag on whatever the database returns — see applySystemFlags(). */
  function defaultForms() {
    var forms = {
      traffic: [
        f('traffic_date', 'วันที่', 'date', { required: true, system: true }),
        f('traffic_name', 'ชื่อผู้กรอก', 'select', { required: true, system: true, options: OPERATORS.slice(), placeholder: 'เลือกชื่อ หรือพิมพ์ชื่อเอง', allowCustom: true }),
        f('traffic_car_in_day', 'รถยนต์ขาเข้า 08.00–20.00', 'number', { required: true, group: 'กะกลางวัน 08.00–20.00', placeholder: '0', unit: 'คัน', system: true }),
        f('traffic_moto_in_day', 'มอเตอร์ไซค์ขาเข้า 08.00–20.00', 'number', { required: true, group: 'กะกลางวัน 08.00–20.00', placeholder: '0', unit: 'คัน', system: true }),
        f('traffic_car_out_day', 'รถยนต์ขาออก 08.00–20.00', 'number', { required: true, group: 'กะกลางวัน 08.00–20.00', placeholder: '0', unit: 'คัน', system: true }),
        f('traffic_moto_out_day', 'มอเตอร์ไซค์ขาออก 08.00–20.00', 'number', { required: true, group: 'กะกลางวัน 08.00–20.00', placeholder: '0', unit: 'คัน', system: true }),
        f('traffic_car_in_night', 'รถยนต์ขาเข้า 20.00–08.00', 'number', { required: true, group: 'กะกลางคืน 20.00–08.00', placeholder: '0', unit: 'คัน', system: true }),
        f('traffic_moto_in_night', 'มอเตอร์ไซค์ขาเข้า 20.00–08.00', 'number', { required: true, group: 'กะกลางคืน 20.00–08.00', placeholder: '0', unit: 'คัน', system: true }),
        f('traffic_car_out_night', 'รถยนต์ขาออก 20.00–08.00', 'number', { required: true, group: 'กะกลางคืน 20.00–08.00', placeholder: '0', unit: 'คัน', system: true }),
        f('traffic_moto_out_night', 'มอเตอร์ไซค์ขาออก 20.00–08.00', 'number', { required: true, group: 'กะกลางคืน 20.00–08.00', placeholder: '0', unit: 'คัน', system: true }),
        f('traffic_inspector', 'ลงชื่อผู้ตรวจสอบ', 'text', { group: 'ผู้ตรวจสอบ', placeholder: 'ชื่อ-นามสกุล', system: true }),
        f('traffic_note', 'หมายเหตุ', 'textarea', { group: 'ผู้ตรวจสอบ', placeholder: 'เหตุการณ์ผิดปกติ (ถ้ามี)' })
      ],
      traffic_tt: [
        f('tt_date', 'วันที่', 'date', { required: true, system: true }),
        f('tt_name', 'ชื่อผู้กรอก', 'select', { required: true, system: true, options: OPERATORS.slice(), placeholder: 'เลือกชื่อ หรือพิมพ์ชื่อเอง', allowCustom: true }),
        f('tt_car_in_day', 'ทะเลทอง รถยนต์ขาเข้า 08.00–20.00', 'number', { required: true, group: 'กะกลางวัน 08.00–20.00', placeholder: '0', unit: 'คัน', system: true }),
        f('tt_moto_in_day', 'ทะเลทอง มอเตอร์ไซค์ขาเข้า 08.00–20.00', 'number', { required: true, group: 'กะกลางวัน 08.00–20.00', placeholder: '0', unit: 'คัน', system: true }),
        f('tt_car_out_day', 'ทะเลทอง รถยนต์ขาออก 08.00–20.00', 'number', { required: true, group: 'กะกลางวัน 08.00–20.00', placeholder: '0', unit: 'คัน', system: true }),
        f('tt_moto_out_day', 'ทะเลทอง มอเตอร์ไซค์ขาออก 08.00–20.00', 'number', { required: true, group: 'กะกลางวัน 08.00–20.00', placeholder: '0', unit: 'คัน', system: true }),
        f('tt_car_in_night', 'ทะเลทอง รถยนต์ขาเข้า 20.00–08.00', 'number', { required: true, group: 'กะกลางคืน 20.00–08.00', placeholder: '0', unit: 'คัน', system: true }),
        f('tt_moto_in_night', 'ทะเลทอง มอเตอร์ไซค์ขาเข้า 20.00–08.00', 'number', { required: true, group: 'กะกลางคืน 20.00–08.00', placeholder: '0', unit: 'คัน', system: true }),
        f('tt_car_out_night', 'ทะเลทอง รถยนต์ขาออก 20.00–08.00', 'number', { required: true, group: 'กะกลางคืน 20.00–08.00', placeholder: '0', unit: 'คัน', system: true }),
        f('tt_moto_out_night', 'ทะเลทอง มอเตอร์ไซค์ขาออก 20.00–08.00', 'number', { required: true, group: 'กะกลางคืน 20.00–08.00', placeholder: '0', unit: 'คัน', system: true }),
        f('tt_inspector', 'ลงชื่อผู้ตรวจสอบ', 'text', { group: 'ผู้ตรวจสอบ', placeholder: 'ชื่อ-นามสกุล', required: true, system: true })
      ],
      golf: [
        f('golf_date', 'วันที่', 'date', { required: true, system: true }),
        f('golf_name', 'ชื่อผู้กรอก', 'select', { required: true, system: true, options: OPERATORS.slice(), placeholder: 'เลือกชื่อ หรือพิมพ์ชื่อเอง', allowCustom: true }),
        f('golf_shift', 'กะ', 'radio', { required: true, options: ['กะกลางวัน', 'กะกลางคืน'], system: true }),
        f('golf_cart_1', 'รถกอล์ฟ 1 — จำนวนรอบ', 'number', { required: true, group: 'จำนวนรอบรายคัน', placeholder: '0 หรือ OFF', allowOff: true, unit: 'รอบ', helper: 'กรอก OFF หากรถไม่ได้ให้บริการ', system: true }),
        f('golf_cart_2', 'รถกอล์ฟ 2 — จำนวนรอบ', 'number', { required: true, group: 'จำนวนรอบรายคัน', placeholder: '0 หรือ OFF', allowOff: true, unit: 'รอบ', system: true }),
        f('golf_cart_3', 'รถกอล์ฟ 3 — จำนวนรอบ', 'number', { required: true, group: 'จำนวนรอบรายคัน', placeholder: '0 หรือ OFF', allowOff: true, unit: 'รอบ', system: true }),
        f('golf_cart_4', 'รถกอล์ฟ 4 — จำนวนรอบ', 'number', { required: true, group: 'จำนวนรอบรายคัน', placeholder: '0 หรือ OFF', allowOff: true, unit: 'รอบ', system: true }),
        f('golf_inspector', 'ลงชื่อผู้ตรวจสอบ', 'text', { group: 'ผู้ตรวจสอบ', placeholder: 'ชื่อ-นามสกุล', system: true }),
        f('golf_note', 'หมายเหตุ', 'textarea', { group: 'ผู้ตรวจสอบ', placeholder: 'เช่น รถคันที่ 3 เข้าซ่อม' })
      ],
      visitors: [
        f('visitor_date', 'วันที่', 'date', { required: true, system: true }),
        f('visitor_name', 'ชื่อผู้กรอก', 'select', { required: true, system: true, options: OPERATORS.slice(), placeholder: 'เลือกชื่อ หรือพิมพ์ชื่อเอง', allowCustom: true }),
        f('visitor_general_count', 'จำนวน Visitor ทั่วไป', 'number', { required: true, group: 'Visitor ทั่วไป', placeholder: '0', unit: 'คน', system: true }),
        f('visitor_general_note', 'หมายเหตุ Visitor ทั่วไป', 'textarea', { group: 'Visitor ทั่วไป', placeholder: 'เช่น ส่งเอกสาร / ติดต่อสำนักงาน' }),
        f('visitor_contractor_count', 'จำนวน Visitor ผู้รับเหมา', 'number', { required: true, group: 'Visitor ผู้รับเหมา', placeholder: '0', unit: 'คน', system: true }),
        f('visitor_contractor_note', 'หมายเหตุ Visitor ผู้รับเหมา', 'textarea', { group: 'Visitor ผู้รับเหมา', placeholder: 'เช่น งานซ่อมบำรุงระบบไฟฟ้า' }),
        f('visitor_org', 'หน่วยงาน', 'text', { group: 'Visitor ผู้รับเหมา', placeholder: 'ชื่อบริษัท / หน่วยงาน' }),
        f('visitor_department', 'แผนกที่ติดต่อ', 'checkbox', { group: 'Visitor ผู้รับเหมา', options: ['วิศวกรรม', 'ความปลอดภัย', 'ธุรการ', 'จัดซื้อ'], helper: 'เลือกได้มากกว่า 1 แผนก หรือพิมพ์แผนกอื่นเองด้านล่าง', allowCustom: true }),
        f('visitor_inspector', 'ลงชื่อผู้ตรวจสอบ', 'text', { group: 'ผู้ตรวจสอบ', placeholder: 'ชื่อ-นามสกุล', system: true })
      ],
      elevator: [
        f('elevator_date', 'วันที่', 'date', { required: true, system: true }),
        f('elevator_lift', 'ลิฟท์ตัวที่', 'radio', { required: true, system: true, options: ['PL01 — ลิฟท์ตัวที่ 1', 'PL02 — ลิฟท์ตัวที่ 2', 'PL03 — ลิฟท์ตัวที่ 3', 'PL04 — ลิฟท์ตัวที่ 4', 'CL01 — ลิฟท์ตัวที่ 5', 'CL02 — ลิฟท์ตัวที่ 6', 'SL03 — ลิฟท์ตัวที่ 7', 'SL04 — ลิฟท์ตัวที่ 8'] }),
        f('elevator_remark', 'หมายเหตุ', 'radio', { required: true, system: true, options: ['กดผิด', 'ยืนพิง/มือโดน/อื่นๆ'] }),
        f('elevator_user_type', 'ประเภทผู้ใช้', 'radio', { required: true, system: true, options: ['พนักงาน', 'ลูกค้า', 'อื่นๆ'] })
      ]
    };
    Object.keys(forms).forEach(function (k) { forms[k].forEach(function (fl, i) { fl.order = i; }); });
    return forms;
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function isoDay(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  /* Deliberately NOT UTC — the whole formatting layer below (fmtDate/fmtTime) slices this
     string directly with no timezone math, so it must already be local wall-clock text.
     The database column is a naive `timestamp` for the same reason: see the
     timestamps_as_naive_local migration. */
  function nowIso() { var d = new Date(); return isoDay(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    /* fallback for a non-secure context (plain http, not localhost) where randomUUID is absent */
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /* Re-apply the `system` flag from defaultForms() onto whatever the database returns.
     The flag marks fields whose fieldId a dashboard formula reads directly, so it is owned by
     the code, not by stored data — a registry row saved before the flag existed must still come
     back locked, or the builder would happily let someone disable a field every KPI depends on.
     Labels, order, groups and active stay untouched. */
  function applySystemFlags(forms) {
    var defaults = defaultForms();
    Object.keys(defaults).forEach(function (m) {
      var locked = {};
      defaults[m].forEach(function (d) { if (d.system) locked[d.fieldId] = true; });
      (forms[m] || []).forEach(function (fl) {
        var want = !!locked[fl.fieldId];
        fl.system = want;
        if (want) fl.active = true;
      });
    });
    return forms;
  }

  /* ---------- row <-> JS object shape ---------- */
  function fieldFromRow(r) {
    return {
      fieldId: r.field_id, label: r.label, type: r.type,
      required: !!r.required, active: r.active !== false, order: r.order,
      options: r.options || [], placeholder: r.placeholder || '',
      helper: r.helper || '', group: r.group || 'ข้อมูลทั่วไป',
      unit: r.unit || '', allowOff: !!r.allow_off, allowCustom: !!r.allow_custom, system: !!r.system
    };
  }
  function fieldToRow(module, fl, i) {
    return {
      module: module, field_id: fl.fieldId, label: fl.label, type: fl.type,
      required: !!fl.required, active: fl.active !== false, order: i,
      options: fl.options || [], placeholder: fl.placeholder || '',
      helper: fl.helper || '', group: fl.group || 'ข้อมูลทั่วไป',
      unit: fl.unit || '', allow_off: !!fl.allowOff, allow_custom: !!fl.allowCustom, system: !!fl.system
    };
  }
  function recordFromRow(r) {
    return {
      id: r.id, module: r.module, formId: r.form_id, formVersion: r.form_version,
      reportDate: r.report_date, submittedAt: r.submitted_at, updatedAt: r.updated_at,
      submittedBy: r.submitted_by, inspector: r.inspector, isTest: !!r.is_test,
      data: r.data || {}
    };
  }
  function recordToRow(rec) {
    return {
      id: rec.id, module: rec.module, form_id: rec.formId, form_version: rec.formVersion,
      report_date: rec.reportDate, submitted_at: rec.submittedAt, updated_at: rec.updatedAt,
      submitted_by: rec.submittedBy, inspector: rec.inspector, is_test: !!rec.isTest,
      data: rec.data || {}
    };
  }
  function portalFromRow(r) {
    return { portalName: r.portal_name, welcomeText: r.welcome_text, slug: r.slug, enabled: !!r.enabled, qrVersion: r.qr_version, hiddenModules: r.hidden_modules || [] };
  }
  function portalToRow(p) {
    return { id: true, portal_name: p.portalName, welcome_text: p.welcomeText, slug: p.slug, enabled: !!p.enabled, qr_version: p.qrVersion, hidden_modules: p.hiddenModules || [] };
  }

  /* ---------- in-memory state — every read method below is synchronous over this ---------- */
  var state = {
    forms: emptyForms(),
    formVersion: 1,
    records: [],
    counts: emptyCounts(), /* from record_count() RPC — see recordCount() */
    rev: 0
  };
  var portalState = null; /* null until the first successful fetch; getPortal() falls back to defaults until then */

  function bump() {
    state.rev++;
    try { window.dispatchEvent(new CustomEvent(EVT, { detail: { rev: state.rev } })); } catch (e) {}
  }
  function bumpPortal() {
    try { window.dispatchEvent(new CustomEvent(PORTAL_EVT, { detail: portalState })); } catch (e) {}
  }

  var errorHandlers = [];
  /* A background write (see addRecord/updateRecord/... below) already applied itself to the
     local cache and returned before the network call resolves, so a failure can't be reported
     through a normal return value or thrown exception — the caller has moved on. This is the
     only channel that failure reaches the UI through; both .dc.html files subscribe to it and
     show it as a toast. */
  function notifyError(msg) { errorHandlers.forEach(function (fn) { try { fn(msg); } catch (e) {} }); }

  /* numeric parse — OFF / blank / text are NOT zero, they are "no value" */
  function num(v) {
    if (v === 0) return 0;
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).trim();
    if (/^off$/i.test(s)) return null;
    var n = parseFloat(s.replace(/,/g, ''));
    return isNaN(n) ? null : n;
  }
  function isOff(v) { return /^off$/i.test(String(v == null ? '' : v).trim()); }

  /* ---------- initial load + realtime ---------- */
  function loadFormFields() {
    return sb.from('form_fields').select('*').then(function (res) {
      if (res.error) { notifyError('โหลดแบบฟอร์มไม่สำเร็จ: ' + res.error.message); return; }
      var forms = emptyForms();
      (res.data || []).forEach(function (r) { (forms[r.module] = forms[r.module] || []).push(fieldFromRow(r)); });
      Object.keys(forms).forEach(function (m) { forms[m].sort(function (a, b) { return a.order - b.order; }); });
      applySystemFlags(forms);
      state.forms = forms;
      bump();
    });
  }
  function loadRecords() {
    return sb.from('records').select('*').then(function (res) {
      if (res.error) { notifyError('โหลดข้อมูลไม่สำเร็จ: ' + res.error.message); return; }
      state.records = (res.data || []).map(recordFromRow);
      bump();
    });
  }
  function loadCounts() {
    return Promise.all(MODULES.map(function (m) {
      return sb.rpc('record_count', { p_module: m.id }).then(function (res) {
        state.counts[m.id] = res.error ? 0 : Number(res.data || 0);
      });
    })).then(bump);
  }
  function loadPortal() {
    return sb.from('portal_settings').select('*').eq('id', true).maybeSingle().then(function (res) {
      if (res.error) { notifyError('โหลดการตั้งค่า Portal ไม่สำเร็จ: ' + res.error.message); return; }
      portalState = res.data ? portalFromRow(res.data) : null;
      bumpPortal();
    });
  }

  var ready = Promise.all([loadFormFields(), loadRecords(), loadCounts(), loadPortal()]);

  /* Wholesale refetch on any change, rather than patching the local cache from the realtime
     payload — simpler to get right, and this app's data volume (a daily security log for one
     site) is small enough that re-fetching a table is cheap. */
  try {
    sb.channel('soc-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'records' }, function () { loadRecords(); loadCounts(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'form_fields' }, function () { loadFormFields(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'portal_settings' }, function () { loadPortal(); })
      .subscribe();
  } catch (e) { /* realtime is a live-sync nicety, not a hard requirement — degrade to no cross-tab push */ }

  /* ---------- auth (Admin Console only — the entry portal never calls this) ---------- */
  var authState = { session: null, initialized: false };
  function setSession(session) {
    authState.session = session || null;
    authState.initialized = true;
    try { window.dispatchEvent(new CustomEvent(AUTH_EVT)); } catch (e) {}
  }
  sb.auth.getSession().then(function (res) { setSession(res.data && res.data.session); });
  sb.auth.onAuthStateChange(function (_event, session) { setSession(session); });

  var Core = {
    MODULES: MODULES, TYPES: TYPES, OPERATORS: OPERATORS, COLORS: PALETTE,

    module: function (id) { for (var i = 0; i < MODULES.length; i++) if (MODULES[i].id === id) return MODULES[i]; return null; },

    /* ---------- form registry ---------- */
    fields: function (m) { return (state.forms[m] || []).slice().sort(function (a, b) { return a.order - b.order; }); },
    activeFields: function (m) { return this.fields(m).filter(function (x) { return x.active !== false; }); },
    field: function (m, id) { var l = this.fields(m); for (var i = 0; i < l.length; i++) if (l[i].fieldId === id) return l[i]; return null; },
    numericFields: function (m) { return this.fields(m).filter(function (x) { return x.type === 'number'; }); },
    groups: function (m) {
      var out = [], idx = {};
      this.activeFields(m).forEach(function (fl) {
        var g = fl.group || 'ข้อมูล';
        if (idx[g] == null) { idx[g] = out.length; out.push({ title: g, fields: [] }); }
        out[idx[g]].fields.push(fl);
      });
      return out;
    },
    /* Replaces the whole field list for one module. Applies to the local cache immediately
       (so Form Builder shows the saved state right away) and persists as delete-all-then-insert
       for that module in the background — this table is small and admin-only, so the brief
       window without row-level atomicity is an accepted tradeoff, not a real risk. */
    setFields: function (m, list) {
      var next = list.map(function (x, i) { return Object.assign({}, x, { order: i }); });
      applySystemFlags((function () { var o = {}; o[m] = next; return o; })());
      var prev = state.forms[m];
      state.forms[m] = next;
      state.formVersion = (state.formVersion || 1) + 1;
      bump();
      var rows = next.map(function (fl, i) { return fieldToRow(m, fl, i); });
      sb.from('form_fields').delete().eq('module', m)
        .then(function () { return sb.from('form_fields').insert(rows); })
        .then(function (res) {
          if (res.error) { state.forms[m] = prev; bump(); notifyError('บันทึกแบบฟอร์มไม่สำเร็จ: ' + res.error.message); }
        });
    },
    newFieldId: function (m) { return m + '_custom_' + Math.random().toString(36).slice(2, 7); },

    /* ---------- records ---------- */
    allRecords: function () {
      return state.records.slice().sort(function (a, b) {
        if (a.reportDate === b.reportDate) return a.submittedAt < b.submittedAt ? 1 : -1;
        return a.reportDate < b.reportDate ? 1 : -1;
      });
    },
    /* q: {module, date, year, month, from, to} — every dashboard filters through here */
    query: function (q) {
      q = q || {};
      return this.allRecords().filter(function (r) {
        if (q.module && r.module !== q.module) return false;
        if (q.date && r.reportDate !== q.date) return false;
        if (!q.date && q.year != null && q.month != null) {
          var pre = q.year + '-' + pad(q.month + 1);
          if (String(r.reportDate).slice(0, 7) !== pre) return false;
        }
        if (q.from && r.reportDate < q.from) return false;
        if (q.to && r.reportDate > q.to) return false;
        return true;
      });
    },
    /* Synchronous count independent of allRecords()/query() — those read `state.records`, which
       Row Level Security leaves empty for an unauthenticated guest (only INSERT is public on
       `records`). The entry portal's module tiles ("บันทึกแล้ว N รายการ") read this instead,
       backed by the record_count() RPC, which returns only a number, never row contents. */
    recordCount: function (module) { return state.counts[module] || 0; },
    addRecord: function (module, data, meta) {
      meta = meta || {};
      var mod = this.module(module) || {};
      var nameField = mod.nameField;
      var dateField = mod.dateField;
      var insField = mod.inspectorField;
      var rec = {
        id: uuid(), module: module, formId: mod.formId, formVersion: state.formVersion || 1,
        reportDate: data[dateField] || isoDay(new Date()),
        submittedAt: nowIso(), updatedAt: nowIso(),
        submittedBy: data[nameField] || meta.submittedBy || '—',
        inspector: data[insField] || '',
        isTest: false,
        data: Object.assign({}, data)
      };
      state.records.push(rec);
      state.counts[module] = (state.counts[module] || 0) + 1;
      bump();
      sb.from('records').insert(recordToRow(rec)).then(function (res) {
        if (res.error) {
          state.records = state.records.filter(function (r) { return r.id !== rec.id; });
          state.counts[module] = Math.max(0, (state.counts[module] || 0) - 1);
          bump();
          notifyError('บันทึกข้อมูลไม่สำเร็จ: ' + res.error.message);
        }
      });
      return rec;
    },
    /* Editing a record must keep the denormalised header fields (reportDate / submittedBy /
       inspector) in sync with the answers, otherwise a corrected date would still be filed
       under the old day and every date-scoped dashboard, history list and PDF would disagree
       with the record's own answers. id, module and submittedAt are never rewritten. */
    updateRecord: function (id, data) {
      var self = this;
      var prev = null, next = null;
      state.records = state.records.map(function (r) {
        if (r.id !== id) return r;
        prev = r;
        var merged = Object.assign({}, r.data, data);
        var mod = self.module(r.module) || {};
        var dateField = mod.dateField;
        var nameField = mod.nameField;
        var insField = mod.inspectorField;
        next = Object.assign({}, r, {
          data: merged,
          reportDate: merged[dateField] || r.reportDate,
          submittedBy: merged[nameField] || r.submittedBy,
          inspector: merged[insField] != null ? merged[insField] : r.inspector,
          updatedAt: nowIso()
        });
        return next;
      });
      if (!next) return;
      bump();
      sb.from('records').update(recordToRow(next)).eq('id', id).then(function (res) {
        if (res.error) {
          state.records = state.records.map(function (r) { return r.id === id ? prev : r; });
          bump();
          notifyError('บันทึกการแก้ไขไม่สำเร็จ: ' + res.error.message);
        }
      });
    },
    deleteRecord: function (id) {
      var removed = state.records.filter(function (r) { return r.id === id; })[0];
      if (!removed) return;
      state.records = state.records.filter(function (r) { return r.id !== id; });
      state.counts[removed.module] = Math.max(0, (state.counts[removed.module] || 0) - 1);
      bump();
      sb.from('records').delete().eq('id', id).then(function (res) {
        if (res.error) {
          state.records.push(removed);
          state.counts[removed.module] = (state.counts[removed.module] || 0) + 1;
          bump();
          notifyError('ลบรายการไม่สำเร็จ: ' + res.error.message);
        }
      });
    },
    /* Kept for API compatibility with the Settings page. Every record created through this
       backend has isTest = false — the localStorage version's auto-generated demo rows have no
       equivalent here, so in practice this filters nothing. */
    clearTestData: function () {
      var removed = state.records.filter(function (r) { return r.isTest; });
      if (!removed.length) return;
      state.records = state.records.filter(function (r) { return !r.isTest; });
      bump();
      sb.from('records').delete().eq('is_test', true).then(function (res) {
        if (res.error) { notifyError('ลบข้อมูลตัวอย่างไม่สำเร็จ: ' + res.error.message); loadRecords(); }
      });
    },
    /* Factory reset: deletes every record and puts the form registry back to the code's own
       defaults. Unlike the old localStorage version this does NOT reseed fake demo rows —
       there is no meaningful "demo data" concept once other people's real submissions live in
       a shared database. */
    resetAll: function () {
      state.records = [];
      state.counts = emptyCounts();
      state.forms = defaultForms();
      state.formVersion = 1;
      bump();
      Promise.all([
        sb.from('records').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
        sb.from('form_fields').delete().neq('module', '')
      ]).then(function (results) {
        var failed = results.filter(function (r) { return r.error; });
        if (failed.length) { notifyError('รีเซ็ตระบบไม่สำเร็จบางส่วน: ' + failed[0].error.message); loadFormFields(); loadRecords(); return; }
        var rows = [];
        Object.keys(state.forms).forEach(function (m) {
          state.forms[m].forEach(function (fl, i) { rows.push(fieldToRow(m, fl, i)); });
        });
        return sb.from('form_fields').insert(rows);
      }).then(function (res) {
        if (res && res.error) notifyError('รีเซ็ตระบบไม่สำเร็จบางส่วน: ' + res.error.message);
      });
    },

    /* ---------- aggregation ---------- */
    num: num, isOff: isOff,
    values: function (records, fieldId) {
      var out = [];
      records.forEach(function (r) { var v = num((r.data || {})[fieldId]); if (v != null) out.push(v); });
      return out;
    },
    agg: function (records, fieldId, op) {
      var vals = this.values(records, fieldId);
      switch (op) {
        case 'COUNT': return records.length;
        case 'COUNT_VALUES': return vals.length;
        case 'AVERAGE': return vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : 0;
        case 'MIN': return vals.length ? Math.min.apply(null, vals) : 0;
        case 'MAX': return vals.length ? Math.max.apply(null, vals) : 0;
        case 'LATEST': return vals.length ? vals[0] : 0;
        default: return vals.reduce(function (a, b) { return a + b; }, 0);
      }
    },
    sumFields: function (records, ids) {
      var self = this;
      return ids.reduce(function (a, id) { return a + self.agg(records, id, 'SUM'); }, 0);
    },
    offCount: function (records, ids) {
      var n = 0;
      records.forEach(function (r) { ids.forEach(function (id) { if (isOff((r.data || {})[id])) n++; }); });
      return n;
    },

    /* ---------- date index ---------- */
    monthsIndex: function (module, count) {
      count = count || 12;
      var recs = this.query({ module: module });
      var now = new Date();
      var out = [];
      for (var i = 0; i < count; i++) {
        var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        var pre = d.getFullYear() + '-' + pad(d.getMonth() + 1);
        var set = {};
        recs.forEach(function (r) { if (String(r.reportDate).slice(0, 7) === pre) set[r.reportDate] = (set[r.reportDate] || 0) + 1; });
        var dates = Object.keys(set).sort();
        out.push({ year: d.getFullYear(), month: d.getMonth(), prefix: pre, dates: dates, count: dates.length,
          records: dates.reduce(function (a, k) { return a + set[k]; }, 0) });
      }
      return out;
    },

    /* ---------- formatting ---------- */
    pad: pad, isoDay: isoDay,
    thaiMonths: ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'],
    thaiMonthsShort: ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'],
    fmtDate: function (isoStr) {
      if (!isoStr) return '—';
      var p = String(isoStr).slice(0, 10).split('-');
      return parseInt(p[2], 10) + ' ' + this.thaiMonthsShort[parseInt(p[1], 10) - 1] + ' ' + (parseInt(p[0], 10) + 543);
    },
    fmtDateShort: function (isoStr) {
      var p = String(isoStr).slice(0, 10).split('-');
      return p[2] + '/' + p[1] + '/' + (parseInt(p[0], 10) + 543);
    },
    fmtTime: function (isoStr) { return String(isoStr).slice(11, 16) || '—'; },
    fmtNum: function (n) { return (Math.round(n * 100) / 100).toLocaleString('en-US'); },
    fmtValue: function (v) {
      if (v == null || v === '') return '—';
      if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
      return String(v);
    },

    /* fires once at load-completion time (all four initial fetches settled) and again on every
       realtime change from any other tab, device or admin */
    subscribe: function (fn) {
      window.addEventListener(EVT, fn);
      return function () { window.removeEventListener(EVT, fn); };
    },
    /* surfaces failures from the background half of addRecord/updateRecord/deleteRecord/
       setFields/resetAll/clearTestData — both .dc.html files show this as a toast */
    onError: function (fn) {
      errorHandlers.push(fn);
      return function () { errorHandlers = errorHandlers.filter(function (h) { return h !== fn; }); };
    },
    ready: ready,

    /* ---------- QR User Entry Portal settings (separate table — never mixed with records) ---------- */
    portalDefaults: function () {
      return { portalName: 'ระบบบันทึกข้อมูลประจำวัน', welcomeText: 'กรุณาเลือกแบบฟอร์มที่ต้องการบันทึกข้อมูล', slug: 'security-daily', enabled: true, qrVersion: 'v1', hiddenModules: [] };
    },
    newQrVersion: function () { return 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); },
    getPortal: function () { return portalState ? Object.assign(this.portalDefaults(), portalState) : this.portalDefaults(); },
    setPortal: function (obj) {
      var prev = portalState;
      var next = Object.assign(this.getPortal(), obj);
      portalState = next;
      bumpPortal();
      var isFirstWrite = !prev;
      var write = isFirstWrite
        ? sb.from('portal_settings').insert(portalToRow(next))
        : sb.from('portal_settings').update(portalToRow(next)).eq('id', true);
      write.then(function (res) {
        if (res.error) { portalState = prev; bumpPortal(); notifyError('บันทึกการตั้งค่า Portal ไม่สำเร็จ: ' + res.error.message); }
      });
      return next;
    },
    validSlug: function (slug) { return /^[a-zA-Z0-9_-]+$/.test(String(slug || '')); },
    portalUrl: function (slug, qrVersion) {
      var base = window.location.origin + window.location.pathname.replace(/[^/]+$/, 'User%20Entry%20Portal%20v2.dc.html');
      var v = qrVersion || this.getPortal().qrVersion;
      return base + '#/entry/' + (slug || '') + '?qr=' + v;
    },
    subscribePortal: function (fn) {
      window.addEventListener(PORTAL_EVT, fn);
      return function () { window.removeEventListener(PORTAL_EVT, fn); };
    },

    /* ---------- auth (Admin Console gate) ---------- */
    auth: {
      ready: function () { return authState.initialized; },
      session: function () { return authState.session; },
      user: function () { return authState.session ? authState.session.user : null; },
      signIn: function (email, password) { return sb.auth.signInWithPassword({ email: email, password: password }); },
      signOut: function () { return sb.auth.signOut(); },
      subscribe: function (fn) {
        window.addEventListener(AUTH_EVT, fn);
        return function () { window.removeEventListener(AUTH_EVT, fn); };
      }
    }
  };

  window.SOCCore = Core;
})();
