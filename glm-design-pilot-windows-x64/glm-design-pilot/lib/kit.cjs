'use strict';
// Forma kit: design tokens -> CSS variables, bundled @font-face embedding, component CSS and its prompt text.
// normalizeTokens is the only gate between untrusted token objects (presets, model plans, imports, legacy 0.2
// design systems) and CSS: everything emitted is a #rrggbb colour, a clamped number, an enum or a FONTS key.
const fs = require('node:fs');
const path = require('node:path');
const { FONTS, PRESETS, DEFAULT_PRESET, preset } = require('./presets.cjs');
const ASSETS = path.join(__dirname, '..', 'assets');

// ---- colour maths: sRGB <-> OKLab (mirrors CSS color-mix(in oklab, …)) and WCAG 2 contrast ----
function hex(x) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(typeof x === 'string' ? x.trim() : '');
  if (!m) return null;
  const h = m[1].toLowerCase();
  return '#' + (h.length === 3 ? [...h].map(c => c + c).join('') : h);
}
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const lin = c => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = c => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const toHex = a => '#' + a.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
function luminance(h) { const [r, g, b] = rgb(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
function contrast(a, b) { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }
function oklab(h) {
  const [r, g, b] = rgb(h).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromOklab([L, A, B]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3, m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3, s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return toHex([4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(gam));
}
// mix(a, b, p) === color-mix(in oklab, a p*100%, b)
function mix(a, b, p) { const x = oklab(a), y = oklab(b); return fromOklab(x.map((v, i) => v * p + y[i] * (1 - p))); }
const chroma = h => { const [, a, b] = oklab(h); return Math.hypot(a, b); };
const hue = h => { const [, a, b] = oklab(h); return (Math.atan2(b, a) * 180 / Math.PI + 360) % 360; };
const hueGap = (x, y) => { const d = Math.abs(hue(x) - hue(y)) % 360; return Math.min(d, 360 - d); };
const isDark = bg => luminance(bg) < 0.18;

// ---- token normalisation ----
const COLORS = ['accent', 'accent2', 'background', 'surface', 'text', 'muted', 'border', 'success', 'warning', 'danger'];
const ENUM = { density: ['compact', 'comfortable', 'spacious'], shadow: ['none', 'soft', 'medium', 'crisp'] };
const STATUS = { light: { success: '#15803d', warning: '#b45309', danger: '#dc2626', info: '#2563eb' }, dark: { success: '#34d399', warning: '#fbbf24', danger: '#f87171', info: '#60a5fa' } };
// Chart / companion candidates: 600-level hues read on light surfaces, 400-level on dark ones.
const HUES = {
  light: ['#0284c7', '#d97706', '#059669', '#e11d48', '#7c3aed', '#0d9488', '#db2777', '#4d7c0f', '#ea580c', '#4f46e5'],
  dark: ['#38bdf8', '#fbbf24', '#34d399', '#fb7185', '#a78bfa', '#2dd4bf', '#f472b6', '#a3e635', '#fb923c', '#818cf8'],
};
const FONT_KEYS = Object.keys(FONTS);
function fontKey(v) {
  if (typeof v !== 'string') return null;
  const first = v.split(',')[0].trim().replace(/^["']|["']$/g, '').trim().toLowerCase();
  return FONT_KEYS.find(k => k.toLowerCase() === first) || null;
}
function num(v, lo, hi, fallback, digits = 0) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*(px)?\s*$/.test(v) ? parseFloat(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const f = 10 ** digits;
  return Math.round(Math.min(hi, Math.max(lo, n)) * f) / f;
}
// Smallest share of fg (mixed into bg) that still reads at AA on every background in `on`.
function readable(fg, bg, on, from = 0.5) {
  for (let p = from; p < 1; p += 0.02) { const c = mix(fg, bg, p); if (on.every(b => contrast(c, b) >= 4.6)) return c; }
  return fg;
}
// Second accent for custom systems: the first of teal, sky, violet, emerald, rose, amber that sits 60-160° away.
function companion(accent, dark) {
  const list = [5, 0, 4, 2, 3, 1].map(i => HUES[dark ? 'dark' : 'light'][i]);
  return chroma(accent) < 0.04 ? list[0] : list.find(c => hueGap(c, accent) >= 60 && hueGap(c, accent) <= 160) || list[0];
}

function normalizeTokens(ds) {
  const src = ds && typeof ds === 'object' && !Array.isArray(ds) ? ds : {};
  const c = Object.fromEntries(COLORS.map(k => [k, hex(src[k])]));
  // A known preset id merges over that preset; no usable colours at all means the default preset.
  const named = (typeof src.preset === 'string' && preset(src.preset)) || (COLORS.some(k => c[k]) ? null : preset(DEFAULT_PRESET));
  c.background ||= (named || preset(DEFAULT_PRESET)).tokens.background;
  const dark = isDark(c.background);
  const base = (named || preset(dark ? 'midnight' : DEFAULT_PRESET)).tokens, struct = (named || preset(DEFAULT_PRESET)).tokens;
  if (named) for (const k of COLORS) c[k] ||= base[k];
  else {
    // Legacy 0.2 or custom systems: derive what is missing from the colours that were given.
    c.text ||= base.text;
    c.accent ||= base.accent;
    c.surface ||= dark ? mix(c.text, c.background, 0.06) : '#ffffff';
    c.muted ||= readable(c.text, c.background, [c.background, c.surface]);
    c.border ||= mix(c.text, c.surface, dark ? 0.16 : 0.12);
    c.accent2 ||= companion(c.accent, dark);
    for (const k of ['success', 'warning', 'danger']) c[k] ||= STATUS[dark ? 'dark' : 'light'][k];
  }
  const legacy = fontKey(src.font);
  const bodyFont = fontKey(src.bodyFont) || legacy || base.bodyFont;
  // An explicitly chosen preset keeps its heading face; legacy single-font systems use their font throughout.
  const headingFont = fontKey(src.headingFont) || (named && named.id === src.preset ? base.headingFont : legacy || bodyFont);
  const name = typeof src.name === 'string' ? src.name.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 80) : '';
  return {
    name: name || (named ? named.name : 'Custom'),
    preset: named ? named.id : 'custom',
    accent: c.accent, accent2: c.accent2, background: c.background, surface: c.surface, text: c.text, muted: c.muted, border: c.border,
    success: c.success, warning: c.warning, danger: c.danger,
    headingFont, bodyFont, monoFont: fontKey(src.monoFont) || base.monoFont, font: bodyFont,
    radius: num(src.radius, 0, 40, struct.radius),
    spacing: num(src.spacing, 4, 24, struct.spacing),
    density: ENUM.density.includes(src.density) ? src.density : struct.density,
    shadow: ENUM.shadow.includes(src.shadow) ? src.shadow : struct.shadow,
    typeScale: num(src.typeScale, 1.1, 1.5, struct.typeScale, 3),
  };
}

// ---- derived colours: each is a color-mix() of base variables (so live token tweaks propagate) whose
// percentage is chosen here so the resolved colour passes WCAG AA. `hex` is the resolved value for tests/lint.
function derive(input) {
  const t = normalizeTokens(input), dark = isDark(t.background);
  const ink = [t.text, t.background].find(c => luminance(c) < 0.05) || '#0b0b0f';
  const on = c => (contrast('#ffffff', c) >= 4.5 || contrast('#ffffff', c) >= contrast(ink, c) ? '#ffffff' : ink);
  const v = (name, a, p, b) => ({ css: `color-mix(in oklab,var(${a}) ${p}%,${b.startsWith('#') ? b : `var(${b})`})`, hex: mix(t[name] || name, b.startsWith('#') ? b : t[b.slice(2)], p / 100) });
  const strongPct = (c, bgs) => { for (let p = 100; p > 0; p -= 5) if (bgs.every(b => contrast(mix(c, t.text, p / 100), b) >= 4.5)) return p; return 0; };
  const surface2 = v('surface', '--surface', dark ? 94 : 96, '--text');
  const out = { tokens: t, dark, onAccent: on(t.accent), onDanger: on(t.danger), surface2,
    borderStrong: v('border', '--border', dark ? 78 : 82, '--text') };
  out.accentHover = v('accent', '--accent', 86, out.onAccent === '#ffffff' ? '#000000' : '#ffffff');
  out.dangerHover = v('danger', '--danger', 86, out.onDanger === '#ffffff' ? '#000000' : '#ffffff');
  const info = STATUS[dark ? 'dark' : 'light'].info;
  out.tones = {};
  for (const [tone, color, softPct] of [['accent', t.accent, dark ? 18 : 10], ['success', t.success], ['warning', t.warning], ['danger', t.danger], ['info', info]]) {
    const pct = softPct || (dark ? 16 : 11);
    const soft = mix(color, t.surface, pct / 100);
    const sp = strongPct(color, [soft, t.surface, t.background, surface2.hex]);
    const ref = `var(--${tone})`;
    out.tones[tone] = { color, soft: { css: `color-mix(in oklab,${ref} ${pct}%,var(--surface))`, hex: soft }, strong: { css: `color-mix(in oklab,${ref} ${sp}%,var(--text))`, hex: mix(color, t.text, sp / 100) } };
  }
  // Charts: accent, accent-2, then the candidates whose hues sit furthest from those already chosen.
  const chosen = [t.accent, t.accent2], pool = [...HUES[dark ? 'dark' : 'light']];
  while (chosen.length < 6) {
    const hued = chosen.filter(c => chroma(c) >= 0.04);
    const score = c => (hued.length ? Math.min(...hued.map(h => hueGap(c, h))) : 180);
    pool.sort((a, b) => score(b) - score(a));
    chosen.push(pool.shift());
  }
  // Calm systems (earthy or ink accents) get calmer chart hues: blend extra colours toward muted.
  const target = (chroma(t.accent) + chroma(t.accent2)) / 2;
  out.chart = chosen.map((c, i) => { const k = i < 2 ? 0 : Math.min(0.5, Math.max(0, 1 - target / chroma(c))); return k > 0.05 ? mix(c, t.muted, 1 - k) : c; });
  return out;
}

const DENSITY = {
  compact: { controls: [32, 36, 40], pad: 2, body: '.875rem' },
  comfortable: { controls: [36, 40, 44], pad: 2.5, body: '.9375rem' },
  spacious: { controls: [36, 44, 48], pad: 3, body: '1rem' },
};
const SHADOWS = {
  none: ['0 0 #0000', '0 0 #0000', '0 16px 40px -12px C(.2)'], // transparent, not `none`, so shadow lists stay valid
  soft: ['0 1px 2px C(.05)', '0 1px 2px C(.04),0 4px 12px -2px C(.07)', '0 4px 8px -2px C(.05),0 20px 44px -12px C(.2)'],
  medium: ['0 1px 3px C(.09)', '0 2px 4px C(.06),0 10px 24px -6px C(.14)', '0 6px 12px -4px C(.08),0 28px 60px -16px C(.3)'],
  crisp: ['0 1px 1px C(.07)', '0 1px 2px C(.1),0 0 0 1px C(.02)', '0 2px 4px C(.07),0 14px 32px -8px C(.26)'],
};
// Fluid steps: [min factor, floor rem, cap rem]; preferred value interpolates 390px -> 1280px viewports.
const FLUID = { '3xl': [3, 0.8, 1.5, 3], '4xl': [4, 0.62, 1.875, 3.75], '5xl': [5, 0.52, 2.25, 4.75] };
const fluid = ([n, f, floor, cap]) => `clamp(max(${floor}rem,calc(var(--ts-${n}) * ${f}rem)),calc(var(--ts-${n}) * (${(f - (1 - f) * 390 / 890).toFixed(4)}rem + ${((1 - f) * 1600 / 890).toFixed(4)}vw)),min(calc(var(--ts-${n}) * 1rem),${cap}rem))`;
const stack = k => { const f = FONTS[k]; return `'${k}', ${f.fallback}`; };

function tokenVars(input) {
  const d = derive(input), t = d.tokens, dens = DENSITY[t.density];
  const sh = d.dark ? [0, 0, 0] : rgb(t.text), k = d.dark ? 2.6 : 1;
  const shadow = SHADOWS[t.shadow].map(s => s.replace(/C\(([\d.]+)\)/g, (_, a) => `rgb(${sh.join(' ')} / ${Math.min(0.8, +a * k).toFixed(2)})`));
  const hf = FONTS[t.headingFont];
  const vars = {
    'color-scheme': d.dark ? 'dark' : 'light',
    '--accent': t.accent, '--on-accent': d.onAccent, '--accent-2': t.accent2,
    '--accent-hover': d.accentHover.css, '--accent-strong': d.tones.accent.strong.css, '--accent-soft': d.tones.accent.soft.css,
    '--background': t.background, '--surface': t.surface, '--surface-2': d.surface2.css,
    '--text': t.text, '--muted': t.muted, '--border': t.border, '--border-strong': d.borderStrong.css,
    '--success': t.success, '--warning': t.warning, '--danger': t.danger, '--info': d.tones.info.color,
    '--on-danger': d.onDanger, '--danger-hover': d.dangerHover.css,
    '--glow': chroma(t.accent) < 0.04 ? 'var(--accent-2)' : 'var(--accent)',
  };
  for (const tone of ['success', 'warning', 'danger', 'info']) { vars[`--${tone}-soft`] = d.tones[tone].soft.css; vars[`--${tone}-strong`] = d.tones[tone].strong.css; }
  Object.assign(vars, {
    '--ring': 'var(--accent-strong)', '--ring-soft': 'color-mix(in oklab,var(--accent) 24%,transparent)',
    '--font': stack(t.bodyFont), '--font-heading': stack(t.headingFont), '--font-mono': stack(t.monoFont),
    '--heading-weight': String(hf.heading || 650), '--heading-tracking': `${hf.tracking ?? -0.02}em`,
    '--radius': `${t.radius}px`, '--radius-sm': 'calc(var(--radius) * .6)', '--radius-lg': 'min(calc(var(--radius) * 1.5),calc(var(--radius) + 8px))',
    '--radius-pill': '999px', '--radius-badge': 'min(999px,calc(var(--radius) * 2))',
    '--space': `${t.spacing}px`,
  });
  for (let i = 1; i <= 12; i++) vars[`--space-${i}`] = `calc(var(--space) * ${i / 2})`;
  Object.assign(vars, {
    '--pad': `calc(var(--space) * ${dens.pad})`,
    '--control-sm': `${dens.controls[0]}px`, '--control': `${dens.controls[1]}px`, '--control-lg': `${dens.controls[2]}px`,
    '--type-scale': String(t.typeScale), '--ts-3': 'calc(var(--type-scale) * var(--type-scale) * var(--type-scale))',
    '--ts-4': 'calc(var(--ts-3) * var(--type-scale))', '--ts-5': 'calc(var(--ts-4) * var(--type-scale))',
    '--text-xs': '.75rem', '--text-sm': '.875rem', '--text-base': '1rem', '--text-lg': '1.125rem',
    '--text-xl': 'calc(1rem * var(--type-scale))', '--text-2xl': 'calc(1rem * var(--type-scale) * var(--type-scale))',
    '--text-3xl': fluid(FLUID['3xl']), '--text-4xl': fluid(FLUID['4xl']), '--text-5xl': fluid(FLUID['5xl']),
    '--text-body': dens.body,
    '--leading-tight': '1.15', '--leading-snug': '1.35', '--leading-normal': FONTS[t.bodyFont].category === 'serif' ? '1.65' : '1.55',
    '--shadow-sm': shadow[0], '--shadow': shadow[1], '--shadow-lg': shadow[2],
    '--sidebar-width': '248px', '--topbar-height': '56px', '--container': '1200px',
  });
  d.chart.forEach((c, i) => { vars[`--chart-${i + 1}`] = c; });
  return vars;
}
function tokensCSS(tokens) { return `:root{${Object.entries(tokenVars(tokens)).map(([k, v]) => `${k}:${v}`).join(';')}}`; }

// ---- fonts ----
const faces = new Map();
function fontFaceCSS(families) {
  const list = typeof families === 'string' ? [families] : families && typeof families[Symbol.iterator] === 'function' ? [...families] : [];
  const keys = [...new Set(list.map(fontKey))].filter(k => k && FONTS[k].file);
  return keys.map(k => {
    if (!faces.has(k)) {
      let rule = '';
      try {
        const f = FONTS[k], data = fs.readFileSync(path.join(ASSETS, 'fonts', f.file)).toString('base64');
        rule = `@font-face{font-family:'${k}';src:url(data:font/woff2;base64,${data}) format('woff2');font-weight:${f.weight};font-style:normal;font-display:swap}`;
      } catch { /* a missing font file falls back to the system stack */ }
      faces.set(k, rule);
    }
    return faces.get(k);
  }).filter(Boolean).join('\n');
}

// ---- kit ----
let kitSource = null;
const minify = css => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/\s*([{};,>])\s*/g, '$1').replace(/;}/g, '}').trim();
function kitBaseCSS() { return (kitSource ??= minify(fs.readFileSync(path.join(ASSETS, 'kit', 'forma-kit.css'), 'utf8'))); }
// Class names styled by the kit. utilityCSS must not generate rules for these: Tailwind also defines
// container, table, list-item and sr-only, and a later utility rule would override the component.
const KIT_CLASSES = Object.freeze([...new Set(kitBaseCSS().replace(/\{[^{}]*\}/g, '{}').match(/\.[a-z][a-z0-9-]*/g).map(c => c.slice(1)))].sort());
function kitCSS(tokens) {
  const t = normalizeTokens(tokens);
  return [fontFaceCSS([t.headingFont, t.bodyFont, t.monoFont]), tokensCSS(t), kitBaseCSS()].filter(Boolean).join('\n');
}

function tweakDefaults(tokens) {
  const t = normalizeTokens(tokens);
  return [
    { var: '--radius', label: 'Corner radius', min: 0, max: 40, step: 1, unit: 'px', value: t.radius },
    { var: '--space', label: 'Spacing unit', min: 4, max: 24, step: 1, unit: 'px', value: t.spacing },
    { var: '--type-scale', label: 'Type scale', min: 1.1, max: 1.5, step: 0.01, unit: '', value: t.typeScale },
  ];
}

const KIT_REFERENCE = `Forma kit classes have zero specificity: any utility class overrides them. Use them instead of hand-written CSS.
LAYOUT: container (centred max-width + gutters) · stack (vertical flex, gap-4) · cluster (wrapping row, gap-3) · grid-auto (auto-fit columns ≥ 240px) · split (2 columns from md) · page (app main content: padding + vertical gap) · page-header (title + muted line left, actions right) · section (vertical band on websites) · section-header (centred eyebrow + h2 + p).
APP SHELL: <div class="app-shell"><aside class="sidebar"><a class="brand" href="#"><span class="brand-mark"><i data-icon="layers"></i></span>Name</a><nav class="nav" aria-label="Main"><p class="nav-label">Workspace</p><button class="nav-item is-active" aria-current="page" data-action="navigate" data-target="home"><i data-icon="house"></i>Home</button>…</nav><div class="sidebar-footer">…</div></aside><header class="topbar">…</header><main class="page">…</main></div>. Under 768px the sidebar becomes a scrolling top strip. topbar is also the sticky header of websites (brand, nav, actions).
TYPE: h1–h6 are pre-styled with the heading font. display = hero headline; lead = large muted intro paragraph; eyebrow = small uppercase accent kicker above a heading. Plain <ul>/<ol> get bullets; any class removes them. prose = long-form article text.
BUTTONS: btn + btn-primary (the one main action) | btn-secondary | btn-ghost (toolbar, low emphasis) | btn-danger; btn-sm | btn-lg; btn-icon = square icon button (needs aria-label). Icon first: <button class="btn btn-primary"><i data-icon="plus"></i>New request</button>.
CARDS: card = padded surface with border. Optional parts: card-header (title + actions, ruled), card-body, card-footer (right-aligned actions); card-title, card-description. A table, table-wrap or list placed directly in a card sits flush.
DATA: stat > stat-label, stat-value, stat-delta (+ is-positive|is-negative: colour means good/bad, the arrow icon shows direction) (KPI tile; 3–4 in a grid). Tables: plain <table> is styled; put data-label="Column" on every <td> so rows stack on phones; num right-aligns figures; table-wrap scrolls wide tables. badge + badge-success|warning|danger|info|neutral|accent (+ badge-dot) for status. avatar (initials or img; avatar-sm|avatar-lg; avatar-group overlaps). progress (<progress class="progress" value="64" max="100">). list > list-item = divided rows (a/button rows get hover). timeline (<ol class="timeline"><li class="is-complete"><time>…</time><p>…</p></li>). steps (<ol class="steps"><li class="is-complete">Details</li><li class="is-active">Review</li><li>Done</li></ol>). chart = figure for data-chart.
FORMS: field (stacks label + control + help) with label, input, select, textarea, help. Bare inputs/selects/textareas get the same look. input-icon wraps a leading icon + input: <div class="input-icon"><i data-icon="search"></i><input type="search" aria-label="Search"></div>. Errors: is-invalid on the control. <label class="checkbox"><input type="checkbox"> Text</label> · <label class="radio"><input type="radio" name="g"> Text</label> · <label class="switch"><input type="checkbox" role="switch"> Text</label>.
NAVIGATION: tabs > tab (aria-selected="true" on the current tab; tabs-pill = segmented control) · breadcrumb (<nav class="breadcrumb" aria-label="Breadcrumb"><ol><li><a href="#">Requests</a></li><li aria-current="page">REQ-104</li></ol></nav>) · pagination (buttons; aria-current="page" on the current one) · chip (filter toggle, aria-pressed="true" when on).
FEEDBACK: alert + alert-success|warning|danger|info (icon, alert-title, text) · toast (+ toast-region pins toasts to a corner) · empty-state (icon-tile, h3, one sentence, one action) · skeleton (loading placeholder) · <dialog> is pre-styled: dialog-title, dialog-description, dialog-footer (actions).
MARKETING: hero (centred, generous padding, soft accent glow; hero-split = text + visual side by side) · feature-grid > feature (icon-tile + h3 + p) · pricing > plan (+ is-featured) with plan-name, plan-price (<span>/month</span> inside), plan-features (<ul>, check marks automatic), btn at the end · accordion (FAQ: <div class="accordion"><details><summary>Question</summary><p>Answer</p></details>…</div>).
MISC: icon-tile (tinted square holding an icon) · divider (<hr class="divider"> or <div class="divider">or</div>) · kbd · sr-only.
STATE: is-active or aria-current="page" marks current navigation; aria-selected for tabs; aria-pressed for chips; disabled attribute for unavailable controls.
TOKENS for your own CSS: --accent --on-accent --accent-soft (tinted fill) --accent-strong (accent text) --accent-2 --background --surface --surface-2 --text --muted --border --success|warning|danger|info (+ -soft, -strong) --radius --radius-sm --radius-lg --shadow-sm --shadow --shadow-lg --space-1…--space-12 --text-xs…--text-5xl --font --font-heading --font-mono --chart-1…--chart-6.`;

const KIT_EXAMPLE = `<div class="app-shell">
  <aside class="sidebar">
    <a class="brand" href="#overview"><span class="brand-mark"><i data-icon="layers"></i></span>Service Desk</a>
    <nav class="nav" aria-label="Main">
      <p class="nav-label">Workspace</p>
      <button class="nav-item is-active" aria-current="page" data-action="navigate" data-target="overview"><i data-icon="layout-dashboard"></i>Overview</button>
      <button class="nav-item" data-action="navigate" data-target="requests"><i data-icon="inbox"></i>Requests<span class="badge badge-accent">12</span></button>
      <button class="nav-item" data-action="navigate" data-target="new-request"><i data-icon="plus"></i>New request</button>
    </nav>
    <div class="sidebar-footer cluster">
      <span class="avatar avatar-sm">AK</span><span class="text-sm font-medium">Asha Kumar</span>
    </div>
  </aside>
  <header class="topbar">
    <div class="input-icon w-full max-w-sm">
      <i data-icon="search"></i>
      <input type="search" placeholder="Search requests" aria-label="Search requests" data-action="filter" data-target="request-rows">
    </div>
    <div class="cluster ml-auto">
      <button class="btn btn-ghost btn-icon" aria-label="Notifications" data-action="toggle" data-target="notice"><i data-icon="bell"></i></button>
      <button class="btn btn-primary" data-action="navigate" data-target="new-request"><i data-icon="plus"></i>New request</button>
    </div>
  </header>
  <main class="page">
    <div class="page-header">
      <div>
        <h1>Overview</h1>
        <p>Open IT requests across teams this week. <span class="badge badge-neutral">Sample data</span></p>
      </div>
      <div class="tabs tabs-pill" role="tablist" aria-label="Period">
        <button class="tab" role="tab" aria-selected="true" data-action="tab" data-group="period" data-target="week">Week</button>
        <button class="tab" role="tab" aria-selected="false" data-action="tab" data-group="period" data-target="month">Month</button>
      </div>
    </div>
    <div id="notice" class="alert alert-info" role="status" hidden><i data-icon="info"></i><div><p class="alert-title">Maintenance window</p><p>Ticket sync pauses Saturday 22:00–23:00.</p></div></div>
    <div id="week" data-panel="period" class="stack gap-6">
      <section class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Key figures">
        <div class="stat"><p class="stat-label"><i data-icon="inbox"></i>Open requests</p><p class="stat-value">48</p><p class="stat-delta is-positive"><i data-icon="trending-down"></i>6 fewer than last week</p></div>
        <div class="stat"><p class="stat-label"><i data-icon="timer"></i>Median first reply</p><p class="stat-value">1h 12m</p><p class="stat-delta is-positive"><i data-icon="trending-up"></i>18 min faster</p></div>
        <div class="stat"><p class="stat-label"><i data-icon="circle-check"></i>Resolved</p><p class="stat-value">131</p><p class="stat-delta">Same as last week</p></div>
        <div class="stat"><p class="stat-label"><i data-icon="triangle-alert"></i>Breaching SLA</p><p class="stat-value">3</p><p class="stat-delta is-negative">Needs attention</p></div>
      </section>
      <div class="grid gap-4 lg:grid-cols-3">
        <section class="card lg:col-span-2">
          <div class="card-header"><h2 class="card-title">Requests by team</h2><span class="badge badge-neutral">This week</span></div>
          <div class="card-body"><figure class="chart" data-chart='{"type":"bar","title":"Requests by team","labels":["Finance","People","Sales","Ops"],"series":[{"name":"Open","values":[14,9,16,9]}],"unit":""}'></figure></div>
        </section>
        <section class="card">
          <div class="card-header"><h2 class="card-title">Needs attention</h2><button class="btn btn-ghost btn-sm" data-action="navigate" data-target="requests">View all</button></div>
          <ul class="list">
            <li class="list-item"><span class="avatar avatar-sm">LM</span><div class="min-w-0 flex-1"><p class="truncate text-sm font-medium">VPN drops on hotel Wi-Fi</p><p class="text-xs text-muted">REQ-311 · 2h left</p></div><span class="badge badge-danger badge-dot">SLA</span></li>
            <li class="list-item"><span class="avatar avatar-sm">RN</span><div class="min-w-0 flex-1"><p class="truncate text-sm font-medium">Laptop for new starter</p><p class="text-xs text-muted">REQ-305 · due today</p></div><span class="badge badge-warning">Waiting</span></li>
          </ul>
        </section>
      </div>
      <section class="card">
        <div class="card-header"><h2 class="card-title">Latest requests</h2><button class="btn btn-secondary btn-sm"><i data-icon="download"></i>Export</button></div>
        <table>
          <thead><tr><th scope="col">Request</th><th scope="col">Team</th><th scope="col">Status</th><th scope="col" class="num">Age</th></tr></thead>
          <tbody id="request-rows">
            <tr data-row><td data-label="Request"><button class="font-medium hover:underline" data-action="navigate" data-target="request-detail">REQ-311 VPN drops</button></td><td data-label="Team">Sales</td><td data-label="Status"><span class="badge badge-danger">Breaching</span></td><td data-label="Age" class="num">2d</td></tr>
            <tr data-row><td data-label="Request"><button class="font-medium hover:underline" data-action="navigate" data-target="request-detail">REQ-305 New laptop</button></td><td data-label="Team">People</td><td data-label="Status"><span class="badge badge-warning">Waiting</span></td><td data-label="Age" class="num">1d</td></tr>
            <tr data-row><td data-label="Request"><button class="font-medium hover:underline" data-action="navigate" data-target="request-detail">REQ-298 Shared drive access</button></td><td data-label="Team">Finance</td><td data-label="Status"><span class="badge badge-success">Resolved</span></td><td data-label="Age" class="num">4h</td></tr>
          </tbody>
        </table>
      </section>
    </div>
    <div id="month" data-panel="period" hidden>
      <div class="empty-state"><span class="icon-tile"><i data-icon="calendar"></i></span><h3>No monthly report yet</h3><p>Monthly figures appear after the first full month of tracking.</p><button class="btn btn-secondary" data-action="tab" data-group="period" data-target="week">Back to this week</button></div>
    </div>
  </main>
</div>`;

module.exports = { normalizeTokens, tokensCSS, tokenVars, fontFaceCSS, kitCSS, KIT_CLASSES, KIT_REFERENCE, KIT_EXAMPLE, tweakDefaults, derive, contrast, mix, hex, luminance, PRESETS, FONTS };
