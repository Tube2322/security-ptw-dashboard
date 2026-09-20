/* KPI definitions and calculations, taken one to one from the department's KPI_Template sheet
   (PTW-FM-02-QMD-008 REV00): 12 indicators, each entered as a monthly numerator (ตัวตั้ง) and, where the
   sheet uses one, a denominator (ตัวหาร). Kept apart from the page so the arithmetic can be tested on its own
   and cannot drift from what the sheet does.

   How the sheet computes each row (column O..Z = Jan..Dec, AA = YTD):
     availability  KPI 1   = 1 - A/B                 (O6  =1-(O4/O5),   AA6 =1-(AA4/AA5))
     ratio         KPI 2,7 = A/B                     (O9  =(O7/O8),     AA9 =(AA7/AA8))
     count         others  = A ("A / 1 = จำนวน")     (O12 =O10,         AA12=AA10 = SUM of the months)
   Total KPI = how many indicators reached their target, out of 12, and that as a percentage (rows 52-54). The
   sheet leaves "achieved" to be counted by hand; here it is worked out from each indicator's target column (M).

   Reading of the target column (M) — the sheet mixes a bare number and text, so each is spelled out below:
     "1"               -> rate must reach 100 %
     "0 ครั้ง/ปี"       -> at most 0 in the whole year (any incident fails that month and every month after it)
     "0 ครั้ง/เดือน"     -> at most 0 in the month
     "≥95%"            -> rate at least 95 %
     "≤ 2 ครั้ง/เดือน"   -> at most 2 in the month;  "2 ครั้ง/เดือน" (KPI 11) is read the same way
   A rate with nothing to divide by (0 events out of 0) is "ไม่มีเหตุการณ์" and counts as achieved. */
(function (root) {
  var MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

  /* per: 'rate' (a percentage), 'month' (a count judged month by month), 'year' (a count judged on the year so far) */
  var DEFS = [
    { no: 1, name: 'อัตราความไม่พร้อมใช้ของกล้อง CCTV', kind: 'availability', unit: 'จำนวน', numLabel: 'จำนวนกล้องที่ไม่พร้อมใช้', denLabel: 'จำนวนกล้อง CCTV ทั้งหมด', formula: '(1 − ตัวตั้ง ÷ ตัวหาร) × 100', targetText: '1 (100%)', target: { op: '>=', value: 100, per: 'rate' } },
    { no: 2, name: 'อัตราการปฏิบัติตามมาตรฐานการเข้าถึงข้อมูล CCTV เช่น การขอดูกล้อง', kind: 'ratio', unit: 'จำนวน', numLabel: 'จำนวนครั้งที่ไม่มีการปฏิบัติตามมาตรฐานการเข้าถึงข้อมูล CCTV', denLabel: 'จำนวนครั้งที่มีการขอดูกล้อง CCTV ทั้งหมด', formula: 'ตัวตั้ง ÷ ตัวหาร × 100', targetText: '1 (100%)', target: { op: '>=', value: 100, per: 'rate' } },
    { no: 3, name: 'จำนวนครั้งการเกิดการโจรกรรม ลักขโมย / ทำลายทรัพย์สินในพื้นที่โรงพยาบาล', kind: 'count', unit: 'ครั้ง', numLabel: 'จำนวนครั้งการเกิดการโจรกรรม ลักขโมย / ทำลายทรัพย์สินในพื้นที่โรงพยาบาล', formula: 'ตัวตั้ง', targetText: '0 ครั้ง/ปี', target: { op: '<=', value: 0, per: 'year' } },
    { no: 4, name: 'จำนวนครั้งที่เกิดการลักพาตัวทารกหรือเด็กในโรงพยาบาล', kind: 'count', unit: 'ครั้ง', numLabel: 'จำนวนครั้งที่เกิดการลักพาตัวทารกหรือเด็กในโรงพยาบาล', formula: 'ตัวตั้ง', targetText: '0 ครั้ง/ปี', target: { op: '<=', value: 0, per: 'year' } },
    { no: 5, name: 'จำนวนครั้งการเกิดเหตุคุกคาม/ความรุนแรงในพื้นที่โรงพยาบาล', kind: 'count', unit: 'ครั้ง', numLabel: 'จำนวนครั้งการเกิดเหตุคุกคาม/ความรุนแรงในพื้นที่โรงพยาบาล', formula: 'ตัวตั้ง', targetText: '0 ครั้ง/เดือน', target: { op: '<=', value: 0, per: 'month' } },
    { no: 6, name: 'จำนวนครั้งที่เกิดเหตุการณ์เข้าถึงพื้นที่ควบคุมของโรงพยาบาลของบุคคลที่ไม่ได้รับอนุญาต', kind: 'count', unit: 'ครั้ง', numLabel: 'จำนวนครั้งที่เกิดเหตุการณ์เข้าถึงพื้นที่ควบคุมของบุคคลที่ไม่ได้รับอนุญาต', formula: 'ตัวตั้ง', targetText: '0 ครั้ง/เดือน', target: { op: '<=', value: 0, per: 'month' } },
    { no: 7, name: 'อัตราการตอบสนองเหตุฉุกเฉิน (Incident Response Time) เมื่อได้รับแจ้งเหตุหรือ Code ต่างๆ ภายใน 3 นาที', kind: 'ratio', unit: 'จำนวน', numLabel: 'จำนวนครั้งที่เข้าถึงจุดเกิดเหตุภายใน 3 นาที', denLabel: 'จำนวนครั้งในการได้รับแจ้งเหตุฉุกเฉินทั้งหมด', formula: 'ตัวตั้ง ÷ ตัวหาร × 100', targetText: '≥ 95%', target: { op: '>=', value: 95, per: 'rate' } },
    { no: 8, name: 'จำนวนครั้งที่มีข้อร้องเรียนเรื่องพฤติกรรมบริการของเจ้าหน้าที่ รปภ.', kind: 'count', unit: 'ครั้ง', numLabel: 'จำนวนครั้งที่มีข้อร้องเรียนเรื่องพฤติกรรมบริการของเจ้าหน้าที่ รปภ.', formula: 'ตัวตั้ง', targetText: '≤ 2 ครั้ง/เดือน', target: { op: '<=', value: 2, per: 'month' } },
    { no: 9, name: 'จำนวนครั้งที่เกิดอุบัติเหตุในลานจอดรถหรือพื้นที่ของโรงพยาบาล', kind: 'count', unit: 'ครั้ง', numLabel: 'จำนวนครั้งที่เกิดอุบัติเหตุในลานจอดรถหรือพื้นที่ของโรงพยาบาล', formula: 'ตัวตั้ง', targetText: '≤ 2 ครั้ง/เดือน', target: { op: '<=', value: 2, per: 'month' } },
    { no: 10, name: 'จำนวนครั้งการเกิดข้อมูล CCTV หลุด จากเจ้าหน้าที่ CCTV ขัดต่อข้อกฎหมาย PDPA', kind: 'count', unit: 'จำนวน', numLabel: 'จำนวนครั้งที่ข้อมูลถูกเผยแพร่จากเจ้าหน้าที่ CCTV', formula: 'ตัวตั้ง', targetText: '0 ครั้ง/เดือน', target: { op: '<=', value: 0, per: 'month' } },
    { no: 11, name: 'จำนวนครั้งที่มีข้อร้องเรียนเรื่องพฤติกรรมบริการของแผนกหน่วยงานรักษาความปลอดภัย', kind: 'count', unit: 'ครั้ง', numLabel: 'จำนวนครั้งที่มีข้อร้องเรียนเรื่องพฤติกรรมบริการของแผนกหน่วยงานรักษาความปลอดภัย', formula: 'ตัวตั้ง', targetText: '2 ครั้ง/เดือน', target: { op: '<=', value: 2, per: 'month' } },
    { no: 12, name: 'จำนวนครั้งที่รถกอล์ฟไฟฟ้าชำรุดจนไม่สามารถใช้งานได้', kind: 'count', unit: 'ครั้ง', numLabel: 'จำนวนครั้งที่รถกอล์ฟไม่สามารถให้บริการได้', formula: 'ตัวตั้ง', targetText: '≤ 2 ครั้ง/เดือน', target: { op: '<=', value: 2, per: 'month' } }
  ];
  var TOTAL = DEFS.length; /* the sheet's "Total : จำนวน KPI ทั้งหมด" = 12 */

  function num(v) {
    if (v === 0) return 0;
    if (v == null || v === '') return null;
    var n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
    return isFinite(n) ? n : null;
  }
  function meets(def, value) {
    var t = def.target, eps = 1e-9;
    return t.op === '>=' ? value >= t.value - eps : value <= t.value + eps;
  }
  function fmtValue(def, value) {
    if (value == null) return '—';
    if (def.kind === 'count') return String(Math.round(value * 100) / 100);
    return (Math.round(value * 100) / 100).toFixed(2) + '%';
  }
  /* one number for a rate KPI from a summed numerator/denominator; null when there is nothing to divide by */
  function rateOf(def, a, b) {
    if (!b) return null;
    return def.kind === 'availability' ? (1 - a / b) * 100 : a / b * 100;
  }

  /* result of one month. cumulative = the year's count up to and including this month (used by "per year" targets) */
  function evalMonth(def, e, cumulative) {
    var a = e ? num(e.numerator) : null, b = e ? num(e.denominator) : null;
    if (a == null) return { status: 'none', value: null, display: '—', note: 'ยังไม่มีข้อมูล' };
    if (def.kind === 'count') {
      var ok = def.target.per === 'year' ? meets(def, cumulative) : meets(def, a);
      return { status: ok ? 'ok' : 'fail', value: a, display: fmtValue(def, a), a: a, b: null,
        note: def.target.per === 'year' ? 'สะสมทั้งปี ' + cumulative + ' ครั้ง (เป้าหมาย ' + def.targetText + ')' : 'เป้าหมาย ' + def.targetText };
    }
    if (b == null) return { status: 'none', value: null, display: '—', a: a, b: b, note: 'ต้องกรอกตัวหารด้วย' };
    if (!b) {
      /* nothing to divide by: no events at all is fine, events with no base is a data error */
      return a === 0
        ? { status: 'na', value: null, display: 'ไม่มีเหตุการณ์', a: a, b: b, note: 'ตัวตั้งและตัวหารเป็น 0 — นับว่าผ่านเป้า' }
        : { status: 'none', value: null, display: '—', a: a, b: b, note: 'ตัวหารเป็น 0 แต่ตัวตั้งมีค่า — ตรวจข้อมูลอีกครั้ง' };
    }
    var v = rateOf(def, a, b);
    return { status: meets(def, v) ? 'ok' : 'fail', value: v, display: fmtValue(def, v), a: a, b: b, note: 'เป้าหมาย ' + def.targetText };
  }

  /* byMonth: { 1: {numerator, denominator}, ... } -> the twelve monthly results plus the YTD column */
  function evalYear(def, byMonth) {
    var months = [], cum = 0, sumA = 0, sumB = 0, dataMonths = 0, passed = 0;
    for (var m = 1; m <= 12; m++) {
      var e = byMonth[m];
      var a = e ? num(e.numerator) : null;
      if (a != null) cum += a;
      var r = evalMonth(def, e, cum);
      months.push(r);
      if (r.status !== 'none') { dataMonths++; if (r.status === 'ok' || r.status === 'na') passed++; }
      if (a != null) { sumA += a; if (def.kind !== 'count') sumB += (e && num(e.denominator)) || 0; }
    }
    var ytd;
    if (!dataMonths) ytd = { status: 'none', value: null, display: '—', note: 'ยังไม่มีข้อมูล' };
    else if (def.kind === 'count') {
      var okYtd = def.target.per === 'year' ? meets(def, sumA) : passed === dataMonths;
      ytd = { status: okYtd ? 'ok' : 'fail', value: sumA, display: fmtValue(def, sumA) };
    } else {
      var yv = rateOf(def, sumA, sumB);
      ytd = yv == null ? { status: 'na', value: null, display: 'ไม่มีเหตุการณ์' } : { status: meets(def, yv) ? 'ok' : 'fail', value: yv, display: fmtValue(def, yv) };
    }
    ytd.passedMonths = passed; ytd.dataMonths = dataMonths; ytd.a = sumA; ytd.b = def.kind === 'count' ? null : sumB;
    return { months: months, ytd: ytd };
  }

  /* the sheet's "Total KPI" block: achieved / 12 / percentage, per month */
  function totals(results) {
    var out = [], sumAchieved = 0, reported = 0;
    for (var m = 0; m < 12; m++) {
      var achieved = 0, has = false;
      results.forEach(function (r) {
        var s = r.months[m].status;
        if (s !== 'none') has = true;
        if (s === 'ok' || s === 'na') achieved++;
      });
      out.push({ has: has, achieved: has ? achieved : null, total: TOTAL, pct: has ? achieved / TOTAL * 100 : null });
      if (has) { sumAchieved += achieved; reported++; }
    }
    return { months: out, ytdAchieved: sumAchieved, reportedMonths: reported, ytdPct: reported ? sumAchieved / (TOTAL * reported) * 100 : null };
  }

  var api = { MONTHS: MONTHS, DEFS: DEFS, TOTAL: TOTAL, num: num, meets: meets, fmtValue: fmtValue, evalMonth: evalMonth, evalYear: evalYear, totals: totals };
  root.SOCKPI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
