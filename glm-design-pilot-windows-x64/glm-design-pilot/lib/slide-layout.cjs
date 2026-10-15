'use strict';
// Slide geometry shared by the HTML preview (lib/presentation.cjs, 90 px per inch, 1.25 px per
// point) and the native PowerPoint export (lib/exports.cjs). Inches in a 16:9 (13.333 x 7.5) slide.
// The 0.2 layouts (cover, bullets, two-column, table, image) keep their own renderers and only use
// slideLayout(); the v2 layouts are described here as a flat list of parts that both renderers draw
// one-to-one: { type: 'text'|'rect'|'ellipse'|'icon'|'chart', x, y, w, h, ... } with colours named
// by palette key, so the preview and the PPTX cannot drift apart.
const { derive, mix, contrast } = require('./kit.cjs');
const { FONTS } = require('./presets.cjs');

const V2_LAYOUTS = ['section', 'quote', 'stats', 'timeline', 'cards', 'chart', 'agenda'];
const SLIDE_LAYOUTS = ['cover', 'bullets', 'two-column', 'table', 'image', ...V2_LAYOUTS];
const LEFT = 0.7, WIDTH = 11.9, BOTTOM = 6.65, LH = 1.25;

function slideLayout(s) {
  if (s.layout === 'section') {
    const title = { x: LEFT, y: 1.55, w: 9.4, h: 2.75, fontSize: fit(s.title, 9.4, 2.75, 46, 30, true).pt };
    const subtitle = { x: LEFT, y: 4.5, w: 9.4, h: 0.65, fontSize: 22 };
    const top = s.subtitle ? 5.33 : 4.5;
    return { title, subtitle, content: { x: LEFT, y: top, w: 9.4, h: BOTTOM - top }, cover: false, section: true };
  }
  const cover = s.layout === 'cover';
  const title = { x: 0.7, y: cover ? 1.35 : 0.95, w: 11.9, h: cover ? 1.65 : 1.05, fontSize: cover ? 40 : 30 };
  const subtitle = { x: 0.7, y: title.y + title.h + 0.14, w: 11.9, h: 0.65, fontSize: 20 };
  const top = s.subtitle ? subtitle.y + subtitle.h + 0.24 : title.y + title.h + 0.24;
  return { title, subtitle, content: { x: 0.7, y: top, w: 11.9, h: 6.65 - top }, cover };
}

function bodyHeight(text, width, fontSize = 20) {
  const chars = Math.max(10, Math.floor(width * 72 / (fontSize * 0.52)));
  const lines = String(text).split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / chars)), 0);
  return lines * fontSize * 1.25 / 72 + 0.08;
}

// ---- text measurement (conservative average advance widths for Arial-like office fonts) ----
function lineCount(text, w, pt, bold = false) {
  const per = Math.max(4, Math.floor((w * 72) / (pt * (bold ? 0.57 : 0.52))));
  let n = 0;
  for (const para of String(text ?? '').split('\n')) {
    let used = 0, count = 1;
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let len = word.length;
      if (used && used + 1 + len <= per) { used += 1 + len; continue; }
      if (used) count++;
      while (len > per) { count++; len -= per; }
      used = len;
    }
    n += count;
  }
  return n;
}
const textHeight = (text, w, pt, bold = false, lh = LH) => (lineCount(text, w, pt, bold) * pt * lh) / 72;
// Largest point size in [min, max] whose wrapped text fits h; `fits` is false when even min overflows.
function fit(text, w, h, max, min, bold = false, lh = LH) {
  for (let pt = max; pt >= min; pt--) {
    const th = textHeight(text, w, pt, bold, lh);
    if (th <= h) return { pt, h: th, fits: true };
  }
  return { pt: min, h: textHeight(text, w, min, bold, lh), fits: false };
}
const round = (v) => Math.round(v * 1000) / 1000;

// ---- colours: theme -> named palette (hex), shared by preview, PPTX and DOCX ----
const NEAR_BLACK = '#111111';
// Text on a filled colour: white when it reaches 4.5:1, otherwise whichever of white and near-black reads better.
function onFill(bg) {
  const white = contrast('#ffffff', bg);
  return white >= 4.5 || white >= contrast(NEAR_BLACK, bg) ? '#ffffff' : NEAR_BLACK;
}
function readableOn(fg, toward, bgs) {
  for (let p = 1; p >= 0; p -= 0.05) { const c = mix(fg, toward, p); if (bgs.every((b) => contrast(c, b) >= 4.5)) return c; }
  return toward;
}
function slidePalette(a) {
  const theme = a.theme || {}, ds = a.designSystem || {};
  const d = derive({ ...(ds.accent2 ? { accent2: ds.accent2 } : {}), accent: theme.accent || '#6554c0', background: theme.background || '#faf9f6', text: theme.text || '#202333' });
  const t = d.tokens, accent = t.accent, background = t.background, text = t.text;
  const panel = mix(accent, background, 0.065), soft = mix(accent, background, 0.15);
  const onAccent = onFill(accent);
  // Muted copy must still read on the tinted panels it sits on.
  const muted = readableOn(t.muted, text, [background, panel]);
  return {
    accent, background, text, muted, panel, soft, onAccent,
    accentText: readableOn(accent, text, [background, panel]),
    line: mix(text, background, 0.14),
    onAccentSoft: mix(onAccent, accent, 0.82),
    onAccentFaint: mix(onAccent, accent, 0.3),
    chart: d.chart,
  };
}
// Office font names: FONTS[family].office when the design system names a family, else Arial.
function officeFonts(a) {
  const ds = a.designSystem || {}, theme = a.theme || {};
  const pick = (k) => (k && Object.hasOwn(FONTS, k) ? FONTS[k].office || 'Arial' : null);
  const body = pick(ds.bodyFont) || pick(ds.font) || pick(theme.font) || 'Arial';
  return { heading: pick(ds.headingFont) || body, body };
}
// 1-based section number for every slide index (0 for non-section slides).
function sectionNumbers(slides) {
  let n = 0;
  return slides.map((s) => (s.layout === 'section' ? ++n : 0));
}

// ---- v2 layouts ----
const text = (x, y, w, h, value, pt, more = {}) => ({ type: 'text', x: round(x), y: round(y), w: round(w), h: round(h), text: value, pt, color: 'text', ...more });
const rect = (x, y, w, h, fill, more = {}) => ({ type: 'rect', x: round(x), y: round(y), w: round(w), h: round(h), fill, ...more });
// Optional takeaway line above a v2 layout's main content.
function intro(s, C, parts) {
  if (!s.body) return { y: C.y + 0.05, fits: true };
  const f = fit(s.body, C.w, 1.15, 20, 15);
  parts.push(text(C.x, C.y, C.w, f.h, s.body, f.pt, { role: 'intro', tag: 'p' }));
  return { y: C.y + f.h + 0.32, fits: f.fits };
}
const columns = (n, w, gap) => (w - gap * (n - 1)) / n;
// Several paragraphs in one text box (heading + detail), so both renderers flow them naturally.
const stack = (x, y, w, h, runs, more = {}) => ({ type: 'text', x: round(x), y: round(y), w: round(w), h: round(h), runs: runs.filter((r) => r.text), color: 'text', ...more });
const stackHeight = (runs, w) => runs.filter((r) => r.text).reduce((sum, r, i) => sum + (i ? r.gap || 0 : 0) + textHeight(r.text, w, r.pt, r.bold), 0);
// Optical centring: a short block sits a little above the middle of the content area.
function settle(parts, C, s) {
  if (s.body) return; // an intro line anchors the block under the title
  const bottom = Math.max(...parts.map((p) => p.y + p.h)), dy = round(Math.max(0, (C.y + C.h - bottom) * 0.4));
  if (dy > 0.05) for (const p of parts) p.y = round(p.y + dy);
}
function stats(s, C, parts) {
  const head = intro(s, C, parts), n = s.stats.length, gap = 0.3, cw = columns(n, C.w, gap), pad = 0.34, iw = cw - pad * 2;
  const avail = C.y + C.h - head.y;
  const maxValue = n === 4 ? 46 : 54, labelPt = n === 4 ? 16 : 18;
  const longest = Math.max(...s.stats.map((x) => x.value.length));
  const valuePt = Math.max(26, Math.min(maxValue, Math.floor((iw * 72) / (Math.max(2, longest) * 0.66))));
  const valueH = (valuePt * 1.18) / 72, fixed = pad * 2 + 0.2 + valueH + 0.14;
  let detailPt = n === 4 ? 13 : 14;
  const runs = (x, dp) => [{ text: x.label, pt: labelPt, bold: true, tag: 'h2' }, { text: x.detail, pt: dp, color: 'muted', gap: 0.1, tag: 'p' }];
  const need = (dp) => Math.max(...s.stats.map((x) => stackHeight(runs(x, dp), iw)));
  while (detailPt > 11 && fixed + need(detailPt) > avail) detailPt--;
  const fits = head.fits && fixed + need(detailPt) <= avail + 0.01;
  const cardH = Math.min(avail, Math.max(2.1, fixed + need(detailPt) + 0.08));
  s.stats.forEach((st, i) => {
    const x = C.x + i * (cw + gap), y = head.y, vy = y + pad + 0.2;
    parts.push(rect(x, y, cw, cardH, 'panel', { radius: 0.14, role: 'card' }));
    parts.push(rect(x + pad, y + pad, 0.42, 0.055, 'accent', { role: 'rule' }));
    parts.push(text(x + pad, vy, iw, valueH, st.value, valuePt, { color: 'accentText', bold: true, font: 'heading', role: 'stat-value', nowrap: true, spacing: -Math.round(valuePt * 0.2) / 10 }));
    parts.push(stack(x + pad, vy + valueH + 0.14, iw, Math.max(0.3, y + cardH - pad - (vy + valueH + 0.14)), runs(st, detailPt), { role: 'stat-text' }));
  });
  settle(parts, C, s);
  return fits;
}
function timeline(s, C, parts) {
  const head = intro(s, C, parts), n = s.steps.length, gap = 0.3, cw = columns(n, C.w, gap), tw = cw - 0.1;
  const labels = s.steps.map((st, i) => (st.label || String(i + 1).padStart(2, '0')).toUpperCase());
  const labelH = Math.max(...labels.map((l) => textHeight(l, cw, 12, true)));
  const ty = head.y + labelH + 0.3, dot = 0.26, top = ty + 0.38, avail = C.y + C.h - top;
  let titlePt = n <= 4 ? 20 : n === 5 ? 18 : 16, detailPt = n <= 4 ? 15 : 13;
  const runs = (st) => [{ text: st.title, pt: titlePt, bold: true, tag: 'h2' }, { text: st.detail, pt: detailPt, color: 'muted', gap: 0.1, tag: 'p' }];
  const need = () => Math.max(...s.steps.map((st) => stackHeight(runs(st), tw)));
  while (need() > avail && (titlePt > 13 || detailPt > 11)) { if (detailPt > 11) detailPt--; if (titlePt > 13 && need() > avail) titlePt--; }
  const fits = head.fits && need() <= avail + 0.01, h = Math.min(avail, need() + 0.15);
  parts.push(rect(C.x, ty - 0.015, C.w, 0.03, 'line', { role: 'track' }));
  s.steps.forEach((st, i) => {
    const x = C.x + i * (cw + gap);
    parts.push(text(x, head.y, cw, labelH, labels[i], 12, { color: 'accentText', bold: true, spacing: 1, role: 'step-label' }));
    parts.push({ type: 'ellipse', x: round(x), y: round(ty - dot / 2), w: dot, h: dot, fill: 'accent', line: 'background', lineWidth: 3, role: 'dot' });
    parts.push(stack(x, top, tw, h, runs(st), { role: 'step-text' }));
  });
  settle(parts, C, s);
  return fits;
}
function cards(s, C, parts) {
  const head = intro(s, C, parts), n = s.cards.length, gap = 0.3, cw = columns(n, C.w, gap), pad = 0.36, iw = cw - pad * 2, tile = 0.66;
  const avail = C.y + C.h - head.y, fixed = pad * 2 + tile + 0.28;
  let titlePt = n === 4 ? 18 : 20, bodyPt = n === 4 ? 14 : 15;
  const runs = (c) => [{ text: c.title, pt: titlePt, bold: true, tag: 'h2' }, { text: c.body, pt: bodyPt, color: 'muted', gap: 0.12, tag: 'p' }];
  const need = () => fixed + Math.max(...s.cards.map((c) => stackHeight(runs(c), iw)));
  while (need() > avail && (titlePt > 14 || bodyPt > 11)) { if (bodyPt > 11) bodyPt--; if (titlePt > 14 && need() > avail) titlePt--; }
  const fits = head.fits && need() <= avail + 0.01;
  const cardH = Math.min(avail, Math.max(2.4, need() + 0.08));
  s.cards.forEach((c, i) => {
    const x = C.x + i * (cw + gap), y = head.y;
    parts.push(rect(x, y, cw, cardH, 'panel', { radius: 0.16, role: 'card' }));
    parts.push(rect(x + pad, y + pad, tile, tile, 'soft', { radius: 0.14, role: 'tile' }));
    if (c.icon) parts.push({ type: 'icon', x: round(x + pad + 0.16), y: round(y + pad + 0.16), w: tile - 0.32, h: tile - 0.32, name: c.icon, color: 'accentText', role: 'icon' });
    else parts.push(text(x + pad, y + pad, tile, tile, String(i + 1).padStart(2, '0'), 17, { color: 'accentText', bold: true, align: 'center', valign: 'middle', role: 'tile-number' }));
    const ty = y + pad + tile + 0.28;
    parts.push(stack(x + pad, ty, iw, Math.max(0.3, y + cardH - pad - ty), runs(c), { role: 'card-text' }));
  });
  settle(parts, C, s);
  return fits;
}
function chart(s, C, parts) {
  let fits = true, w = C.w;
  if (s.body) {
    const side = 3.55, x = C.x + C.w - side;
    w = C.w - side - 0.5;
    const f = fit(s.body, side - 0.3, C.h - 0.2, 22, 14);
    fits = f.fits;
    parts.push(rect(x, C.y + 0.08, 0.05, Math.min(C.h - 0.1, f.h + 0.1), 'accent', { role: 'rule' }));
    parts.push(text(x + 0.3, C.y + 0.1, side - 0.3, Math.min(C.h - 0.2, Math.max(f.h, 0.4)), s.body, f.pt, { role: 'chart-note', tag: 'p' }));
  }
  let y = C.y, h = C.h;
  if (s.chart.title) {
    parts.push(text(C.x, y, w, 0.36, s.chart.title, 15, { bold: true, role: 'chart-title', nowrap: true }));
    y += 0.46; h -= 0.46;
  }
  if (s.chart.caption) {
    h -= 0.42;
    parts.push(text(C.x, y + h + 0.1, w, 0.3, s.chart.caption, 12, { color: 'muted', role: 'chart-caption', tag: 'p', nowrap: true }));
  }
  parts.push({ type: 'chart', x: C.x, y: round(y), w: round(w), h: round(h), chart: s.chart, role: 'chart' });
  return fits;
}
function quote(s, C, parts) {
  const x = C.x + 1.05, w = C.w - 1.05 - 0.55, attr = s.attribution ? s.attribution.replace(/^[\s—–-]+/, '') : '';
  const f = fit(s.quote, w, C.h - (attr ? 0.8 : 0.1), 34, 18, false, 1.3);
  const block = f.h + (attr ? 0.72 : 0), y = C.y + Math.max(0.12, (C.h - block) / 2 - 0.15);
  parts.push(text(C.x - 0.04, y - 0.5, 1, 1.85, '“', 110, { color: 'accentText', font: 'serif', role: 'quote-mark', lh: 1.2, decorative: true }));
  parts.push(text(x, y, w, f.h, s.quote, f.pt, { font: 'heading', role: 'quote', tag: 'blockquote', lh: 1.3 }));
  if (attr) {
    parts.push(rect(x, y + f.h + 0.38, 0.36, 0.04, 'accent', { role: 'rule' }));
    parts.push(text(x + 0.5, y + f.h + 0.24, w - 0.5, 0.34, attr, 16, { color: 'muted', role: 'attribution', tag: 'p', nowrap: true }));
  }
  return f.fits;
}
function section(s, C, parts, number) {
  if (number) parts.push(text(9.35, 1.3, 3.25, 3.0, String(number).padStart(2, '0'), 120, { color: 'onAccentFaint', bold: true, align: 'right', valign: 'bottom', font: 'heading', role: 'section-number', lh: 1.3, spacing: -3, decorative: true }));
  if (!s.body) return true;
  const f = fit(s.body, C.w, C.h, 18, 14);
  parts.push(text(C.x, C.y, C.w, Math.min(C.h, f.h), s.body, f.pt, { color: 'onAccent', role: 'section-body', tag: 'p' }));
  return f.fits;
}
function agenda(s, C, parts) {
  const head = intro(s, C, parts), n = s.bullets.length, cols = n > 4 ? 2 : 1, rows = Math.ceil(n / cols), gap = 0.6;
  const colW = cols === 2 ? columns(2, C.w, gap) : C.w, avail = C.y + C.h - head.y, rowH = Math.min(1.0, avail / rows), num = cols === 2 ? 0.85 : 1.0;
  const max = cols === 2 ? 21 : 24;
  const sizes = s.bullets.map((b) => fit(b, colW - num, rowH - 0.18, max, 13));
  const pt = Math.min(...sizes.map((f) => f.pt));
  s.bullets.forEach((b, i) => {
    const col = cols === 2 ? Math.floor(i / rows) : 0, row = cols === 2 ? i % rows : i;
    const x = C.x + col * (colW + gap), y = head.y + row * rowH;
    parts.push(rect(x, y, colW, 0.014, 'line', { role: 'divider' }));
    parts.push(text(x, y, num - 0.15, rowH, String(i + 1).padStart(2, '0'), pt, { color: 'accentText', bold: true, valign: 'middle', font: 'heading', role: 'agenda-number' }));
    parts.push(text(x + num, y, colW - num, rowH, b, pt, { valign: 'middle', role: 'agenda-item' }));
  });
  return head.fits && sizes.every((f) => f.fits);
}
const BUILD = { section, quote, stats, timeline, cards, chart, agenda };
// Parts inside the content box render in it; decorative parts outside it render on the slide.
const insideContent = (p, c) => p.x >= c.x - 0.01 && p.y >= c.y - 0.01 && p.x + p.w <= c.x + c.w + 0.01 && p.y + p.h <= c.y + c.h + 0.01;
// Geometry for any slide: { title, subtitle, content, cover, section, parts, dense }. 0.2 layouts get
// an empty part list (their renderers lay out content themselves).
function slideGeometry(s, { section: number = 0 } = {}) {
  const base = slideLayout(s), parts = [];
  let fits = true;
  if (BUILD[s.layout]) fits = BUILD[s.layout](s, base.content, parts, number);
  return { ...base, section: s.layout === 'section', parts, dense: !fits };
}

module.exports = { slideLayout, bodyHeight, slideGeometry, insideContent, slidePalette, officeFonts, sectionNumbers, onFill, lineCount, textHeight, fit, V2_LAYOUTS, SLIDE_LAYOUTS, NEAR_BLACK };
