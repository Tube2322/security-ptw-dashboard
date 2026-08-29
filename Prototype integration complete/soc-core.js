/* ============================================================
   SOC Command Center — CENTRAL DATA LAYER (single source of truth)
   Phase 1–2: architecture + data layer
   window.SOCCore
     • Form registry  : fields per module (stable fieldId, order, active)
     • Records        : reportDate vs submittedAt kept separate
     • Aggregation    : COUNT / SUM / AVERAGE / MIN / MAX / LATEST
     • Date index     : months → dates that actually have records
     • Reactive       : subscribe() fires on every write, cross-tab
   No UI code lives here. No dashboard keeps its own dataset.
   ============================================================ */
(function () {
  var KEY = 'soc.core.v2';
  var EVT = 'soc:core';
  var PORTAL_KEY = 'soc_qr_portal_settings_v1';
  var PORTAL_EVT = 'soc:portal';

  var PALETTE = { traffic: '#4aa3e8', golf: '#3fbf8f', visitors: '#a874e8' };

  var MODULES = [
    { id: 'traffic', code: 'TR', name: 'รถเข้า-ออก', en: 'Traffic', formId: 'form_traffic',
      desc: 'บันทึกจำนวนรถเข้า-ออก แยกกะกลางวัน/กลางคืน', color: PALETTE.traffic },
    { id: 'golf', code: 'GF', name: 'รถกอล์ฟ', en: 'Golf Fleet', formId: 'form_golf',
      desc: 'บันทึกจำนวนรอบรถกอล์ฟรายคัน รองรับสถานะ OFF', color: PALETTE.golf },
    { id: 'visitors', code: 'VS', name: 'ผู้มาเยือน', en: 'Visitors', formId: 'form_visitors',
      desc: 'บันทึกผู้มาเยือนทั่วไปและผู้รับเหมา', color: PALETTE.visitors }
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

  function f(id, label, type, o) {
    o = o || {};
    return {
      fieldId: id, label: label, type: type,
      required: !!o.required, active: true, order: 0,
      options: o.options || [], placeholder: o.placeholder || '',
      helper: o.helper || '', group: o.group || 'ข้อมูลทั่วไป',
      unit: o.unit || '', allowOff: !!o.allowOff, system: !!o.system
    };
  }

  function defaultForms() {
    var forms = {
      traffic: [
        f('traffic_date', 'วันที่', 'date', { required: true, system: true }),
        f('traffic_name', 'ชื่อผู้กรอก', 'select', { required: true, system: true, options: OPERATORS.slice(), placeholder: 'เลือกชื่อ' }),
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
      golf: [
        f('golf_date', 'วันที่', 'date', { required: true, system: true }),
        f('golf_name', 'ชื่อผู้กรอก', 'select', { required: true, system: true, options: OPERATORS.slice(), placeholder: 'เลือกชื่อ' }),
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
        f('visitor_name', 'ชื่อผู้กรอก', 'select', { required: true, system: true, options: OPERATORS.slice(), placeholder: 'เลือกชื่อ' }),
        f('visitor_general_count', 'จำนวน Visitor ทั่วไป', 'number', { required: true, group: 'Visitor ทั่วไป', placeholder: '0', unit: 'คน', system: true }),
        f('visitor_general_note', 'หมายเหตุ Visitor ทั่วไป', 'textarea', { group: 'Visitor ทั่วไป', placeholder: 'เช่น ส่งเอกสาร / ติดต่อสำนักงาน' }),
        f('visitor_contractor_count', 'จำนวน Visitor ผู้รับเหมา', 'number', { required: true, group: 'Visitor ผู้รับเหมา', placeholder: '0', unit: 'คน', system: true }),
        f('visitor_contractor_note', 'หมายเหตุ Visitor ผู้รับเหมา', 'textarea', { group: 'Visitor ผู้รับเหมา', placeholder: 'เช่น งานซ่อมบำรุงระบบไฟฟ้า' }),
        f('visitor_org', 'หน่วยงาน', 'text', { group: 'Visitor ผู้รับเหมา', placeholder: 'ชื่อบริษัท / หน่วยงาน' }),
        f('visitor_department', 'แผนกที่ติดต่อ', 'checkbox', { group: 'Visitor ผู้รับเหมา', options: ['วิศวกรรม', 'ความปลอดภัย', 'ธุรการ', 'จัดซื้อ'], helper: 'เลือกได้มากกว่า 1 แผนก' }),
        f('visitor_inspector', 'ลงชื่อผู้ตรวจสอบ', 'text', { group: 'ผู้ตรวจสอบ', placeholder: 'ชื่อ-นามสกุล', system: true })
      ]
    };
    Object.keys(forms).forEach(function (k) { forms[k].forEach(function (fl, i) { fl.order = i; }); });
    return forms;
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function isoDay(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function nowIso() { var d = new Date(); return isoDay(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }

  var seq = 0;
  function newId(prefix) {
    seq++;
    return prefix + '-' + Date.now().toString(36) + seq.toString(36);
  }

  /* Controlled test data — spec §41–44. Flagged isTest so it can be cleared. */
  function seedRecords() {
    var out = [];
    var mk = function (module, formId, reportDate, submittedAt, by, inspector, data) {
      return { id: newId('seed'), module: module, formId: formId, formVersion: 1,
        reportDate: reportDate, submittedAt: submittedAt, updatedAt: submittedAt,
        submittedBy: by, inspector: inspector, isTest: true, data: data };
    };
    var y = 2026;
    var day = function (d) { return y + '-08-' + pad(d); };

    /* mandated scenario — 13/08/2569 */
    out.push(mk('traffic', 'form_traffic', day(13), day(13) + 'T20:15:00', OPERATORS[0], 'หัวหน้าชุด A', {
      traffic_date: day(13), traffic_name: OPERATORS[0],
      traffic_car_in_day: 100, traffic_moto_in_day: 50, traffic_car_out_day: 80, traffic_moto_out_day: 40,
      traffic_car_in_night: 30, traffic_moto_in_night: 20, traffic_car_out_night: 25, traffic_moto_out_night: 15,
      traffic_inspector: 'หัวหน้าชุด A', traffic_note: ''
    }));
    out.push(mk('golf', 'form_golf', day(13), day(14) + 'T00:15:00', OPERATORS[1], 'หัวหน้าชุด A', {
      golf_date: day(13), golf_name: OPERATORS[1], golf_shift: 'กะกลางวัน',
      golf_cart_1: 10, golf_cart_2: 20, golf_cart_3: 'OFF', golf_cart_4: 15,
      golf_inspector: 'หัวหน้าชุด A', golf_note: 'รถ 3 เข้าซ่อมบำรุง'
    }));
    out.push(mk('visitors', 'form_visitors', day(13), day(13) + 'T18:40:00', OPERATORS[2], 'หัวหน้าชุด A', {
      visitor_date: day(13), visitor_name: OPERATORS[2],
      visitor_general_count: 30, visitor_general_note: 'ติดต่อสำนักงาน / ส่งเอกสาร',
      visitor_contractor_count: 15, visitor_contractor_note: 'งานซ่อมบำรุงระบบไฟฟ้าอาคาร B',
      visitor_org: 'บ. ทีพี เอ็นจิเนียริ่ง', visitor_department: ['วิศวกรรม', 'ความปลอดภัย'],
      visitor_inspector: 'หัวหน้าชุด A'
    }));

    /* neighbouring days for history testing (12, 14) + a spread for trend charts */
    var spread = [
      { d: 12, k: 0.8 }, { d: 14, k: 1.2 }, { d: 15, k: 0.9 }, { d: 18, k: 1.1 },
      { d: 20, k: 0.7 }, { d: 22, k: 1.3 }, { d: 25, k: 1.0 }, { d: 27, k: 0.85 }, { d: 28, k: 1.15 }
    ];
    spread.forEach(function (s, i) {
      var r = function (base) { return Math.round(base * s.k); };
      out.push(mk('traffic', 'form_traffic', day(s.d), day(s.d) + 'T20:0' + (i % 9) + ':00', OPERATORS[i % 4], 'หัวหน้าชุด ' + (i % 2 ? 'B' : 'A'), {
        traffic_date: day(s.d), traffic_name: OPERATORS[i % 4],
        traffic_car_in_day: r(92), traffic_moto_in_day: r(58), traffic_car_out_day: r(85), traffic_moto_out_day: r(54),
        traffic_car_in_night: r(28), traffic_moto_in_night: r(19), traffic_car_out_night: r(26), traffic_moto_out_night: r(17),
        traffic_inspector: 'หัวหน้าชุด ' + (i % 2 ? 'B' : 'A'), traffic_note: ''
      }));
      out.push(mk('golf', 'form_golf', day(s.d), day(s.d) + 'T19:1' + (i % 9) + ':00', OPERATORS[(i + 1) % 4], 'หัวหน้าชุด A', {
        golf_date: day(s.d), golf_name: OPERATORS[(i + 1) % 4], golf_shift: i % 3 === 0 ? 'กะกลางคืน' : 'กะกลางวัน',
        golf_cart_1: r(12), golf_cart_2: r(16), golf_cart_3: i % 4 === 0 ? 'OFF' : r(9), golf_cart_4: r(14),
        golf_inspector: 'หัวหน้าชุด A', golf_note: ''
      }));
      out.push(mk('visitors', 'form_visitors', day(s.d), day(s.d) + 'T17:2' + (i % 9) + ':00', OPERATORS[(i + 2) % 4], 'หัวหน้าชุด B', {
        visitor_date: day(s.d), visitor_name: OPERATORS[(i + 2) % 4],
        visitor_general_count: r(26), visitor_general_note: 'ติดต่อสำนักงาน',
        visitor_contractor_count: r(12), visitor_contractor_note: 'งานปรับปรุงพื้นที่',
        visitor_org: 'ผู้รับเหมาโครงการ', visitor_department: i % 2 ? ['วิศวกรรม'] : ['ธุรการ', 'จัดซื้อ'],
        visitor_inspector: 'หัวหน้าชุด B'
      }));
    });
    return out;
  }

  function fresh() { return { forms: defaultForms(), formVersion: 1, records: seedRecords(), rev: 1 }; }

  /* Re-apply the `system` flag from defaultForms() onto a stored registry.
     The flag marks fields whose fieldId a dashboard formula reads directly, so it is owned by
     the code, not by the saved data — a registry saved before the flag existed (or edited while
     it was missing) must still come back locked, or the builder would happily let someone
     disable a field that every KPI depends on. Labels, order, groups and active stay untouched. */
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

  var cache = null;
  function read() {
    if (cache) return cache;
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (p && p.forms && p.records) { applySystemFlags(p.forms); cache = p; return cache; }
      }
    } catch (e) {}
    cache = fresh();
    persist(cache, true);
    return cache;
  }
  function persist(data, silent) {
    cache = data;
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
    if (!silent) { try { window.dispatchEvent(new CustomEvent(EVT, { detail: { rev: data.rev } })); } catch (e2) {} }
  }
  function commit(data) { data.rev = (data.rev || 0) + 1; persist(data); }

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

  var Core = {
    MODULES: MODULES, TYPES: TYPES, OPERATORS: OPERATORS, COLORS: PALETTE,

    module: function (id) { for (var i = 0; i < MODULES.length; i++) if (MODULES[i].id === id) return MODULES[i]; return null; },

    /* ---------- form registry ---------- */
    fields: function (m) { return (read().forms[m] || []).slice().sort(function (a, b) { return a.order - b.order; }); },
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
    setFields: function (m, list) {
      var d = read();
      d.forms[m] = list.map(function (x, i) { return Object.assign({}, x, { order: i }); });
      applySystemFlags(d.forms);
      d.formVersion = (d.formVersion || 1) + 1;
      commit(d);
    },
    newFieldId: function (m) { return m + '_custom_' + Math.random().toString(36).slice(2, 7); },

    /* ---------- records ---------- */
    allRecords: function () {
      return read().records.slice().sort(function (a, b) {
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
    addRecord: function (module, data, meta) {
      meta = meta || {};
      var d = read();
      var mod = this.module(module) || {};
      var nameField = module === 'traffic' ? 'traffic_name' : (module === 'golf' ? 'golf_name' : 'visitor_name');
      var dateField = module === 'traffic' ? 'traffic_date' : (module === 'golf' ? 'golf_date' : 'visitor_date');
      var insField = module === 'traffic' ? 'traffic_inspector' : (module === 'golf' ? 'golf_inspector' : 'visitor_inspector');
      var rec = {
        id: newId('rec'), module: module, formId: mod.formId, formVersion: d.formVersion || 1,
        reportDate: data[dateField] || isoDay(new Date()),
        submittedAt: nowIso(), updatedAt: nowIso(),
        submittedBy: data[nameField] || meta.submittedBy || '—',
        inspector: data[insField] || '',
        data: Object.assign({}, data)
      };
      d.records.push(rec);
      commit(d);
      return rec;
    },
    /* Editing a record must keep the denormalised header fields (reportDate / submittedBy /
       inspector) in sync with the answers, otherwise a corrected date would still be filed
       under the old day and every date-scoped dashboard, history list and PDF would disagree
       with the record's own answers. id, module and submittedAt are never rewritten. */
    updateRecord: function (id, data) {
      var d = read();
      var self = this;
      d.records = d.records.map(function (r) {
        if (r.id !== id) return r;
        var merged = Object.assign({}, r.data, data);
        var m = r.module;
        var dateField = m === 'traffic' ? 'traffic_date' : (m === 'golf' ? 'golf_date' : 'visitor_date');
        var nameField = m === 'traffic' ? 'traffic_name' : (m === 'golf' ? 'golf_name' : 'visitor_name');
        var insField = m === 'traffic' ? 'traffic_inspector' : (m === 'golf' ? 'golf_inspector' : 'visitor_inspector');
        return Object.assign({}, r, {
          data: merged,
          reportDate: merged[dateField] || r.reportDate,
          submittedBy: merged[nameField] || r.submittedBy,
          inspector: merged[insField] != null ? merged[insField] : r.inspector,
          updatedAt: nowIso()
        });
      });
      commit(d);
    },
    deleteRecord: function (id) {
      var d = read();
      d.records = d.records.filter(function (r) { return r.id !== id; });
      commit(d);
    },
    clearTestData: function () {
      var d = read();
      d.records = d.records.filter(function (r) { return !r.isTest; });
      commit(d);
    },
    resetAll: function () { cache = null; try { localStorage.removeItem(KEY); } catch (e) {} read(); commit(read()); },

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

    subscribe: function (fn) {
      var h = function () { cache = null; fn(); };
      window.addEventListener(EVT, h);
      window.addEventListener('storage', function (e) { if (!e.key || e.key === KEY) { cache = null; fn(); } });
      return function () { window.removeEventListener(EVT, h); };
    },

    /* ---------- QR User Entry Portal settings (separate store — never mixed with records) ---------- */
    portalDefaults: function () {
      return { portalName: 'ระบบบันทึกข้อมูลประจำวัน', welcomeText: 'กรุณาเลือกแบบฟอร์มที่ต้องการบันทึกข้อมูล', slug: 'security-daily', enabled: true, qrVersion: 'v1' };
    },
    newQrVersion: function () { return 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); },
    getPortal: function () {
      try {
        var raw = localStorage.getItem(PORTAL_KEY);
        if (raw) { var p = JSON.parse(raw); if (p && typeof p === 'object') return Object.assign(this.portalDefaults(), p); }
      } catch (e) {}
      return this.portalDefaults();
    },
    setPortal: function (obj) {
      var next = Object.assign(this.getPortal(), obj);
      try { localStorage.setItem(PORTAL_KEY, JSON.stringify(next)); } catch (e) {}
      try { window.dispatchEvent(new CustomEvent(PORTAL_EVT, { detail: next })); } catch (e2) {}
      return next;
    },
    validSlug: function (slug) { return /^[a-zA-Z0-9_-]+$/.test(String(slug || '')); },
    portalUrl: function (slug, qrVersion) {
      var base = window.location.origin + window.location.pathname.replace(/[^/]+$/, 'User%20Entry%20Portal%20v2.dc.html');
      var v = qrVersion || this.getPortal().qrVersion;
      return base + '#/entry/' + (slug || '') + '?qr=' + v;
    },
    subscribePortal: function (fn) {
      var h = function () { fn(); };
      window.addEventListener(PORTAL_EVT, h);
      window.addEventListener('storage', function (e) { if (!e.key || e.key === PORTAL_KEY) fn(); });
      return function () { window.removeEventListener(PORTAL_EVT, h); };
    }
  };

  window.SOCCore = Core;
})();
