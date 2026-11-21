/* ECharts option for the Admin Console's time-series charts (bar or line), kept out of the page so
   it can be tested on its own. spec comes from buildChart(); theme carries the page's resolved colours
   (text, line, panel, fg) and resolve(cssColour) -> concrete colour; E is the echarts namespace (only
   graphic.LinearGradient is used). Zoom: always by drag/pinch, plus a slider past two weeks. */
(function (root) {
  function option(spec, theme, E) {
    const text = theme.text, line = theme.line, panel = theme.panel, fg = theme.fg, resolve = theme.resolve;
    const n = spec.values.length, color = resolve(spec.color);
    const avg = n ? spec.values.reduce((a, x) => a + x, 0) / n : 0;
    const long = n > 14; /* slider for anything past two weeks; opens on the latest 31 points */
    return {
      animationDuration: 400,
      grid: { left: 8, right: 16, top: 28, bottom: long ? 56 : 24, containLabel: true },
      tooltip: { trigger: 'axis', confine: true, backgroundColor: panel, borderColor: line, textStyle: { color: fg, fontFamily: 'IBM Plex Sans Thai' },
        valueFormatter: (x) => Number(x).toLocaleString() + (spec.unit ? ' ' + spec.unit : '') },
      xAxis: { type: 'category', data: spec.labels, boundaryGap: !!spec.bar, axisLine: { lineStyle: { color: line } }, axisTick: { show: false },
        axisLabel: { color: text, hideOverlap: true, fontFamily: 'IBM Plex Mono', fontSize: 11 } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: line, type: 'dashed' } }, axisLabel: { color: text, fontSize: 11 } },
      dataZoom: [{ type: 'inside', start: long ? Math.max(0, 100 - 3100 / n) : 0, end: 100 }].concat(long ? [{ type: 'slider', height: 18, bottom: 10, borderColor: line, textStyle: { color: text } }] : []),
      series: [spec.bar ? { type: 'bar', barMaxWidth: 28, data: spec.values.map((x, i) => ({ value: x, itemStyle: { color: resolve((spec.barColors || [])[i] || spec.color), borderRadius: [4, 4, 0, 0] } })),
        markLine: n > 1 ? { silent: true, symbol: 'none', lineStyle: { color: text, type: 'dashed', opacity: 0.6 }, label: { color: text, formatter: 'เฉลี่ย ' + Math.round(avg).toLocaleString(), position: 'insideEndTop' }, data: [{ yAxis: avg }] } : undefined }
        : { type: 'line', data: spec.values, smooth: 0.3, symbol: 'circle', symbolSize: n > 60 ? 0 : 6, showSymbol: n <= 60,
        lineStyle: { width: 2, color }, itemStyle: { color },
        areaStyle: spec.area && /^#[0-9a-f]{6}$/i.test(color) ? { color: new E.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: color + '40' }, { offset: 1, color: color + '00' }]) } : spec.area ? { color, opacity: 0.15 } : undefined,
        markLine: n > 1 ? { silent: true, symbol: 'none', lineStyle: { color: text, type: 'dashed', opacity: 0.6 },
          label: { color: text, formatter: 'เฉลี่ย ' + Math.round(avg).toLocaleString(), position: 'insideEndTop' }, data: [{ yAxis: avg }] } : undefined }]
    };
  }
  const api = { option: option };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SOCCharts = api;
})(typeof window !== 'undefined' ? window : globalThis);
