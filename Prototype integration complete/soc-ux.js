/* SOC UX micro-interactions — purely presentational, shared by Admin Console + Entry Portal.
   Never reads or writes app state: it only watches the DOM for number elements appearing and
   animates their text, always finishing on the exact string the framework rendered. */
(function () {
  /* ---- layout helpers: run regardless of reduced-motion ---- */

  /* Mobile table cards: copy each column's header text onto its cells as data-label so the
     CSS in the page can stack rows into cards below 640px. Only attributes are written —
     the framework's text nodes and rows are left exactly as rendered. */
  function labelTables() {
    var tables = document.querySelectorAll('main table');
    for (var t = 0; t < tables.length; t++) {
      var table = tables[t];
      var ths = table.querySelectorAll('thead th');
      if (!ths.length) continue;
      var labels = [];
      for (var i = 0; i < ths.length; i++) labels.push(ths[i].textContent.replace(/\s+/g, ' ').trim());
      table.setAttribute('data-soc-cards', '');
      var rows = table.querySelectorAll('tbody tr');
      for (var r = 0; r < rows.length; r++) {
        var cells = rows[r].children;
        for (var c = 0; c < cells.length; c++) {
          var l = labels[c] || '';
          if (cells[c].getAttribute('data-label') !== l) cells[c].setAttribute('data-label', l);
        }
      }
    }
  }

  /* Desktop sidebar collapse: a toggle injected into the sidebar header. State is a class on
     <html> (remembered per browser), so the framework's inline sidebar styles are untouched;
     the drawer on narrow screens (position: fixed) ignores it. */
  var COLLAPSE_KEY = 'soc-nav-collapsed';
  try { if (localStorage.getItem(COLLAPSE_KEY) === '1') document.documentElement.classList.add('soc-nav-collapsed'); } catch (e) {}
  function ensureCollapseButton() {
    var aside = document.querySelector('aside');
    if (!aside || aside.querySelector('.soc-collapse-btn')) return;
    var head = aside.firstElementChild;
    if (!head) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'soc-collapse-btn';
    b.setAttribute('aria-label', 'ย่อ/ขยายเมนู');
    b.title = 'ย่อ/ขยายเมนู';
    b.textContent = '‹';
    b.addEventListener('click', function () {
      var on = document.documentElement.classList.toggle('soc-nav-collapsed');
      try { localStorage.setItem(COLLAPSE_KEY, on ? '1' : '0'); } catch (e) {}
    });
    head.appendChild(b);
  }

  /* Page transition: when a sidebar nav item is clicked, replay a short fade on <main>. */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('aside nav button');
    if (!btn) return;
    var main = document.querySelector('main');
    if (!main) return;
    main.classList.remove('soc-page-enter');
    void main.offsetWidth;
    main.classList.add('soc-page-enter');
  }, true);

  var layoutQueued = false;
  function queueLayout() {
    if (layoutQueued) return;
    layoutQueued = true;
    requestAnimationFrame(function () { layoutQueued = false; labelTables(); ensureCollapseButton(); });
  }
  function startLayout() {
    queueLayout();
    new MutationObserver(queueLayout).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startLayout);
  else startLayout();

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
