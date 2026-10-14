'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const K = require('../lib/kit.cjs');
const { FONTS, PRESETS, DEFAULT_PRESET, preset } = require('../lib/presets.cjs');
const ROOT = path.join(__dirname, '..');
const KIT_FILE = fs.readFileSync(path.join(ROOT, 'assets/kit/forma-kit.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const HEX = /^#[0-9a-f]{6}$/;
const LEGACY = { name: 'Forma / Violet', accent: '#6554c0', background: '#f6f7fb', surface: '#ffffff', text: '#202333', muted: '#667085', font: 'Segoe UI', radius: 12, spacing: 8 };
const LEGACY_DARK = { name: 'Slate / Dark', accent: '#a9a2ff', background: '#14171f', surface: '#202530', text: '#f2f4f9', muted: '#a3adbf', font: 'Segoe UI', radius: 16, spacing: 8 };
const SPEC_VARS = ['--accent', '--on-accent', '--background', '--surface', '--text', '--muted', '--radius', '--space', '--font',
  '--accent-2', '--accent-soft', '--accent-strong', '--border', '--success', '--warning', '--danger', '--font-heading', '--font-mono',
  ...Array.from({ length: 12 }, (_, i) => `--space-${i + 1}`), '--radius-sm', '--radius-lg', '--radius-pill', '--shadow-sm', '--shadow', '--shadow-lg',
  ...['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl'].map(s => `--text-${s}`), '--leading-tight', '--leading-normal',
  ...Array.from({ length: 6 }, (_, i) => `--chart-${i + 1}`)];
const SPEC_CLASSES = ['btn', 'btn-primary', 'btn-secondary', 'btn-ghost', 'btn-danger', 'btn-sm', 'btn-lg', 'btn-icon', 'card', 'card-header', 'card-body', 'card-footer',
  'badge', 'badge-success', 'badge-warning', 'badge-danger', 'badge-info', 'badge-neutral', 'badge-accent', 'field', 'label', 'input', 'select', 'textarea', 'help',
  'switch', 'checkbox', 'tabs', 'tab', 'table', 'app-shell', 'sidebar', 'topbar', 'nav', 'nav-item', 'is-active', 'avatar', 'stat', 'hero', 'section', 'eyebrow',
  'display', 'lead', 'feature-grid', 'pricing', 'timeline', 'steps', 'empty-state', 'alert', 'alert-success', 'alert-warning', 'alert-danger', 'alert-info', 'toast',
  'list', 'list-item', 'breadcrumb', 'pagination', 'progress', 'chip', 'divider', 'kbd', 'chart', 'icon', 'sr-only', 'container', 'stack', 'cluster', 'grid-auto'];
const classesIn = html => [...html.matchAll(/class="([^"]*)"/g)].flatMap(m => m[1].split(/\s+/).filter(Boolean));
// Split a selector list at top-level commas (commas inside :where()/:is()/:not() stay).
const splitTop = sel => { const out = []; let d = 0, cur = ''; for (const ch of sel) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && !d) { out.push(cur); cur = ''; } else cur += ch; } return [...out, cur]; };

// Resolved colour pairs that the kit puts text on (see forma-kit.css), per preset.
function textPairs(tokens) {
  const d = K.derive(tokens), t = d.tokens, T = d.tones, s2 = d.surface2.hex;
  const pairs = [
    ['text/background', t.text, t.background], ['text/surface', t.text, t.surface], ['text/surface-2', t.text, s2],
    ['muted/background', t.muted, t.background], ['muted/surface', t.muted, t.surface], ['muted/surface-2 (table head, neutral badge)', t.muted, s2],
    ['on-accent/accent', d.onAccent, t.accent], ['on-accent/accent-hover', d.onAccent, d.accentHover.hex],
    ['on-danger/danger', d.onDanger, t.danger], ['on-danger/danger-hover', d.onDanger, d.dangerHover.hex],
  ];
  for (const [tone, v] of Object.entries(T)) {
    pairs.push([`${tone}-strong/${tone}-soft`, v.strong.hex, v.soft.hex], [`${tone}-strong/surface`, v.strong.hex, t.surface],
      [`${tone}-strong/background`, v.strong.hex, t.background], [`text/${tone}-soft (alerts)`, t.text, v.soft.hex]);
  }
  return pairs;
}

test('colour maths matches WCAG and CSS color-mix(in oklab)', () => {
  assert.equal(K.contrast('#000000', '#ffffff').toFixed(2), '21.00');
  assert.equal(K.contrast('#ffffff', '#ffffff'), 1);
  assert.ok(Math.abs(K.contrast('#777777', '#ffffff') - 4.48) < 0.01);
  assert.equal(K.mix('#000000', '#ffffff', 0.5), '#636363'); // color-mix(in oklab, black, white) = rgb(99 99 99)
  assert.equal(K.mix('#4f46e5', '#ffffff', 1), '#4f46e5');
  assert.equal(K.mix('#4f46e5', '#ffffff', 0), '#ffffff');
  assert.equal(K.hex('#ABC'), '#aabbcc');
  for (const bad of ['abc', '#abcd', '#12345g', 'red', 'rgb(0,0,0)', ' #fff;}', null, 12, {}]) assert.equal(K.hex(bad), null);
});

test('presets are curated, distinct and complete', () => {
  assert.ok(PRESETS.length >= 8 && PRESETS.length <= 12);
  assert.equal(new Set(PRESETS.map(p => p.id)).size, PRESETS.length);
  assert.equal(new Set(PRESETS.map(p => p.tokens.accent)).size, PRESETS.length);
  assert.ok(preset(DEFAULT_PRESET));
  assert.equal(preset('nope'), null);
  assert.ok(PRESETS.some(p => K.luminance(p.tokens.background) < 0.05), 'at least one dark preset');
  for (const p of PRESETS) {
    assert.match(p.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(p.name && p.description.length > 20 && Array.isArray(p.mood) && p.mood.length >= 2, p.id);
    assert.equal(preset(p.id), p);
    for (const k of ['accent', 'accent2', 'background', 'surface', 'text', 'muted', 'border', 'success', 'warning', 'danger']) assert.match(p.tokens[k], HEX, `${p.id}.${k}`);
    for (const k of ['headingFont', 'bodyFont', 'monoFont']) assert.ok(FONTS[p.tokens[k]], `${p.id}.${k}`);
    // Preset tokens are already normal: normalisation changes nothing they define.
    const n = K.normalizeTokens(p.tokens);
    for (const [k, v] of Object.entries(p.tokens)) assert.deepEqual(n[k], v, `${p.id}.${k}`);
    assert.equal(n.preset, p.id);
    assert.equal(n.font, n.bodyFont);
  }
  // Moods differ: headline/body pairings are not all the same.
  assert.ok(new Set(PRESETS.map(p => `${p.tokens.headingFont}/${p.tokens.bodyFont}`)).size >= 8);
});

test('every preset passes WCAG AA for text, muted text, accent and status colours', () => {
  const failures = [];
  for (const p of PRESETS)
    for (const [label, fg, bg] of textPairs(p.tokens)) {
      const ratio = K.contrast(fg, bg);
      if (ratio < 4.5) failures.push(`${p.id} ${label}: ${fg} on ${bg} = ${ratio.toFixed(2)}`);
    }
  assert.deepEqual(failures, []);
});

test('legacy and custom systems also get AA derived colours', () => {
  const samples = [LEGACY, LEGACY_DARK, { accent: '#facc15' }, { accent: '#22c55e', background: '#ffffff' }, { background: '#000000', accent: '#ff5500' }, { accent: '#0f172a', background: '#f8fafc' }];
  const failures = [];
  for (const s of samples)
    for (const [label, fg, bg] of textPairs(s))
      if (!label.startsWith('text/') && !label.startsWith('muted/') && K.contrast(fg, bg) < 4.5) failures.push(`${JSON.stringify(s)} ${label}`);
  assert.deepEqual(failures, []);
  // Derived muted text (not supplied) reads on the supplied background.
  const m = K.normalizeTokens({ accent: '#2255cc', background: '#fdfcf8', text: '#222222' });
  assert.ok(K.contrast(m.muted, m.background) >= 4.5 && K.contrast(m.muted, m.surface) >= 4.5);
  assert.ok(K.contrast(m.muted, m.background) < K.contrast(m.text, m.background));
  // Light accents get dark text; saturated mid accents keep white.
  assert.notEqual(K.derive({ accent: '#facc15' }).onAccent, '#ffffff');
  assert.equal(K.derive({ accent: '#4f46e5' }).onAccent, '#ffffff');
});

test('normalizeTokens fills 0.2 design systems', () => {
  const n = K.normalizeTokens(LEGACY);
  assert.deepEqual(Object.keys(n), ['name', 'preset', 'accent', 'accent2', 'background', 'surface', 'text', 'muted', 'border', 'success', 'warning', 'danger',
    'headingFont', 'bodyFont', 'monoFont', 'font', 'radius', 'spacing', 'density', 'shadow', 'typeScale']);
  assert.equal(n.preset, 'custom');
  for (const k of ['name', 'accent', 'background', 'surface', 'text', 'muted', 'radius', 'spacing']) assert.equal(n[k], LEGACY[k]);
  assert.equal(n.bodyFont, 'Segoe UI'); assert.equal(n.headingFont, 'Segoe UI'); assert.equal(n.font, 'Segoe UI'); assert.equal(n.monoFont, 'JetBrains Mono');
  for (const k of ['accent2', 'border', 'success', 'warning', 'danger']) assert.match(n[k], HEX);
  assert.deepEqual([n.density, n.shadow, n.typeScale], ['comfortable', 'soft', 1.25]);
  assert.ok(K.contrast(n.border, n.surface) > 1.1 && K.contrast(n.border, n.surface) < 2, 'derived border is a hairline');
  const d = K.normalizeTokens(LEGACY_DARK);
  assert.equal(d.success, '#34d399', 'dark systems get light status colours');
  assert.equal(d.density, 'comfortable', 'structure comes from the default preset, not the dark one');
  assert.ok(K.contrast(d.border, d.surface) > 1.2);
  // Partial systems from model plans merge over their preset.
  const e = K.normalizeTokens({ preset: 'editorial', accent: '#0055aa', radius: 0 });
  assert.equal(e.preset, 'editorial'); assert.equal(e.accent, '#0055aa'); assert.equal(e.radius, 0);
  assert.equal(e.headingFont, 'Fraunces'); assert.equal(e.background, preset('editorial').tokens.background);
});

test('normalizeTokens validates, clamps and rejects hostile values', () => {
  const base = K.normalizeTokens({});
  assert.equal(base.preset, DEFAULT_PRESET);
  for (const junk of [null, undefined, [], 'neutral', 42, true, () => {}]) assert.deepEqual(K.normalizeTokens(junk), base);
  const n = (o) => K.normalizeTokens({ ...LEGACY, ...o });
  assert.equal(n({ radius: 99 }).radius, 40); assert.equal(n({ radius: -4 }).radius, 0); assert.equal(n({ radius: 7.6 }).radius, 8);
  assert.equal(n({ radius: '12px' }).radius, 12); assert.equal(n({ radius: '1e9' }).radius, 8); assert.equal(n({ radius: NaN }).radius, 8);
  assert.equal(n({ radius: Infinity }).radius, 8); assert.equal(n({ radius: '12rem' }).radius, 8);
  assert.equal(n({ spacing: 1 }).spacing, 4); assert.equal(n({ spacing: 100 }).spacing, 24);
  assert.equal(n({ typeScale: 3 }).typeScale, 1.5); assert.equal(n({ typeScale: 0.2 }).typeScale, 1.1); assert.equal(n({ typeScale: 1.2345 }).typeScale, 1.235);
  assert.equal(n({ density: 'huge' }).density, 'comfortable'); assert.equal(n({ density: 'compact' }).density, 'compact');
  assert.equal(n({ shadow: 'url(x)' }).shadow, 'soft'); assert.equal(n({ shadow: 'crisp' }).shadow, 'crisp');
  assert.equal(n({ accent: '#ABC' }).accent, '#aabbcc');
  for (const bad of ['red', 'url(javascript:x)', '#fff;}body{display:none', '#12345', 'var(--x)', 'expression(alert(1))'])
    assert.equal(n({ accent: bad }).accent, K.normalizeTokens({ ...LEGACY, accent: undefined }).accent, bad);
  assert.equal(n({ bodyFont: 'Comic Sans MS' }).bodyFont, 'Segoe UI', 'unknown body font falls back to the legacy font');
  assert.equal(K.normalizeTokens({ preset: 'warm', bodyFont: 'Papyrus' }).bodyFont, 'Manrope', 'unknown font -> preset default');
  assert.equal(K.normalizeTokens({ preset: 'warm', headingFont: "x'}*{color:red" }).headingFont, 'Manrope');
  assert.equal(n({ bodyFont: "'Inter', system-ui, sans-serif" }).bodyFont, 'Inter');
  assert.equal(n({ bodyFont: 'ibm plex sans' }).bodyFont, 'IBM Plex Sans');
  assert.equal(n({ name: '  <b>Team</b>\u0000 style  ' }).name, 'bTeam/b style');
  assert.equal(n({ name: 'x'.repeat(200) }).name.length, 80);
  assert.equal(n({ name: 7 }).name, 'Custom');
  assert.equal(n({ evil: 'x', __proto__: { polluted: 1 } }).evil, undefined);
});

test('normalizeTokens is idempotent', () => {
  const inputs = [...PRESETS.map(p => p.tokens), LEGACY, LEGACY_DARK, {}, { accent: '#ff0066' }, { background: '#101010' }, { preset: 'bold', density: 'compact', bodyFont: 'Inter' }, { font: 'Georgia' }];
  for (const x of inputs) { const once = K.normalizeTokens(x); assert.deepEqual(K.normalizeTokens(once), once, JSON.stringify(x)); }
});

test('tokensCSS emits one :root rule with every token variable', () => {
  for (const tokens of [...PRESETS.map(p => p.tokens), LEGACY, LEGACY_DARK]) {
    const css = K.tokensCSS(tokens);
    assert.match(css, /^:root\{[^{}]+\}$/);
    for (const v of SPEC_VARS) assert.ok(css.includes(`${v}:`), `${v} missing`);
    assert.doesNotMatch(css, /[<>\\]|url\(|@import|@font-face|\/\*|expression/i);
    assert.match(css, /color-mix\(in oklab,var\(--accent\) \d+%,var\(--surface\)\)/);
  }
  assert.match(K.tokensCSS(preset('midnight').tokens), /color-scheme:dark/);
  assert.match(K.tokensCSS(preset('neutral').tokens), /color-scheme:light/);
  const v = K.tokenVars(preset('neutral').tokens);
  assert.equal(v['--accent'], '#4f46e5'); assert.equal(v['--radius'], '8px'); assert.equal(v['--space'], '8px'); assert.equal(v['--chart-1'], '#4f46e5');
  assert.equal(v['--font'], `'Inter', ${FONTS.Inter.fallback}`);
  assert.equal(v['--space-4'], 'calc(var(--space) * 2)');
  assert.match(K.tokenVars(LEGACY)['--font'], /^'Segoe UI', /);
  for (let i = 1; i <= 6; i++) assert.match(v[`--chart-${i}`], HEX);
  assert.equal(new Set(Array.from({ length: 6 }, (_, i) => v[`--chart-${i + 1}`])).size, 6);
  // Derived scales are var() expressions so radius / spacing / type tweaks restyle everything live.
  assert.match(v['--radius-lg'], /var\(--radius\)/); assert.match(v['--text-5xl'], /var\(--ts-5\)/); assert.match(v['--text-xl'], /var\(--type-scale\)/);
});

test('tokensCSS cannot be broken out of by hostile token objects', () => {
  const css = K.tokensCSS({ accent: 'red;}body{display:none}', background: '#fff}</style><script>', headingFont: "Inter'}html{x:y", bodyFont: '\\0041', name: '</style>', radius: '4px;}*{', density: '}', shadow: '{', typeScale: '1.2;}' });
  assert.equal(css.split('{').length, 2); assert.equal(css.split('}').length, 2);
  assert.doesNotMatch(css, /display:none|<\/style|script|html\{|\\/);
});

test('tweakDefaults returns schema-valid tweaks for the token knobs', () => {
  for (const tokens of [preset('neutral').tokens, preset('luxury').tokens, LEGACY, {}]) {
    const tw = K.tweakDefaults(tokens), n = K.normalizeTokens(tokens);
    assert.ok(tw.length >= 2 && tw.length <= 8);
    for (const t of tw) {
      assert.match(t.var, /^--[a-z][a-z0-9-]{1,40}$/);
      assert.ok(typeof t.label === 'string' && t.label.length <= 40);
      assert.ok(t.min < t.max && t.step > 0 && t.value >= t.min && t.value <= t.max);
      assert.ok(['px', 'rem', 'em', '%', 'vh', 'vw', ''].includes(t.unit));
      assert.ok(t.var in K.tokenVars(tokens), `${t.var} is a kit variable`);
    }
    assert.equal(tw.find(t => t.var === '--radius').value, n.radius);
    assert.equal(tw.find(t => t.var === '--space').value, n.spacing);
    assert.equal(tw.find(t => t.var === '--type-scale').value, n.typeScale);
  }
});

test('fontFaceCSS embeds bundled woff2 files once and skips system or unknown fonts', () => {
  for (const [name, f] of Object.entries(FONTS)) {
    if (f.system) { assert.equal(K.fontFaceCSS([name]), ''); continue; }
    assert.ok(fs.existsSync(path.join(ROOT, 'assets/fonts', f.file)), f.file);
  }
  for (const empty of [[], null, undefined, 42, {}, ['Comic Sans'], ['Arial', 'Georgia']]) assert.equal(K.fontFaceCSS(empty), '');
  const css = K.fontFaceCSS(['Inter', 'inter', "'Inter', sans-serif", 'Fraunces', 'Arial']);
  assert.equal(css.match(/@font-face/g).length, 2);
  const m = /font-family:'Inter';src:url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\) format\('woff2'\);font-weight:100 900;font-style:normal;font-display:swap/.exec(css);
  assert.ok(m, 'Inter face');
  const bytes = Buffer.from(m[1], 'base64');
  assert.equal(bytes.subarray(0, 4).toString('latin1'), 'wOF2');
  assert.deepEqual(bytes, fs.readFileSync(path.join(ROOT, 'assets/fonts', FONTS.Inter.file)));
  assert.equal(K.fontFaceCSS('Fraunces'), K.fontFaceCSS(['Fraunces']));
  // Cached: repeated calls do not touch the disk again.
  K.kitCSS(preset('neutral').tokens);
  const read = fs.readFileSync; let reads = 0;
  fs.readFileSync = (...a) => { reads++; return read(...a); };
  try { K.fontFaceCSS(['Inter', 'Fraunces']); K.kitCSS(preset('neutral').tokens); } finally { fs.readFileSync = read; }
  assert.equal(reads, 0);
});

test('kitCSS embeds only the fonts the tokens use', () => {
  const faces = css => [...css.matchAll(/@font-face\{font-family:'([^']+)'/g)].map(m => m[1]).sort();
  assert.deepEqual(faces(K.kitCSS(preset('neutral').tokens)), ['Inter', 'JetBrains Mono']);
  assert.deepEqual(faces(K.kitCSS(preset('editorial').tokens)), ['Fraunces', 'JetBrains Mono', 'Source Serif 4']);
  assert.deepEqual(faces(K.kitCSS(preset('luxury').tokens)), ['DM Serif Display', 'Inter', 'JetBrains Mono']);
  assert.deepEqual(faces(K.kitCSS(LEGACY)), ['JetBrains Mono']);
  assert.deepEqual(faces(K.kitCSS({ ...LEGACY, monoFont: 'Verdana' })), []);
  const css = K.kitCSS(preset('bold').tokens);
  assert.ok(css.indexOf(':root{') > css.lastIndexOf('@font-face'), 'fonts, then tokens, then components');
  assert.ok(css.indexOf(':where(.btn') > css.indexOf(':root{'));
});

test('forma-kit.css is safe, balanced and self-contained', () => {
  assert.doesNotMatch(KIT_FILE, /url\(|@import|@font-face|expression\(|javascript:|<\/?style|https?:/i);
  const css = K.kitCSS(LEGACY).replace(/@font-face\{[^}]*\}/g, '');
  assert.doesNotMatch(css, /url\(|@import|<|\\/);
  let depth = 0;
  for (const ch of css.replace(/"[^"]*"/g, '')) { if (ch === '{') depth++; if (ch === '}') depth--; assert.ok(depth >= 0); }
  assert.equal(depth, 0);
  for (const ch of ['(', '[']) assert.equal(css.split(ch).length, css.split(ch === '(' ? ')' : ']').length, `balanced ${ch}`);
  // Every var() the kit reads is defined by tokensCSS (or is a documented local hook with a fallback).
  const defined = new Set(Object.keys(K.tokenVars(LEGACY)));
  const local = new Set([...KIT_FILE.matchAll(/(--[a-z0-9-]+):/g)].map(m => m[1]));
  const used = [...KIT_FILE.matchAll(/var\((--[a-z0-9-]+)(,?)/g)];
  const missing = used.filter(([, v, fallback]) => !defined.has(v) && !local.has(v) && !fallback).map(m => m[1]);
  assert.deepEqual([...new Set(missing)], []);
});

test('kit selectors have zero specificity so utilities and model CSS win', () => {
  const rules = [];
  K.kitCSS(LEGACY).replace(/@font-face\{[^}]*\}/g, '').replace(/@keyframes [\w-]+\{(?:[^{}]*\{[^}]*\})*\}/g, '')
    .replace(/([^{}@]+)\{[^{}]*\}/g, (_, sel) => { rules.push(sel.trim()); return ''; });
  assert.ok(rules.length > 300);
  const stripWhere = s => { let out = '', i = 0; while (i < s.length) { if (s.startsWith(':where(', i)) { let d = 0; for (; i < s.length; i++) { if (s[i] === '(') d++; if (s[i] === ')' && --d === 0) { i++; break; } } } else out += s[i++]; } return out; };
  const offenders = [];
  for (const rule of rules)
    for (const sel of splitTop(rule)) {
      const rest = stripWhere(sel).replace(/::?(before|after|backdrop|placeholder|selection|marker|-webkit-[a-z-]+|-moz-[a-z-]+)/g, '').replace(/[*\s>+~]/g, '');
      if (rest && rest !== ':root') offenders.push(sel);
    }
  assert.deepEqual(offenders, []);
});

test('the kit covers every component in the spec plus accessibility affordances', () => {
  const kit = new Set(K.KIT_CLASSES);
  for (const c of SPEC_CLASSES) assert.ok(kit.has(c), `.${c}`);
  assert.ok(KIT_FILE.includes(':where(dialog)'));
  assert.match(KIT_FILE, /:focus-visible/);
  assert.match(KIT_FILE, /@media \(prefers-reduced-motion:reduce\)/);
  // 44px targets on touch screens and at phone widths (page lint measures mobile with a fine pointer).
  assert.match(KIT_FILE, /@media \(pointer:coarse\),\(max-width:640px\)\{[^@]*min-block-size:44px/);
  assert.match(KIT_FILE, /@media \(max-width:640px\)\{[^@]*td\[data-label\]\)::before\{content:attr\(data-label\)/);
  assert.match(KIT_FILE, /tabular-nums/);
  assert.match(KIT_FILE, /\[hidden\]/);
  assert.ok(K.KIT_CLASSES.every(c => /^[a-z][a-z0-9-]*$/.test(c)));
  assert.ok(!kit.has('text-right') && !kit.has('flex'), 'utility names are not claimed by the kit');
});

test('KIT_REFERENCE is compact and only names real kit classes and icons', () => {
  const icons = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/icons/lucide.json'), 'utf8'));
  assert.ok(K.KIT_REFERENCE.length <= 7200, `${K.KIT_REFERENCE.length} chars`);
  const kit = new Set(K.KIT_CLASSES);
  for (const c of classesIn(K.KIT_REFERENCE)) assert.ok(kit.has(c), `reference uses unknown class ${c}`);
  // badge-success|warning|… shorthand counts as naming each variant.
  const ref = K.KIT_REFERENCE.replace(/([a-z][a-z0-9-]*-)((?:[a-z0-9]+\|)+[a-z0-9]+)(?![a-z0-9-])/g, (_, pre, alts) => alts.split('|').map(a => pre + a).join(' '));
  for (const c of SPEC_CLASSES) assert.match(ref, new RegExp(`(^|[^a-z-])${c}([^a-z-]|$)`), c);
  for (const [, n] of K.KIT_REFERENCE.matchAll(/data-icon="([^"]+)"/g)) assert.ok(icons[n], n);
});

test('KIT_EXAMPLE is safe, accessible markup using kit classes, utilities, icons and a chart', () => {
  const x = K.KIT_EXAMPLE;
  assert.doesNotMatch(x, /\sstyle=|<script|\son[a-z]+=|url\(|https?:|javascript:|<iframe|<img|\{\{/i);
  const ids = [...x.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, target] of x.matchAll(/data-action="(?:toggle|tab|filter)"[^>]*data-target="([^"]+)"/g)) assert.ok(ids.includes(target), target);
  const tds = x.match(/<td\b[^>]*>/g);
  assert.ok(tds.length >= 6 && tds.every(td => /data-label="[^"]+"/.test(td)));
  const chart = JSON.parse(/data-chart='([^']+)'/.exec(x)[1]);
  assert.ok(chart.labels.length <= 24 && chart.series.every(s => s.values.length === chart.labels.length && s.values.every(Number.isFinite)));
  const icons = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/icons/lucide.json'), 'utf8'));
  for (const [, n] of x.matchAll(/data-icon="([^"]+)"/g)) assert.ok(icons[n], n);
  for (const b of x.match(/<button\b[^>]*>(?:\s*<i [^>]*><\/i>\s*)<\/button>/g) || []) assert.match(b, /aria-label="/, 'icon-only buttons are labelled');
  assert.match(x, /aria-current="page"/); assert.match(x, /Sample data/);
  const kit = new Set(K.KIT_CLASSES), used = new Set(classesIn(x));
  assert.ok([...used].filter(c => kit.has(c)).length >= 30, 'example exercises the kit');
  let U = null; try { U = require('../lib/utilities.cjs'); } catch { /* utilities module not present yet */ }
  if (U?.classifyClasses) {
    const { unknown } = U.classifyClasses([...used].filter(c => !kit.has(c)));
    assert.deepEqual(unknown, [], 'every non-kit class is a supported utility');
  }
});
