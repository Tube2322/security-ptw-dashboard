/* SOC UX micro-interactions — purely presentational, shared by Admin Console + Entry Portal.
   Never reads or writes app state: it only watches the DOM for number elements appearing and
   animates their text, always finishing on the exact string the framework rendered. */
(function () {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var SEL = '.soc-kpi-value';
  var seen = new WeakSet();

  /* "3,058" / "12" / "+33" / "0/5 หัวข้อ" -> animate the first number, keep the rest verbatim */
  /* Writes go to the existing text node's .data (never el.textContent), so the node the
     framework holds a reference to stays attached; if the framework rewrites it mid-animation
     (data !== what we last wrote) we stop and leave its value alone. */
  function countUp(el) {
    var node = el.firstChild;
    if (!node || node.nodeType !== 3 || el.childNodes.length !== 1) return;
    var final = node.data;
    var m = final.match(/^(\D*?)(-?\d[\d,]*(?:\.\d+)?)(.*)$/s);
    if (!m || !/^[+\-−]?\s*$/.test(m[1])) return; /* codes like "PL02" aren't quantities */
    var target = parseFloat(m[2].replace(/,/g, ''));
    if (!isFinite(target) || target === 0) return;
    var decimals = (m[2].split('.')[1] || '').length;
    var grouped = m[2].indexOf(',') !== -1 || Math.abs(target) >= 1000;
    var start = performance.now(), dur = Math.min(900, 420 + Math.log10(Math.abs(target) + 1) * 140);
    function fmt(v) {
      var s = v.toFixed(decimals);
      return grouped ? Number(s).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : s;
    }
    var last;
    function write(s) { last = s; node.data = s; }
    function frame(now) {
      if (node.data !== last) return; /* framework updated it — its value wins */
      var t = Math.min(1, (now - start) / dur);
      var e = 1 - Math.pow(1 - t, 3);
      if (t < 1) { write(m[1] + fmt(target * e) + m[3]); requestAnimationFrame(frame); }
      else node.data = final;
    }
    write(m[1] + fmt(0) + m[3]);
    requestAnimationFrame(frame);
  }

  function scan(root) {
    var list = root.querySelectorAll ? root.querySelectorAll(SEL) : [];
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (seen.has(el)) continue;
      /* skip template placeholders that haven't been filled in yet */
      if (!el.textContent || el.textContent.indexOf('{{') !== -1) continue;
      seen.add(el);
      countUp(el);
    }
  }

  function start() {
    scan(document);
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var n = muts[i].addedNodes;
        for (var j = 0; j < n.length; j++) if (n[j].nodeType === 1) scan(n[j].parentNode || n[j]);
      }
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
