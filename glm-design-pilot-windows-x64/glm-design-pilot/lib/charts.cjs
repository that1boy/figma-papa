'use strict';
// Declarative charts. The model writes
//   <figure class="chart" data-chart='{"type":"bar","title":"…","labels":[…],"series":[{"name":"…","values":[…]}],"unit":"%"}'></figure>
// and presentation-time expansion fills the figure with deterministic,
// accessible SVG: nice axis ticks, hairline grid, compact numbers, a legend for
// several series, a visually hidden data table and per-mark tooltips. Colours
// come from --chart-1…--chart-6 (with fallbacks); text uses currentColor and
// --muted. Every string from the spec is escaped; inline styles only ever hold
// constants generated here.
const { escapeHTML: esc, attrs, findElements, splice } = require('./svg.cjs');
const { expandIcons } = require('./icons.cjs');

const TYPES = ['bar', 'hbar', 'stacked-bar', 'line', 'area', 'donut', 'pie', 'sparkline'];
const TYPE_NAMES = { bar: 'Bar chart', hbar: 'Horizontal bar chart', 'stacked-bar': 'Stacked bar chart', line: 'Line chart', area: 'Area chart', donut: 'Donut chart', pie: 'Pie chart', sparkline: 'Sparkline' };
const MAX_LABELS = 24, MAX_SERIES = 6, MAX_SLICES = 12, MAX_SPEC = 6000, LIMIT = 1e15;
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];
const MUTED = 'var(--muted,#667085)', BORDER = 'var(--border,#e4e7ec)', SURFACE = 'var(--surface,#ffffff)';
const seriesColor = (i) => {
  const c = `var(--chart-${(i % 6) + 1},${PALETTE[i % 6]})`;
  return i < 6 ? c : `color-mix(in oklab,${c} 55%,${SURFACE})`;
};
// Variants are switched by container width (MARKUP_CSS); md is the inline default.
// SVG text scales with the drawing, so each band keeps its 12-unit text between about
// 11 and 16 px: xs below 400 px (11 px from a 275 px container, e.g. a card on a 390 px
// phone), sm 400–560, md 560–780, lg from 780 px.
const VARIANTS = { xs: { w: 300, h: 220, ticks: 4 }, sm: { w: 420, h: 250, ticks: 4 }, md: { w: 580, h: 290, ticks: 5 }, lg: { w: 820, h: 330, ticks: 5 } };

function invalid(message) {
  return Object.assign(new Error(message), { status: 400, code: 'chart' });
}
const short = (s) => (String(s).length > 40 ? String(s).slice(0, 39) + '…' : String(s));
function text(x, name, max, fallback = '') {
  if (x == null || x === '') return fallback;
  if (typeof x === 'number' && Number.isFinite(x)) x = String(x);
  if (typeof x !== 'string' || x.length > max) throw invalid(`${name} must be text of at most ${max} characters.`);
  return x.trim();
}
function finite(v, where) {
  if (typeof v === 'string' && /^\s*-?\d+(?:\.\d+)?\s*$/.test(v)) v = Number(v);
  if (typeof v !== 'number' || !Number.isFinite(v)) throw invalid(`${where} is not a finite number.`);
  if (Math.abs(v) > LIMIT) throw invalid(`${where} is outside ±1e15.`);
  return v;
}
// Normalises a chart spec (object or JSON text) or throws an Error with a
// descriptive message and code 'chart'. Returns { type, title, caption, unit, labels, series:[{name, values}] }.
function validateChart(spec) {
  if (typeof spec === 'string') {
    if (spec.length > MAX_SPEC) throw invalid('Chart data exceeds 6,000 characters.');
    try {
      spec = JSON.parse(spec);
    } catch {
      throw invalid('Chart data is not valid JSON.');
    }
  }
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw invalid('Chart data must be a JSON object.');
  const type = spec.type ?? 'bar';
  if (!TYPES.includes(type)) throw invalid(`Unknown chart type "${typeof type === 'string' ? short(type) : typeof type}". Use one of: ${TYPES.join(', ')}.`);
  const title = text(spec.title, 'Chart title', 160);
  const caption = text(spec.caption, 'Chart caption', 300);
  const unit = text(spec.unit, 'Chart unit', 12);
  let series = spec.series;
  if (series == null && Array.isArray(spec.values)) series = [{ name: spec.name, values: spec.values }];
  if (!Array.isArray(series) || !series.length || series.length > MAX_SERIES)
    throw invalid(`Chart series must be an array of 1–${MAX_SERIES} series, each {"name": "…", "values": [numbers]}.`);
  series = series.map((s, i) => {
    if (Array.isArray(s)) s = { values: s };
    if (!s || typeof s !== 'object' || !Array.isArray(s.values)) throw invalid(`Series ${i + 1} must be an object with a "values" array of numbers.`);
    const name = text(s.name, `Series ${i + 1} name`, 80, series.length === 1 ? title || 'Value' : `Series ${i + 1}`);
    return { name, values: s.values.map((v, j) => finite(v, `Series "${short(name)}" value ${j + 1}`)) };
  });
  const longest = Math.max(...series.map((s) => s.values.length));
  let labels = spec.labels;
  if (labels == null) labels = Array.from({ length: longest }, (_, i) => String(i + 1));
  if (!Array.isArray(labels) || !labels.length || labels.length > MAX_LABELS)
    throw invalid(`Chart labels must be an array of 1–${MAX_LABELS} items.`);
  labels = labels.map((l, i) => text(l, `Label ${i + 1}`, 80));
  for (const s of series)
    if (s.values.length !== labels.length)
      throw invalid(`Series "${short(s.name)}" has ${s.values.length} values but there are ${labels.length} labels.`);
  const values = series.flatMap((s) => s.values);
  if (type === 'pie' || type === 'donut') {
    if (series.length !== 1) throw invalid('Pie and donut charts take exactly one series.');
    if (labels.length > MAX_SLICES) throw invalid(`Pie and donut charts support at most ${MAX_SLICES} slices; group small categories into "Other".`);
    if (values.some((v) => v < 0) || !(values.reduce((a, b) => a + b, 0) > 0))
      throw invalid('Pie and donut values must be zero or positive and add up to more than zero.');
  }
  if (type === 'stacked-bar' && values.some((v) => v < 0)) throw invalid('Stacked bar values must be zero or positive.');
  if (type === 'sparkline') {
    if (series.length !== 1) throw invalid('Sparklines take exactly one series.');
    if (labels.length < 2) throw invalid('A sparkline needs at least 2 values.');
  }
  if ((type === 'line' || type === 'area') && labels.length < 2) throw invalid('Line and area charts need at least 2 labels.');
  return { type, title, caption, unit, labels, series };
}

// ---- numbers -------------------------------------------------------------
const MINUS = '−';
const SCALES = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'k']];
const trimZeros = (s) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
// Fewest decimals that write x exactly (relative tolerance, so 1e-7 needs 7, 1234567.5 needs 1).
const decimals = (x) => {
  for (let k = 0; k < 20; k++) {
    const y = Math.abs(x) * 10 ** k;
    if (Math.abs(y - Math.round(y)) <= 1e-9 * Math.max(1, y)) return k;
  }
  return 20;
};
// Decimals that keep two significant digits of a value below 1 (0.0045 -> 4).
const smallDigits = (a) => Math.min(20, 1 - Math.floor(Math.log10(a)));
function plain(v, digits) {
  const s = trimZeros(Math.abs(v).toFixed(digits));
  const [i, f] = s.split('.');
  return (v < 0 && Number(s) !== 0 ? MINUS : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? '.' + f : '');
}
// Exact-ish value for tables and tooltips: 1,234.57 or 0.0045.
const full = (v) => plain(v, v !== 0 && Math.abs(v) < 1 ? smallDigits(Math.abs(v)) : 2);
// Short value for labels: 1,284 / 45.3 / 12.9k / 4.2M / 0.0045.
function compact(v) {
  const a = Math.abs(v);
  if (a < 1e4) return plain(v, a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 || a === 0 ? 2 : smallDigits(a));
  let i = SCALES.findIndex(([d]) => a >= d);
  let t = trimZeros((a / SCALES[i][0]).toFixed(a / SCALES[i][0] < 100 ? 1 : 0));
  if (Number(t) >= 1000 && i > 0) t = trimZeros((a / SCALES[--i][0]).toFixed(1));
  return (v < 0 ? MINUS : '') + t + SCALES[i][1];
}
function tickLabel(t, step) {
  const a = Math.abs(t);
  if (a < 1000) return plain(t, decimals(step));
  const [d, s] = SCALES.find(([d]) => a >= d);
  const k = decimals(step / d);
  return k <= 2 ? (t < 0 ? MINUS : '') + trimZeros((a / d).toFixed(k)) + s : plain(t, decimals(step));
}
const PREFIX_UNIT = /^(?:[$€£¥₹₩₽₺₫₦₱฿₴₪¢]|[A-Z]{1,3}\$|R\$)$/;
function unitize(s, unit) {
  if (!unit) return s;
  const neg = s.startsWith(MINUS);
  if (PREFIX_UNIT.test(unit)) return (neg ? MINUS : '') + unit + (neg ? s.slice(1) : s);
  return s + (/^(?:%|‰|°.*|x|×|′|″)$/.test(unit) ? '' : ' ') + unit;
}
const pct = (v, total) => {
  const p = (v / total) * 100;
  return trimZeros(p.toFixed(p > 0 && p < 10 ? 1 : 0)) + '%';
};
// Nice axis: steps of 1, 2, 2.5 or 5 × 10^n giving about `count` intervals.
function niceTicks(lo, hi, count = 5, integers = false) {
  // Flat data, or a range too small for doubles to step through: axis from zero to the value.
  if (!(hi - lo > Math.max(Math.abs(lo), Math.abs(hi)) * 1e-12)) {
    const v = Math.abs(hi) >= Math.abs(lo) ? hi : lo;
    [lo, hi] = v > 0 ? [0, v] : v < 0 ? [v, 0] : [0, 1];
  }
  if (!(hi - lo >= 1e-200)) [lo, hi] = [0, 1]; // denormal-sized data
  const raw = (hi - lo) / count, mag = 10 ** Math.floor(Math.log10(raw));
  let steps = [1, 2, 2.5, 5, 10].map((m) => m * mag);
  if (integers) steps = steps.filter((s) => s >= 1 && Math.abs(s - Math.round(s)) < 1e-9);
  if (!steps.length) steps = [1];
  const step = steps.find((s) => s >= raw * 0.999) ?? steps[steps.length - 1];
  const dp = Math.min(100, Math.max(0, Math.ceil(-Math.log10(step)) + 1));
  const min = Math.floor(lo / step + 1e-9) * step, ticks = [];
  for (let i = 0; i <= 60; i++) {
    const t = Number((min + i * step).toFixed(dp));
    ticks.push(t);
    if (t >= hi - step * 1e-9) break;
  }
  // Never hand back a degenerate scale (it would put NaN into every coordinate).
  if (!(ticks.length > 1 && ticks[ticks.length - 1] > ticks[0] && ticks.every(Number.isFinite))) return { min: lo, max: hi, step: hi - lo, ticks: [lo, hi] };
  return { min: ticks[0], max: ticks[ticks.length - 1], step, ticks };
}

// ---- drawing helpers ------------------------------------------------------
const chars = (s) => Array.from(String(s));
// Approximate advance widths (em) of a UI sans at text sizes, erring wide: East
// Asian wide characters and emoji 1em, wide letters 0.88, capitals 0.7, digits
// 0.62, narrow glyphs 0.34, everything else 0.58.
const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u;
const advance = (c) => (WIDE.test(c) ? 1 : /[mwMW@%\u2014]/.test(c) ? 0.88 : /[A-Z#&]/.test(c) ? 0.7 : /[0-9$\u20ac\u00a3\u00a5+=<>~^_\u00b1\u00d7\u2212\u2013?]/.test(c) ? 0.62 : /[ijlI.,:;'"!|()[\]{}/ frt]/.test(c) ? 0.34 : 0.58);
const width = (s, size = 12) => chars(s).reduce((n, c) => n + advance(c), 0) * size;
// Truncate with an ellipsis to fit `px` at `size` (always keeps one character).
const clip = (s, px, size = 12) => {
  if (width(s, size) <= px) return String(s);
  let out = '', used = advance('\u2026') * size;
  for (const c of chars(s)) {
    if (out && used + advance(c) * size > px) break;
    out += c;
    used += advance(c) * size;
  }
  return out.trimEnd() + '\u2026';
};
const n1 = (v) => {
  const x = Math.round(v * 10) / 10;
  return Object.is(x, -0) ? 0 : x;
};
const tip = (c, i, s, v) => `${c.labels[i]}${c.series.length > 1 ? ` · ${s.name}` : ''}: ${unitize(full(v), c.unit)}`;
const titleOf = (c) => c.title || TYPE_NAMES[c.type];
function describe(c) {
  const values = c.series.flatMap((s) => s.values), n = c.labels.length, m = c.series.length;
  if (c.type === 'pie' || c.type === 'donut') {
    const v = c.series[0].values, total = v.reduce((a, b) => a + b, 0), top = v.indexOf(Math.max(...v));
    return `${TYPE_NAMES[c.type]} of ${n} parts totalling ${unitize(full(total), c.unit)}. Largest: ${c.labels[top]}, ${pct(v[top], total)}.`;
  }
  const lo = Math.min(...values), hi = Math.max(...values);
  if (c.type === 'sparkline')
    return `Sparkline of ${n} values from ${unitize(full(lo), c.unit)} to ${unitize(full(hi), c.unit)}; latest ${unitize(full(values[n - 1]), c.unit)}.`;
  return `${TYPE_NAMES[c.type]} with ${n} ${n === 1 ? 'point' : 'points'}${m > 1 ? ` in ${m} series` : ''}, from ${c.labels[0]} to ${c.labels[n - 1]}. Values range from ${unitize(full(lo), c.unit)} to ${unitize(full(hi), c.unit)}.`;
}
function svgRoot(c, w, h, body, variant, extra = {}) {
  const style = variant ? `display:${variant === 'md' ? 'block' : 'none'};width:100%;height:auto;overflow:visible` : 'display:block;width:100%;height:auto;overflow:visible';
  return `<svg${attrs({ xmlns: 'http://www.w3.org/2000/svg', viewBox: `0 0 ${n1(w)} ${n1(h)}`, role: 'img', focusable: 'false', 'data-forma-variant': variant || null, style, ...extra })}><title>${esc(titleOf(c))}</title><desc>${esc(describe(c))}</desc>${body}</svg>`;
}
function barPath(x, from, to, w, r, horizontal = false) {
  if (Math.abs(to - from) < 0.5) return '';
  const rr = n1(Math.min(r, w / 2, Math.abs(to - from)));
  [x, from, to, w] = [n1(x), n1(from), n1(to), n1(w)];
  if (!horizontal) {
    return to < from
      ? `M${x} ${from}V${n1(to + rr)}A${rr} ${rr} 0 0 1 ${n1(x + rr)} ${to}H${n1(x + w - rr)}A${rr} ${rr} 0 0 1 ${n1(x + w)} ${n1(to + rr)}V${from}Z`
      : `M${x} ${from}V${n1(to - rr)}A${rr} ${rr} 0 0 0 ${n1(x + rr)} ${to}H${n1(x + w - rr)}A${rr} ${rr} 0 0 0 ${n1(x + w)} ${n1(to - rr)}V${from}Z`;
  }
  // Horizontal: x is the top edge, from/to run along the x axis.
  return to > from
    ? `M${from} ${x}H${n1(to - rr)}A${rr} ${rr} 0 0 1 ${to} ${n1(x + rr)}V${n1(x + w - rr)}A${rr} ${rr} 0 0 1 ${n1(to - rr)} ${n1(x + w)}H${from}Z`
    : `M${from} ${x}H${n1(to + rr)}A${rr} ${rr} 0 0 0 ${to} ${n1(x + rr)}V${n1(x + w - rr)}A${rr} ${rr} 0 0 0 ${n1(to + rr)} ${n1(x + w)}H${from}Z`;
}
// Monotone cubic interpolation (Fritsch–Carlson): smooth without overshooting the data.
function monotone(pts) {
  const n = pts.length;
  if (n < 3) return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${n1(x)} ${n1(y)}`).join('');
  const dx = [], s = [], m = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    s[i] = (pts[i + 1][1] - pts[i][1]) / dx[i];
  }
  m[0] = s[0];
  m[n - 1] = s[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (s[i - 1] * s[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * dx[i] + dx[i - 1], w2 = dx[i] + 2 * dx[i - 1];
      m[i] = (w1 + w2) / (w1 / s[i - 1] + w2 / s[i]);
    }
  }
  let d = `M${n1(pts[0][0])} ${n1(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], h = dx[i] / 3;
    d += `C${n1(x0 + h)} ${n1(y0 + m[i] * h)} ${n1(x1 - h)} ${n1(y1 - m[i + 1] * h)} ${n1(x1)} ${n1(y1)}`;
  }
  return d;
}
// Legend drawn inside a standalone SVG (chartSVG with legend: true).
function svgLegend(c, w, line) {
  let x = 0, y = 0, out = '';
  for (const [i, s] of c.series.entries()) {
    const name = clip(s.name, 190), itemW = 16 + width(name) + 18;
    if (x && x + itemW > w) {
      x = 0;
      y += 20;
    }
    out += line
      ? `<rect x="${n1(x)}" y="${y + 5}" width="12" height="3" rx="1.5" style="fill:${seriesColor(i)}"/>`
      : `<rect x="${n1(x)}" y="${y + 1.5}" width="10" height="10" rx="3" style="fill:${seriesColor(i)}"/>`;
    out += `<text x="${n1(x + 16)}" y="${y + 6.5}" dy="0.32em">${esc(name)}</text>`;
    x += itemW;
  }
  return { svg: `<g aria-hidden="true" font-size="12" style="fill:currentColor">${out}</g>`, height: y + 26 };
}
// Category labels along x: truncate (to about `keep` characters), then thin out. Bars keep
// every category readable down to four characters; lines and areas thin out earlier.
function xAxisLabels(labels, at, slot, y, w, keep = 7) {
  const longest = Math.max(...labels.map((l) => width(l)));
  let k = 1;
  while (k < labels.length && slot * k < Math.min(longest, width('x'.repeat(keep))) + 10) k++;
  const budget = Math.max(width('xxx'), slot * k - 8);
  let out = '';
  labels.forEach((l, i) => {
    if (i % k) return;
    const t = clip(l, budget), tw = width(t);
    const x = Math.min(Math.max(at(i), tw / 2 + 2), w - tw / 2 - 2);
    out += `<text x="${n1(x)}" y="${n1(y)}">${esc(t)}</text>`;
  });
  return `<g font-size="12" text-anchor="middle" style="fill:${MUTED}">${out}</g>`;
}

function cartesian(c, v, legend, variant) {
  const { w, h } = v, m = c.series.length, n = c.labels.length;
  const stacked = c.type === 'stacked-bar', bars = c.type === 'bar' || stacked, area = c.type === 'area';
  const values = c.series.flatMap((s) => s.values);
  const totals = c.labels.map((_, i) => c.series.reduce((t, s) => t + s.values[i], 0));
  let lo = stacked ? 0 : Math.min(...values), hi = stacked ? Math.max(...totals) : Math.max(...values);
  const zoom = !bars && !area && ((lo > 0 && lo > hi * 0.5) || (hi < 0 && hi < lo * 0.5));
  if (!zoom) [lo, hi] = [Math.min(lo, 0), Math.max(hi, 0)];
  const scale = niceTicks(lo, hi, v.ticks, values.every(Number.isInteger));
  const ticks = scale.ticks.map((t) => unitize(tickLabel(t, scale.step), c.unit));
  const lg = legend && m > 1 ? svgLegend(c, w, !bars) : null;
  const last = c.series[0].values[n - 1];
  const endLabel = !bars && m === 1 ? unitize(compact(last), c.unit) : '';
  const x0 = Math.ceil(Math.max(...ticks.map((t) => width(t))) + 12), x1 = w - (endLabel ? width(endLabel, 12) + 16 : bars ? 4 : 12);
  const y0 = (lg ? lg.height : 0) + (bars ? 20 : 12), y1 = h - 26;
  const y = (val) => y1 - ((val - scale.min) / (scale.max - scale.min)) * (y1 - y0);
  const base = y(Math.min(Math.max(0, scale.min), scale.max));
  const grid = scale.ticks.map((t) => `M${x0} ${n1(y(t))}H${n1(x1)}`).join('');
  let axis = `<path d="${grid}" style="fill:none;stroke:${BORDER};stroke-width:1" vector-effect="non-scaling-stroke"/>`;
  axis += `<path d="M${x0} ${n1(base)}H${n1(x1)}" style="fill:none;stroke:${MUTED};stroke-opacity:0.45;stroke-width:1" vector-effect="non-scaling-stroke"/>`;
  axis += `<g font-size="12" text-anchor="end" style="fill:${MUTED};font-variant-numeric:tabular-nums">${scale.ticks.map((t, i) => `<text x="${x0 - 8}" y="${n1(y(t))}" dy="0.32em">${esc(ticks[i])}</text>`).join('')}</g>`;
  let marks = '', labels = '';
  if (bars) {
    const band = (x1 - x0) / n, gap = 2;
    const bw = Math.max(1, Math.min(24, stacked ? band * 0.64 : (band * (m > 1 ? 0.8 : 0.64) - gap * (m - 1)) / m));
    const group = stacked ? bw : m * bw + (m - 1) * gap;
    const centre = (i) => x0 + i * band + band / 2;
    c.labels.forEach((_, i) => {
      const gx = centre(i) - group / 2;
      if (stacked) {
        let cum = 0;
        const topIndex = c.series.map((s) => s.values[i] > 0).lastIndexOf(true);
        c.series.forEach((s, j) => {
          const val = s.values[i];
          if (val <= 0) return;
          const from = y(cum), top = j === topIndex;
          let to = y(cum + val);
          if (!top && from - to > 3) to += gap;
          cum += val;
          const d = barPath(gx, from, to, bw, top ? 4 : 0);
          if (d) marks += `<path d="${d}" style="fill:${seriesColor(j)}"><title>${esc(tip(c, i, s, val))}</title></path>`;
        });
      } else
        c.series.forEach((s, j) => {
          const val = s.values[i], d = barPath(gx + j * (bw + gap), base, y(val), bw, 4);
          if (d) marks += `<path d="${d}" style="fill:${seriesColor(j)}"><title>${esc(tip(c, i, s, val))}</title></path>`;
        });
    });
    // Value labels on the caps when every one fits its band.
    const shown = stacked ? totals : m === 1 ? c.series[0].values : null;
    if (shown && n <= 12) {
      const t = shown.map((val) => unitize(compact(val), c.unit));
      if (Math.max(...t.map((s) => width(s))) <= band - 2)
        labels = `<g font-size="12" text-anchor="middle" style="fill:currentColor;font-variant-numeric:tabular-nums">${t
          .map((s, i) => `<text x="${n1(centre(i))}" y="${n1(shown[i] < 0 ? y(shown[i]) + 14 : y(shown[i]) - 6)}">${esc(s)}</text>`)
          .join('')}</g>`;
    }
    axis += xAxisLabels(c.labels, centre, band, y1 + 18, w, 4);
  } else {
    const inset = n > 1 ? Math.min(12, (x1 - x0) / (n - 1) / 2) : 0;
    const slot = n > 1 ? (x1 - x0 - 2 * inset) / (n - 1) : x1 - x0;
    const px = (i) => (n === 1 ? (x0 + x1) / 2 : x0 + inset + i * slot);
    const dots = n <= 16;
    let fills = '', lines = '', points = '';
    c.series.forEach((s, j) => {
      const pts = s.values.map((val, i) => [px(i), y(val)]), d = monotone(pts), col = seriesColor(j);
      if (area) fills += `<path d="${d}L${n1(pts[n - 1][0])} ${n1(base)}L${n1(pts[0][0])} ${n1(base)}Z" style="fill:${col};fill-opacity:${m > 1 ? 0.06 : 0.12};stroke:none"/>`;
      lines += `<path d="${d}" style="fill:none;stroke:${col};stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>`;
      pts.forEach(([x, yy], i) => {
        const visible = dots || i === n - 1;
        points += `<g><title>${esc(tip(c, i, s, s.values[i]))}</title><circle cx="${n1(x)}" cy="${n1(yy)}" r="${n1(Math.max(4, Math.min(10, slot / 2)))}" style="fill:transparent"/>${
          visible ? `<circle cx="${n1(x)}" cy="${n1(yy)}" r="4" style="fill:${col};stroke:${SURFACE};stroke-width:2"/>` : ''
        }</g>`;
      });
    });
    marks = fills + lines + points;
    if (endLabel)
      labels = `<text x="${n1(px(n - 1) + 10)}" y="${n1(y(last))}" dy="0.32em" font-size="12" font-weight="600" style="fill:currentColor;font-variant-numeric:tabular-nums">${esc(endLabel)}</text>`;
    axis += xAxisLabels(c.labels, px, slot, y1 + 18, w);
  }
  return svgRoot(c, w, h, `${lg ? lg.svg : ''}<g aria-hidden="true">${axis}</g><g>${marks}</g>${labels ? `<g aria-hidden="true">${labels}</g>` : ''}`, variant);
}

function horizontal(c, v, legend, variant) {
  const { w } = v, m = c.series.length, n = c.labels.length, single = m === 1;
  const values = c.series.flatMap((s) => s.values);
  const scale = niceTicks(Math.min(0, ...values), Math.max(0, ...values), v.ticks - 1, values.every(Number.isInteger));
  const lg = legend && m > 1 ? svgLegend(c, w, false) : null;
  const thick = single ? (w < 420 ? 14 : 18) : Math.max(6, Math.min(12, 30 / m)), gap = 2;
  const group = m * thick + (m - 1) * gap, row = group + (single ? 14 : 16);
  const vals = single ? c.series[0].values.map((val) => unitize(compact(val), c.unit)) : [];
  const valueW = single ? Math.max(...vals.map((s) => width(s))) + 10 : 0;
  const labelW = Math.min(Math.max(...c.labels.map((l) => width(l))), Math.floor(w * 0.36));
  // Labels of negative bars sit left of the bar end: keep room for them before the plot.
  const negW = single ? Math.max(0, ...vals.filter((_, i) => c.series[0].values[i] < 0).map((s) => width(s) + 8)) : 0;
  const x0 = Math.ceil(labelW + 12 + negW), x1 = w - Math.max(12, valueW + 4);
  const y0 = (lg ? lg.height : 0) + 6, plotH = n * row, h = y0 + plotH + (single ? 6 : 26);
  const x = (val) => x0 + ((val - scale.min) / (scale.max - scale.min)) * (x1 - x0);
  const base = x(0);
  let axis = '';
  if (!single) {
    axis += `<path d="${scale.ticks.map((t) => `M${n1(x(t))} ${y0}V${n1(y0 + plotH)}`).join('')}" style="fill:none;stroke:${BORDER};stroke-width:1" vector-effect="non-scaling-stroke"/>`;
    axis += `<g font-size="12" text-anchor="middle" style="fill:${MUTED};font-variant-numeric:tabular-nums">${scale.ticks
      .map((t) => `<text x="${n1(x(t))}" y="${n1(y0 + plotH + 18)}">${esc(unitize(tickLabel(t, scale.step), c.unit))}</text>`)
      .join('')}</g>`;
  }
  axis += `<path d="M${n1(base)} ${y0}V${n1(y0 + plotH)}" style="fill:none;stroke:${MUTED};stroke-opacity:0.45;stroke-width:1" vector-effect="non-scaling-stroke"/>`;
  axis += `<g font-size="12" text-anchor="end" style="fill:currentColor">${c.labels
    .map((l, i) => `<text x="${n1(labelW)}" y="${n1(y0 + i * row + row / 2)}" dy="0.32em">${esc(clip(l, Math.max(labelW, width('xxx'))))}</text>`)
    .join('')}</g>`;
  let marks = '', labels = '';
  c.labels.forEach((_, i) => {
    const top = y0 + i * row + (row - group) / 2;
    c.series.forEach((s, j) => {
      const val = s.values[i], d = barPath(top + j * (thick + gap), base, x(val), thick, 4, true);
      if (d) marks += `<path d="${d}" style="fill:${seriesColor(j)}"><title>${esc(tip(c, i, s, val))}</title></path>`;
    });
    if (single) {
      const val = c.series[0].values[i];
      labels += `<text x="${n1(val < 0 ? x(val) - 6 : Math.max(x(val), base) + 6)}" y="${n1(y0 + i * row + row / 2)}" dy="0.32em"${val < 0 ? ' text-anchor="end"' : ''}>${esc(vals[i])}</text>`;
    }
  });
  if (labels) labels = `<g aria-hidden="true" font-size="12" style="fill:${MUTED};font-variant-numeric:tabular-nums">${labels}</g>`;
  return svgRoot(c, w, h, `${lg ? lg.svg : ''}<g aria-hidden="true">${axis}</g><g>${marks}</g>${labels}`, variant);
}

function arc(cx, cy, R, r, a0, a1) {
  const p = (rad, a) => `${n1(cx + rad * Math.cos(a))} ${n1(cy + rad * Math.sin(a))}`;
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    const ring = (rad, sweep) => `M${n1(cx)} ${n1(cy - rad)}A${n1(rad)} ${n1(rad)} 0 1 ${sweep} ${n1(cx)} ${n1(cy + rad)}A${n1(rad)} ${n1(rad)} 0 1 ${sweep} ${n1(cx)} ${n1(cy - rad)}Z`;
    return ring(R, 1) + (r ? ring(r, 0) : '');
  }
  // Slices over half a turn are drawn as two arcs: one large arc whose (rounded)
  // endpoints coincide, as for a 99.99% slice, would be dropped by the renderer.
  const mid = a1 - a0 > Math.PI ? [(a0 + a1) / 2] : [];
  const outer = [...mid, a1].map((a) => `A${n1(R)} ${n1(R)} 0 0 1 ${p(R, a)}`).join('');
  if (!r) return `M${p(R, a0)}${outer}L${n1(cx)} ${n1(cy)}Z`;
  const inner = [...mid, a0].map((a) => `A${n1(r)} ${n1(r)} 0 0 0 ${p(r, a)}`).join('');
  return `M${p(R, a0)}${outer}L${p(r, a1)}${inner}Z`;
}
function radial(c, legend) {
  const donut = c.type === 'donut', v = c.series[0].values, total = v.reduce((a, b) => a + b, 0);
  const size = 200, cx = 100, cy = 100, R = 96, r = donut ? 60 : 0;
  let a = -Math.PI / 2, marks = '';
  v.forEach((val, i) => {
    if (val <= 0) return;
    const a1 = a + (val / total) * Math.PI * 2;
    marks += `<path d="${arc(cx, cy, R, r, a, a1)}" fill-rule="evenodd" style="fill:${seriesColor(i)};stroke:${SURFACE};stroke-width:2;stroke-linejoin:round"><title>${esc(`${c.labels[i]}: ${unitize(full(val), c.unit)} (${pct(val, total)})`)}</title></path>`;
    a = a1;
  });
  let centre = '';
  if (donut) {
    const t = unitize(compact(total), c.unit), fs = n1(Math.min(26, (r * 2 * 0.82) / Math.max(1, chars(t).length * 0.6)));
    centre = `<g aria-hidden="true" text-anchor="middle"><text x="${cx}" y="${cy - 3}" font-size="${fs}" font-weight="600" style="fill:currentColor;letter-spacing:-0.01em">${esc(t)}</text><text x="${cx}" y="${cy + 17}" font-size="12" style="fill:${MUTED}">Total</text></g>`;
  }
  let w = size, items = '';
  if (legend) {
    const rows = c.labels.map((l, i) => [clip(l, 170), unitize(compact(v[i]), c.unit) + (c.unit === '%' ? '' : ` · ${pct(v[i], total)}`)]);
    const colW = Math.max(...rows.map(([l, s]) => width(l) + width(s) + 20)), y0 = Math.max(8, cy - (rows.length * 22) / 2);
    items = `<g aria-hidden="true" font-size="12">${rows
      .map(([l, s], i) => `<rect x="${size + 24}" y="${n1(y0 + i * 22 + 1)}" width="10" height="10" rx="3" style="fill:${seriesColor(i)}"/><text x="${size + 40}" y="${n1(y0 + i * 22 + 6)}" dy="0.32em" style="fill:currentColor">${esc(l)}</text><text x="${n1(size + 40 + colW)}" y="${n1(y0 + i * 22 + 6)}" dy="0.32em" text-anchor="end" style="fill:${MUTED};font-variant-numeric:tabular-nums">${esc(s)}</text>`)
      .join('')}</g>`;
    w = size + 40 + colW + 4;
  }
  return svgRoot(c, w, Math.max(size, legend ? c.labels.length * 22 + 16 : 0), `<g>${marks}</g>${centre}${items}`, null, legend ? {} : { style: 'display:block;width:100%;height:auto;overflow:visible' });
}
function sparkline(c) {
  const v = c.series[0].values, n = v.length, W = 120, H = 32, pad = 4;
  const lo = Math.min(...v), hi = Math.max(...v);
  const pts = v.map((val, i) => [(i * W) / (n - 1), hi === lo ? H / 2 : pad + ((hi - val) / (hi - lo)) * (H - pad * 2)]);
  const d = monotone(pts), [ex, ey] = pts[n - 1], col = seriesColor(0);
  const dot = (stroke, size) => `<path d="M${n1(ex)} ${n1(ey)}h0" style="fill:none;stroke:${stroke};stroke-width:${size};stroke-linecap:round;vector-effect:non-scaling-stroke"/>`;
  const body = `<path d="${d}L${W} ${H}L0 ${H}Z" style="fill:${col};fill-opacity:0.1;stroke:none"/><path d="${d}" style="fill:none;stroke:${col};stroke-width:2;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke"/>${dot(SURFACE, 10)}${dot(col, 6)}`;
  return `<svg${attrs({ xmlns: 'http://www.w3.org/2000/svg', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', focusable: 'false', style: 'display:block;width:100%;height:2.25rem;overflow:visible' })}><title>${esc(titleOf(c))}</title><desc>${esc(describe(c))}</desc>${body}</svg>`;
}
// One SVG for a spec. opts: { variant: 'sm'|'md'|'lg', width, height, legend = true }.
// Pie and donut are square (legend at the side when legend is true); sparklines stretch.
function chartSVG(spec, opts = {}) {
  const c = validateChart(spec), legend = opts.legend !== false;
  if (c.type === 'sparkline') return sparkline(c);
  if (c.type === 'pie' || c.type === 'donut') return radial(c, legend);
  const base = (Object.hasOwn(VARIANTS, opts.variant) && VARIANTS[opts.variant]) || VARIANTS.md;
  const v = { w: Math.min(2000, Math.max(200, Number(opts.width) || base.w)), h: Math.min(1200, Math.max(120, Number(opts.height) || base.h)), ticks: base.ticks };
  return (c.type === 'hbar' ? horizontal : cartesian)(c, v, legend, null);
}

const HIDDEN = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0';
function dataTable(c) {
  const share = c.type === 'pie' || c.type === 'donut', total = share ? c.series[0].values.reduce((a, b) => a + b, 0) : 0;
  const head = `<tr><th scope="col">Category</th>${c.series.map((s) => `<th scope="col">${esc(s.name)}</th>`).join('')}${share ? '<th scope="col">Share</th>' : ''}</tr>`;
  const rows = c.labels
    .map((l, i) => `<tr><th scope="row">${esc(l)}</th>${c.series.map((s) => `<td data-label="${esc(s.name)}">${esc(unitize(full(s.values[i]), c.unit))}</td>`).join('')}${share ? `<td data-label="Share">${esc(pct(c.series[0].values[i], total))}</td>` : ''}</tr>`)
    .join('');
  // Tables never shrink below their content, so the visually hidden box is a wrapper.
  return `<div class="sr-only" style="${HIDDEN}"><table><caption>${esc(titleOf(c))}</caption><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
}
const swatch = (i, line) => `<span style="flex:none;width:${line ? 14 : 10}px;height:${line ? 3 : 10}px;border-radius:${line ? 2 : 3}px;background:${seriesColor(i)}"></span>`;
// The block expandCharts inserts into a chart host: legend, SVG (four width
// variants for axis charts), optional caption and the hidden data table
// (opts.dataTable === false leaves the table out).
function chartHTML(spec, opts = {}) {
  const c = validateChart(spec), line = c.type === 'line' || c.type === 'area';
  let visual, legend = '';
  if (c.type === 'pie' || c.type === 'donut') {
    const v = c.series[0].values, total = v.reduce((a, b) => a + b, 0), share = c.unit !== '%';
    const items = c.labels
      .map((l, i) => `<li style="display:flex;align-items:center;gap:8px;min-width:0">${swatch(i)}<span style="flex:1 1 auto;min-width:0;overflow-wrap:anywhere">${esc(l)}</span><span style="font-weight:600;font-variant-numeric:tabular-nums">${esc(unitize(compact(v[i]), c.unit))}</span>${share ? `<span style="min-width:3.2em;text-align:right;color:${MUTED};font-variant-numeric:tabular-nums">${esc(pct(v[i], total))}</span>` : ''}</li>`)
      .join('');
    visual = `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:16px 28px"><div style="flex:0 1 200px;min-width:128px;max-width:220px">${radial(c, false)}</div><ul aria-hidden="true" style="flex:1 1 180px;min-width:0;margin:0;padding:0;list-style:none;display:grid;gap:8px;font-size:13px;line-height:1.35">${items}</ul></div>`;
  } else if (c.type === 'sparkline') visual = sparkline(c);
  else {
    const draw = c.type === 'hbar' ? horizontal : cartesian;
    visual = `<div data-forma-variants="">${Object.entries(VARIANTS).map(([id, v]) => draw(c, v, false, id)).join('')}</div>`;
    if (c.series.length > 1)
      legend = `<div aria-hidden="true" style="display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12px;line-height:1.3">${c.series
        .map((s, i) => `<span style="display:inline-flex;align-items:center;gap:6px">${swatch(i, line)}${esc(s.name)}</span>`)
        .join('')}</div>`;
  }
  const caption = c.caption ? `<p style="margin:0;font-size:12px;line-height:1.4;color:${MUTED}">${esc(c.caption)}</p>` : '';
  return `<div data-forma-generated="" class="forma-chart" data-forma-chart="${esc(c.type)}" style="position:relative;display:grid;gap:12px;min-width:0">${legend}${visual}${caption}${opts.dataTable === false ? '' : dataTable(c)}</div>`;
}
function invalidNotice(message) {
  return `<div data-forma-generated="" role="note" class="forma-chart-invalid" style="padding:12px 14px;border:1px dashed var(--danger,#d92d20);border-radius:var(--radius,8px);background:color-mix(in oklab,var(--danger,#d92d20) 7%,transparent);font-size:13px;line-height:1.45"><strong style="font-weight:600;color:var(--danger,#b42318)">Chart data invalid:</strong> ${esc(message)}</div>`;
}
// A spec title is shown above the chart: as the figure's <figcaption> when the host is a
// <figure> without an authored one (the caption also names the figure), otherwise as a
// paragraph. It is generated markup, so the inspector skips it like the drawing.
const TITLE_STYLE = 'display:block;margin:0 0 10px;font-size:0.875rem;font-weight:600;line-height:1.35;color:var(--text,currentColor);overflow-wrap:anywhere';
function titleHTML(title, figure) {
  const tag = figure ? 'figcaption' : 'p';
  return `<${tag} data-forma-generated="" class="forma-chart-title" style="${TITLE_STYLE}">${esc(title)}</${tag}>`;
}
const TABLE_PARTS = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr']);
// A drawn chart is 5–140 KB (four width variants of up to 24 labels × 6 series). A page shares
// one budget across its screens (pageHTML passes it) so the expanded page stays well under the
// renderer's 9 MB limit; hosts past the budget get a visible notice instead.
const MAX_CHARTS = 120, MAX_CHART_BYTES = 6000000;
const chartBudget = () => ({ charts: MAX_CHARTS, bytes: MAX_CHART_BYTES });
// Fill every <figure|div data-chart> with its chart (or a visible notice when the
// spec is invalid). The host keeps its attributes and children and gains
// data-forma-expanded="chart" plus data-forma-source (its original outer HTML).
// A host nested inside another host is left alone: it is already part of the
// outer host's data-forma-source (and the inspector skips it), and copying every
// level's subtree again would make the output grow quadratically.
function expandCharts(html, budget = chartBudget()) {
  html = String(html ?? '');
  if (!/data-chart/i.test(html)) return html;
  let coveredTo = -1;
  // Already expanded hosts still cover their subtree, which keeps a second pass idempotent.
  const hosts = findElements(html, (name, a) => (name === 'figure' || name === 'div') && Object.hasOwn(a, 'data-chart')).filter((el) => {
    if (el.start < coveredTo) return false;
    coveredTo = el.end;
    return !Object.hasOwn(el.attribs, 'data-forma-expanded');
  });
  const edits = hosts.map((el) => {
    let body;
    try {
      if (budget.charts <= 0 || budget.bytes <= 0) throw invalid('Too many or too large charts on one page; only the first ones are drawn.');
      budget.charts--;
      const spec = validateChart(el.attribs['data-chart']);
      // A host written directly inside a table (invalid, but model output) is foster-parented out of
      // it by the HTML parser, which would also tear a nested data <table> out of the generated block:
      // the drawing would lose its wrapper and the inspector its stored element order.
      body = chartHTML(spec, { dataTable: !TABLE_PARTS.has(el.parent) });
      if (spec.title) body = titleHTML(spec.title, el.name === 'figure' && !/<figcaption[\s>]/i.test(html.slice(el.openEnd, el.end))) + body;
      budget.bytes -= body.length;
    } catch (e) {
      body = invalidNotice(e.code === 'chart' ? e.message : 'The chart could not be drawn.');
    }
    let head = html.slice(el.start, el.openEnd - 1); // the open tag without its ">"
    if (head.endsWith('/')) head = head.slice(0, -1);
    return { start: el.start, end: el.openEnd, text: `${head}${attrs({ 'data-forma-expanded': 'chart', 'data-forma-source': html.slice(el.start, el.end) })}>${body}` };
  });
  return splice(html, edits);
}
// Presentation-time expansion of the compact model markup. Charts run first so
// a host's data-forma-source is its stored form even if it contains icons.
const expandMarkup = (html, budget) => expandIcons(expandCharts(html, budget));
// Page CSS for expanded markup. Without it charts show their 540-unit variant and
// icons sit on the text baseline. It lives in a cascade layer, so wherever it is
// placed the kit, utilities and model CSS (unlayered) override its defaults; the
// !important variant switch still wins over everything, including inline styles.
const MARKUP_CSS = `@layer forma-markup{:where(svg[data-forma-expanded="icon"]){flex-shrink:0;vertical-align:-0.125em}
:where([data-forma-expanded="chart"]){width:100%;min-width:0;margin:0}
[data-forma-variants]{container-type:inline-size}
[data-forma-variants]>svg{display:none!important}
[data-forma-variants]>[data-forma-variant="md"]{display:block!important}
@container (max-width:559.98px){[data-forma-variants]>[data-forma-variant="md"]{display:none!important}[data-forma-variants]>[data-forma-variant="sm"]{display:block!important}}
@container (max-width:399.98px){[data-forma-variants]>[data-forma-variant="sm"]{display:none!important}[data-forma-variants]>[data-forma-variant="xs"]{display:block!important}}
@container (min-width:780px){[data-forma-variants]>[data-forma-variant="md"]{display:none!important}[data-forma-variants]>[data-forma-variant="lg"]{display:block!important}}}`;

module.exports = { expandCharts, expandMarkup, chartBudget, validateChart, chartSVG, chartHTML, niceTicks, compact, tickLabel, unitize, MARKUP_CSS, CHART_TYPES: TYPES };
