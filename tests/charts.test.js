// Unit tests for soc-charts.js (ECharts option for time-series charts). Plain Node, no browser.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { option } = require(path.join(__dirname, '..', 'Prototype integration complete', 'soc-charts.js'));

const theme = { text: '#666', line: '#ddd', panel: '#fff', fg: '#111', resolve: (c) => (c && c[0] === '#' ? c : '#2f6f5e') };
const E = { graphic: { LinearGradient: function () { this.gradient = true; } } };
const spec = (n, extra) => Object.assign({ labels: Array.from({ length: n }, (_, i) => String(i + 1)),
  values: Array.from({ length: n }, (_, i) => 100 + i), unit: 'คัน', color: '#d14d8a' }, extra);

test('bar series keeps each bar colour and draws the average line', () => {
  const o = option(spec(5, { bar: true, barColors: ['#111111', '', '', '', ''] }), theme, E);
  const s = o.series[0];
  assert.strictEqual(s.type, 'bar');
  assert.strictEqual(s.data[0].itemStyle.color, '#111111');
  assert.strictEqual(s.data[1].itemStyle.color, '#d14d8a');
  assert.strictEqual(s.markLine.data[0].yAxis, 102);
});

test('a short range zooms by drag only; past two weeks it adds a slider on the latest month', () => {
  assert.strictEqual(option(spec(14), theme, E).dataZoom.length, 1);
  const long = option(spec(62), theme, E);
  assert.strictEqual(long.dataZoom.length, 2);
  assert.strictEqual(long.dataZoom[1].type, 'slider');
  assert.ok(long.dataZoom[0].start > 0, 'opens on the latest points, not the whole range');
});

test('area line uses a gradient for hex colours and a plain tint otherwise', () => {
  assert.ok(option(spec(5, { area: true }), theme, E).series[0].areaStyle.color.gradient);
  const plain = option(spec(5, { area: true, color: 'var(--accent)' }), { ...theme, resolve: () => 'rgb(1,2,3)' }, E);
  assert.strictEqual(plain.series[0].areaStyle.opacity, 0.15);
});

test('tooltip shows the exact value with its unit', () => {
  assert.strictEqual(option(spec(3), theme, E).tooltip.valueFormatter(1234), '1,234 คัน');
});
