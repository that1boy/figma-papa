'use strict';
const pptxgen = require('pptxgenjs');
const docx = require('docx');
const JSZip = require('jszip');
const { bodyHeight, slideGeometry, slidePalette, officeFonts, sectionNumbers, onFill, NEAR_BLACK, insideContent } = require('./slide-layout.cjs');
const { niceTicks } = require('./charts.cjs');
const { contrast } = require('./kit.cjs');
const { iconSVG } = require('./icons.cjs');
function imageDimensions(data) {
  const b = Buffer.from(data.split(',')[1], 'base64');
  if (b[0] === 137) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  let i = 2;
  while (i + 8 < b.length) {
    if (b[i] !== 255) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    i += 2;
    if (marker === 216 || marker === 217) continue;
    const n = b.readUInt16BE(i);
    if (n < 2) break;
    if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker))
      return { height: b.readUInt16BE(i + 3), width: b.readUInt16BE(i + 5) };
    i += n;
  }
  return { width: 800, height: 500 };
}
const hex = (c) => c.slice(1).toUpperCase();

// ---- Lucide icon -> native PowerPoint custom geometry (editable vector, recolourable) ----
// SVG path data (absolute or relative M L H V C S Q T A Z) becomes moveTo/lnTo/cubicBezTo points
// in inches relative to the icon box; arcs and circles are converted to cubic Béziers.
function arcToCubics(x1, y1, rx, ry, phi, large, sweep, x2, y2) {
  if (!rx || !ry) return [[x1, y1, x2, y2, x2, y2]];
  const rad = (phi * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2, xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp, den = rx * rx * yp * yp + ry * ry * xp * xp;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (k * rx * yp) / ry, cyp = (-k * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  const t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const segs = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2))), d = dt / segs, out = [];
  const pt = (t) => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  const der = (t) => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
  const a = (4 / 3) * Math.tan(d / 4);
  for (let i = 0, t = t1; i < segs; i++, t += d) {
    const [px, py] = pt(t), [qx, qy] = pt(t + d), [dx1, dy1] = der(t), [dx2, dy2] = der(t + d);
    out.push([px + a * dx1, py + a * dy1, qx - a * dx2, qy - a * dy2, qx, qy]);
  }
  return out;
}
function pathOps(d) {
  const ops = [];
  let i = 0, cmd = '', cx = 0, cy = 0, sx = 0, sy = 0, lc = null, lq = null;
  const ws = () => { while (i < d.length && /[\s,]/.test(d[i])) i++; };
  const num = () => { ws(); const m = /^[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/.exec(d.slice(i)); if (!m) throw new Error('bad path'); i += m[0].length; return Number(m[0]); };
  const flag = () => { ws(); const c = d[i++]; if (c !== '0' && c !== '1') throw new Error('bad flag'); return c === '1'; };
  while (i < d.length) {
    ws();
    if (i >= d.length) break;
    if (/[a-zA-Z]/.test(d[i])) cmd = d[i++];
    else if (!cmd || /z/i.test(cmd)) throw new Error('bad path');
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase(), ox = rel ? cx : 0, oy = rel ? cy : 0;
    if (C === 'Z') { ops.push({ t: 'Z' }); cx = sx; cy = sy; lc = lq = null; continue; }
    if (C === 'M') { cx = ox + num(); cy = oy + num(); sx = cx; sy = cy; ops.push({ t: 'M', x: cx, y: cy }); cmd = rel ? 'l' : 'L'; lc = lq = null; continue; }
    if (C === 'L') { cx = ox + num(); cy = oy + num(); ops.push({ t: 'L', x: cx, y: cy }); lc = lq = null; }
    else if (C === 'H') { cx = ox + num(); ops.push({ t: 'L', x: cx, y: cy }); lc = lq = null; }
    else if (C === 'V') { cy = oy + num(); ops.push({ t: 'L', x: cx, y: cy }); lc = lq = null; }
    else if (C === 'C' || C === 'S') {
      const [x1, y1] = C === 'C' ? [ox + num(), oy + num()] : lc ? [2 * cx - lc[0], 2 * cy - lc[1]] : [cx, cy];
      const x2 = ox + num(), y2 = oy + num(), x = ox + num(), y = oy + num();
      ops.push({ t: 'C', x1, y1, x2, y2, x, y }); lc = [x2, y2]; lq = null; cx = x; cy = y;
    } else if (C === 'Q' || C === 'T') {
      const [qx, qy] = C === 'Q' ? [ox + num(), oy + num()] : lq ? [2 * cx - lq[0], 2 * cy - lq[1]] : [cx, cy];
      const x = ox + num(), y = oy + num();
      ops.push({ t: 'C', x1: cx + (2 / 3) * (qx - cx), y1: cy + (2 / 3) * (qy - cy), x2: x + (2 / 3) * (qx - x), y2: y + (2 / 3) * (qy - y), x, y }); lq = [qx, qy]; lc = null; cx = x; cy = y;
    } else if (C === 'A') {
      const rx = num(), ry = num(), phi = num(), large = flag(), sweep = flag(), x = ox + num(), y = oy + num();
      for (const [x1, y1, x2, y2, ex, ey] of arcToCubics(cx, cy, rx, ry, phi, large, sweep, x, y)) ops.push({ t: 'C', x1, y1, x2, y2, x: ex, y: ey });
      cx = x; cy = y; lc = lq = null;
    } else throw new Error('bad path');
  }
  return ops;
}
const K = 0.5522847498;
function ellipseOps(cx, cy, rx, ry) {
  return [{ t: 'M', x: cx + rx, y: cy }, { t: 'C', x1: cx + rx, y1: cy + ry * K, x2: cx + rx * K, y2: cy + ry, x: cx, y: cy + ry }, { t: 'C', x1: cx - rx * K, y1: cy + ry, x2: cx - rx, y2: cy + ry * K, x: cx - rx, y: cy }, { t: 'C', x1: cx - rx, y1: cy - ry * K, x2: cx - rx * K, y2: cy - ry, x: cx, y: cy - ry }, { t: 'C', x1: cx + rx * K, y1: cy - ry, x2: cx + rx, y2: cy - ry * K, x: cx + rx, y: cy }, { t: 'Z' }];
}
function iconShapes(name) {
  const inner = iconSVG(name).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, ''), ops = [];
  for (const m of inner.matchAll(/<(\w+)((?:\s+[\w-]+="[^"]*")*)\s*\/>/g)) {
    const at = Object.fromEntries([...m[2].matchAll(/([\w-]+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
    const n = (k) => Number(at[k] || 0);
    try {
      if (m[1] === 'path') ops.push(...pathOps(at.d || ''));
      else if (m[1] === 'circle') ops.push(...ellipseOps(n('cx'), n('cy'), n('r'), n('r')));
      else if (m[1] === 'ellipse') ops.push(...ellipseOps(n('cx'), n('cy'), n('rx'), n('ry')));
      else if (m[1] === 'line') ops.push({ t: 'M', x: n('x1'), y: n('y1') }, { t: 'L', x: n('x2'), y: n('y2') });
      else if (m[1] === 'polyline' || m[1] === 'polygon') {
        const p = (at.points || '').trim().split(/[\s,]+/).map(Number);
        for (let k = 0; k + 1 < p.length; k += 2) ops.push({ t: k ? 'L' : 'M', x: p[k], y: p[k + 1] });
        if (m[1] === 'polygon') ops.push({ t: 'Z' });
      } else if (m[1] === 'rect') {
        const x = n('x'), y = n('y'), w = n('width'), h = n('height'), r = Math.min(Number(at.rx ?? at.ry ?? 0), w / 2, h / 2);
        if (!r) ops.push({ t: 'M', x, y }, { t: 'L', x: x + w, y }, { t: 'L', x: x + w, y: y + h }, { t: 'L', x, y: y + h }, { t: 'Z' });
        else {
          const c = (x1, y1, x2, y2) => arcToCubics(x1, y1, r, r, 0, false, true, x2, y2).map(([a, b, c2, d, ex, ey]) => ({ t: 'C', x1: a, y1: b, x2: c2, y2: d, x: ex, y: ey }));
          ops.push({ t: 'M', x: x + r, y }, { t: 'L', x: x + w - r, y }, ...c(x + w - r, y, x + w, y + r), { t: 'L', x: x + w, y: y + h - r }, ...c(x + w, y + h - r, x + w - r, y + h), { t: 'L', x: x + r, y: y + h }, ...c(x + r, y + h, x, y + h - r), { t: 'L', x, y: y + r }, ...c(x, y + r, x + r, y), { t: 'Z' });
        }
      }
    } catch { /* skip a malformed element rather than the whole icon */ }
  }
  // Zero-length subpaths ("M12 8h.01") are round-capped dots in SVG; draw them as small discs.
  const strokes = [], dots = [];
  let sub = [];
  const flush = () => {
    if (!sub.length) return;
    const xs = sub.flatMap((o) => (o.t === 'Z' ? [] : [o.x])), ys = sub.flatMap((o) => (o.t === 'Z' ? [] : [o.y]));
    if (Math.max(...xs) - Math.min(...xs) < 0.2 && Math.max(...ys) - Math.min(...ys) < 0.2) dots.push({ x: xs[0], y: ys[0] });
    else strokes.push(...sub);
    sub = [];
  };
  for (const o of ops) { if (o.t === 'M') flush(); sub.push(o); }
  flush();
  return { strokes, dots };
}
function addIcon(slide, p, color) {
  const { strokes, dots } = iconShapes(p.name), s = p.w / 24, r = (v) => Math.round(v * s * 10000) / 10000;
  const points = strokes.map((o) => (o.t === 'Z' ? { close: true } : o.t === 'M' ? { x: r(o.x), y: r(o.y), moveTo: true } : o.t === 'L' ? { x: r(o.x), y: r(o.y) } : { x: r(o.x), y: r(o.y), curve: { type: 'cubic', x1: r(o.x1), y1: r(o.y1), x2: r(o.x2), y2: r(o.y2) } }));
  if (points.length) slide.addShape('custGeom', { x: p.x, y: p.y, w: p.w, h: p.h, points, line: { color, width: Math.round(2 * s * 72 * 100) / 100 }, objectName: `Icon ${p.name}` });
  for (const d of dots) slide.addShape('ellipse', { x: p.x + d.x * s - s, y: p.y + d.y * s - s, w: 2 * s, h: 2 * s, fill: { color }, line: { color, transparency: 100 }, objectName: `Icon dot ${p.name}` });
}
// pptxgenjs has no line cap/join options; give icon strokes Lucide's round caps and joins.
async function roundIconStrokes(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  let changed = false;
  for (const name of Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
    const xml = await zip.file(name).async('string');
    const next = xml.replace(/(<p:sp>(?:(?!<\/p:sp>)[\s\S])*?name="Icon (?!dot )[^"]*"(?:(?!<\/p:sp>)[\s\S])*?)<a:ln w="(\d+)">((?:(?!<\/a:ln>)[\s\S])*?)<\/a:ln>/g, (_, head, w, body) => `${head}<a:ln w="${w}" cap="rnd">${body}<a:round/></a:ln>`);
    if (next !== xml) { zip.file(name, next); changed = true; }
  }
  return changed ? zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) : buffer;
}

// ---- native charts ----
const CHART_TYPES = { bar: 'bar', hbar: 'bar', 'stacked-bar': 'bar', line: 'line', area: 'area', sparkline: 'line', pie: 'pie', donut: 'doughnut' };
const PREFIX_UNIT = /^(?:[$€£¥₹₩₽₺₫₦₱฿₴₪¢]|[A-Z]{1,3}\$|R\$)$/;
function numberFormat(c) {
  const values = c.series.flatMap((s) => s.values);
  const decimals = Math.min(2, Math.max(0, ...values.map((v) => (String(v).split('.')[1] || '').length)));
  const base = decimals ? `#,##0.${'0'.repeat(decimals)}` : '#,##0';
  const unit = String(c.unit || '').replace(/["\\<>&]/g, '');
  if (!unit) return base;
  return PREFIX_UNIT.test(unit) ? `"${unit}"${base}` : `${base}${unit === '%' ? '"%"' : `" ${unit}"`}`;
}
function addChart(slide, p, P, fonts) {
  const c = p.chart, radial = c.type === 'pie' || c.type === 'donut', spark = c.type === 'sparkline';
  const colors = P.chart.map(hex), fmt = numberFormat(c), muted = hex(P.muted), line = hex(P.line), text = hex(P.text);
  // The same value axis as the preview (lib/charts.cjs cartesian scale).
  const values = c.series.flatMap((s) => s.values), stacked = c.type === 'stacked-bar', bars = stacked || c.type === 'bar' || c.type === 'hbar';
  let lo = stacked ? 0 : Math.min(...values), hi = stacked ? Math.max(...c.labels.map((_, i) => c.series.reduce((t, s) => t + s.values[i], 0))) : Math.max(...values);
  const zoom = !bars && c.type !== 'area' && ((lo > 0 && lo > hi * 0.5) || (hi < 0 && hi < lo * 0.5));
  if (!zoom) [lo, hi] = [Math.min(lo, 0), Math.max(hi, 0)];
  const scale = radial || spark ? null : niceTicks(lo, hi, 5, values.every(Number.isInteger));
  // Slice labels sit on the slice colours: white when every slice reads with it, else near-black.
  const sliceText = radial ? (c.labels.every((_, i) => contrast('#ffffff', P.chart[i % P.chart.length]) >= 4.5) ? 'FFFFFF' : hex(NEAR_BLACK)) : text;
  slide.addChart(CHART_TYPES[c.type], c.series.map((s) => ({ name: s.name, labels: c.labels, values: s.values })), {
    x: p.x, y: p.y, w: p.w, h: p.h,
    chartColors: radial ? c.labels.map((_, i) => colors[i % colors.length]) : colors.slice(0, c.series.length),
    ...(scale ? { valAxisMinVal: scale.min, valAxisMaxVal: scale.max, valAxisMajorUnit: scale.step } : {}),
    barDir: c.type === 'hbar' ? 'bar' : 'col',
    barGrouping: c.type === 'stacked-bar' ? 'stacked' : 'clustered',
    barGapWidthPct: c.series.length === 1 ? 180 : 80, barOverlapPct: c.type === 'stacked-bar' ? 100 : -10,
    showLegend: radial || c.series.length > 1, legendPos: radial ? 'r' : 't', legendFontFace: fonts.body, legendFontSize: 12, legendColor: text,
    catAxisLabelColor: muted, valAxisLabelColor: muted, catAxisLabelFontFace: fonts.body, valAxisLabelFontFace: fonts.body,
    catAxisLabelFontSize: 12, valAxisLabelFontSize: 12,
    catAxisLineShow: !spark, catAxisLineColor: line, valAxisLineShow: false,
    catAxisMajorTickMark: 'none', valAxisMajorTickMark: 'none',
    valGridLine: spark ? { style: 'none' } : { color: line, size: 0.75 }, catGridLine: { style: 'none' },
    catAxisHidden: spark, valAxisHidden: spark,
    valAxisLabelFormatCode: fmt, dataLabelFormatCode: radial ? '0%' : fmt,
    showValue: (c.type === 'bar' || c.type === 'hbar') && c.series.length === 1 && c.labels.length <= 12, showPercent: radial, showLeaderLines: false, dataLabelColor: sliceText, dataLabelFontSize: 12, dataLabelFontBold: radial, dataLabelFontFace: fonts.body,
    dataLabelPosition: c.type === 'pie' ? 'bestFit' : undefined,
    lineSize: 2.5, lineDataSymbol: c.labels.length <= 16 && !spark ? 'circle' : 'none', lineDataSymbolSize: 7,
    holeSize: 62, showTitle: false,
  });
}

// ---- PowerPoint ----
async function exportPPTX(a, refs = []) {
  const pptx = new pptxgen();
  const fonts = officeFonts(a), P = slidePalette(a), numbers = sectionNumbers(a.slides);
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Design Pilot';
  pptx.subject = a.summary;
  pptx.title = a.title;
  pptx.company = 'Internal pilot';
  pptx.lang = 'en-US';
  pptx.theme = { headFontFace: fonts.heading, bodyFontFace: fonts.body, lang: 'en-US' };
  const accent = a.theme.accent.slice(1),
    text = a.theme.text.slice(1),
    onAccent = hex(onFill(a.theme.accent));
  let icons = false;
  for (const [index, s] of a.slides.entries()) {
    const slide = pptx.addSlide();
    const geo = slideGeometry(s, { section: numbers[index] }), section = geo.section;
    slide.background = { color: section ? accent : a.theme.background.slice(1) };
    const add = (value, opts) =>
      slide.addText(value, {
        fontFace: fonts.body,
        fontSize: 20,
        color: text,
        margin: 0,
        breakLine: false,
        fit: 'shrink',
        ...opts,
      });
    add(a.title.toUpperCase(), {
      x: 0.7,
      y: 0.35,
      w: 11.9,
      h: 0.25,
      fontSize: 11,
      color: section ? onAccent : accent,
      charSpacing: 1.5,
    });
    const { cover, title, subtitle, content } = geo;
    slide.addShape(pptx.ShapeType.rect, { x: 0.7, y: 0.77, w: 0.6, h: 0.045, fill: { color: section ? onAccent : accent }, line: { color: accent, transparency: 100 } });
    // Decorative parts outside the content box (section number, quote mark) sit behind the title.
    const color = (k) => hex(P[k]);
    const drawPart = (p) => {
      if (p.type === 'rect' || p.type === 'ellipse')
        slide.addShape(p.type === 'ellipse' ? 'ellipse' : p.radius ? 'roundRect' : 'rect', {
          x: p.x, y: p.y, w: p.w, h: p.h, fill: { color: color(p.fill) },
          line: p.line ? { color: color(p.line), width: p.lineWidth || 1 } : { color: color(p.fill), transparency: 100 },
          ...(p.radius ? { rectRadius: p.radius } : {}),
        });
      else if (p.type === 'text' && p.runs)
        add(p.runs.map((r, i) => ({ text: r.text, options: { fontSize: r.pt, bold: !!r.bold, color: color(r.color || p.color), breakLine: i < p.runs.length - 1, ...(i && r.gap ? { paraSpaceBefore: Math.round(r.gap * 72) } : {}) } })), {
          x: p.x, y: p.y, w: p.w, h: p.h, valign: p.valign || 'top', fontFace: fonts.body,
        });
      else if (p.type === 'text')
        add(p.text, {
          x: p.x, y: p.y, w: p.w, h: p.h, fontSize: p.pt, bold: !!p.bold, color: color(p.color),
          fontFace: p.font === 'heading' ? fonts.heading : p.font === 'serif' ? 'Georgia' : fonts.body,
          align: p.align || 'left', valign: p.valign || 'top',
          ...(p.spacing ? { charSpacing: p.spacing } : {}),
          ...(p.lh && p.lh !== 1.25 ? { lineSpacingMultiple: p.lh / 1.2 } : {}),
          ...(p.nowrap ? { wrap: false } : {}),
        });
      else if (p.type === 'icon') { addIcon(slide, p, color(p.color)); icons = true; }
      else if (p.type === 'chart') addChart(slide, p, P, fonts);
    };
    const inside = (p) => insideContent(p, content);
    geo.parts.filter((p) => !inside(p)).forEach(drawPart);
    add(s.title, {
      ...title,
      fontFace: fonts.heading,
      bold: true,
      valign: section ? 'bottom' : 'mid',
      ...(section ? { color: onAccent } : {}),
    });
    if (s.subtitle)
      add(s.subtitle, {
        ...subtitle,
        ...(section ? { color: onAccent } : {}),
      });
    if (geo.parts.length) geo.parts.filter(inside).forEach(drawPart);
    else if (s.layout === 'two-column') {
      s.columns.forEach((c, j) => {
        const x = 0.7 + j * 6.05;
        add(c.heading, { x, y: content.y, w: 5.5, h: 0.65, fontSize: 24, color: accent, bold: true, fontFace: fonts.heading });
        let y = content.y + 0.85;
        if (c.body) {
          const h = Math.min(bodyHeight(c.body, 5.5, 19), c.bullets.length ? 1.5 : 6.65 - y);
          add(c.body, { x, y, w: 5.5, h, fontSize: 19 });
          y += h + 0.2;
        }
        if (c.bullets.length)
          add(
            c.bullets.map((t) => ({
              text: t,
              options: { bullet: { indent: 18 }, breakLine: true },
            })),
            { x, y, w: 5.5, h: 6.65 - y, fontSize: 18, paraSpaceAfterPt: 10 },
          );
      });
    } else if (s.layout === 'table') {
      const intro = s.body ? Math.min(1, bodyHeight(s.body, content.w, 18)) + 0.18 : 0;
      const footer = s.bullets.length ? Math.min(1.6, s.bullets.length * 0.3 + 0.15) : 0;
      if (s.body) add(s.body, { x: content.x, y: content.y, w: content.w, h: intro - 0.18, fontSize: 18 });
      slide.addTable(
        [
          s.table.headers.map((text) => ({
            text,
            options: { bold: true, color: onAccent, fill: accent },
          })),
          ...s.table.rows,
        ],
        {
          x: 0.7,
          y: content.y + intro,
          w: 11.9,
          h: content.h - intro - footer,
          fontFace: fonts.body,
          fontSize: s.table.headers.length >= 5 || s.table.rows.length > 5 ? 13 : 16,
          color: text,
          border: { type: 'solid', pt: 0.5, color: 'DDDDE3' },
          margin: 0.12,
          fill: a.theme.background.slice(1),
          rowH: 0.4,
          autoPage: false,
        },
      );
      if (s.bullets.length) add(s.bullets.map((t) => ({ text: t, options: { bullet: { indent: 14 }, breakLine: true } })), { x: content.x, y: 6.65 - footer + 0.15, w: content.w, h: footer - 0.15, fontSize: 14 });
    } else if (s.layout === 'image') {
      const ref = refs[s.imageIndex];
      if (ref) {
        const d = imageDimensions(ref.data);
        const factor = Math.min(6 / d.width, content.h / d.height);
        slide.addImage({
          data: ref.data,
          x: 0.7,
          y: content.y,
          w: d.width * factor,
          h: d.height * factor,
        });
      }
      const textHeight = s.bullets.length ? Math.min(content.h * 0.45, bodyHeight(s.body, 5.2, 22)) : content.h;
      if (s.body) add(s.body, { x: 7.25, y: content.y, w: 5.2, h: textHeight, fontSize: 22 });
      if (s.bullets.length) {
        const y = content.y + (s.body ? textHeight + 0.2 : 0);
        add(s.bullets.map(t => ({text:t,options:{bullet:{indent:18},breakLine:true}})), {x:7.25,y,w:5.2,h:6.65-y,fontSize:20,paraSpaceAfterPt:10});
      }
    } else {
      // Cover and bullets slides show body and bullets only; tables appear on table slides
      // (the HTML preview matches, and warnings() flags a table on another layout).
      let y = content.y;
      const split = !cover && s.body && s.bullets.length;
      if (s.body) {
        const w = split ? 3.6 : content.w;
        const h = split ? content.h : Math.min(bodyHeight(s.body, w, cover ? 23 : 20), s.bullets.length ? content.h * 0.45 : content.h);
        add(s.body, { x: content.x, y, w, h, fontSize: split ? 24 : cover ? 23 : 20, color: split ? accent : text });
        if (!split) y += h + 0.25;
      }
      if (s.bullets.length)
        add(
          s.bullets.map((t) => ({ text: t, options: { bullet: { indent: 21 }, breakLine: true } })),
          { x: split ? 4.8 : 0.85, y, w: split ? 7.6 : 11.2, h: 6.65 - y, fontSize: 22, paraSpaceAfterPt: 14 },
        );
    }
    add(String(index + 1).padStart(2, '0'), {
      x: 0.7,
      y: 7,
      w: 1,
      h: 0.2,
      fontSize: 10,
      color: section ? onAccent : '777777',
    });
    if (s.notes) slide.addNotes(s.notes);
  }
  const out = Buffer.from(await pptx.write({ outputType: 'nodebuffer' }));
  return icons ? roundIconStrokes(out) : out;
}

// ---- Word ----
// Text with "\n" becomes runs separated by line breaks.
function runs(text, opts = {}) {
  return String(text ?? '').split('\n').map((line, i) => new docx.TextRun({ ...opts, text: line, ...(i ? { break: 1 } : {}) }));
}
async function exportDOCX(a, refs = []) {
  const {
    Document,
    Paragraph,
    Table,
    TableRow,
    TableCell,
    WidthType,
    HeadingLevel,
    Packer,
    ImageRun,
  } = docx;
  const fonts = officeFonts(a), headerText = hex(onFill(a.theme.accent)), muted = hex(slidePalette(a).muted);
  const children = [
    new Paragraph({ children: runs(a.title), heading: HeadingLevel.TITLE }),
    ...(a.subtitle ? [new Paragraph({ children: runs(a.subtitle), style: 'Subtitle' })] : []),
  ];
  for (const b of a.blocks) {
    if (b.type === 'heading')
      children.push(new Paragraph({ children: runs(b.text), heading: HeadingLevel.HEADING_1 }));
    else if (b.type === 'paragraph')
      children.push(
        new Paragraph({ children: runs(b.text), spacing: { after: 120, line: 264 }, widowControl: true }),
      );
    else if (b.type === 'bullets')
      children.push(
        ...b.items.map(
          (text) => new Paragraph({ children: runs(text), bullet: { level: 0 }, spacing: { after: 80, line: 264 }, widowControl: true }),
        ),
      );
    else if (b.type === 'table')
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [b.table.headers, ...b.table.rows].map(
            (row, i) =>
              new TableRow({
                tableHeader: i === 0,
                cantSplit: true,
                children: row.map(
                  (text) =>
                    new TableCell({
                      shading: i === 0 ? { fill: a.theme.accent.slice(1) } : undefined,
                      margins: { top: 85, bottom: 85, left: 110, right: 110 },
                      children: [
                        new Paragraph({
                          spacing: { before: 0, after: 0, line: 240 },
                          children: runs(text, {
                            bold: i === 0,
                            color: i === 0 ? headerText : a.theme.text.slice(1),
                            size: 21,
                          }),
                        }),
                      ],
                    }),
                ),
              }),
          ),
        }),
      );
    else if (b.type === 'image' && refs[b.imageIndex]) {
      const data = refs[b.imageIndex].data,
        d = imageDimensions(data),
        factor = Math.min(540 / d.width, 430 / d.height);
      children.push(
        new Paragraph({
          keepNext: !!b.text,
          children: [
            new ImageRun({
              data: Buffer.from(data.split(',')[1], 'base64'),
              type: data.startsWith('data:image/png') ? 'png' : 'jpg',
              transformation: {
                width: Math.round(d.width * factor),
                height: Math.round(d.height * factor),
              },
              altText: {
                title: b.text || 'Reference image',
                description: b.text || refs[b.imageIndex].name,
                name: 'Reference image',
              },
            }),
          ],
        }),
      );
      if (b.text) children.push(new Paragraph({ children: runs(b.text), style: 'Caption' }));
    }
  }
  const document = new Document({
    creator: 'Design Pilot',
    title: a.title,
    description: a.summary,
    styles: {
      default: {
        document: {
          run: { font: fonts.body, size: 22, color: a.theme.text.slice(1) },
          paragraph: { spacing: { after: 120, line: 264 }, widowControl: true },
        },
      },
      paragraphStyles: [
        {
          id: 'Title',
          name: 'Title',
          basedOn: 'Normal',
          next: 'Normal',
          run: { font: fonts.heading, size: 48, bold: true, color: a.theme.text.slice(1) },
          paragraph: { spacing: { after: 140 }, keepNext: true },
        },
        {
          id: 'Subtitle', name: 'Subtitle', basedOn: 'Normal', next: 'Normal',
          run: { font: fonts.body, size: 24, color: a.theme.text.slice(1) },
          paragraph: { spacing: { after: 180 }, keepNext: true },
        },
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: fonts.heading, size: 28, bold: true, color: a.theme.accent.slice(1) },
          paragraph: { spacing: { before: 200, after: 100 }, keepNext: true },
        },
        {
          id: 'Caption', name: 'Caption', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: fonts.body, size: 18, italics: true, color: muted },
          paragraph: { spacing: { before: 60, after: 200 } },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
          },
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(document);
}
module.exports = { exportPPTX, exportDOCX, imageDimensions, numberFormat, iconShapes };
