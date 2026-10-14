'use strict';
// Deterministic design lint. Static rules read the stored artifact; PAGE_LINT runs
// inside the rendered page. Every input is model-authored and treated as untrusted:
// nothing here executes it, and every string leaving this module is length-capped.
const fs = require('node:fs');
const path = require('node:path');
const SEV = { error: 0, warning: 1, info: 2 };
const ACTIONS = ['navigate', 'toggle', 'tab', 'open', 'close', 'filter'];
const CHART_TYPES = ['bar', 'hbar', 'stacked-bar', 'line', 'area', 'donut', 'pie', 'sparkline'];
const PLACEHOLDER_I = /lorem ipsum|dolor sit amet|consectetur adipiscing|\binsert (?:[a-z]+ ){0,4}here\b|\bplaceholder (?:text|copy|image)\b|\bsample (?:text|copy)\b|\[(?:image|img|photo|picture|logo|icon|chart|graph|video|placeholder|insert[^\]]{0,40}|your [^\]]{1,40}|(?:company|product|brand|client|customer|user|first|last|full) name|name|title|date|link|url|email|phone|address|number|amount|description|text)\]|\{\{(?!reference:\d\}\})[^{}]{1,40}\}\}/i;
const PLACEHOLDER = /\b(?:TODO|FIXME)\b\s*[:(\-–]|\[(?:TODO|TBD|TK)\]|\bFIXME\b/;
const UTILITY_LIKE = /[:[\]/]|^-?(?:p[xytblrse]?|m[xytblrse]?|w|h|min-w|min-h|max-w|max-h|size|gap(?:-[xy])?|space-[xy]|text|bg|border(?:-[xytblrse])?|rounded(?:-[a-z]+)?|shadow|font|leading|tracking|grid-cols|grid-rows|col-span|row-span|col|row|flex|items|justify|content|self|place|order|z|top|right|bottom|left|inset(?:-[xy])?|opacity|ring|fill|stroke|object|aspect|overflow(?:-[xy])?|whitespace|line-clamp|basis|grow|shrink|from|via|to|translate-[xy]|rotate|scale|duration|ease|delay|cursor|select|decoration|underline-offset|divide-[xy]|outline|columns|break|list|indent|align|backdrop|blur)-|^(?:flex|grid|block|inline|inline-block|inline-flex|inline-grid|hidden|contents|table|relative|absolute|fixed|sticky|static|truncate|uppercase|lowercase|capitalize|italic|underline|container|antialiased|grow|shrink|transition|shadow|rounded|border|visible|invisible|isolate)$/;
const HOOK_CLASSES = new Set(['group', 'peer', 'is-active', 'active', 'selected', 'open', 'current', 'dark', 'light']);
const SEVERITY_WEIGHT = { error: 10, warning: 3, info: 0.5 };
const txt = (x) => (typeof x === 'string' ? x.trim() : '');
const list = (x) => (Array.isArray(x) ? x.filter((s) => typeof s === 'string').map((s) => s.trim()) : []);
const oneLine = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
const snip = (s, n = 32) => { s = oneLine(s).replace(/</g, '‹').replace(/>/g, '›'); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const cut = (s, n) => { s = oneLine(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const optional = (file, pick) => { try { return pick(require(file)) ?? null; } catch { return null; } };
const dep = (deps, key, file, pick) => (Object.prototype.hasOwnProperty.call(deps, key) ? deps[key] : optional(file, pick));
const placeholderCopy = (s) => (typeof s === 'string' && (PLACEHOLDER_I.test(s) || PLACEHOLDER.test(s)) ? s : '');
const cssClasses = (css) => new Set([...String(css || '').matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((m) => m[1]));
const MAX_SCREEN_HTML = 200000;
const KIT_FILE = path.join(__dirname, '..', 'assets', 'kit', 'forma-kit.css');
let kitCache = { mtime: -1, classes: new Set() };
function kitClasses() {
  try {
    const mtime = fs.statSync(KIT_FILE).mtimeMs;
    if (mtime !== kitCache.mtime) kitCache = { mtime, classes: cssClasses(fs.readFileSync(KIT_FILE, 'utf8')) };
  } catch {}
  return kitCache.classes;
}
function levenshtein(a, b, limit) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i]; let low = i;
    for (let j = 1; j <= b.length; j++) { row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); low = Math.min(low, row[j]); }
    if (low >= limit) return limit;
    prev = row;
  }
  return prev[b.length];
}
function nearest(name, names) {
  let best = null, bd = name.length > 4 ? 4 : 2;
  for (const n of names) { if (Math.abs(n.length - name.length) >= bd) continue; const d = levenshtein(name, n, bd); if (d < bd) { bd = d; best = n; } }
  if (best) return best;
  const parts = name.split('-').filter(Boolean);
  for (const n of names) { const p = n.split('-'); if (parts.length > 1 && parts.length === p.length && parts.every((x) => p.includes(x))) return n; }
  for (const n of names) if (n.split('-').includes(name)) return n;
  return null;
}
function builtinChart(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return 'the spec must be a JSON object';
  if (!CHART_TYPES.includes(spec.type)) return `type must be one of ${CHART_TYPES.join(', ')}`;
  const labels = spec.labels, series = spec.series;
  if (spec.type !== 'sparkline' && (!Array.isArray(labels) || !labels.length || labels.length > 24)) return 'labels must be an array of 1–24 items';
  if (!Array.isArray(series) || !series.length || series.length > 6) return 'series must be an array of 1–6 items';
  for (const s of series) {
    if (!s || !Array.isArray(s.values) || !s.values.length || !s.values.every((v) => typeof v === 'number' && Number.isFinite(v))) return 'every series needs finite numeric values';
    if (Array.isArray(labels) && labels.length && s.values.length !== labels.length) return 'every series needs one value per label';
  }
  return '';
}
const json = (v) => { try { return JSON.stringify(v) || ''; } catch { return ''; } };
// Validator messages are sentences; callers wrap them in their own sentence.
const sentence = (s) => oneLine(s).replace(/[\s.]+$/, '');
function chartProblem(raw, validate) { const p = chartCheck(raw, validate); return p && sentence(p); }
// raw: the data-chart attribute string, or a slide's chart object.
function chartCheck(raw, validate) {
  let spec = raw;
  if (typeof raw === 'string') {
    if (raw.length > 6000) return `data-chart is ${raw.length} characters; the limit is 6000`;
    try { spec = JSON.parse(raw); } catch { return 'data-chart is not valid JSON'; }
  } else if (json(raw).length > 6000) return 'the chart spec is over 6000 characters';
  if (typeof validate === 'function') {
    try {
      const r = validate(spec);
      if (r === false) return 'the chart spec is invalid';
      if (typeof r === 'string' && r) return r;
      if (Array.isArray(r) && r.length) return oneLine(r.slice(0, 3).join('; '));
      if (r && typeof r === 'object' && (r.ok === false || r.valid === false || (Array.isArray(r.errors) && r.errors.length))) return oneLine((r.errors || [r.error || 'the chart spec is invalid']).slice(0, 3).join('; '));
      return '';
    } catch (e) { return oneLine(e && e.message) || 'the chart spec is invalid'; }
  }
  return builtinChart(spec);
}
// Minimal DOM helpers over htmlparser2's tree (iterative: model HTML can be deeply nested).
function parseHTML(html) {
  return require('htmlparser2').parseDocument(typeof html === 'string' ? html : '', { lowerCaseTags: true, lowerCaseAttributeNames: true });
}
const attr = (n, k) => (n && n.attribs && typeof n.attribs[k] === 'string' ? n.attribs[k] : null);
// Flags inherited from ancestors (computed once, so deep nesting stays linear).
const HIDDEN = 1, IN_LABEL = 2, IN_FORM = 4, IN_ACTION = 8;
const hides = (n) => attr(n, 'hidden') != null || n.name === 'dialog' || n.name === 'template';
function walk(doc) {
  const els = [], texts = [], flags = new Map(), stack = [];
  for (let i = (doc.children || []).length - 1; i >= 0; i--) stack.push([doc.children[i], 0]);
  while (stack.length) {
    const [n, up] = stack.pop();
    if (n.type === 'text') { texts.push(n); flags.set(n, up); continue; }
    if (n.type !== 'tag') continue;
    els.push(n); flags.set(n, up);
    const own = up | (hides(n) ? HIDDEN : 0) | (n.name === 'label' ? IN_LABEL : 0) | (n.name === 'form' ? IN_FORM : 0) | (attr(n, 'data-action') != null ? IN_ACTION : 0);
    for (let i = (n.children || []).length - 1; i >= 0; i--) stack.push([n.children[i], own]);
  }
  return { els, texts, flags };
}
function shortPath(parts, dropped) {
  while (parts.length > 1 && parts.join(' > ').length > 76) { parts.shift(); dropped = true; }
  return cut((dropped ? '… > ' : '') + parts.join(' > '), 80);
}
function nodePath(n) {
  const parts = []; let d = 0, dropped = false;
  for (; n && n.type === 'tag'; n = n.parent, d++) {
    if (d === 5) { dropped = true; break; }
    let s = String(n.name).replace(/[^a-z0-9-]/gi, '').slice(0, 20) || 'el'; const id = attr(n, 'id'), cls = (attr(n, 'class') || '').split(/\s+/).find((c) => /^[A-Za-z][\w-]{0,24}$/.test(c));
    if (id && /^[A-Za-z][\w-]{0,30}$/.test(id)) { parts.unshift(s + '#' + id); break; }
    if (cls) s += '.' + cls;
    const sib = (n.parent?.children || []).filter((x) => x.type === 'tag' && x.name === n.name);
    if (sib.length > 1) s += `:nth-of-type(${sib.indexOf(n) + 1})`;
    parts.unshift(s);
  }
  return shortPath(parts, dropped);
}
function finding(rule, severity, screen, target, message, viewport = null) {
  return { rule, severity, screen: screen == null ? null : cut(screen, 200), viewport, target: cut(target, 80), message: cut(message, 400) };
}
// Per rule and screen cap. Target and message may be thunks so capped-out findings cost nothing.
function capper(out, cap) {
  const counts = {}, val = (v) => (typeof v === 'function' ? v() : v);
  return (rule, severity, screen, target, message) => {
    const k = rule + '|' + screen; counts[k] = (counts[k] || 0) + 1;
    if (counts[k] <= cap) out.push(finding(rule, severity, screen, val(target), val(message)));
    else if (counts[k] === cap + 1) out.push(finding(rule, 'info', screen, 'screen', `More ${rule} findings on this screen were omitted; fix the pattern everywhere.`));
  };
}
function webLint(a, deps) {
  const out = [], push = capper(out, 10);
  const raw = Array.isArray(a.screens) && a.screens.length ? a.screens : [{ id: 'home', name: 'Home', html: a.html }];
  const screens = raw.filter((s) => s && typeof s === 'object').slice(0, 60).map((s, i) => ({ id: typeof s.id === 'string' && s.id ? s.id.slice(0, 200) : `screen-${i + 1}`, name: txt(s.name) || txt(s.id) || `Screen ${i + 1}`, html: typeof s.html === 'string' ? s.html.slice(0, MAX_SCREEN_HTML) : '' }));
  const screenIds = screens.map((s) => s.id), screenSet = new Set(screenIds), idList = [...screenSet].slice(0, 8).map((id) => snip(id, 40)).join(', ');
  for (const id of screenSet) { const n = screenIds.filter((x) => x === id).length; if (n > 1) push('duplicate-screen', 'error', id, 'screen', `Screen id "${snip(id, 40)}" is used by ${n} screens; navigation always opens the first. Give every screen a unique id.`); }
  let names = null, resolve = null;
  try { const f = dep(deps, 'iconNames', './icons.cjs', (m) => m.iconNames); if (typeof f === 'function') { names = new Set([...f()].map(String)); if (!names.size) names = null; } } catch { names = null; }
  try { const f = dep(deps, 'resolveIcon', './icons.cjs', (m) => m.resolveIcon); if (typeof f === 'function') resolve = f; } catch {}
  const aliases = dep(deps, 'iconAliases', './icons.cjs', (m) => m.ICON_ALIASES), fallback = dep(deps, 'fallbackIcon', './icons.cjs', (m) => m.FALLBACK_ICON);
  const classify = dep(deps, 'classifyClasses', './utilities.cjs', (m) => m.classifyClasses);
  const validate = dep(deps, 'validateChart', './charts.cjs', (m) => m.validateChart);
  const kit = Object.prototype.hasOwnProperty.call(deps, 'kitClasses') ? deps.kitClasses : kitClasses();
  const defined = new Set([...(kit && typeof kit[Symbol.iterator] === 'function' && typeof kit !== 'string' ? [...kit].map(String) : []), ...cssClasses(a.css)]);
  const knownIcon = (n, raw) => {
    if (names.has(n)) return true;
    try { if (aliases && names.has(String(aliases instanceof Map ? aliases.get(n) : Object.prototype.hasOwnProperty.call(aliases, n) ? aliases[n] : ''))) return true; } catch {}
    try { const r = resolve && resolve(raw); if (typeof r === 'string' && names.has(r) && r !== fallback) return true; } catch {}
    return false;
  };
  const edges = new Map();
  let suggestions = 0;
  for (const s of screens) {
    const F = (rule, severity, target, message) => push(rule, severity, s.id, target, message);
    let doc;
    try { doc = parseHTML(s.html); } catch { F('empty-screen', 'error', 'screen', `Screen "${snip(s.name)}" could not be parsed.`); continue; }
    const { els, texts, flags } = walk(doc);
    const ids = new Map(), byId = new Map();
    for (const n of els) { const id = attr(n, 'id'); if (id) { ids.set(id, (ids.get(id) || 0) + 1); if (!byId.has(id)) byId.set(id, n); } }
    for (const [id, count] of ids) if (count > 1) F('duplicate-id', 'error', `#${snip(id, 40)}`, `id "${snip(id, 40)}" is used ${count} times on this screen; ids must be unique (targets and labels pick the first).`);
    let targets = edges.get(s.id);
    if (!targets) edges.set(s.id, (targets = new Set()));
    let dead = 0, inert = 0;
    const opens = new Set(els.filter((n) => attr(n, 'data-action') === 'open').map((n) => attr(n, 'data-target')));
    const labelFor = new Set(els.filter((n) => n.name === 'label').map((n) => attr(n, 'for')).filter(Boolean));
    const classes = new Map();
    for (const n of els) {
      const action = attr(n, 'data-action'), target = attr(n, 'data-target'), here = () => nodePath(n);
      // `here` is passed uncalled: the capper resolves it only for findings it keeps.
      if (action != null) {
        if (!ACTIONS.includes(action)) F('action-unknown', 'warning', here, `data-action="${snip(action, 24)}" is not supported; use one of ${ACTIONS.join(', ')}.`);
        else if (action === 'navigate') {
          if (!target) F('nav-target', 'error', here, 'Navigation control has no data-target; set it to a screen id.');
          else if (!screenSet.has(target)) F('nav-target', 'error', here, `Navigation target "${snip(target, 40)}" is not a screen. Use one of: ${idList}.`);
          else targets.add(target);
        } else if (!target) F('action-target', 'error', here, `data-action="${action}" has no data-target; point it at an element id on this screen.`);
        else if (!ids.has(target)) F('action-target', 'error', here, `data-action="${action}" targets #${snip(target, 40)}, which is not on this screen. Add id="${snip(target, 40)}" to the element or fix data-target.`);
        else if (action === 'tab') {
          const group = attr(n, 'data-group'), panel = byId.get(target);
          if (!group || attr(panel, 'data-panel') !== group) F('tab-setup', 'warning', here, `Tab needs data-group and its panel #${snip(target, 40)} needs data-panel="${snip(group || 'group', 30)}" so the other panels hide.`);
        }
      }
      if (n.name === 'a' && action == null) {
        const href = attr(n, 'href');
        const nav = /^#screen=(.+)$/.exec(href || '');
        if (href === '#' || href === '') { if (!(flags.get(n) & IN_ACTION)) dead++; }
        else if (nav) { if (screenSet.has(nav[1])) targets.add(nav[1]); else F('nav-target', 'error', here, `Link to screen "${snip(nav[1], 40)}" goes nowhere. Use one of: ${idList}.`); }
        else if (href && href.startsWith('#')) {
          const id = href.slice(1);
          if (!ids.has(id)) F('link-target', 'warning', here, screenSet.has(id) ? `Link href="#${snip(id, 40)}" does not switch screens; use data-action="navigate" data-target="${snip(id, 40)}".` : `Link target #${snip(id, 40)} does not exist on this screen.`);
        }
      }
      if (n.name === 'button' && action == null && !(flags.get(n) & (IN_FORM | IN_ACTION)) && attr(n, 'disabled') == null) inert++;
      for (const k of ['aria-labelledby', 'aria-describedby', 'aria-controls'])
        for (const id of (attr(n, k) || '').split(/\s+/).filter(Boolean)) if (!ids.has(id)) F('aria-ref', 'warning', here, `${k} references #${snip(id, 40)}, which does not exist on this screen.`);
      if (n.name === 'label' && attr(n, 'for') && !ids.has(attr(n, 'for'))) F('aria-ref', 'warning', here, `label for="${snip(attr(n, 'for'), 40)}" points to a missing id.`);
      const type = (attr(n, 'type') || 'text').toLowerCase();
      if ((n.name === 'input' && !['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) || n.name === 'select' || n.name === 'textarea') {
        const id = attr(n, 'id');
        const labelled = (id && labelFor.has(id)) || flags.get(n) & IN_LABEL || txt(attr(n, 'aria-label')) || txt(attr(n, 'aria-labelledby')) || txt(attr(n, 'title'));
        if (!labelled) F('input-label', 'error', here, `${n.name === 'input' ? `Input type="${snip(type, 20)}"` : n.name}${attr(n, 'name') ? ` name="${snip(attr(n, 'name'), 24)}"` : ''} has no label. Add <label for="id"> or aria-label; a placeholder is not a label.`);
      }
      if (n.name === 'dialog') {
        const id = attr(n, 'id');
        if (!id) F('dialog-trigger', 'warning', here, 'Dialog has no id, so nothing can open it. Give it an id and a button with data-action="open" data-target="<id>".');
        else if (!opens.has(id)) F('dialog-trigger', 'warning', here, `Nothing opens dialog #${snip(id, 40)}. Add a button with data-action="open" data-target="${snip(id, 40)}".`);
      }
      const chart = attr(n, 'data-chart');
      if (chart != null) { const p = chartProblem(chart, validate); if (p) F('chart-invalid', 'error', here, `Invalid chart: ${snip(p, 200)}.`); }
      const icon = attr(n, 'data-icon');
      if (icon != null && names) {
        const raw = icon.trim(), nm = raw.toLowerCase();
        if (!nm) F('icon-unknown', 'warning', here, 'data-icon is empty; name a Lucide icon such as "search".');
        else if (!knownIcon(nm, raw)) F('icon-unknown', 'warning', here, () => { const g = nm.length <= 64 && suggestions++ < 40 && nearest(nm, names); return `Unknown icon "${snip(raw, 40)}" renders as a fallback.${g ? ` Did you mean "${snip(g, 40)}"?` : ' Use a Lucide icon name.'}`; });
      }
      if (n.name === 'img' && !txt(attr(n, 'src'))) F('img-src', 'warning', here, 'Image has no source (only {{reference:N}} images are allowed). Remove it or use a styled block instead.');
      for (const c of (attr(n, 'class') || '').split(/\s+/)) if (c && !classes.has(c)) classes.set(c, n);
      for (const k of ['alt', 'title', 'aria-label', 'placeholder', 'value']) { const p = placeholderCopy(attr(n, k)); if (p) F('placeholder-copy', 'warning', here, `Placeholder copy in ${k}: "${snip(p, 40)}". Replace it with real content from the brief.`); }
    }
    const reported = new Set();
    for (const t of texts) {
      const p = placeholderCopy(t.data), host = t.parent && t.parent.type === 'tag' ? t.parent : null;
      if (p && !reported.has(host)) { reported.add(host); F('placeholder-copy', 'warning', () => (host ? nodePath(host) : 'screen'), () => `Placeholder copy "${snip(p, 40)}". Replace it with real content from the brief.`); }
    }
    if (dead) F('link-dead', 'info', 'screen', `${dead} link${dead > 1 ? 's go' : ' goes'} nowhere (href="#"). Use data-action="navigate" data-target="<screen>" or plain text.`);
    if (inert) F('button-inert', 'info', 'screen', `${inert} button${inert > 1 ? 's do' : ' does'} nothing (no data-action, not in a form). Wire them to navigate, open, toggle or tab.`);
    const shown = (n) => !(flags.get(n) & HIDDEN) && !(n.type === 'tag' && hides(n));
    let visibleText = '';
    for (const t of texts) if (visibleText.length < 400 && t.parent && shown(t)) visibleText += t.data;
    visibleText = visibleText.replace(/\s+/g, ' ').trim();
    const media = els.some((n) => (['img', 'svg', 'input', 'select', 'textarea', 'button', 'video', 'canvas', 'progress', 'meter'].includes(n.name) || attr(n, 'data-icon') != null || attr(n, 'data-chart') != null) && shown(n));
    if (!visibleText && !media) F('empty-screen', 'error', 'screen', `Screen "${snip(s.name)}" has no visible content.`);
    else if (visibleText.length < 20 && !media) F('empty-screen', 'warning', 'screen', `Screen "${snip(s.name)}" has almost no content (${visibleText.length} characters).`);
    if (typeof classify === 'function' && classes.size) {
      const candidates = [...classes.keys()].filter((c) => !defined.has(c) && !HOOK_CLASSES.has(c));
      let unknown = [];
      try { const r = candidates.length ? classify(candidates) : null; unknown = r && r.unknown ? [...r.unknown].map(String) : []; } catch { unknown = []; }
      const util = unknown.filter((c) => UTILITY_LIKE.test(c)), other = unknown.filter((c) => !UTILITY_LIKE.test(c));
      const show = (l) => l.slice(0, 12).map((c) => snip(c, 40)).join(', ') + (l.length > 12 ? ` (+${l.length - 12} more)` : '');
      if (util.length) F('class-unknown', 'warning', nodePath(classes.get(util[0])), `Unknown utility classes generate no CSS: ${show(util)}. Use supported Tailwind v3 classes or token colours (text-accent, bg-surface).`);
      if (other.length) F('class-undefined', 'info', nodePath(classes.get(other[0])), `Classes with no CSS: ${show(other)}. Define them in the shared CSS or remove them.`);
    }
  }
  if (screens.length > 1) {
    const seen = new Set([screens[0].id]), queue = [screens[0].id];
    while (queue.length) for (const t of edges.get(queue.shift()) || []) if (!seen.has(t)) { seen.add(t); queue.push(t); }
    for (const s of screens) if (!seen.has(s.id)) push('unreachable-screen', 'warning', s.id, 'screen', `Screen "${snip(s.name)}" (${snip(s.id, 40)}) cannot be reached from "${snip(screens[0].name)}". Add a control with data-action="navigate" data-target="${snip(s.id, 40)}".`);
  }
  return out;
}
function tableLint(t, F, label, limit, target) {
  if (!t || typeof t !== 'object') return;
  const headers = list(t.headers).slice(0, 50), rows = Array.isArray(t.rows) ? t.rows.slice(0, 200).map((r) => list(r).slice(0, 50)) : [];
  const cols = Math.max(headers.length, ...rows.map((r) => r.length), 0);
  if (!cols) return;
  const widths = Array.from({ length: cols }, (_, i) => Math.max((headers[i] || '').length, ...rows.map((r) => (r[i] || '').length)));
  const total = widths.reduce((a, b) => a + b, 0) + 3 * cols;
  if (total > limit) F('table-wide', 'warning', target, `${label} table needs about ${total} characters per row across ${cols} columns; it will wrap heavily or overflow. Cut columns, abbreviate or split the table.`);
  const long = rows.flat().find((c) => c.length > 80);
  if (long) F('table-cell-long', 'info', target, `${label} table has a ${long.length}-character cell; keep cells short and move detail to body text.`);
  return rows.length;
}
function slidesLint(a, deps) {
  const out = [], push = capper(out, 10), titles = new Map();
  (Array.isArray(a.slides) ? a.slides : []).slice(0, 60).forEach((s, i) => {
    if (!s || typeof s !== 'object') return;
    const id = typeof s.id === 'string' && s.id ? s.id : `slide-${i + 1}`, label = `Slide ${i + 1}`;
    const F = (rule, severity, target, message) => push(rule, severity, id, target, message);
    const title = txt(s.title), body = txt(s.body), bullets = list(s.bullets), cols = Array.isArray(s.columns) ? s.columns.filter((c) => c && typeof c === 'object') : [];
    const has = body || bullets.length || (s.table && list(s.table.headers).length) || cols.some((c) => txt(c.heading) || txt(c.body) || list(c.bullets).length) || s.imageIndex != null || s.chart ||
      ['stats', 'steps', 'cards', 'items', 'timeline', 'agenda'].some((k) => Array.isArray(s[k]) && s[k].length) || txt(s.quote) || txt(s.attribution);
    if (!title) F('slide-title', 'error', 'title', `${label} has no title.`);
    if (!has && !['cover', 'section'].includes(s.layout)) F('slide-empty', 'error', 'slide', `${label} ("${snip(title)}") has a title but no content. Add bullets, a table or a chart, or make it a section slide.`);
    if (title.length > 75) F('slide-title-long', 'warning', 'title', `${label} title is ${title.length} characters; keep slide titles under 75 so they fit on one or two lines.`);
    if (txt(s.subtitle).length > 140) F('slide-subtitle-long', 'warning', 'subtitle', `${label} subtitle is ${txt(s.subtitle).length} characters; keep it under 140.`);
    bullets.forEach((b, k) => { if (b.length > 120) F('slide-bullet-long', 'warning', `bullets[${k}]`, `${label} bullet ${k + 1} is ${b.length} characters; keep bullets under 120 and move detail to speaker notes.`); });
    if (bullets.length > 6) F('slide-dense', 'warning', 'bullets', `${label} has ${bullets.length} bullets; keep to 6 or fewer.`);
    const amount = body.length + bullets.join('').length;
    if (amount > 650) F('slide-dense', 'warning', 'slide', `${label} carries ${amount} characters of body text; split it or move detail to speaker notes.`);
    cols.forEach((c, k) => { const n = txt(c.body).length + list(c.bullets).join('').length; if (n > 400) F('slide-dense', 'warning', `columns[${k}]`, `${label} column ${k + 1} carries ${n} characters; keep each column under 400.`); });
    const rows = tableLint(s.table, F, label, 100, 'table');
    if (rows > 6) F('slide-dense', 'warning', 'table', `${label} table has ${rows} rows; slides fit about 6. Split it or show the top rows.`);
    if (s.chart) { const p = chartProblem(s.chart, dep(deps, 'validateChart', './charts.cjs', (m) => m.validateChart)); if (p) F('chart-invalid', 'error', 'chart', `${label} chart is invalid: ${snip(p, 200)}.`); }
    const key = title.toLowerCase();
    if (key && titles.has(key)) F('slide-duplicate-title', 'info', 'title', `${label} repeats the title of slide ${titles.get(key)}; make each title state its own point.`);
    else if (key) titles.set(key, i + 1);
    const strings = [title, txt(s.subtitle), body, ...bullets, ...cols.flatMap((c) => [txt(c.heading), txt(c.body), ...list(c.bullets)]), ...(s.table ? [...list(s.table.headers), ...(Array.isArray(s.table.rows) ? s.table.rows.flatMap(list) : [])] : [])];
    const p = strings.find(placeholderCopy);
    if (p) F('placeholder-copy', 'warning', 'slide', `${label} contains placeholder copy "${snip(p, 40)}". Replace it with real content from the brief.`);
  });
  return out;
}
function documentLint(a) {
  const out = [], push = capper(out, 10), blocks = Array.isArray(a.blocks) ? a.blocks.filter((b) => b && typeof b === 'object').slice(0, 200) : [];
  let prev = null, headings = 0;
  const placeholder = placeholderCopy(txt(a.title)) || placeholderCopy(txt(a.subtitle));
  if (placeholder) push('placeholder-copy', 'warning', null, 'title', `Document title contains placeholder copy "${snip(placeholder, 40)}".`);
  blocks.forEach((b, i) => {
    const id = typeof b.id === 'string' && b.id ? b.id : `block-${i + 1}`, label = `Block ${i + 1}`, text = txt(b.text), items = list(b.items);
    const F = (rule, severity, target, message) => push(rule, severity, id, target, message);
    if (b.type === 'heading') {
      headings++;
      if (text.length > 90) F('doc-heading-long', 'warning', 'text', `${label} heading is ${text.length} characters; keep headings under 90.`);
      if (prev && prev.type === 'heading') push('doc-empty-section', 'warning', prev.id, 'text', `Heading "${snip(prev.text)}" is followed directly by another heading; add content or remove it.`);
    }
    if (b.type === 'paragraph' && text.length > 1200) F('doc-paragraph-long', 'info', 'text', `${label} paragraph is ${text.length} characters; split it into shorter paragraphs or a list.`);
    const long = items.find((x) => x.length > 300);
    if (long) F('doc-item-long', 'info', 'items', `${label} has a ${long.length}-character list item; keep list items under 300.`);
    if (b.type === 'table') tableLint(b.table, F, label, 95, 'table');
    const p = [text, ...items, ...(b.table ? [...list(b.table.headers), ...(Array.isArray(b.table.rows) ? b.table.rows.flatMap(list) : [])] : [])].find(placeholderCopy);
    if (p) F('placeholder-copy', 'warning', 'text', `${label} contains placeholder copy "${snip(p, 40)}". Replace it with real content from the brief.`);
    prev = { type: b.type, id, text };
  });
  if (prev && prev.type === 'heading') push('doc-empty-section', 'warning', prev.id, 'text', `The document ends with heading "${snip(prev.text)}" and no content.`);
  if (!headings && blocks.length > 6) push('doc-no-headings', 'info', null, 'blocks', `The document has ${blocks.length} blocks and no headings; add section headings.`);
  return out;
}
function sortFindings(list) {
  const rank = (f) => (f && Object.prototype.hasOwnProperty.call(SEV, f.severity) ? SEV[f.severity] : 3);
  return (Array.isArray(list) ? list : []).map((f, i) => [f, i]).sort((x, y) => rank(x[0]) - rank(y[0]) || x[1] - y[1]).map((x) => x[0]);
}
// staticLint(artifact, deps?) — deps lets callers (and tests) inject or disable
// (null) iconNames, resolveIcon, iconAliases, fallbackIcon, classifyClasses, validateChart, kitClasses.
function staticLint(artifact, deps = {}) {
  if (!artifact || typeof artifact !== 'object') return [];
  deps = deps && typeof deps === 'object' ? deps : {};
  const kind = artifact.kind || (artifact.slides ? 'slides' : artifact.blocks ? 'document' : 'web');
  try {
    return sortFindings(kind === 'web' ? webLint(artifact, deps) : kind === 'slides' ? slidesLint(artifact, deps) : kind === 'document' ? documentLint(artifact) : []);
  } catch (e) {
    return [finding('lint-failed', 'info', null, 'artifact', `Static lint failed: ${cut(e && e.message, 160)}`)];
  }
}
// Runs inside the page via page.evaluate(PAGE_LINT, { viewport, screen }). It must stay
// self-contained: Playwright serialises only this function's source.
function PAGE_LINT(opts) {
  // The spec form page.evaluate(PAGE_LINT_FN, viewport) passes the viewport label alone.
  opts = typeof opts === 'string' ? { viewport: opts } : opts && typeof opts === 'object' ? opts : {};
  const D = document, html = D.documentElement, body = D.body, vw = innerWidth, vh = innerHeight;
  const root = D.querySelector('[data-forma-screen]:not([hidden])') || body;
  const screen = opts.screen != null ? String(opts.screen) : root.getAttribute('data-forma-screen');
  const viewport = opts.viewport != null ? String(opts.viewport) : vw + 'px';
  const mobile = typeof opts.mobile === 'boolean' ? opts.mobile : vw < 640;
  const cap = opts.cap > 0 ? opts.cap : 12, max = opts.max > 0 ? opts.max : 150;
  // Time budget (ms): hostile pages stop the remaining work instead of stalling the renderer.
  const t0 = performance.now(), budget = opts.budget > 0 ? +opts.budget : 1500, late = () => performance.now() - t0 > budget, skipped = [];
  const sx = scrollX, sy = scrollY, out = [], seen = new Map(), counts = {}, extra = {}, omitted = new Map();
  const styles = new Map(), infos = new Map(), colors = new Map();
  const st = (n) => { let s = styles.get(n); if (!s) { s = getComputedStyle(n); styles.set(n, s); } return s; };
  const clean = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  const snip = (s, n) => { s = clean(s).replace(/</g, '‹').replace(/>/g, '›'); n = n || 32; return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const where = (el) => {
    if (el === root) return root === body ? 'page' : 'screen';
    const parts = []; let dropped = false, d = 0;
    for (let n = el; n && n.nodeType === 1 && n !== root && n !== body && n !== html; n = n.parentElement, d++) {
      if (d === 5) { dropped = true; break; }
      let s = n.tagName.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20) || 'el';
      const id = n.getAttribute('id'), c = [...n.classList].find((x) => /^[A-Za-z][\w-]{0,24}$/.test(x));
      if (id && /^[A-Za-z][\w-]{0,30}$/.test(id)) { parts.unshift(s + '#' + id); break; }
      if (c) s += '.' + c;
      const p = n.parentElement;
      if (p) { const same = [...p.children].filter((x) => x.tagName === n.tagName); if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(n) + 1) + ')'; }
      parts.unshift(s);
    }
    while (parts.length > 1 && parts.join(' > ').length > 76) { parts.shift(); dropped = true; }
    const t = (dropped ? '… > ' : '') + parts.join(' > ');
    return t.length > 80 ? t.slice(0, 79) + '…' : t || 'page';
  };
  // One finding per rule and element (or string target), at most `cap` per rule. The cap is
  // checked first and message may be a thunk, so pathological pages cost little.
  const add = (rule, severity, el, message) => {
    let done = seen.get(rule);
    if (!done) seen.set(rule, (done = new Set()));
    if (done.has(el)) return null;
    if ((counts[rule] || 0) >= cap) {
      // Count each omitted element once (pair rules such as text-overlap call this per pair).
      let o = omitted.get(rule);
      if (!o) omitted.set(rule, (o = new Set()));
      if (!o.has(el)) { o.add(el); extra[rule] = (extra[rule] || 0) + 1; }
      return null;
    }
    done.add(el); counts[rule] = (counts[rule] || 0) + 1;
    const f = { rule, severity, screen, viewport, target: typeof el === 'string' ? el : where(el), message: typeof message === 'function' ? message() : message };
    out.push(f); return f;
  };
  const upto = (list, n) => Array.prototype.slice.call(list, 0, n);
  // Colours: computed values may be rgb(), oklab(), oklch() or color(); anything that is
  // not rgb() is resolved by painting one canvas pixel.
  let ctx = null, forced = null, adopted = null;
  const rgba = (s) => {
    if (colors.has(s)) return colors.get(s);
    let v = null; const m = /^rgba?\(([^)]*)\)$/.exec(s);
    if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat); if (p.length >= 3 && p.slice(0, 3).every(isFinite)) v = [p[0], p[1], p[2], p.length > 3 && isFinite(p[3]) ? (/%\s*$/.test(m[1]) ? p[3] / 100 : p[3]) : 1]; }
    else if (s === 'transparent') v = [0, 0, 0, 0];
    else try {
      ctx = ctx || Object.assign(D.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#010203'; ctx.fillStyle = s;
      if (ctx.fillStyle !== '#010203') { ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; v = [d[0], d[1], d[2], d[3] / 255]; }
    } catch (e) { v = null; }
    colors.set(s, v); return v;
  };
  const mix = (a, b) => [a[0] * a[3] + b[0] * (1 - a[3]), a[1] * a[3] + b[1] * (1 - a[3]), a[2] * a[3] + b[2] * (1 - a[3]), 1];
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  // Inherited render facts: cumulative opacity, fixed/sticky, sr-only style hiding,
  // disabled state and the clip box of overflow-hidden ancestors (scrollers reset it).
  const NOCLIP = /^(inline|contents|table-row|table-row-group|table-header-group|table-footer-group|table-column|table-column-group)$/;
  const base = { opacity: 1, fixed: false, hidden: false, disabled: false, ellipsis: false, x: null, y: null };
  const derive = (p, n) => {
    const s = st(n), r = Object.assign({}, p);
    r.opacity = p.opacity * (parseFloat(s.opacity) || 0);
    if (s.position === 'fixed' || s.position === 'sticky') r.fixed = true;
    if (n.matches(':disabled,[aria-disabled="true"]')) r.disabled = true;
    if (s.clip && s.clip !== 'auto' && /absolute|fixed/.test(s.position)) r.hidden = true;
    if (s.clipPath && s.clipPath !== 'none') { const b = n.getBoundingClientRect(); if (b.width <= 2 || b.height <= 2 || /inset\(\s*50%/.test(s.clipPath)) r.hidden = true; }
    if (s.textOverflow === 'ellipsis' || (s.webkitLineClamp && s.webkitLineClamp !== 'none')) r.ellipsis = true;
    if (n !== body && !NOCLIP.test(s.display)) {
      const b = n.getBoundingClientRect();
      if (/hidden|clip/.test(s.overflowX)) { const lo = b.left + n.clientLeft, hi = lo + n.clientWidth; r.x = r.x ? [Math.max(r.x[0], lo), Math.min(r.x[1], hi)] : [lo, hi]; }
      else if (/auto|scroll/.test(s.overflowX)) r.x = null;
      if (/hidden|clip/.test(s.overflowY)) { const lo = b.top + n.clientTop, hi = lo + n.clientHeight; r.y = r.y ? [Math.max(r.y[0], lo), Math.min(r.y[1], hi)] : [lo, hi]; }
      else if (/auto|scroll/.test(s.overflowY)) r.y = null;
    }
    return r;
  };
  const info = (el) => {
    if (infos.has(el)) return infos.get(el);
    const chain = []; let n = el;
    while (n && n !== html && !infos.has(n)) { chain.push(n); n = n.parentElement; }
    let p = n && infos.has(n) ? infos.get(n) : base;
    for (let k = chain.length - 1; k >= 0; k--) { p = derive(p, chain[k]); infos.set(chain[k], p); }
    return p;
  };
  const shown = (el) => { const b = el.getBoundingClientRect(); if (b.width < 1 && b.height < 1) return false; if (st(el).visibility !== 'visible') return false; const i = info(el); return !i.hidden && i.opacity >= 0.05; };
  const kind = (el) => { const r = el.getAttribute('role'); return r && /^[a-z]{2,20}$/.test(r) ? r[0].toUpperCase() + r.slice(1) : el.tagName === 'A' ? 'Link' : el.tagName === 'BUTTON' || /^(submit|button|reset)$/.test(el.type) ? 'Button' : el.tagName === 'SELECT' ? 'Select' : el.tagName === 'SUMMARY' ? 'Summary' : /^(INPUT|TEXTAREA)$/.test(el.tagName) ? 'Field' : 'Element'; };
  const accName = (el) => {
    let t = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map((id) => { const n = D.getElementById(id); return n ? n.textContent : ''; }).join(' ');
    if (clean(t)) return clean(t);
    t = clean(el.getAttribute('aria-label')); if (t) return t;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
      if (/^(submit|reset)$/.test(el.type)) return el.value || el.type;
      if (el.type === 'button' || el.type === 'image') return clean(el.value || el.getAttribute('alt') || el.title);
      t = [...(el.labels || [])].map((l) => l.textContent).join(' ');
      return clean(t) || clean(el.title);
    }
    t = el.textContent + ' ' + [...el.querySelectorAll('img[alt],[aria-label]')].map((n) => n.getAttribute('alt') || n.getAttribute('aria-label')).join(' ') + ' ' + [...el.querySelectorAll('svg title')].map((n) => n.textContent).join(' ');
    return clean(t) || clean(el.title);
  };
  try {
    // 1. Text: collect visible text nodes per parent element.
    const owners = new Map(), range = D.createRange();
    const SKIP = 'script,style,noscript,template,textarea,select,option,svg,[data-forma-runtime],[data-forma-expanded]';
    // Skipped subtrees are rejected whole, so thousands of chart or icon nodes cost nothing.
    const tw = D.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: (x) => (x.nodeType !== 1 ? NodeFilter.FILTER_ACCEPT : x.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP) });
    let tn, n = 0, walked = 0;
    while ((tn = tw.nextNode()) && n < 5000) {
      if ((++walked & 1023) === 0 && late()) { skipped.push('text'); break; }
      if (!/\S/.test(tn.data)) continue;
      const el = tn.parentElement;
      if (!el) continue;
      n++;
      range.selectNodeContents(tn);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
      if (!rects.length) continue;
      let o = owners.get(el);
      if (!o) owners.set(el, (o = { rects: [], text: '' }));
      o.rects.push(...rects); o.text += tn.data;
    }
    const visible = [], sizes = new Map();
    for (const [el, o] of owners) {
      const s = st(el), i = info(el);
      if (i.hidden || s.visibility !== 'visible' || i.opacity < 0.05) continue;
      const u = { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity };
      for (const r of o.rects) { u.l = Math.min(u.l, r.left); u.t = Math.min(u.t, r.top); u.r = Math.max(u.r, r.right); u.b = Math.max(u.b, r.bottom); }
      const cx = i.x ? [Math.max(u.l, i.x[0]), Math.min(u.r, i.x[1])] : [u.l, u.r], cy = i.y ? [Math.max(u.t, i.y[0]), Math.min(u.b, i.y[1])] : [u.t, u.b];
      if (cx[1] - cx[0] <= 1 || cy[1] - cy[0] <= 1 || u.r + sx <= 0 || u.b + sy <= 0) continue;
      const fs = parseFloat(s.fontSize) || 16, text = snip(o.text);
      o.el = el; o.i = i; o.fs = fs; o.s = s; o.u = u; o.snip = text; visible.push(o);
      sizes.set(Math.round(fs), (sizes.get(Math.round(fs)) || 0) + 1);
      if (fs < 12) add('text-small', fs < 10 ? 'error' : 'warning', el, '"' + text + '": ' + Math.round(fs * 10) / 10 + 'px text is too small; use at least 12px (14–16px for body copy), e.g. text-xs or larger.');
      const tol = Math.max(2, fs * 0.2), clippedX = i.x && (u.l < i.x[0] - 2 || u.r > i.x[1] + 2), clippedY = i.y && (u.t < i.y[0] - tol || u.b > i.y[1] + tol);
      if (clippedX || clippedY) {
        if (i.ellipsis) add('text-clipped', 'info', el, '"' + text + '" is truncated with an ellipsis at this width; make sure the full text is still available or widen the layout.');
        else add('text-clipped', 'warning', el, '"' + text + '" is cut off ' + (clippedX ? 'horizontally' : 'vertically') + ' by an overflow-hidden container. Let it wrap, remove the fixed ' + (clippedX ? 'width' : 'height') + ' or shorten the copy.');
      }
    }
    if (sizes.size > 8) add('font-sizes', 'warning', root, 'Uses ' + sizes.size + ' font sizes (' + [...sizes.keys()].sort((a, b) => a - b).join(', ') + 'px); keep to 8 or fewer from one type scale.');
    // 2. Line length for paragraph-like blocks.
    const blocks = new Set();
    for (const o of visible) { const b = o.el.closest('p,li,dd,blockquote,figcaption'); if (b && root.contains(b)) blocks.add(b); else if (/^(block|list-item)$/.test(o.s.display)) blocks.add(o.el); }
    let checked = 0;
    for (const b of blocks) {
      if (++checked > 300 || ((checked & 31) === 0 && late())) { if (checked <= 300) skipped.push('line length'); break; }
      if (b.getElementsByTagName('*').length > 60) continue;
      const t = clean(b.textContent);
      if (t.length <= 90 || t.length > 6000 || !shown(b)) continue;
      range.selectNodeContents(b);
      const ys = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5).map((r) => (r.top + r.bottom) / 2).sort((a, c) => a - c);
      if (!ys.length) continue;
      const fs = parseFloat(st(b).fontSize) || 16;
      let lines = 1; for (let k = 1; k < ys.length; k++) if (ys[k] - ys[k - 1] > fs * 0.6) lines++;
      const per = t.length / lines;
      if (per > 90) add('line-length', 'warning', b, 'Lines run about ' + Math.round(per) + ' characters; keep body text to 45–90 characters per line (e.g. max-w-prose or max-w-[65ch]).');
    }
    // 3. Overlapping text boxes (line fragments of unrelated elements).
    const frags = [];
    for (const o of visible) {
      if (o.i.fixed) continue;
      for (const r of o.rects) {
        const l = o.i.x ? Math.max(r.left, o.i.x[0]) : r.left, rr = o.i.x ? Math.min(r.right, o.i.x[1]) : r.right, t = o.i.y ? Math.max(r.top, o.i.y[0]) : r.top, b = o.i.y ? Math.min(r.bottom, o.i.y[1]) : r.bottom;
        if (rr - l >= 2 && b - t >= 2 && frags.length < 2000) frags.push({ o, l, r: rr, t, b });
      }
    }
    frags.sort((a, b) => a.t - b.t);
    let ops = 0;
    outer: for (let a = 0; a < frags.length; a++) {
      const A = frags[a];
      for (let k = a + 1; k < frags.length && frags[k].t < A.b; k++) {
        if (++ops > 60000 || ((ops & 4095) === 0 && late())) { if (ops <= 60000) skipped.push('overlap'); break outer; }
        const B = frags[k];
        if (A.o === B.o || A.o.el.contains(B.o.el) || B.o.el.contains(A.o.el)) continue;
        const w = Math.min(A.r, B.r) - Math.max(A.l, B.l), h = Math.min(A.b, B.b) - Math.max(A.t, B.t);
        if (w < 4 || h < 4 || w * h < 0.3 * Math.min((A.r - A.l) * (A.b - A.t), (B.r - B.l) * (B.b - B.t))) continue;
        const [P, Q] = A.o.el.compareDocumentPosition(B.o.el) & Node.DOCUMENT_POSITION_FOLLOWING ? [B.o, A.o] : [A.o, B.o];
        add('text-overlap', 'warning', P.el, () => '"' + P.snip + '" overlaps "' + Q.snip + '" (' + where(Q.el) + ') by ' + Math.round(w) + '×' + Math.round(h) + 'px. Fix absolute positioning, negative margins or fixed heights.');
      }
    }
    // 4. Tap targets at mobile widths.
    if (mobile) {
      const sel = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=checkbox],[role=radio],[role=switch],[role=menuitem],[data-action],[tabindex]:not([tabindex="-1"])';
      let tapped = 0;
      for (const el of upto(root.querySelectorAll(sel), 1500)) {
        if ((++tapped & 127) === 0 && late()) { skipped.push('tap targets'); break; }
        if (el.closest('[data-forma-runtime]') || el.matches(':disabled') || !shown(el)) continue;
        const b = el.getBoundingClientRect();
        if (b.right <= 0 || b.left >= vw) continue;
        const s = st(el);
        // WCAG 2.5.8 inline exception: a link inside a sentence (text runs beside it).
        if (el.tagName === 'A' && s.display === 'inline' && el.parentElement && [...el.parentElement.childNodes].some((c) => c.nodeType === 3 && /\S{2,}/.test(c.data))) continue;
        let w = b.width, h = b.height;
        for (const l of el.labels || []) { const lb = l.getBoundingClientRect(); if (Math.min(lb.width, lb.height) > Math.min(w, h)) { w = lb.width; h = lb.height; } }
        const m = Math.min(w, h);
        if (m >= 44) continue;
        add('tap-target', m < 24 ? 'error' : 'warning', el, () => { const nm = snip(accName(el), 24); return kind(el) + (nm ? ' "' + nm + '"' : '') + ' is ' + Math.round(w) + '×' + Math.round(h) + 'px; make tap targets at least 44×44px on mobile (never under 24px), e.g. min-h-11 with padding.'; });
      }
    }
    // 5. Horizontal overflow and the elements causing it. past(r) = how far a box reaches beyond
    // the scroll origin's far edge in document coordinates (the left edge in right-to-left pages).
    const sw = Math.max(html.scrollWidth, body.scrollWidth);
    if (sw > vw + 2) {
      const rtl = st(body).direction === 'rtl', past = (r) => (rtl ? -(r.left + sx) : r.right + sx - vw);
      const clippedBy = (el) => { for (let p = el.parentElement; p && p !== body && p !== html; p = p.parentElement) { const s = st(p); if (!NOCLIP.test(s.display) && s.overflowX !== 'visible') return true; } return false; };
      const all = root.querySelectorAll('*'); let found = 0;
      for (let k = 0; k < all.length && k < 6000 && found < 6; k++) {
        if ((k & 255) === 255 && late()) { skipped.push('overflow'); break; }
        const el = all[k];
        if (el.closest('[data-forma-runtime]')) continue;
        const b = el.getBoundingClientRect();
        if (b.width === 0 && b.height === 0) continue;
        const p = el.parentElement, pb = p && p !== root && p !== body ? p.getBoundingClientRect() : null;
        const table = el.closest('table') ? ' Wrap wide tables in a div with overflow-x-auto.' : '';
        if (past(b) > 1) {
          if ((pb && past(pb) > 1) || clippedBy(el) || st(el).position === 'fixed') continue;
          found++;
          add('overflow', 'error', el, 'Extends ' + Math.round(past(b)) + 'px past the ' + vw + 'px viewport and causes horizontal scrolling. Constrain it (w-full, max-w-full, min-w-0, flex-wrap) or stack columns at this width.' + table);
        } else if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
          // Only the box whose own text runs past the viewport: wrappers of an overflowing
          // descendant have a large scrollWidth too, but the descendant is reported instead.
          let far = -Infinity;
          for (const c of el.childNodes) {
            if (c.nodeType !== 3 || !/\S/.test(c.data)) continue;
            range.selectNodeContents(c);
            for (const r of range.getClientRects()) if (r.width > 0.5) far = Math.max(far, past(r));
          }
          if (far <= 1 || st(el).overflowX !== 'visible' || clippedBy(el)) continue;
          found++;
          add('overflow', 'error', el, 'Content overflows this box by ' + Math.round(far - past(b)) + 'px (unbroken text or nowrap) and causes horizontal scrolling. Allow wrapping (break-words, whitespace-normal) or add min-w-0.' + table);
        }
      }
      if (!found) add('overflow', 'error', root, 'Page is ' + sw + 'px wide in a ' + vw + 'px viewport (horizontal scrolling). Constrain wide elements or stack columns at this width.');
    }
    // 6. Images and accessible names.
    for (const img of upto(root.querySelectorAll('img'), 2000)) {
      if (!shown(img)) continue;
      const alt = img.getAttribute('alt');
      if (alt == null) add('img-alt', 'error', img, 'Image has no alt attribute. Describe it with alt="…", or use alt="" if it is decorative.');
      else if (/^\s*(image|img|photo|picture|graphic|banner|screenshot|placeholder|untitled)?\s*\d*\s*$/i.test(alt) && alt.trim() || /\.(png|jpe?g|gif|webp|svg)\s*$/i.test(alt)) add('img-alt', 'info', img, 'Alt text "' + snip(alt, 24) + '" is not descriptive; say what the image shows.');
      if (img.complete && !img.naturalWidth) add('img-broken', 'warning', img, 'Image failed to load (empty or invalid src). Use a {{reference:N}} image or remove it.');
    }
    for (const el of upto(root.querySelectorAll('[role=img]'), 1000)) if (shown(el) && !accName(el) && !el.closest('[data-forma-expanded]')) add('img-alt', 'warning', el, 'role="img" element has no aria-label; describe it.');
    for (const el of upto(root.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=checkbox],[role=radio],[role=switch],[role=menuitem],[role=combobox],[role=textbox],[role=slider]'), 1500)) {
      if (el.closest('[data-forma-runtime]') || !shown(el) || accName(el)) continue;
      const field = /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && !/^(submit|reset|button|image)$/.test(el.type), ph = clean(el.getAttribute('placeholder'));
      if (field && ph) add('label-placeholder', 'warning', el, 'Field "' + snip(ph, 24) + '" relies on its placeholder; add a visible <label for> or aria-label.');
      else if (field) add('control-name', 'error', el, 'Form field has no label. Add <label for="id">…</label> or aria-label.');
      else add('control-name', 'error', el, kind(el) + ' has no accessible name' + (el.querySelector('svg,i,img') ? ' (icon-only?)' : '') + '. Add visible text or aria-label="…".');
    }
    // 7. Heading structure.
    let prev = 0, prevText = '', h1 = false, any = false;
    for (const h of upto(root.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]'), 1000)) {
      if (!shown(h)) continue;
      const lv = /^H[1-6]$/.test(h.tagName) ? +h.tagName[1] : Math.min(6, Math.max(1, parseInt(h.getAttribute('aria-level'), 10) || 2));
      any = true; if (lv === 1) h1 = true;
      if (lv > prev + 1 && (prev || lv > 2)) add('heading-skip', 'warning', h, prev ? 'h' + lv + ' "' + snip(h.textContent, 24) + '" follows h' + prev + ' "' + snip(prevText, 24) + '"; use h' + (prev + 1) + ' and style it with classes.' : 'The first heading is h' + lv + ' "' + snip(h.textContent, 24) + '"; start the screen at h1.');
      prev = lv; prevText = h.textContent;
    }
    if (any && !h1) add('heading-h1', 'info', root, 'The screen has no h1; mark its main title as h1.');
    // 8. Contrast on solid backgrounds (last: it may scroll to hit-test below the fold).
    const MEDIA = /^(IMG|VIDEO|CANVAS|IFRAME|OBJECT|EMBED|PICTURE)$/, NONE = [0, 0, 0, 0];
    // The canvas is painted by html's background, or body's when html has none (CSS propagation).
    // A gradient there makes every text on it unmeasurable rather than "on white".
    const hs = st(html), htmlPaints = hs.backgroundImage !== 'none' || (rgba(hs.backgroundColor) || NONE)[3] > 0, rs = htmlPaints ? hs : st(body);
    const canvas = rs.backgroundImage !== 'none' ? null : mix(rgba(rs.backgroundColor) || NONE, [255, 255, 255, 1]);
    // a over b, both possibly translucent.
    const over = (a, b) => { const al = a[3] + b[3] * (1 - a[3]); return al <= 0 ? NONE : [0, 1, 2].map((k) => (a[k] * a[3] + b[k] * b[3] * (1 - a[3])) / al).concat(al); };
    // A positioned ::before/::after covering its host (hero and card overlays) paints between the
    // host's background and its text: composite a solid one; gradients or images make it unmeasurable.
    const pseudo = (p, s, v) => {
      const page = p === html || p === body, positioned = s.position !== 'static' || s.transform !== 'none';
      let box = null;
      for (const k of ['::before', '::after']) {
        const ps = getComputedStyle(p, k);
        if (ps.content === 'none' || ps.content === 'normal' || ps.display === 'none' || ps.visibility !== 'visible') continue;
        const fixed = ps.position === 'fixed';
        if (!fixed && !(ps.position === 'absolute' && (positioned || page))) continue;
        const op = parseFloat(ps.opacity), img = ps.backgroundImage !== 'none', c = rgba(ps.backgroundColor) || NONE;
        if (!(op >= 0.05) || (!img && !(c[3] > 0))) continue;
        box = box || (fixed || (page && !positioned) ? { width: vw, height: vh } : p.getBoundingClientRect());
        if (!(parseFloat(ps.width) >= box.width * 0.9 && parseFloat(ps.height) >= box.height * 0.9)) continue;
        if (img || v === null || ps.mixBlendMode !== 'normal' || (ps.filter && ps.filter !== 'none') || (ps.backdropFilter && ps.backdropFilter !== 'none')) return null;
        const top = [c[0], c[1], c[2], c[3] * Math.min(1, op)];
        // z-index < 0 without a stacking context on the host paints below the host's background.
        const below = parseInt(ps.zIndex, 10) < 0 && !((s.zIndex !== 'auto' && s.position !== 'static') || parseFloat(s.opacity) < 1 || s.transform !== 'none' || s.isolation === 'isolate' || (s.filter && s.filter !== 'none'));
        v = below ? over(v, top) : over(top, v);
      }
      return v;
    };
    // Paint layer of one element: null = unmeasurable (image, gradient, blend, filter, media),
    // [r,g,b,0] = transparent. Cached, as is the composited ancestor background.
    const layerCache = new Map(), ancCache = new Map();
    const layer = (p) => {
      if (layerCache.has(p)) return layerCache.get(p);
      let v;
      if (MEDIA.test(p.tagName) || p instanceof SVGElement) v = null;
      else {
        const s = st(p);
        v = p === html || (p === body && !htmlPaints) ? NONE : s.backgroundImage !== 'none' || s.mixBlendMode !== 'normal' || (s.filter && s.filter !== 'none') || (s.backdropFilter && s.backdropFilter !== 'none') ? null : rgba(s.backgroundColor);
        if (v !== null && !/^(INPUT|SELECT|TEXTAREA|BR|HR)$/.test(p.tagName)) v = pseudo(p, s, v);
      }
      layerCache.set(p, v); return v;
    };
    const own = (p, isText) => { const v = layer(p); return v === null && isText && (MEDIA.test(p.tagName) || p instanceof SVGElement) ? NONE : v; };
    const ancestors = (el) => {
      const chain = []; let p = el;
      while (p && !ancCache.has(p)) { chain.push(p); p = p.parentElement; }
      let bg = p ? ancCache.get(p) : canvas;
      for (let k = chain.length - 1; k >= 0; k--) { const c = layer(chain[k]); bg = c === null ? null : c[3] >= 0.999 ? c : bg === null ? null : c[3] > 0 ? mix(c, bg) : bg; ancCache.set(chain[k], bg); }
      return bg;
    };
    // Hit-testing sees boxes with pointer-events:none too (decorative overlays often set it):
    // a constructed sheet (no DOM node) forces them hit-testable until the finally block.
    // adoptedStyleSheets is a live array, so the original list is copied before appending.
    let hitMs = 0;
    const HIT_MS = Math.min(400, budget / 3);
    const hitTest = (x, y) => {
      if (forced === null) try { forced = new CSSStyleSheet(); forced.replaceSync('*,*::before,*::after{pointer-events:auto!important}'); adopted = [...D.adoptedStyleSheets]; D.adoptedStyleSheets = [...adopted, forced]; } catch (e) { forced = false; }
      const h0 = performance.now(), list = D.elementsFromPoint(x, y);
      hitMs += performance.now() - h0;
      return list;
    };
    const background = (el, x, y) => {
      let chain = null;
      if (x != null) { const s = hitTest(x, y), k = s.indexOf(el); if (k >= 0) chain = s.slice(k); }
      if (!chain) { const c = own(el, true); if (c === null) return null; const up = el.parentElement ? ancestors(el.parentElement) : canvas; return c[3] >= 0.999 ? c : up === null ? null : c[3] > 0 ? mix(c, up) : up; }
      const layers = [];
      for (const p of chain) {
        const c = own(p, p === el);
        if (c === null) return null;
        if (c[3] > 0) { layers.push(c); if (c[3] >= 0.999) break; }
      }
      const last = layers[layers.length - 1], solid = !!last && last[3] >= 0.999;
      if (!solid && canvas === null) return null;
      let bg = solid ? last : canvas;
      for (let k = layers.length - (solid ? 2 : 1); k >= 0; k--) bg = mix(layers[k], bg);
      return bg;
    };
    const pairs = new Map();
    const judge = (o, x, y) => {
      const c = rgba(o.s.webkitTextFillColor || o.s.color);
      if (!c || c[3] === 0) return;
      const bg = background(o.el, x, y);
      if (!bg) { add('contrast-unknown', 'info', o.el, '"' + o.snip + '" sits on a background image, gradient or blended layer, so contrast was not measured. Check it stays readable; a solid background or overlay behind text guarantees it.'); return; }
      const fg = mix([c[0], c[1], c[2], c[3] * Math.min(1, o.i.opacity)], bg);
      const a = lum(fg), b = lum(bg), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const large = o.fs >= 24 || (o.fs >= 18.66 && (parseInt(o.s.fontWeight, 10) || 400) >= 700), need = large ? 3 : 4.5;
      if (ratio >= need - 0.005) return;
      const key = hex(fg) + hex(bg) + need, prior = pairs.get(key);
      if (prior) { prior.more++; return; }
      const f = add('contrast', 'error', o.el, '"' + o.snip + '": text ' + hex(fg) + ' on ' + hex(bg) + ' is ' + (Math.floor(ratio * 10) / 10).toFixed(1) + ':1; needs ' + need + ':1' + (large ? ' (large text)' : '') + '. ' + (a < b ? 'Darken the text or lighten the background.' : 'Lighten the text or darken the background.'));
      if (f) pairs.set(key, { f, more: 0 });
    };
    // Hit-testing is costly (1–4ms on large pages), so it only runs for text points that sit
    // over a painted box which is not an ancestor (positioned overlays, media, negative
    // margins). Everything else uses the ancestor walk. Boxes are indexed in vertical bands.
    const BAND = 256, bands = new Map(), all = root.querySelectorAll('*');
    let entries = 0, scans = 400000;
    for (let k = 0; k < all.length && k < 8000 && entries < 200000; k++) {
      const el = all[k];
      if (el instanceof SVGElement && !(el instanceof SVGSVGElement)) continue;
      const s = st(el);
      if (!MEDIA.test(el.tagName) && !(el instanceof SVGSVGElement) && s.backgroundImage === 'none' && !((rgba(s.backgroundColor) || NONE)[3] > 0)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const box = { el, l: r.left + sx, t: r.top + sy, r: r.right + sx, b: r.bottom + sy };
      for (let n = Math.floor(box.t / BAND), e = Math.min(Math.floor(box.b / BAND), n + 400); n <= e; n++) { let a = bands.get(n); if (!a) bands.set(n, (a = [])); a.push(box); entries++; }
    }
    const overlaid = (el, ax, ay) => {
      let anc = null;
      for (const b of bands.get(Math.floor(ay / BAND)) || []) {
        if (--scans < 0) return false;
        if (ax < b.l || ax > b.r || ay < b.t || ay > b.b || b.el === el) continue;
        if (!anc) { anc = new Set(); for (let p = el.parentElement; p; p = p.parentElement) anc.add(p); }
        if (!anc.has(b.el) && !el.contains(b.el)) return true;
      }
      return false;
    };
    // Overlaid text that cannot be hit-tested (budget, off-screen, inner scrollers) is counted,
    // not judged against its ancestors: that background is known to be wrong there.
    const later = [];
    let hits = 0, unmeasured = 0, judged = 0;
    for (const o of visible) {
      if (o.i.disabled) continue;
      if ((++judged & 63) === 0 && late()) { skipped.push('contrast'); break; }
      const r = o.rects.find((q) => q.width >= 2) || o.rects[0], x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (!overlaid(o.el, x + sx, y + sy)) { judge(o, null, null); continue; }
      if (hits >= 400 || hitMs > HIT_MS || o.i.fixed || x < 0 || x >= vw) { unmeasured++; continue; }
      hits++;
      if (y >= 0 && y < vh) judge(o, x, y);
      else later.push({ o, x, y: y + sy });
    }
    later.sort((a, b) => a.y - b.y);
    for (const it of later) {
      if (hitMs > HIT_MS || late()) { unmeasured++; continue; }
      if (it.y - scrollY < 0 || it.y - scrollY >= vh) scrollTo({ top: Math.max(0, it.y - vh / 3), left: sx, behavior: 'instant' });
      const y = it.y - scrollY;
      if (y >= 0 && y < vh) judge(it.o, it.x, y); else unmeasured++;
    }
    if (unmeasured) out.push({ rule: 'contrast-unknown', severity: 'info', screen, viewport, target: root === body ? 'page' : 'screen', message: unmeasured + ' text element' + (unmeasured > 1 ? 's' : '') + ' over overlapping layers could not be hit-tested, so their contrast was not measured.' });
    for (const { f, more } of pairs.values()) if (more) f.message += ' Same colours on ' + more + ' more element' + (more > 1 ? 's' : '') + '.';
  } finally {
    if (forced) try { D.adoptedStyleSheets = adopted; } catch (e) {}
    if (scrollX !== sx || scrollY !== sy) scrollTo({ top: sy, left: sx, behavior: 'instant' });
  }
  if (skipped.length) out.push({ rule: 'lint-partial', severity: 'info', screen, viewport, target: root === body ? 'page' : 'screen', message: 'Page lint stopped after ' + Math.round(performance.now() - t0) + 'ms on this very large page; skipped part of: ' + skipped.join(', ') + '.' });
  for (const rule in extra) out.push({ rule, severity: 'info', screen, viewport, target: root === body ? 'page' : 'screen', message: extra[rule] + ' more ' + rule + ' findings were omitted; fix the pattern everywhere.' });
  const rank = { error: 0, warning: 1, info: 2 };
  return out.map((f, i) => [f, i]).sort((a, b) => rank[a[0].severity] - rank[b[0].severity] || a[1] - b[1]).map((x) => x[0]).slice(0, max);
}
const PAGE_LINT_SOURCE = PAGE_LINT.toString();
// Findings coming back from a page are re-validated: the page is model-authored.
function cleanFindings(findings, cap = 2000) {
  if (!Array.isArray(findings)) return [];
  const out = [];
  for (const f of findings) {
    if (out.length >= cap) break;
    if (!f || typeof f !== 'object' || typeof f.rule !== 'string' || !/^[a-z][a-z0-9-]{0,40}$/.test(f.rule) || !Object.prototype.hasOwnProperty.call(SEV, f.severity)) continue;
    const opt = (v, n) => (v == null || v === '' ? null : cut(v, n));
    out.push({ rule: f.rule, severity: f.severity, screen: opt(f.screen, 60), viewport: opt(f.viewport, 80), target: cut(f.target ?? '', 120), message: cut(f.message ?? '', 400) });
  }
  return out;
}
// Merge findings (static and page, several viewports): identical rule/screen/target/message
// collapse into one finding whose viewport lists every viewport, errors first. Merging
// already-merged lists is idempotent, and the most severe copy wins.
function mergeFindings(...lists) {
  const map = new Map();
  for (const f of cleanFindings(lists.flat(), 20000)) {
    const k = [f.rule, f.screen, f.target, f.message].join('\u0000'), old = map.get(k);
    if (!old) { map.set(k, { ...f }); continue; }
    if (SEV[f.severity] < SEV[old.severity]) old.severity = f.severity;
    const seen = old.viewport ? old.viewport.split(',') : [];
    for (const v of f.viewport ? f.viewport.split(',') : []) if (v && !seen.includes(v)) seen.push(v);
    old.viewport = seen.length ? cut(seen.join(','), 80) : null;
  }
  return sortFindings([...map.values()]);
}
// Score 100 means no findings. Each error costs ~10 points, warning ~3, info ~0.5, with
// diminishing returns so the score stays in 0..100 and keeps ranking very poor pages.
function scoreFindings(findings) {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of Array.isArray(findings) ? findings : []) if (f && Object.prototype.hasOwnProperty.call(counts, f.severity)) counts[f.severity]++;
  const points = counts.error * SEVERITY_WEIGHT.error + counts.warning * SEVERITY_WEIGHT.warning + counts.info * SEVERITY_WEIGHT.info;
  return { score: Math.max(0, Math.min(100, Math.round(100 * Math.exp(-points / 80)))), counts };
}
// Compact plain-text summary for model prompts: errors first, rules interleaved so every
// problem type is visible within `max` lines.
function findingsPrompt(findings, max = 20) {
  const all = sortFindings(cleanFindings(findings, 20000));
  if (!all.length) return '';
  max = Math.max(1, Math.min(200, Number.isInteger(max) ? max : 20));
  const picked = [];
  for (const sev of ['error', 'warning', 'info']) {
    const byRule = new Map();
    for (const f of all) if (f.severity === sev) { if (!byRule.has(f.rule)) byRule.set(f.rule, []); byRule.get(f.rule).push(f); }
    const queues = [...byRule.values()];
    while (picked.length < max && queues.some((q) => q.length)) for (const q of queues) if (q.length && picked.length < max) picked.push(q.shift());
  }
  const { counts } = scoreFindings(all);
  const lines = picked.map((f) => `- ${f.severity} ${f.rule}${f.screen || f.viewport ? ` [${[f.screen, f.viewport].filter(Boolean).join(' @ ')}]` : ''}${f.target ? ` ${f.target}` : ''}: ${f.message}`);
  if (all.length > picked.length) lines.push(`- …and ${all.length - picked.length} more findings.`);
  return `Lint findings (${counts.error} errors, ${counts.warning} warnings, ${counts.info} info):\n${lines.join('\n')}`;
}
async function lintPage(page, opts = {}) {
  return cleanFindings(await page.evaluate(PAGE_LINT, opts));
}
module.exports = { staticLint, PAGE_LINT, PAGE_LINT_FN: PAGE_LINT, PAGE_LINT_SOURCE, lintPage, scoreFindings, findingsPrompt, mergeFindings, cleanFindings, sortFindings };
