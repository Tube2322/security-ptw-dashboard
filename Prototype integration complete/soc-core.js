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
  var PROFILE_EVT = 'soc:profile';

  var PALETTE = { traffic: '#4aa3e8', golf: '#3fbf8f', visitors: '#a874e8', elevator: '#e0763f', checkpoint: '#2fa89a', monthly: '#c2739c' };

  /* A group is a *folder* of modules, not a module itself — it owns no fields and no records.
     Its only job is that both the Admin nav and the Entry Portal require one tap into the
     group before its member modules become reachable, so five monthly-inspection forms don't
     sit at the same level as the daily operational ones. Modules opt in with `group: <id>`;
     everything without a `group` stays top-level exactly as before. */
  var GROUPS = [
    { id: 'monthly', code: 'MI', name: 'ตรวจประจำเดือน', en: 'Monthly Inspection',
      desc: 'สรุปผลการตรวจประจำเดือน 5 หัวข้อ', color: PALETTE.monthly }
  ];

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
      kind: 'elevator', fieldPrefix: 'elevator', dateField: 'elevator_date', nameField: null, inspectorField: null },
    { id: 'checkpoint', code: 'CP', name: 'รายงานการตรวจจุด', en: 'Checkpoint Inspection', formId: 'form_checkpoint',
      desc: 'บันทึกการลงตรวจจุดตรวจการณ์ประจำกะ', color: PALETTE.checkpoint,
      kind: 'checkpoint', fieldPrefix: 'checkpoint', dateField: 'checkpoint_date', nameField: 'checkpoint_employee_name', inspectorField: 'checkpoint_inspector_name' },

    /* ---- ตรวจประจำเดือน (group: monthly) ----
       One record = one month's summary for that category, so these stay sparse (~12/year
       each). They all share kind:'monthly', which routes them to the *generic* dashboard
       builder that derives its KPIs and charts from the live field list — these five are the
       only modules whose questions the admin is expected to reshape freely, so nothing here
       may depend on a specific fieldId the way the daily modules do. */
    { id: 'monthly_inspection_golf_cart', code: 'M1', name: 'รถกอล์ฟ', en: 'Monthly – Golf Cart', formId: 'form_monthly_golf_cart',
      desc: 'สรุปผลตรวจสภาพรถกอล์ฟประจำเดือน', color: PALETTE.monthly, group: 'monthly',
      kind: 'monthly', fieldPrefix: 'mi_golf', dateField: 'mi_golf_date', nameField: 'mi_golf_name', inspectorField: 'mi_golf_name' },
    { id: 'monthly_inspection_acc_door', code: 'M2', name: 'ประตู ACC', en: 'Monthly – ACC Door', formId: 'form_monthly_acc_door',
      desc: 'เช็คความพร้อมใช้ประตู ACC', color: PALETTE.monthly, group: 'monthly',
      kind: 'monthly', fieldPrefix: 'mi_acc', dateField: 'mi_acc_date', nameField: 'mi_acc_checker_name', inspectorField: 'mi_acc_inspector_name' },
    { id: 'monthly_inspection_cctv', code: 'M3', name: 'กล้องวงจรปิด', en: 'Monthly – CCTV', formId: 'form_monthly_cctv',
      desc: 'เช็คความพร้อมใช้งานกล้อง CCTV', color: PALETTE.monthly, group: 'monthly',
      /* the real form has no name/inspector question at all — same as elevator, which already
         shows "—" for ผู้กรอก with no ill effect */
      kind: 'monthly', fieldPrefix: 'mi_cctv', dateField: 'mi_cctv_date', nameField: null, inspectorField: null },
    { id: 'monthly_inspection_fire_extinguisher', code: 'M4', name: 'ถังดับเพลิง', en: 'Monthly – Fire Extinguisher', formId: 'form_monthly_fire_extinguisher',
      desc: 'แบบฟอร์มสำรวจถังดับเพลิง', color: PALETTE.monthly, group: 'monthly',
      kind: 'monthly', fieldPrefix: 'mi_fire_ext', dateField: 'mi_fire_ext_date', nameField: 'mi_fire_ext_checker_name', inspectorField: 'mi_fire_ext_inspector_name' },
    { id: 'monthly_inspection_fire_exit', code: 'M5', name: 'ประตูหนีไฟ', en: 'Monthly – Fire Exit', formId: 'form_monthly_fire_exit',
      desc: 'ตรวจเช็คความพร้อมประตูหนีไฟ', color: PALETTE.monthly, group: 'monthly',
      kind: 'monthly', fieldPrefix: 'mi_fire_exit', dateField: 'mi_fire_exit_date', nameField: 'mi_fire_exit_checker_name', inspectorField: 'mi_fire_exit_inspector_name' }
  ];

  /* The code's own name for each module, kept aside so a custom label (see loadModuleLabels /
     setModuleName below) can be reset back to it — MODULES[i].name itself gets overwritten in
     place with whatever the admin saved, since every screen reads the name straight off the
     shared MODULES array or via module(id) rather than through a separate lookup. */
  var DEFAULT_MODULE_NAMES = {};
  MODULES.forEach(function (m) { DEFAULT_MODULE_NAMES[m.id] = m.name; });

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

  /* Golf-cart is the only monthly-inspection category still on the generic total/pass/fail
     template — the other four have their real question sets typed out in defaultForms()
     below, taken directly from the site's actual paper/Google-Forms checklists. Replace this
     entry the same way once that form's real questions are available. */
  var MONTHLY_FORM_SPECS = [
    { module: 'monthly_inspection_golf_cart', prefix: 'mi_golf', unit: 'คัน',
      totalLabel: 'จำนวนรถกอล์ฟที่ตรวจทั้งหมด', passLabel: 'ใช้งานได้ปกติ', failLabel: 'ต้องซ่อม / ไม่พร้อมใช้งาน' }
  ];

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
        f('elevator_remark', 'หมายเหตุ', 'radio', { required: true, system: true, options: ['กดผิด', 'ยืนพิง', 'อื่นๆ'], allowCustom: true }),
        f('elevator_user_type', 'ประเภทผู้ใช้', 'radio', { required: true, system: true, options: ['พนักงาน', 'ลูกค้า', 'ผู้รับเหมา'] })
      ],
      checkpoint: [
        f('checkpoint_employee_name', 'ชื่อ', 'text', { required: true, system: true, group: 'ข้อมูลผู้บันทึก', placeholder: 'ใส่ชื่อ' }),
        f('checkpoint_date', 'วันที่', 'date', { required: true, system: true, group: 'ข้อมูลผู้บันทึก' }),
        f('checkpoint_shift', 'กะกลางวัน/กะกลางคืน', 'radio', { required: true, system: true, group: 'ข้อมูลผู้บันทึก', options: ['กะกลางวัน 08.00-20.00', 'กะกลางคืน 20.00-08.00'] }),
        f('checkpoint_point', 'จุดที่ตรวจ', 'radio', { required: true, system: true, group: 'จุดที่ตรวจ', options: ['จุดที่1', 'จุดที่2', 'จุดที่3', 'จุดที่4'] }),
        f('checkpoint_time', 'เวลาที่ลงตรวจ', 'time', { group: 'จุดที่ตรวจ', placeholder: 'ตัวอย่าง 09:30' }),
        f('checkpoint_inspector_name', 'ชื่อผู้ตรวจสอบ', 'text', { group: 'จุดที่ตรวจ', placeholder: 'ใส่ชื่อผู้ตรวจสอบ' }),
        f('checkpoint_remark', 'หมายเหตุ', 'textarea', { group: 'จุดที่ตรวจ', placeholder: 'เหตุการณ์ผิดปกติ (ถ้ามี)' })
      ],

      /* ---- ตรวจประจำเดือน — the four categories with a real question set (as typed out by
         the site). Every non-date/name field is left unlocked (`system` omitted, defaults to
         false), same as every other module's optional/count-type questions — the admin can add,
         reword or delete any of these, and buildDynamic() picks the change up automatically. */
      monthly_inspection_cctv: [
        f('mi_cctv_date', 'วันที่', 'date', { required: true, system: true, group: 'ข้อมูลการตรวจ' }),
        f('mi_cctv_time', 'เวลา', 'time', { required: true, group: 'ข้อมูลการตรวจ' }),
        f('mi_cctv_nvr_name', 'NVR - ชื่อกล้อง', 'text', { required: true, group: 'ข้อมูลการตรวจ', placeholder: 'ชื่อกล้องตาม NVR' }),
        f('mi_cctv_location', 'ชั้น/ตำแหน่งกล้อง', 'text', { required: true, group: 'ข้อมูลการตรวจ', placeholder: 'เช่น ชั้น 3 โถงลิฟท์' }),
        f('mi_cctv_dust', 'มีฝุ่นเกาะหรือไม่', 'radio', { required: true, group: 'สภาพกล้อง', options: ['มี', 'ไม่มี'] }),
        f('mi_cctv_crack', 'มีรอยแตกหรือไม่', 'radio', { required: true, group: 'สภาพกล้อง', options: ['มี', 'ไม่มี'] }),
        f('mi_cctv_dirty', 'สิ่งสกปรกเลอะที่ตัวกล้องและเลนส์กล้อง', 'radio', { required: true, group: 'สภาพกล้อง', options: ['มี', 'ไม่มี'] }),
        f('mi_cctv_status', 'กล้องใช้งานได้ปกติหรือไม่', 'radio', { required: true, group: 'สภาพกล้อง', options: ['ปกติ', 'ไม่สามารถใช้งานได้'] }),
        f('mi_cctv_note', 'หากพบสิ่งผิดปกติ ระบุข้อและเขียนหมายเหตุ', 'textarea', { group: 'สภาพกล้อง', placeholder: 'ระบุข้อที่พบ และรายละเอียด' })
      ],
      monthly_inspection_fire_extinguisher: [
        f('mi_fire_ext_date', 'วัน/เดือน/ปี', 'date', { required: true, system: true, group: 'ข้อมูลการตรวจ' }),
        f('mi_fire_ext_floor', 'ชั้นที่', 'radio', { required: true, group: 'ข้อมูลการตรวจ',
          options: ['ชั้น G', 'ชั้นที่ 1', 'ชั้นที่ 2', 'ชั้นที่ 3', 'ชั้นที่ 4', 'ชั้นที่ 5', 'ชั้นที่ 6', 'ชั้นที่ 7', 'ชั้นที่ 8', 'ชั้นที่ 9', 'ชั้นที่ 10', 'ชั้นที่ 11', 'ชั้นที่ 12 ดาดฟ้า', 'ตึกบริการ ชั้น 1', 'ตึกบริการ ชั้น 2', 'ตึกบริการ ชั้น 3', 'ตึกบริการ ชั้น 4', 'ลานจอด'],
          allowCustom: true }),
        f('mi_fire_ext_tank_no', 'ชั้น/ถังที่', 'text', { required: true, group: 'ข้อมูลการตรวจ', placeholder: 'ตัวอย่าง 7-1' }),
        f('mi_fire_ext_type', 'ชนิดของถัง', 'radio', { required: true, group: 'สภาพถัง', options: ['ABFFC', 'CO2'], allowCustom: true }),
        f('mi_fire_ext_size', 'ขนาด (ปอนด์)', 'radio', { required: true, group: 'สภาพถัง', options: ['10'], allowCustom: true }),
        f('mi_fire_ext_condition', 'สภาพถัง', 'radio', { required: true, group: 'สภาพถัง', options: ['ถังบุบ', 'มีรอยขีดข่วน', 'ปกติ'], allowCustom: true }),
        f('mi_fire_ext_gauge', 'เกจวัด', 'radio', { required: true, group: 'สภาพถัง', options: ['อยู่ในเกจวัด (สีเขียว)', 'ไม่อยู่ในเกจวัด (สีแดง)'], allowCustom: true }),
        f('mi_fire_ext_pin', 'สลัก', 'radio', { required: true, group: 'สภาพถัง', options: ['มี', 'ไม่มี', 'หลุด'], allowCustom: true }),
        f('mi_fire_ext_weight', 'น้ำหนัก', 'radio', { required: true, group: 'สภาพถัง', options: ['ปกติ', 'เบา', 'หนัก'], allowCustom: true }),
        f('mi_fire_ext_hose', 'สายฉีด', 'radio', { required: true, group: 'สภาพถัง', options: ['แตก', 'แข็ง', 'อ่อน', 'ปกติ'], allowCustom: true }),
        f('mi_fire_ext_obstruction', 'สิ่งกีดขวาง', 'radio', { required: true, group: 'สภาพถัง', options: ['มี', 'ไม่มี'], allowCustom: true }),
        f('mi_fire_ext_label', 'ป้าย', 'radio', { required: true, group: 'สภาพถัง', options: ['ปกติ', 'ฉีก/ขาด', 'หลุด'], allowCustom: true }),
        f('mi_fire_ext_checker_name', 'ลงชื่อผู้เช็คถัง', 'text', { required: true, system: true, group: 'ผู้ตรวจสอบ' }),
        f('mi_fire_ext_inspector_name', 'ลงชื่อผู้ตรวจสอบ', 'text', { required: true, group: 'ผู้ตรวจสอบ' }),
        f('mi_fire_ext_note', 'หมายเหตุ', 'textarea', { group: 'ผู้ตรวจสอบ' })
      ],
      monthly_inspection_acc_door: [
        f('mi_acc_date', 'วันที่', 'date', { required: true, system: true, group: 'ข้อมูลการตรวจ' }),
        f('mi_acc_time', 'เวลา', 'time', { required: true, group: 'ข้อมูลการตรวจ' }),
        f('mi_acc_reader_status', 'เครื่องอ่านบัตรและป้อนรหัส (Card Reader & Keypad) ใช้งานได้ปกติหรือไม่', 'radio', { required: true, group: 'ข้อมูลการตรวจ', options: ['ปกติ', 'ผิดปกติ'], allowCustom: true }),
        f('mi_acc_floor', 'ชั้น', 'radio', { required: true, group: 'ข้อมูลการตรวจ',
          options: ['G', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12 ดาดฟ้า', 'ตึกบริการ 1', 'ตึกบริการ 2', 'ตึกบริการ 3', 'ตึกบริการ 4', 'ดาดฟ้า ตึกบริการ'],
          allowCustom: true }),
        f('mi_acc_electric_lock', 'กลอนไฟฟ้าอยู่ในสภาพสมบูรณ์ปกติหรือไม่', 'radio', { required: true, group: 'สภาพประตู', options: ['ปกติ', 'ไม่ปกติ'], allowCustom: true }),
        f('mi_acc_magnet', 'แผ่นแม่เหล็กทำงานปกติหรือไม่', 'radio', { required: true, group: 'สภาพประตู', options: ['ปกติ', 'ไม่ปกติ'], allowCustom: true }),
        f('mi_acc_alarm_light', 'มีไฟแจ้งเตือนล็อคหรือไม่', 'radio', { required: true, group: 'สภาพประตู', options: ['มีไฟแจ้งเตือน', 'ไม่มีไฟแจ้งเตือน'], allowCustom: true }),
        f('mi_acc_lock_status', 'ประตูล็อคปกติหรือไม่', 'radio', { required: true, group: 'สภาพประตู', options: ['ล็อคปกติ', 'ประตูไม่ล็อค'], allowCustom: true }),
        f('mi_acc_sensor_box', 'กล่องเซ็นเซอร์สามารถใช้ได้ปกติหรือไม่', 'radio', { required: true, group: 'สภาพประตู', options: ['ใช้ได้ปกติ', 'ใช้ไม่ได้'], allowCustom: true }),
        f('mi_acc_emergency_release', 'กล่อง EMERGENCY DOOR RELEASE อยู่ในสภาพปกติหรือไม่', 'radio', { required: true, group: 'สภาพประตู', options: ['ปกติ', 'ไม่ปกติ'], allowCustom: true }),
        f('mi_acc_note', 'หมายเหตุ', 'textarea', { group: 'สภาพประตู' }),
        f('mi_acc_checker_name', 'ชื่อผู้เช็คประตู ACC', 'text', { required: true, system: true, group: 'ผู้ตรวจสอบ' }),
        f('mi_acc_inspector_name', 'ผู้ตรวจสอบ หัวหน้าแผนกรักษาความปลอดภัย', 'text', { required: true, group: 'ผู้ตรวจสอบ' })
      ],
      monthly_inspection_fire_exit: [
        f('mi_fire_exit_date', 'ว/ด/ป', 'date', { required: true, system: true, group: 'ข้อมูลการตรวจ' }),
        f('mi_fire_exit_time', 'เวลา', 'time', { required: true, group: 'ข้อมูลการตรวจ' }),
        f('mi_fire_exit_door', 'ประตูที่', 'radio', { required: true, group: 'ข้อมูลการตรวจ',
          options: ['ST 1 (ประตูกลาง)', 'ST 2 (ประตูด้านหน้า)', 'ST 4 (ประตูตรงตู้เต่าบิน)', 'ST 5 (หลังห้อง CCTV)', 'ST 6 (ห้องคลังพัสดุ)'], allowCustom: true }),
        f('mi_fire_exit_floor', 'ชั้นที่', 'text', { required: true, group: 'ข้อมูลการตรวจ' }),
        f('mi_fire_exit_obstruction', 'แนวประตูฉุกเฉินมีสิ่งกีดขวางทางหรือไม่', 'radio', { required: true, group: 'สภาพประตู', options: ['มี', 'ไม่มี'] }),
        f('mi_fire_exit_push_open', 'เมื่อเปิดประตูออก ผลักออกจากด้านในได้หรือไม่', 'radio', { required: true, group: 'สภาพประตู', options: ['ได้', 'ไม่ได้'] }),
        f('mi_fire_exit_alarm', 'เมื่อเปิดประตูฉุกเฉิน มีเสียงแจ้งเตือนหรือไม่', 'radio', { required: true, group: 'สภาพประตู', options: ['มี', 'ไม่มี'] }),
        f('mi_fire_exit_lock_outside', 'เมื่อเปิดประตูเข้าจากด้านนอกประตูล็อคหรือไม่', 'radio', { required: true, group: 'สภาพประตู', options: ['ล็อค', 'ไม่ล็อค'] }),
        f('mi_fire_exit_sign', 'ป้ายสัญลักษณ์มีหรือไม่', 'radio', { required: true, group: 'สภาพประตู', options: ['มี', 'ไม่มี'] }),
        f('mi_fire_exit_damaged', 'ประตูชำรุดหรือไม่', 'radio', { required: true, group: 'สภาพประตู', options: ['ชำรุด', 'ไม่ชำรุด'] }),
        f('mi_fire_exit_checker_name', 'ลงชื่อผู้ตรวจเช็ค', 'text', { required: true, system: true, group: 'ผู้ตรวจสอบ' }),
        f('mi_fire_exit_inspector_name', 'ผู้ตรวจสอบ หัวหน้าหน่วยรักษาความปลอดภัย', 'text', { required: true, group: 'ผู้ตรวจสอบ' }),
        f('mi_fire_exit_note', 'หมายเหตุ', 'textarea', { group: 'ผู้ตรวจสอบ' })
      ]
    };
    /* The five monthly-inspection forms share one shape — เดือนที่ตรวจ / ผู้ตรวจ, then a
       total-pass-fail trio, then a note — with only the count wording differing per category.
       Only the date and name fields are `system` (locked): the dashboard for these modules is
       generated from whatever fields exist at render time, so the admin is free to delete or
       replace every count question without breaking anything. */
    MONTHLY_FORM_SPECS.forEach(function (spec) {
      var p = spec.prefix;
      var fields = [
        f(p + '_date', 'เดือนที่ตรวจ', 'date', { required: true, system: true, group: 'ข้อมูลการตรวจ', helper: 'เลือกวันใดก็ได้ในเดือนที่ตรวจ' }),
        f(p + '_name', 'ชื่อผู้ตรวจ', 'select', { required: true, system: true, group: 'ข้อมูลการตรวจ', options: OPERATORS.slice(), placeholder: 'เลือกชื่อ หรือพิมพ์ชื่อเอง', allowCustom: true }),
        f(p + '_total', spec.totalLabel, 'number', { required: true, group: 'ผลการตรวจ', placeholder: '0', unit: spec.unit }),
        f(p + '_pass', spec.passLabel, 'number', { required: true, group: 'ผลการตรวจ', placeholder: '0', unit: spec.unit }),
        f(p + '_fail', spec.failLabel, 'number', { group: 'ผลการตรวจ', placeholder: '0', unit: spec.unit })
      ];
      if (spec.extra) fields = fields.concat(spec.extra(p));
      fields.push(f(p + '_note', 'หมายเหตุ', 'textarea', { group: 'ผลการตรวจ', placeholder: 'สิ่งที่พบ / รายการที่ต้องแก้ไข (ถ้ามี)' }));
      forms[spec.module] = fields;
    });
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
    records: [], /* only the calendar months ensureRange()/ensureAll() have actually pulled in — see below */
    dateIndex: {}, /* dateIndex[module][reportDate] = count — cheap, always full-history, powers monthsIndex() */
    loadedMonths: {}, /* 'YYYY-MM' -> true, once that month's full rows are in state.records */
    allLoaded: false, /* true once ensureAll() has pulled every record at least once this session */
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
  /* Tier 0 — every module's {reportDate: count}, with no `data` jsonb column, across all of
     history. Cheap enough (a few hundred KB/year at this app's real volume) to always load in
     full, and is the only thing monthsIndex()/pickLatestDate() actually need — they never
     require the full row payload just to know which days have data. */
  function loadDateIndex() {
    return sb.from('records').select('module, report_date').then(function (res) {
      if (res.error) { notifyError('โหลดปฏิทินข้อมูลไม่สำเร็จ: ' + res.error.message); return; }
      var idx = {};
      MODULES.forEach(function (m) { idx[m.id] = {}; });
      (res.data || []).forEach(function (r) {
        var byModule = idx[r.module] || (idx[r.module] = {});
        byModule[r.report_date] = (byModule[r.report_date] || 0) + 1;
      });
      state.dateIndex = idx;
      bump();
    });
  }
  function monthBounds(year, month) {
    return { start: year + '-' + pad(month + 1) + '-01', end: isoDay(new Date(year, month + 1, 0)) };
  }
  function monthKeysBetween(from, to) {
    var out = [];
    var d = new Date(from + 'T00:00:00'), end = new Date(to + 'T00:00:00');
    while (d <= end) {
      out.push(d.getFullYear() + '-' + pad(d.getMonth() + 1));
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
    return out;
  }
  function fetchMonth(key) {
    var parts = key.split('-');
    var b = monthBounds(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1);
    return sb.from('records').select('*').gte('report_date', b.start).lte('report_date', b.end).then(function (res) {
      if (res.error) { notifyError('โหลดข้อมูลไม่สำเร็จ: ' + res.error.message); return; }
      var byId = {};
      state.records.forEach(function (r) { byId[r.id] = r; });
      (res.data || []).map(recordFromRow).forEach(function (r) { byId[r.id] = r; });
      state.records = Object.keys(byId).map(function (id) { return byId[id]; });
      state.loadedMonths[key] = true;
    });
  }
  /* Tier 1 — pulls in full row detail (the `data` jsonb) for only the calendar months a date
     or date range touches, and only the months not already cached this session. A no-op
     (resolves immediately, no network call) once everything asked for is already loaded, so
     it's safe for scopeRecords()/monthRecords()/pdfRecords() to call this on every render. */
  function ensureRange(from, to) {
    if (state.allLoaded) return Promise.resolve();
    var keys = monthKeysBetween(from, to || from).filter(function (k) { return !state.loadedMonths[k]; });
    if (!keys.length) return Promise.resolve();
    return Promise.all(keys.map(fetchMonth)).then(bump);
  }
  /* Tier 2 — the Records page's "ทั้งหมด" browser and the PDF "ข้อมูลทั้งหมด" period both want
     genuine full history with no date bound. Real volume here is small (a few MB/year), so a
     single deliberate full fetch is fine — it just must not be the thing that runs on every
     page load and every realtime tick, which is what made this expensive before. */
  function ensureAll() {
    if (state.allLoaded) return Promise.resolve();
    return sb.from('records').select('*').then(function (res) {
      if (res.error) { notifyError('โหลดข้อมูลไม่สำเร็จ: ' + res.error.message); return; }
      state.records = (res.data || []).map(recordFromRow);
      state.allLoaded = true;
      bump();
    });
  }
  /* Re-pulls only what's actually cached right now — the Tier-0 index (cheap), every month
     Tier-1 already loaded, and the Tier-2 full set if that was ever loaded — instead of the
     whole table, so realtime sync cost scales with what's on screen, not with total history. */
  function refreshLoaded() {
    var work = [loadDateIndex()];
    Object.keys(state.loadedMonths).forEach(function (k) { work.push(fetchMonth(k)); });
    if (state.allLoaded) { state.allLoaded = false; work.push(ensureAll()); }
    return Promise.all(work).then(bump);
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
  /* Admin-renamed module titles — overwrites MODULES[i].name in place (see
     DEFAULT_MODULE_NAMES above) so every screen that reads a module's name, whether via
     module(id) or by iterating MODULES directly, picks up the rename with no other change. */
  function loadModuleLabels() {
    return sb.from('module_labels').select('*').then(function (res) {
      if (res.error) { notifyError('โหลดชื่อฟอร์มไม่สำเร็จ: ' + res.error.message); return; }
      MODULES.forEach(function (m) { m.name = DEFAULT_MODULE_NAMES[m.id]; });
      (res.data || []).forEach(function (r) {
        var m = null;
        for (var i = 0; i < MODULES.length; i++) if (MODULES[i].id === r.module) { m = MODULES[i]; break; }
        if (m) m.name = r.label;
      });
      bump();
    });
  }

  var ready = Promise.all([loadFormFields(), loadDateIndex(), loadCounts(), loadPortal(), loadModuleLabels()]);

  /* Refetches only what's actually cached (see refreshLoaded above), rather than the whole
     table — a change anywhere shouldn't cost every open Admin tab a full-table download,
     only a re-pull of whatever month(s) that tab is actually looking at. */
  try {
    sb.channel('soc-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'records' }, function () { refreshLoaded(); loadCounts(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'form_fields' }, function () { loadFormFields(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'portal_settings' }, function () { loadPortal(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'module_labels' }, function () { loadModuleLabels(); })
      .subscribe();
  } catch (e) { /* realtime is a live-sync nicety, not a hard requirement — degrade to no cross-tab push */ }

  /* ---------- auth (Admin Console only — the entry portal never calls this) ---------- */
  var authState = { session: null, initialized: false };
  /* role is deny-by-default: `loaded: false` until the profiles-table lookup below actually
     resolves, so a UI that only shows admin controls when role()==='admin' never flashes them
     for a viewer (or for an admin) before we actually know — see role() further down. */
  var profileState = { role: null, loaded: false };
  function bumpProfile() { try { window.dispatchEvent(new CustomEvent(PROFILE_EVT)); } catch (e) {} }
  /* Every login re-derives role from the profiles table — it is never trusted from anything
     the client itself set (unlike theme, which is a pure self-preference in user_metadata).
     A missing row (first login right after email-confirmation, since profiles only gets a row
     via self-signup's own insert or this fallback) is healed here as a `viewer` insert — RLS
     only allows a user to insert their own row as `viewer`, so this can't be used to self-grant
     admin. */
  function loadProfile() {
    var user = authState.session && authState.session.user;
    if (!user) { profileState = { role: null, loaded: true }; bumpProfile(); return Promise.resolve(); }
    return sb.from('profiles').select('role').eq('user_id', user.id).maybeSingle().then(function (res) {
      if (res.error) { profileState = { role: null, loaded: true }; bumpProfile(); return; }
      if (!res.data) {
        return sb.from('profiles').insert({ user_id: user.id, email: user.email, role: 'viewer' }).then(function () {
          profileState = { role: 'viewer', loaded: true };
          bumpProfile();
        });
      }
      profileState = { role: res.data.role, loaded: true };
      bumpProfile();
    });
  }
  function setSession(session) {
    authState.session = session || null;
    authState.initialized = true;
    try { window.dispatchEvent(new CustomEvent(AUTH_EVT)); } catch (e) {}
    profileState = { role: null, loaded: false };
    loadProfile();
  }
  sb.auth.getSession().then(function (res) { setSession(res.data && res.data.session); });
  sb.auth.onAuthStateChange(function (_event, session) { setSession(session); });

  var Core = {
    MODULES: MODULES, TYPES: TYPES, OPERATORS: OPERATORS, COLORS: PALETTE,

    module: function (id) { for (var i = 0; i < MODULES.length; i++) if (MODULES[i].id === id) return MODULES[i]; return null; },
    defaultModuleName: function (id) { return DEFAULT_MODULE_NAMES[id] || id; },

    /* ---------- module groups ----------
       A group is a folder, never a data owner: it has no fields and no records of its own.
       topLevelModules() is what every "list the modules" surface should iterate — the Admin
       nav, the Entry Portal tiles, the Form Builder tabs — so a grouped module only ever
       appears after the user has opened its group. Surfaces that are flat lists of *data*
       rather than navigation (the Records filter, the PDF module picker) keep iterating the
       full MODULES array, because there filtering by a specific form is the whole point. */
    GROUPS: GROUPS,
    group: function (id) { for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i].id === id) return GROUPS[i]; return null; },
    groupModules: function (groupId) { return MODULES.filter(function (m) { return m.group === groupId; }); },
    topLevelModules: function () { return MODULES.filter(function (m) { return !m.group; }); },
    /* Renames a module's display title. Applies to the shared MODULES entry immediately (every
       nav label, page title and dashboard heading reads m.name straight off that array) and
       persists in the background — an empty/unchanged name just deletes the override row so the
       module falls back to its default name. */
    setModuleName: function (id, name) {
      var m = this.module(id);
      if (!m) return;
      var trimmed = String(name == null ? '' : name).trim();
      var next = trimmed || DEFAULT_MODULE_NAMES[id];
      var prev = m.name;
      if (next === prev) return;
      m.name = next;
      bump();
      var req = (trimmed && trimmed !== DEFAULT_MODULE_NAMES[id])
        ? sb.from('module_labels').upsert({ module: id, label: trimmed, updated_at: nowIso() })
        : sb.from('module_labels').delete().eq('module', id);
      req.then(function (res) {
        if (res.error) { m.name = prev; bump(); notifyError('บันทึกชื่อฟอร์มไม่สำเร็จ: ' + res.error.message); }
      });
    },

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
    /* Makes sure the given date (or date range)'s full rows are in state.records before a
       caller relies on query()/allRecords() for them — a no-op once already cached. Every
       dashboard/PDF read goes through this first; see scopeRecords()/monthRecords()/
       prevMonthRecs()/pdfRecords() in the Admin Console. */
    ensureRange: function (from, to) { return ensureRange(from, to); },
    /* Full, unbounded history — only for the Records page's "ทั้งหมด" browser and the PDF
       "ข้อมูลทั้งหมด" period, which genuinely need it; everything else stays date-scoped. */
    ensureAll: function () { return ensureAll(); },
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
        if (res.error) { notifyError('ลบข้อมูลตัวอย่างไม่สำเร็จ: ' + res.error.message); refreshLoaded(); }
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
        if (failed.length) { notifyError('รีเซ็ตระบบไม่สำเร็จบางส่วน: ' + failed[0].error.message); loadFormFields(); refreshLoaded(); return; }
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
    /* Reads state.dateIndex (Tier 0 — module/reportDate/count only, no jsonb, always fully
       loaded) rather than full rows, so asking "which of the last 12 months have data" never
       needs the heavy per-month row cache to already be populated. */
    /* `module` may be one id or an array of ids — an array merges their date indexes, which is
       what a group landing page needs so its month sidebar reflects all its members at once. */
    monthsIndex: function (module, count) {
      count = count || 12;
      var ids = Array.isArray(module) ? module : [module];
      var byDate = {};
      ids.forEach(function (id) {
        var src = state.dateIndex[id] || {};
        Object.keys(src).forEach(function (rd) { byDate[rd] = (byDate[rd] || 0) + src[rd]; });
      });
      var now = new Date();
      var out = [];
      for (var i = 0; i < count; i++) {
        var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        var pre = d.getFullYear() + '-' + pad(d.getMonth() + 1);
        var set = {};
        Object.keys(byDate).forEach(function (rd) { if (rd.slice(0, 7) === pre) set[rd] = byDate[rd]; });
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
      signUp: function (email, password) { return sb.auth.signUp({ email: email, password: password }); },
      signOut: function () { return sb.auth.signOut(); },
      changePassword: function (newPassword) { return sb.auth.updateUser({ password: newPassword }); },
      /* role is the real access-control boundary (enforced by RLS via is_admin() on every
         write), not just a UI flag — role() returns null until the profiles-table lookup has
         actually resolved so admin-only controls default to hidden, never default to shown. */
      roleReady: function () { return profileState.loaded; },
      role: function () { return profileState.role; },
      isAdmin: function () { return profileState.role === 'admin'; },
      subscribeProfile: function (fn) {
        window.addEventListener(PROFILE_EVT, fn);
        return function () { window.removeEventListener(PROFILE_EVT, fn); };
      },
      /* admin-only in practice (RLS: profiles_select lets a non-admin see only their own row,
         so this naturally returns just one row for a viewer and everyone for an admin) */
      listProfiles: function () {
        return sb.from('profiles').select('*').order('created_at', { ascending: true }).then(function (res) {
          return res.error ? [] : (res.data || []);
        });
      },
      setUserRole: function (userId, role) {
        return sb.from('profiles').update({ role: role }).eq('user_id', userId);
      },
      /* theme is a per-account UI preference, stored in Supabase Auth's own user_metadata rather
         than a new table — ownership is enforced by the auth API itself (a client can only ever
         update its own current session's user), so no new schema or RLS policy is needed. */
      themePreference: function () {
        var u = authState.session && authState.session.user;
        return (u && u.user_metadata && u.user_metadata.theme_preference) || null;
      },
      setThemePreference: function (value) { return sb.auth.updateUser({ data: { theme_preference: value } }); },
      subscribe: function (fn) {
        window.addEventListener(AUTH_EVT, fn);
        return function () { window.removeEventListener(AUTH_EVT, fn); };
      }
    }
  };

  window.SOCCore = Core;
})();
