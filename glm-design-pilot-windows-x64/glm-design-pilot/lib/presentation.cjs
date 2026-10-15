'use strict';
const { slideLayout } = require('./slide-layout.cjs');
const { webScreens } = require('./schema.cjs');
const { INTERACTIONS, inspectorScript } = require('./design-runtime.cjs');
const { normalizeTokens, kitCSS } = require('./kit.cjs');
const { utilityCSS, collectClasses } = require('./utilities.cjs');
const { expandMarkup, chartBudget, MARKUP_CSS } = require('./markup.cjs');
const escape = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; font-src data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const REFERENCE = /\{\{reference:([0-5])\}\}/g;
// 0.2 base rules kept as zero-specificity fallbacks. They load before the kit, so kit
// components (which are also :where()) and every utility or model rule win over them.
const BASE_CSS = ':where(button,a){touch-action:manipulation}:where(:focus-visible){outline:3px solid var(--accent);outline-offset:3px}:where([data-forma-screen]){min-height:100vh}:where(dialog){max-width:min(90vw,640px);max-height:85vh;overflow:auto}:where(dialog)::backdrop{background:#10182866}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}';
// Tweaks become custom properties; re-checked here because the result is written into <style>.
const TWEAK_VAR = /^--[a-z][a-z0-9-]{1,40}$/, TWEAK_UNITS = ['px', 'rem', 'em', '%', 'vh', 'vw', ''];
function tweakCSS(a, selector = ':root') {
  const out = [];
  for (const t of (Array.isArray(a?.tweaks) ? a.tweaks : []).slice(0, 8)) {
    const unit = t?.unit ?? 'px', v = Math.round(Number(t?.value) * 1e4) / 1e4;
    if (t && typeof t.var === 'string' && TWEAK_VAR.test(t.var) && TWEAK_UNITS.includes(unit) && Number.isFinite(v) && Math.abs(v) < 1e6) out.push(`${t.var}:${v}${unit}`);
  }
  return out.length ? `${selector}{${out.join(';')}}` : '';
}
const designTokens = (a) => normalizeTokens(a.designSystem || a.theme);
// Web styles in cascade order (spec 9): kit (fonts, tokens, components) -> markup support -> utilities
// for every class used on any screen -> model CSS -> tweak values. Handoff reuses the same parts.
function webStyles(a, tweakSelector = ':root') {
  const tokens = designTokens(a);
  return { tokens, base: BASE_CSS, kit: kitCSS(tokens), markup: MARKUP_CSS, utilities: utilityCSS(collectClasses(webScreens(a).map((s) => s.html)), tokens), model: a.css || '', tweaks: tweakCSS(a, tweakSelector) };
}
const webCSS = (a) => { const s = webStyles(a); return [s.base, s.kit, s.markup, s.utilities, s.model, s.tweaks].filter(Boolean).join('\n'); };
// Stored screen HTML -> page HTML: references first, then icons and charts. In the editor, images
// remember their reference number so the inspector can report stored-equivalent markup.
// All screens of a page share one chart budget (lib/charts.cjs).
function screenBody(html, refs, editor, budget) {
  let out = String(html ?? '');
  if (editor) out = out.replace(/ src="\{\{reference:([0-5])\}\}"/g, (_, n) => ` src="${refs[Number(n)]?.data || ''}" data-forma-reference="${n}"`);
  out = out.replace(REFERENCE, (_, n) => refs[Number(n)]?.data || '');
  try { return expandMarkup(out, budget); } catch { return out; }
}
function tableHTML(t) {
  return t
    ? `<table><thead><tr>${t.headers.map((h) => `<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map((r) => `<tr>${r.map((c) => `<td>${escape(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    : '';
}
function list(items) {
  return items?.length ? `<ul>${items.map((i) => `<li>${escape(i)}</li>`).join('')}</ul>` : '';
}
function picture(index, refs, caption = '') {
  const ref = refs[index];
  return ref
    ? `<figure><img src="${ref.data}" alt="${escape(caption || ref.name)}">${caption ? `<figcaption>${escape(caption)}</figcaption>` : ''}</figure>`
    : '';
}
function slideHTML(s, a, refs, index) {
  const { title, subtitle, content } = slideLayout(s);
  const box = (b) => `position:absolute;left:${b.x * 90}px;top:${b.y * 90}px;width:${b.w * 90}px;height:${b.h * 90}px;${b.fontSize ? `font-size:${b.fontSize * 1.25}px;` : ''}`;
  const inner = s.layout === 'two-column'
    ? `<div class="columns">${s.columns.map(c => `<div><h2>${escape(c.heading)}</h2>${c.body ? `<p>${escape(c.body)}</p>` : ''}${list(c.bullets)}</div>`).join('')}</div>`
    : s.layout === 'image'
      ? `<div class="image-layout">${picture(s.imageIndex, refs)}<div>${s.body ? `<p>${escape(s.body)}</p>` : ''}${list(s.bullets)}</div></div>`
      : `${s.body ? `<p class="takeaway">${escape(s.body)}</p>` : ''}${tableHTML(s.table)}${list(s.bullets)}`;
  return `<section class="slide ${escape(s.layout)}"><div class="kicker">${escape(a.title)}</div><div class="accent-rule"></div><h1 style="${box(title)}">${escape(s.title)}</h1>${s.subtitle ? `<p class="subtitle" style="${box(subtitle)}">${escape(s.subtitle)}</p>` : ''}<div class="slide-content ${s.layout === 'bullets' && s.body && s.bullets.length ? 'split-takeaway' : ''}" style="${box(content)}">${inner}</div><span class="number">${String(index + 1).padStart(2, '0')}</span></section>`;
}
function pageHTML(a, refs = [], page = null, editor = null) {
  let body, css;
  if (a.kind === 'web') {
    const screens = webScreens(a);
    const chosen = page === null ? screens : screens.filter(s => s.id === page);
    const budget = chartBudget();
    body = chosen.map((s,i) => `<div data-forma-screen="${escape(s.id)}" aria-label="${escape(s.name)}"${i ? ' hidden' : ''}>${screenBody(s.html, refs, editor, budget)}</div>`).join('');
    css = webCSS(a);
  } else {
    css = `*{box-sizing:border-box}body{margin:0;background:#eeedf1;color:${a.theme.text};font-family:Arial,sans-serif}h1,h2,p{margin-top:0}h1{font-size:42px;line-height:1.15;letter-spacing:-1px}h2{font-size:24px}p,li{font-size:20px;line-height:1.55}li{margin-bottom:14px}ul{padding-left:25px}table{width:100%;border-collapse:collapse;font-size:17px;text-align:left}th{background:${a.theme.accent};color:white}td,th{padding:14px;border-bottom:1px solid #dedde3}figure{margin:0}img{max-width:100%;max-height:360px;object-fit:contain}figcaption{font-size:13px;color:#777}.slide{width:1200px;height:675px;background:${a.theme.background};padding:55px 65px;margin:24px auto;position:relative;overflow:hidden}.slide.cover{display:flex;flex-direction:column;justify-content:center}.slide.cover h1{font-size:62px;max-width:900px}.slide .kicker{color:${a.theme.accent};font-size:13px;text-transform:uppercase;letter-spacing:2px;margin-bottom:18px}.slide .subtitle{color:#737180;font-size:24px;max-width:850px}.slide .number{position:absolute;bottom:22px;left:65px;font-size:12px;color:#888}.columns{display:grid;grid-template-columns:1fr 1fr;gap:60px}.columns h2{color:${a.theme.accent}}.image-layout{display:grid;grid-template-columns:1fr 1fr;gap:40px}.document{max-width:850px;margin:30px auto;background:white;padding:75px 80px;min-height:1100px}.document h1{font-size:36px;color:#111}.document h2{font-size:21px;margin-top:30px}.document p,.document li{font-size:16px;line-height:1.65}.document table{font-size:14px}.document .subtitle{color:#666;font-size:17px;margin-bottom:35px}@media print{body{background:white}.slide{margin:0;page-break-after:always}.document{margin:0;padding:0;min-height:0;max-width:none}h2{break-after:avoid}tr,figure{break-inside:avoid}}`;
    if (a.kind === 'slides') {
      const slides = page === null ? a.slides : [a.slides[page]].filter(Boolean);
      body = slides.map((s, i) => slideHTML(s, a, refs, (page ?? i))).join('');
    } else
      body = `<article class="document"><h1>${escape(a.title)}</h1><p class="subtitle">${escape(a.subtitle)}</p>${a.blocks.map((b) => (b.type === 'heading' ? `<h2>${escape(b.text)}</h2>` : b.type === 'paragraph' ? `<p>${escape(b.text).replace(/\n/g, '<br>')}</p>` : b.type === 'bullets' ? list(b.items) : b.type === 'table' ? tableHTML(b.table) : picture(b.imageIndex, refs, b.text))).join('')}</article>`;
  }
  if (a.kind !== 'web') css += `
    .slide,.slide.cover{display:block;padding:0}.slide h1{margin:0;line-height:1.12;letter-spacing:-.6px;max-width:none}
    .slide .kicker{position:absolute;left:63px;top:31px;margin:0;max-width:1071px;font-size:13px;letter-spacing:1px}
    .accent-rule{position:absolute;left:63px;top:69px;width:54px;height:4px;background:${a.theme.accent}}
    .slide .subtitle{margin:0;max-width:none;color:${a.theme.text};line-height:1.3}
    .slide-content p,.slide-content li{font-size:25px;line-height:1.35}.slide-content p{margin:0 0 20px}
    .slide-content ul{margin:0;padding-left:28px}.slide-content li{margin:0 0 16px}
    .slide-content .columns{gap:50px}.columns h2{font-size:30px;line-height:1.15;margin:0 0 24px}
    .columns p,.columns li{font-size:23px}.split-takeaway{display:grid;grid-template-columns:324px 1fr;gap:45px}
    .split-takeaway .takeaway{color:${a.theme.accent};font-size:30px}.slide.table .takeaway{font-size:22px}
    .slide.table table{font-size:18px}.slide.table td,.slide.table th{padding:12px}.slide.table ul{margin-top:16px}
    .slide.table li{font-size:18px;margin-bottom:7px}.slide .number{left:63px;bottom:28px}
    .document{padding:60px 68px;min-height:0}.document h1{font-size:32px;color:${a.theme.text};margin-bottom:12px}
    .document h2{font-size:20px;margin:24px 0 10px;color:${a.theme.accent}}
    .document p,.document li{font-size:15px;line-height:1.45;margin-bottom:10px}.document .subtitle{font-size:17px;margin-bottom:20px}
    .document td,.document th{padding:9px 10px;line-height:1.4}.document ul{margin:0 0 14px}
    @media(max-width:650px){.document{margin:0;padding:28px 20px}.document table{font-size:12px}.document td,.document th{padding:7px;overflow-wrap:anywhere}}
    @media print{.document{padding:0}.document h1,.document h2{break-after:avoid}.document p{orphans:2;widows:2}}
  `;
  const scale =
    a.kind === 'slides'
      ? `function fitSlides(){document.querySelectorAll('.slide').forEach(s=>s.style.zoom=Math.min(1,(innerWidth-30)/1200))}fitSlides();addEventListener('resize',fitSlides);`
      : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${CSP}"><title>${escape(a.title)}</title><style>${css}\n[hidden]{display:none!important}img{max-width:100%}</style></head><body>${body}<script>${INTERACTIONS}${scale}${editor ? inspectorScript(editor.channel, editor.screen) : ''}</script></body></html>`;
}
function warnings(a, refs) {
  const w = [];
  if (a.kind === 'web')
    for (const m of webScreens(a).map(s => s.html).join('\n').matchAll(REFERENCE))
      if (!refs[Number(m[1])]) w.push('A referenced image is missing.');
  if (a.kind === 'slides')
    for (const [i, s] of a.slides.entries()) {
      if (s.title.length > 75 || s.body.length + s.bullets.join('').length > 650)
        w.push(`Slide ${i + 1} has dense content; inspect the native export.`);
      if (s.imageIndex != null && !refs[s.imageIndex])
        w.push(`Slide ${i + 1} references a missing image.`);
    }
  if (a.kind === 'document')
    for (const b of a.blocks)
      if (b.imageIndex != null && !refs[b.imageIndex]) w.push('A document image is missing.');
  return [...new Set(w)];
}
module.exports = { pageHTML, escape, CSP, warnings, INTERACTIONS, webStyles, webCSS, tweakCSS, designTokens };
