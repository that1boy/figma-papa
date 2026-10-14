'use strict';
// Tailwind v3 compatible utility CSS, generated on demand from the class names a page actually uses.
// Class names are model output and therefore untrusted: a class only produces CSS when every part of it
// matches a fixed scale or the strict arbitrary-value grammar (lengths, percentages, numbers, #hex and
// var(--name)), so no class can smuggle declarations, url() or markup into the stylesheet. Selectors are
// escaped with the CSSOM CSS.escape() algorithm. Output is deterministic: rules are sorted like Tailwind
// (base utilities in plugin order, then pseudo-class variants, then responsive breakpoints).

// ---------------------------------------------------------------- scales
const own = (o, k) => Object.hasOwn(o, k);
const SPACING = { 0: '0px', px: '1px' };
for (const n of [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96]) SPACING[n] = n / 4 + 'rem';
const frac = (ds) => { const o = {}; for (const d of ds) for (let n = 1; n < d; n++) o[`${n}/${d}`] = +(n / d * 100).toFixed(6) + '%'; return o; };
const FRAC = frac([2, 3, 4, 5, 6, 12]), FRAC_SM = { ...frac([2, 3, 4]), full: '100%' };
const KW = { min: 'min-content', max: 'max-content', fit: 'fit-content' };
const W = { auto: 'auto', ...FRAC, full: '100%', screen: '100vw', svw: '100svw', lvw: '100lvw', dvw: '100dvw', ...KW };
const H = { auto: 'auto', ...FRAC, full: '100%', screen: '100vh', svh: '100svh', lvh: '100lvh', dvh: '100dvh', ...KW };
const SIZE = { auto: 'auto', ...FRAC, full: '100%', ...KW };
const MIN_W = { full: '100%', ...KW };
const MIN_H = { full: '100%', screen: '100vh', svh: '100svh', lvh: '100lvh', dvh: '100dvh', ...KW };
const MAX_H = { none: 'none', ...MIN_H };
const SCREENS = [['sm', 640], ['md', 768], ['lg', 1024], ['xl', 1280], ['2xl', 1536]];
const MAX_W = { none: 'none', xs: '20rem', sm: '24rem', md: '28rem', lg: '32rem', xl: '36rem', '2xl': '42rem', '3xl': '48rem', '4xl': '56rem', '5xl': '64rem', '6xl': '72rem', '7xl': '80rem', full: '100%', ...KW, prose: '65ch' };
for (const [n, px] of SCREENS) MAX_W['screen-' + n] = px + 'px';
const BASIS = { auto: 'auto', ...FRAC, full: '100%' };
const INSET = { auto: 'auto', ...FRAC_SM };
const FONT_SIZE = { xs: ['0.75rem', '1rem'], sm: ['0.875rem', '1.25rem'], base: ['1rem', '1.5rem'], lg: ['1.125rem', '1.75rem'], xl: ['1.25rem', '1.75rem'], '2xl': ['1.5rem', '2rem'], '3xl': ['1.875rem', '2.25rem'], '4xl': ['2.25rem', '2.5rem'], '5xl': ['3rem', '1'], '6xl': ['3.75rem', '1'], '7xl': ['4.5rem', '1'], '8xl': ['6rem', '1'], '9xl': ['8rem', '1'] };
const FONT_WEIGHT = { thin: '100', extralight: '200', light: '300', normal: '400', medium: '500', semibold: '600', bold: '700', extrabold: '800', black: '900' };
const SANS = 'ui-sans-serif, system-ui, sans-serif';
const FONT_FAMILY = { sans: `var(--font, ${SANS})`, body: `var(--font, ${SANS})`, heading: `var(--font-heading, var(--font, ${SANS}))`, display: `var(--font-heading, var(--font, ${SANS}))`,
  serif: 'ui-serif, Georgia, Cambria, Times New Roman, Times, serif', mono: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace)' };
const LEADING = { none: '1', tight: '1.25', snug: '1.375', normal: '1.5', relaxed: '1.625', loose: '2', 3: '.75rem', 4: '1rem', 5: '1.25rem', 6: '1.5rem', 7: '1.75rem', 8: '2rem', 9: '2.25rem', 10: '2.5rem' };
const TRACKING = { tighter: '-0.05em', tight: '-0.025em', normal: '0em', wide: '0.025em', wider: '0.05em', widest: '0.1em' };
// Radius follows the design system: sm/DEFAULT/md/lg are the kit tokens, larger sizes scale --radius-lg
// with Tailwind's ratios (xl = 1.5 lg, 2xl = 2 lg, 3xl = 3 lg). Fallbacks are Tailwind's defaults.
const RLG = 'var(--radius-lg, 0.5rem)';
const RADIUS = { none: '0px', sm: 'var(--radius-sm, 0.125rem)', '': 'var(--radius, 0.25rem)', md: 'var(--radius, 0.375rem)', lg: RLG, xl: `calc(${RLG} * 1.5)`, '2xl': `calc(${RLG} * 2)`, '3xl': `calc(${RLG} * 3)`, full: '9999px' };
const SHADOW = { sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)', '': '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)', md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)', xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)', '2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
  inner: 'inset 0 2px 4px 0 rgb(0 0 0 / 0.05)', none: '0 0 #0000' };
const px = (...ns) => Object.fromEntries(ns.map(n => [n, n + 'px']));
const BORDER_W = { '': '1px', ...px(0, 2, 4, 8) }, RING_W = { '': '3px', ...px(0, 1, 2, 4, 8) }, WIDTH5 = px(0, 1, 2, 4, 8);
const OPACITY = {}, OPACITY_PCT = {};
for (let n = 0; n <= 100; n += 5) { OPACITY[n] = String(n / 100); OPACITY_PCT[n] = n + '%'; }
const ints = (a, b, f = String) => { const o = {}; for (let n = a; n <= b; n++) o[n] = f(n); return o; };
const Z = { 0: '0', 10: '10', 20: '20', 30: '30', 40: '40', 50: '50', auto: 'auto' };
const ORDER_SCALE = { ...ints(1, 12), first: '-9999', last: '9999', none: '0' };
const SPAN = { ...ints(1, 12, n => `span ${n} / span ${n}`), full: '1 / -1' }, LINE = { ...ints(1, 13), auto: 'auto' };
const GRID = { ...ints(1, 12, n => `repeat(${n}, minmax(0, 1fr))`), none: 'none', subgrid: 'subgrid' };
const AUTO_TRACK = { auto: 'auto', min: 'min-content', max: 'max-content', fr: 'minmax(0, 1fr)' };
const DURATION = { 0: '0s', ...Object.fromEntries([75, 100, 150, 200, 300, 500, 700, 1000].map(n => [n, n + 'ms'])) };
const deg = (...ns) => Object.fromEntries(ns.map(n => [n, n + 'deg']));
const ROTATE = deg(0, 1, 2, 3, 6, 12, 45, 90, 180), SKEW = deg(0, 1, 2, 3, 6, 12);
const SCALE = { 0: '0', 50: '.5', 75: '.75', 90: '.9', 95: '.95', 100: '1', 105: '1.05', 110: '1.1', 125: '1.25', 150: '1.5' };
const BLUR = { none: '0', sm: '4px', '': '8px', md: '12px', lg: '16px', xl: '24px', '2xl': '40px', '3xl': '64px' };
const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];
const PALETTE = Object.freeze(Object.fromEntries(Object.entries({
  slate: 'f8fafc f1f5f9 e2e8f0 cbd5e1 94a3b8 64748b 475569 334155 1e293b 0f172a 020617',
  gray: 'f9fafb f3f4f6 e5e7eb d1d5db 9ca3af 6b7280 4b5563 374151 1f2937 111827 030712',
  zinc: 'fafafa f4f4f5 e4e4e7 d4d4d8 a1a1aa 71717a 52525b 3f3f46 27272a 18181b 09090b',
  neutral: 'fafafa f5f5f5 e5e5e5 d4d4d4 a3a3a3 737373 525252 404040 262626 171717 0a0a0a',
  stone: 'fafaf9 f5f5f4 e7e5e4 d6d3d1 a8a29e 78716c 57534e 44403c 292524 1c1917 0c0a09',
  red: 'fef2f2 fee2e2 fecaca fca5a5 f87171 ef4444 dc2626 b91c1c 991b1b 7f1d1d 450a0a',
  orange: 'fff7ed ffedd5 fed7aa fdba74 fb923c f97316 ea580c c2410c 9a3412 7c2d12 431407',
  amber: 'fffbeb fef3c7 fde68a fcd34d fbbf24 f59e0b d97706 b45309 92400e 78350f 451a03',
  yellow: 'fefce8 fef9c3 fef08a fde047 facc15 eab308 ca8a04 a16207 854d0e 713f12 422006',
  lime: 'f7fee7 ecfccb d9f99d bef264 a3e635 84cc16 65a30d 4d7c0f 3f6212 365314 1a2e05',
  green: 'f0fdf4 dcfce7 bbf7d0 86efac 4ade80 22c55e 16a34a 15803d 166534 14532d 052e16',
  emerald: 'ecfdf5 d1fae5 a7f3d0 6ee7b7 34d399 10b981 059669 047857 065f46 064e3b 022c22',
  teal: 'f0fdfa ccfbf1 99f6e4 5eead4 2dd4bf 14b8a6 0d9488 0f766e 115e59 134e4a 042f2e',
  cyan: 'ecfeff cffafe a5f3fc 67e8f9 22d3ee 06b6d4 0891b2 0e7490 155e75 164e63 083344',
  sky: 'f0f9ff e0f2fe bae6fd 7dd3fc 38bdf8 0ea5e9 0284c7 0369a1 075985 0c4a6e 082f49',
  blue: 'eff6ff dbeafe bfdbfe 93c5fd 60a5fa 3b82f6 2563eb 1d4ed8 1e40af 1e3a8a 172554',
  indigo: 'eef2ff e0e7ff c7d2fe a5b4fc 818cf8 6366f1 4f46e5 4338ca 3730a3 312e81 1e1b4b',
  violet: 'f5f3ff ede9fe ddd6fe c4b5fd a78bfa 8b5cf6 7c3aed 6d28d9 5b21b6 4c1d95 2e1065',
  purple: 'faf5ff f3e8ff e9d5ff d8b4fe c084fc a855f7 9333ea 7e22ce 6b21a8 581c87 3b0764',
  fuchsia: 'fdf4ff fae8ff f5d0fe f0abfc e879f9 d946ef c026d3 a21caf 86198f 701a75 4a044e',
  pink: 'fdf2f8 fce7f3 fbcfe8 f9a8d4 f472b6 ec4899 db2777 be185d 9d174d 831843 500724',
  rose: 'fff1f2 ffe4e6 fecdd3 fda4af fb7185 f43f5e e11d48 be123c 9f1239 881337 4c0519',
}).map(([k, v]) => [k, Object.freeze(Object.fromEntries(v.split(' ').map((h, i) => [SHADES[i], '#' + h])))])));
// The spec's semantic tokens plus every other colour variable the kit defines and advertises in
// KIT_REFERENCE (surface-2, border-strong, info, the -soft/-strong tints, chart-1…6), so `bg-surface-2` or
// `text-danger-strong` resolve instead of silently producing nothing.
const SEMANTIC_COLORS = Object.freeze(['accent', 'accent-2', 'accent-soft', 'accent-strong', 'background', 'surface', 'text', 'muted', 'border', 'success', 'warning', 'danger', 'on-accent',
  'accent-hover', 'surface-2', 'border-strong', 'info', 'on-danger', 'danger-hover', 'success-soft', 'success-strong', 'warning-soft', 'warning-strong', 'danger-soft', 'danger-strong',
  'info-soft', 'info-strong', 'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6']);
const SEMANTIC = new Set(SEMANTIC_COLORS);
const SPECIAL = { white: '#fff', black: '#000', transparent: 'transparent', current: 'currentColor', inherit: 'inherit' };

// ---------------------------------------------------------------- arbitrary values
const NUM = '(?:\\d{1,6}(?:\\.\\d{1,6})?|\\.\\d{1,6})';
const RE = {
  length: new RegExp(`^-?${NUM}(?:px|rem|em|%|vh|vw|vmin|vmax|svh|lvh|dvh|svw|lvw|dvw|ch|ex|lh|cqw|cqh|cqi|pt)$|^-?0$`),
  // `dim`: a length without percentages, for properties that reject them (border, outline and ring widths,
  // letter-spacing, outline-offset, columns, blur()).
  dim: new RegExp(`^-?${NUM}(?:px|rem|em|vh|vw|vmin|vmax|svh|lvh|dvh|svw|lvw|dvw|ch|ex|lh|cqw|cqh|cqi|pt)$|^-?0$`),
  number: new RegExp(`^-?${NUM}$`),
  color: /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
  angle: new RegExp(`^-?${NUM}(?:deg|rad|grad|turn)$|^0$`),
  time: new RegExp(`^${NUM}m?s$`),
  ratio: new RegExp(`^${NUM}/${NUM}$|^${NUM}$`),
  integer: /^-?\d{1,6}$/,
};
const VAR = /^var\(--[A-Za-z_][\w-]{0,62}\)$/;
const BAD = /url|expression|[\\"'`;{}<>@\s]/i;
// Returns { k: kind, v: css } for '[...]' when the content matches one of `kinds`, else null.
function arbitrary(v, kinds) {
  if (v.length < 3 || v[0] !== '[' || v[v.length - 1] !== ']') return null;
  let s = v.slice(1, -1), hint = '';
  const m = /^(length|percentage|color|number):/.exec(s);
  if (m) { hint = m[1] === 'percentage' ? 'length' : m[1]; s = s.slice(m[0].length); }
  if (!s || BAD.test(s)) return null;
  for (const k of kinds) if ((!hint || hint === k || (hint === 'number' && k === 'integer') || (hint === 'length' && k === 'dim')) && (RE[k].test(s) || VAR.test(s))) return { k, v: s };
  return null;
}
const arb = (v, ...kinds) => arbitrary(v, kinds)?.v ?? null;
const pick = (map, v, ...kinds) => own(map, v) ? map[v] : kinds.length ? arb(v, ...kinds) : null;
const sp = (v, extra) => extra && own(extra, v) ? extra[v] : own(SPACING, v) ? SPACING[v] : arb(v, 'length');
// For properties that reject negative values (padding, gap, sizes, widths, radius, font-size, ...): an
// arbitrary negative such as p-[-4px] would be dropped by the browser, so it is reported as unknown instead.
const nn = (x) => (x != null && x[0] === '-' ? null : x);
// Positive integers (line-clamp, columns) and non-zero grid lines; var() passes through.
const posInt = (x) => (x != null && (VAR.test(x) || +x >= 1) ? x : null);
const lineNo = (x) => (x != null && (VAR.test(x) || !/^-?0+$/.test(x)) ? x : null);
function negate(x) {
  if (x == null) return null;
  if (VAR.test(x)) return `calc(${x} * -1)`;
  if (!/^[\d.]/.test(x)) return null;
  return /^0(?:\.0+)?[a-z%]*$/.test(x) ? x : '-' + x;
}
// Position of the last '/' outside brackets, splitting a value from its modifier (bg-accent/10, text-sm/6).
function splitMod(v) {
  let depth = 0;
  for (let i = v.length - 1; i > 0; i--) {
    const c = v[i];
    if (c === ']' || c === ')') depth++; else if (c === '[' || c === '(') depth--;
    else if (c === '/' && !depth) return i < v.length - 1 ? [v.slice(0, i), v.slice(i + 1)] : [v, null];
  }
  return [v, null];
}
function opacityPct(m) {
  if (own(OPACITY_PCT, m)) return OPACITY_PCT[m];
  const a = arbitrary(m, ['number', 'length']);
  if (!a || VAR.test(a.v)) return null;
  if (a.k === 'number') { const n = +a.v; return n >= 0 && n <= 1 ? +(n * 100).toFixed(4) + '%' : null; }
  return /^\d+(?:\.\d+)?%$/.test(a.v) && +a.v.slice(0, -1) <= 100 ? a.v : null;
}
// Colour value: semantic token, white/black/transparent/current, palette shade or [#hex]/[var(--x)],
// optionally with an opacity modifier rendered as color-mix(in oklab, c N%, transparent).
function color(v) {
  const [b, m] = splitMod(v);
  let c = null;
  if (SEMANTIC.has(b)) c = `var(--${b})`;
  else if (own(SPECIAL, b)) c = SPECIAL[b];
  else {
    const i = b.lastIndexOf('-'), fam = b.slice(0, i), shade = b.slice(i + 1);
    if (i > 0 && own(PALETTE, fam) && own(PALETTE[fam], shade)) c = PALETTE[fam][shade];
    else c = arb(b, 'color');
  }
  if (!c || m == null) return c;
  const p = c === 'inherit' ? null : opacityPct(m);
  return p && `color-mix(in oklab, ${c} ${p}, transparent)`;
}
// grid-cols-[...] / grid-rows-[...]: a strict track-list grammar (no free-form CSS) that also enforces the
// CSS Grid validity rules, so a template the browser would drop is reported as unknown instead of silently
// doing nothing. template := item ('_' item)*; item := repeat(auto-fit|auto-fill|1..100, track ('_' track)*)
// | track; track := minmax(breadth, breadth) | fit-content(len) | breadth; breadth := len | fr | auto
// | min-content | max-content; len := non-negative length/percentage | var(--x) | min()/max()/clamp() of lens.
// auto-fit/auto-fill repeat only fixed-size tracks (a length, or minmax() with a length on either side), may
// appear once, and then every other track must be fixed-size too; minmax() cannot start with fr.
const FR = new RegExp(`^${NUM}fr$`), BREADTH = new Set(['auto', 'min-content', 'max-content']);
function gridTemplate(s) {
  const t = s.match(/[a-z-]+\(|[(),_]|[^(),_]+/g);
  if (!t || t.length > 80 || t.join('') !== s) return null;
  let i = 0;
  const eat = (x) => (t[i] === x ? (i++, true) : false);
  const comma = () => eat(',') && (eat('_'), true);
  // Each piece returns { v: css, k: 'fixed' | 'inflexible' | 'flex' } or null.
  const len = () => {
    const x = t[i];
    if (x === 'var(' && /^--[A-Za-z_][\w-]{0,62}$/.test(t[i + 1] || '') && t[i + 2] === ')') { i += 3; return { v: `var(${t[i - 2]})`, k: 'fixed' }; }
    if (x && x[0] !== '-' && RE.length.test(x)) { i++; return { v: x, k: 'fixed' }; }
    return null;
  };
  const breadth = () => {
    for (const f of ['min(', 'max(', 'clamp(']) if (eat(f)) {
      const a = [len()];
      while (a[a.length - 1] && comma()) a.push(len());
      if (a.includes(null) || a.length < 2 || a.length > 3 || (f === 'clamp(') !== (a.length === 3) || !eat(')')) return null;
      return { v: `${f}${a.map((x) => x.v).join(', ')})`, k: 'fixed' };
    }
    const x = t[i];
    if (x && BREADTH.has(x)) { i++; return { v: x, k: 'inflexible' }; }
    if (x && FR.test(x)) { i++; return { v: x, k: 'flex' }; }
    return len();
  };
  const track = () => {
    if (eat('minmax(')) {
      const a = breadth();
      if (!a || a.k === 'flex' || !comma()) return null;
      const b = breadth();
      return b && eat(')') ? { v: `minmax(${a.v}, ${b.v})`, fixed: a.k === 'fixed' || b.k === 'fixed' } : null;
    }
    if (eat('fit-content(')) { const a = len(); return a && eat(')') ? { v: `fit-content(${a.v})`, fixed: false } : null; }
    const b = breadth();
    return b && { v: b.v, fixed: b.k === 'fixed' };
  };
  const item = () => {
    if (!eat('repeat(')) return track();
    const n = t[i++], auto = n === 'auto-fit' || n === 'auto-fill';
    if (!(auto || (/^\d{1,3}$/.test(n || '') && +n >= 1 && +n <= 100)) || !comma()) return null;
    const a = [track()];
    while (a[a.length - 1] && eat('_')) a.push(track());
    if (a.includes(null) || !eat(')')) return null;
    const fixed = a.every((x) => x.fixed);
    return auto && !fixed ? null : { v: `repeat(${n}, ${a.map((x) => x.v).join(' ')})`, fixed, auto };
  };
  const out = [item()];
  while (out[out.length - 1] && eat('_')) out.push(item());
  if (out.includes(null) || i !== t.length) return null;
  const autos = out.filter((x) => x.auto).length;
  if (autos > 1 || (autos && !out.every((x) => x.fixed))) return null;
  return out.map((x) => x.v).join(' ');
}

// ---------------------------------------------------------------- plugin order (Tailwind v3 corePlugins)
const ORDER = new Map(`container sr pointer-events visibility position inset inset-x inset-y start end top right bottom left isolation z order
col col-start col-end row row-start row-end float clear m mx my ms me mt mr mb ml box line-clamp display aspect size h max-h min-h w min-w max-w
flex shrink grow basis table-layout border-collapse origin translate-x translate-y rotate skew-x skew-y scale scale-x scale-y transform animate
cursor touch select resize scroll-behavior list-pos list-type appearance columns auto-cols grid-flow auto-rows grid-cols grid-rows flex-dir flex-wrap
place-content place-items content items justify justify-items gap gap-x gap-y space-x space-y space-x-rev space-y-rev divide-x divide-y divide-x-rev
divide-y-rev divide-style divide-color place-self self justify-self overflow overflow-x overflow-y overscroll text-overflow hyphens whitespace
text-wrap break rounded rounded-s rounded-e rounded-t rounded-r rounded-b rounded-l rounded-ss rounded-se rounded-ee rounded-es rounded-tl rounded-tr
rounded-br rounded-bl border-w border-x-w border-y-w border-s-w border-e-w border-t-w border-r-w border-b-w border-l-w border-style border-c
border-x-c border-y-c border-s-c border-e-c border-t-c border-r-c border-b-c border-l-c bg bg-image gradient-from gradient-via gradient-to bg-size
bg-attach bg-clip bg-pos bg-repeat fill stroke stroke-w object-fit object-pos p px py ps pe pt pr pb pl text-align indent align font-family
font-size font-weight transform-case font-style numeric leading tracking text-color decoration-line decoration-color decoration-style
decoration-thickness underline-offset smoothing placeholder-color caret accent-color opacity shadow shadow-color outline-style outline-w
outline-offset outline-color ring-w ring-color ring-offset-w ring-offset-color filter backdrop transition delay duration ease will-change`
  .split(/\s+/).map((k, i) => [k, i]));
const O = (k) => { if (!ORDER.has(k)) throw new Error('Unknown utility order key ' + k); return ORDER.get(k); };

// ---------------------------------------------------------------- static utilities
const CHILD = ' > :not([hidden]) ~ :not([hidden])';
const TRANSFORM = 'translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y))';
const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';
const COLORS_T = 'color, background-color, border-color, text-decoration-color, fill, stroke';
const pairs = (s) => s.split(';').map((x) => { const i = x.indexOf(':'); return [x.slice(0, i), x.slice(i + 1)]; });
const STATIC = new Map();
function st(key, entries, extra) { const o = O(key); for (const [k, d] of Object.entries(entries)) STATIC.set(k, Object.freeze({ o, d: pairs(d), ...extra })); }
const each = (names, f, prefix = '') => Object.fromEntries(names.split(' ').map((n) => [prefix + n, f(n)]));
// The kit's sr-only hides with clip-path:inset(50%) (as Tailwind v4 does), so not-sr-only must undo
// clip-path as well as clip, or `sr-only focus:not-sr-only` skip links stay invisible when focused.
st('sr', { 'sr-only': 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0, 0, 0, 0);clip-path:inset(50%);white-space:nowrap;border-width:0',
  'not-sr-only': 'position:static;width:auto;height:auto;padding:0;margin:0;overflow:visible;clip:auto;clip-path:none;white-space:normal' });
st('pointer-events', { 'pointer-events-none': 'pointer-events:none', 'pointer-events-auto': 'pointer-events:auto' });
st('visibility', { visible: 'visibility:visible', invisible: 'visibility:hidden', collapse: 'visibility:collapse' });
st('position', each('static fixed absolute relative sticky', (n) => 'position:' + n));
st('isolation', { isolate: 'isolation:isolate', 'isolation-auto': 'isolation:auto' });
st('col', { 'col-auto': 'grid-column:auto' });
st('row', { 'row-auto': 'grid-row:auto' });
st('float', { 'float-start': 'float:inline-start', 'float-end': 'float:inline-end', 'float-right': 'float:right', 'float-left': 'float:left', 'float-none': 'float:none' });
st('clear', { 'clear-start': 'clear:inline-start', 'clear-end': 'clear:inline-end', 'clear-left': 'clear:left', 'clear-right': 'clear:right', 'clear-both': 'clear:both', 'clear-none': 'clear:none' });
st('box', { 'box-border': 'box-sizing:border-box', 'box-content': 'box-sizing:content-box' });
st('line-clamp', { 'line-clamp-none': 'overflow:visible;display:block;-webkit-box-orient:horizontal;-webkit-line-clamp:none' });
st('display', { ...each('block inline-block inline flex inline-flex table inline-table table-caption table-cell table-column table-column-group table-footer-group table-header-group table-row-group table-row flow-root grid inline-grid contents list-item', (n) => 'display:' + n), hidden: 'display:none' });
st('aspect', { 'aspect-auto': 'aspect-ratio:auto', 'aspect-square': 'aspect-ratio:1 / 1', 'aspect-video': 'aspect-ratio:16 / 9' });
st('flex', { 'flex-1': 'flex:1 1 0%', 'flex-auto': 'flex:1 1 auto', 'flex-initial': 'flex:0 1 auto', 'flex-none': 'flex:none' });
st('shrink', { 'flex-shrink': 'flex-shrink:1', 'flex-shrink-0': 'flex-shrink:0' });
st('grow', { 'flex-grow': 'flex-grow:1', 'flex-grow-0': 'flex-grow:0' });
st('table-layout', { 'table-auto': 'table-layout:auto', 'table-fixed': 'table-layout:fixed' });
st('border-collapse', { 'border-collapse': 'border-collapse:collapse', 'border-separate': 'border-collapse:separate' });
st('origin', { 'origin-center': 'transform-origin:center', 'origin-top': 'transform-origin:top', 'origin-top-right': 'transform-origin:top right', 'origin-right': 'transform-origin:right',
  'origin-bottom-right': 'transform-origin:bottom right', 'origin-bottom': 'transform-origin:bottom', 'origin-bottom-left': 'transform-origin:bottom left', 'origin-left': 'transform-origin:left', 'origin-top-left': 'transform-origin:top left' });
st('transform', { transform: 'transform:' + TRANSFORM, 'transform-cpu': 'transform:' + TRANSFORM,
  'transform-gpu': 'transform:' + TRANSFORM.replace('translate(var(--tw-translate-x), var(--tw-translate-y))', 'translate3d(var(--tw-translate-x), var(--tw-translate-y), 0)') }, { needs: 'transform' });
st('transform', { 'transform-none': 'transform:none' });
st('animate', { 'animate-none': 'animation:none' });
st('cursor', each('auto default pointer wait text move help not-allowed none context-menu progress cell crosshair vertical-text alias copy no-drop grab grabbing all-scroll col-resize row-resize zoom-in zoom-out', (n) => 'cursor:' + n, 'cursor-'));
st('touch', { 'touch-auto': 'touch-action:auto', 'touch-none': 'touch-action:none', 'touch-manipulation': 'touch-action:manipulation', 'touch-pan-x': 'touch-action:pan-x', 'touch-pan-y': 'touch-action:pan-y' });
st('select', each('none text all auto', (n) => `-webkit-user-select:${n};user-select:${n}`, 'select-'));
st('resize', { 'resize-none': 'resize:none', 'resize-y': 'resize:vertical', 'resize-x': 'resize:horizontal', resize: 'resize:both' });
st('scroll-behavior', { 'scroll-auto': 'scroll-behavior:auto', 'scroll-smooth': 'scroll-behavior:smooth' });
st('list-pos', { 'list-inside': 'list-style-position:inside', 'list-outside': 'list-style-position:outside' });
st('list-type', { 'list-none': 'list-style-type:none', 'list-disc': 'list-style-type:disc', 'list-decimal': 'list-style-type:decimal' });
st('appearance', { 'appearance-none': 'appearance:none', 'appearance-auto': 'appearance:auto' });
st('grid-flow', { 'grid-flow-row': 'grid-auto-flow:row', 'grid-flow-col': 'grid-auto-flow:column', 'grid-flow-dense': 'grid-auto-flow:dense', 'grid-flow-row-dense': 'grid-auto-flow:row dense', 'grid-flow-col-dense': 'grid-auto-flow:column dense' });
st('flex-dir', { 'flex-row': 'flex-direction:row', 'flex-row-reverse': 'flex-direction:row-reverse', 'flex-col': 'flex-direction:column', 'flex-col-reverse': 'flex-direction:column-reverse' });
st('flex-wrap', { 'flex-wrap': 'flex-wrap:wrap', 'flex-wrap-reverse': 'flex-wrap:wrap-reverse', 'flex-nowrap': 'flex-wrap:nowrap' });
const ALIGN = { start: 'flex-start', end: 'flex-end', center: 'center', between: 'space-between', around: 'space-around', evenly: 'space-evenly', baseline: 'baseline', stretch: 'stretch', normal: 'normal' };
const al = (prefix, prop, names, map = ALIGN) => Object.fromEntries(names.split(' ').map((n) => [`${prefix}-${n}`, `${prop}:${map[n] || n}`]));
const PLACE = { start: 'start', end: 'end', center: 'center', between: 'space-between', around: 'space-around', evenly: 'space-evenly', baseline: 'baseline', stretch: 'stretch', auto: 'auto' };
st('place-content', al('place-content', 'place-content', 'center start end between around evenly baseline stretch', PLACE));
st('place-items', al('place-items', 'place-items', 'start end center baseline stretch', PLACE));
st('content', { ...al('content', 'align-content', 'center start end between around evenly baseline stretch'), 'content-normal': 'align-content:normal' });
st('items', al('items', 'align-items', 'start end center baseline stretch'));
st('justify', al('justify', 'justify-content', 'normal start end center between around evenly stretch'));
st('justify-items', al('justify-items', 'justify-items', 'start end center stretch', PLACE));
st('space-x-rev', { 'space-x-reverse': '--tw-space-x-reverse:1' }, { child: CHILD });
st('space-y-rev', { 'space-y-reverse': '--tw-space-y-reverse:1' }, { child: CHILD });
st('divide-x-rev', { 'divide-x-reverse': '--tw-divide-x-reverse:1' }, { child: CHILD });
st('divide-y-rev', { 'divide-y-reverse': '--tw-divide-y-reverse:1' }, { child: CHILD });
// Style utilities also record the style in --tw-border-style, which width utilities read (Tailwind v4's
// approach): `border-dotted md:border` stays dotted at md instead of the width class forcing solid.
st('divide-style', each('solid dashed dotted double none', (n) => `--tw-border-style:${n};border-style:${n}`, 'divide-'), { child: CHILD, needs: 'border' });
st('place-self', al('place-self', 'place-self', 'auto start end center stretch', PLACE));
st('self', al('self', 'align-self', 'auto start end center stretch baseline'));
st('justify-self', al('justify-self', 'justify-self', 'auto start end center stretch', PLACE));
for (const p of ['overflow', 'overflow-x', 'overflow-y']) st(p, each('auto hidden clip visible scroll', (n) => `${p}:${n}`, p + '-'));
st('overscroll', { 'overscroll-auto': 'overscroll-behavior:auto', 'overscroll-contain': 'overscroll-behavior:contain', 'overscroll-none': 'overscroll-behavior:none',
  'overscroll-y-contain': 'overscroll-behavior-y:contain', 'overscroll-x-contain': 'overscroll-behavior-x:contain', 'overscroll-y-none': 'overscroll-behavior-y:none', 'overscroll-x-none': 'overscroll-behavior-x:none' });
st('text-overflow', { truncate: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap', 'text-ellipsis': 'text-overflow:ellipsis', 'text-clip': 'text-overflow:clip' });
st('hyphens', { 'hyphens-none': 'hyphens:none', 'hyphens-manual': 'hyphens:manual', 'hyphens-auto': 'hyphens:auto' });
st('whitespace', al('whitespace', 'white-space', 'normal nowrap pre pre-line pre-wrap break-spaces', {}));
st('text-wrap', { 'text-wrap': 'text-wrap:wrap', 'text-nowrap': 'text-wrap:nowrap', 'text-balance': 'text-wrap:balance', 'text-pretty': 'text-wrap:pretty' });
st('break', { 'break-normal': 'overflow-wrap:normal;word-break:normal', 'break-words': 'overflow-wrap:break-word', 'break-all': 'word-break:break-all', 'break-keep': 'word-break:keep-all' });
st('border-style', each('solid dashed dotted double hidden none', (n) => `--tw-border-style:${n};border-style:${n}`, 'border-'), { needs: 'border' });
const DIRS = { t: 'top', tr: 'top right', r: 'right', br: 'bottom right', b: 'bottom', bl: 'bottom left', l: 'left', tl: 'top left' };
st('bg-image', { 'bg-none': 'background-image:none', ...Object.fromEntries(Object.entries(DIRS).map(([k, d]) => [`bg-gradient-to-${k}`, `background-image:linear-gradient(to ${d}, var(--tw-gradient-stops))`])) });
st('bg-size', { 'bg-auto': 'background-size:auto', 'bg-cover': 'background-size:cover', 'bg-contain': 'background-size:contain' });
st('bg-attach', { 'bg-fixed': 'background-attachment:fixed', 'bg-local': 'background-attachment:local', 'bg-scroll': 'background-attachment:scroll' });
st('bg-clip', { 'bg-clip-border': 'background-clip:border-box', 'bg-clip-padding': 'background-clip:padding-box', 'bg-clip-content': 'background-clip:content-box', 'bg-clip-text': '-webkit-background-clip:text;background-clip:text' });
st('bg-pos', Object.fromEntries(['bottom', 'center', 'left', 'left-bottom', 'left-top', 'right', 'right-bottom', 'right-top', 'top'].map((n) => [`bg-${n}`, 'background-position:' + n.replace('-', ' ')])));
st('bg-repeat', { 'bg-repeat': 'background-repeat:repeat', 'bg-no-repeat': 'background-repeat:no-repeat', 'bg-repeat-x': 'background-repeat:repeat-x', 'bg-repeat-y': 'background-repeat:repeat-y', 'bg-repeat-round': 'background-repeat:round', 'bg-repeat-space': 'background-repeat:space' });
st('fill', { 'fill-none': 'fill:none' });
st('stroke', { 'stroke-none': 'stroke:none' });
st('object-fit', al('object', 'object-fit', 'contain cover fill none scale-down', {}));
st('object-pos', Object.fromEntries(['bottom', 'center', 'left', 'left-bottom', 'left-top', 'right', 'right-bottom', 'right-top', 'top'].map((n) => [`object-${n}`, 'object-position:' + n.replace('-', ' ')])));
st('text-align', al('text', 'text-align', 'left center right justify start end', {}));
st('align', al('align', 'vertical-align', 'baseline top middle bottom text-top text-bottom sub super', {}));
st('transform-case', { uppercase: 'text-transform:uppercase', lowercase: 'text-transform:lowercase', capitalize: 'text-transform:capitalize', 'normal-case': 'text-transform:none' });
st('font-style', { italic: 'font-style:italic', 'not-italic': 'font-style:normal' });
st('numeric', { 'normal-nums': 'font-variant-numeric:normal', ...each('ordinal slashed-zero lining-nums oldstyle-nums proportional-nums tabular-nums diagonal-fractions stacked-fractions', (n) => 'font-variant-numeric:' + n) });
st('decoration-line', { underline: 'text-decoration-line:underline', overline: 'text-decoration-line:overline', 'line-through': 'text-decoration-line:line-through', 'no-underline': 'text-decoration-line:none' });
st('decoration-style', al('decoration', 'text-decoration-style', 'solid double dotted dashed wavy', {}));
st('smoothing', { antialiased: '-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale', 'subpixel-antialiased': '-webkit-font-smoothing:auto;-moz-osx-font-smoothing:auto' });
st('outline-style', { 'outline-none': 'outline:2px solid transparent;outline-offset:2px', outline: 'outline-style:solid', 'outline-dashed': 'outline-style:dashed', 'outline-dotted': 'outline-style:dotted', 'outline-double': 'outline-style:double' });
st('ring-w', { 'ring-inset': '--tw-ring-inset:inset' }, { needs: 'ring' });
st('transition', { transition: `transition-property:${COLORS_T}, opacity, box-shadow, transform, filter, backdrop-filter;transition-timing-function:${EASE};transition-duration:150ms`,
  'transition-all': `transition-property:all;transition-timing-function:${EASE};transition-duration:150ms`,
  'transition-colors': `transition-property:${COLORS_T};transition-timing-function:${EASE};transition-duration:150ms`,
  'transition-opacity': `transition-property:opacity;transition-timing-function:${EASE};transition-duration:150ms`,
  'transition-shadow': `transition-property:box-shadow;transition-timing-function:${EASE};transition-duration:150ms`,
  'transition-transform': `transition-property:transform;transition-timing-function:${EASE};transition-duration:150ms`,
  'transition-none': 'transition-property:none' });
st('ease', { 'ease-linear': 'transition-timing-function:linear', 'ease-in': 'transition-timing-function:cubic-bezier(0.4, 0, 1, 1)', 'ease-out': 'transition-timing-function:cubic-bezier(0, 0, 0.2, 1)', 'ease-in-out': `transition-timing-function:${EASE}` });
st('will-change', { 'will-change-auto': 'will-change:auto', 'will-change-scroll': 'will-change:scroll-position', 'will-change-contents': 'will-change:contents', 'will-change-transform': 'will-change:transform' });

// ---------------------------------------------------------------- functional utilities (prefix-value)
const FN = new Map();
// f(value, negative) returns declarations [[prop, value]] or { d, o, child, pe, needs, kf }; null = unknown.
function fn(prefix, key, f, opts = {}) { FN.set(prefix, { o: O(key), f, neg: !!opts.neg, needs: opts.needs, child: opts.child }); }
const decl = (props, x) => x == null ? null : props.map((p) => [p, x]);
const signed = (x, n) => (n ? negate(x) : x);
for (const [k, props] of Object.entries({ p: ['padding'], px: ['padding-left', 'padding-right'], py: ['padding-top', 'padding-bottom'], ps: ['padding-inline-start'], pe: ['padding-inline-end'],
  pt: ['padding-top'], pr: ['padding-right'], pb: ['padding-bottom'], pl: ['padding-left'] })) fn(k, k, (v) => decl(props, nn(sp(v))));
for (const [k, props] of Object.entries({ m: ['margin'], mx: ['margin-left', 'margin-right'], my: ['margin-top', 'margin-bottom'], ms: ['margin-inline-start'], me: ['margin-inline-end'],
  mt: ['margin-top'], mr: ['margin-right'], mb: ['margin-bottom'], ml: ['margin-left'] })) fn(k, k, (v, n) => decl(props, signed(sp(v, { auto: 'auto' }), n)), { neg: true });
for (const [k, props] of Object.entries({ inset: ['inset'], 'inset-x': ['left', 'right'], 'inset-y': ['top', 'bottom'], start: ['inset-inline-start'], end: ['inset-inline-end'],
  top: ['top'], right: ['right'], bottom: ['bottom'], left: ['left'] })) fn(k, k, (v, n) => decl(props, signed(sp(v, INSET), n)), { neg: true });
fn('z', 'z', (v, n) => decl(['z-index'], signed(pick(Z, v, 'integer'), n)), { neg: true });
fn('order', 'order', (v, n) => decl(['order'], signed(pick(ORDER_SCALE, v, 'integer'), n)), { neg: true });
const span = (v) => { if (own(SPAN, v)) return SPAN[v]; const n = arb(v, 'integer'); return n && (VAR.test(n) || +n > 0) ? `span ${n} / span ${n}` : null; };
fn('col-span', 'col', (v) => decl(['grid-column'], span(v)));
fn('col-start', 'col-start', (v) => decl(['grid-column-start'], lineNo(pick(LINE, v, 'integer'))));
fn('col-end', 'col-end', (v) => decl(['grid-column-end'], lineNo(pick(LINE, v, 'integer'))));
fn('row-span', 'row', (v) => decl(['grid-row'], span(v)));
fn('row-start', 'row-start', (v) => decl(['grid-row-start'], lineNo(pick(LINE, v, 'integer'))));
fn('row-end', 'row-end', (v) => decl(['grid-row-end'], lineNo(pick(LINE, v, 'integer'))));
const CLAMP = ints(1, 6);
fn('line-clamp', 'line-clamp', (v) => { const x = posInt(pick(CLAMP, v, 'integer')); return x && [['overflow', 'hidden'], ['display', '-webkit-box'], ['-webkit-box-orient', 'vertical'], ['-webkit-line-clamp', x]]; });
fn('aspect', 'aspect', (v) => { const x = arb(v, 'ratio'); return decl(['aspect-ratio'], x && x.replace('/', ' / ')); });
fn('size', 'size', (v) => decl(['width', 'height'], nn(sp(v, SIZE))));
fn('w', 'w', (v) => decl(['width'], nn(sp(v, W))));
fn('h', 'h', (v) => decl(['height'], nn(sp(v, H))));
fn('min-w', 'min-w', (v) => decl(['min-width'], nn(sp(v, MIN_W))));
fn('min-h', 'min-h', (v) => decl(['min-height'], nn(sp(v, MIN_H))));
fn('max-w', 'max-w', (v) => decl(['max-width'], nn(sp(v, MAX_W))));
fn('max-h', 'max-h', (v) => decl(['max-height'], nn(sp(v, MAX_H))));
fn('shrink', 'shrink', (v) => decl(['flex-shrink'], nn(pick({ '': '1', 0: '0' }, v, 'number'))));
fn('grow', 'grow', (v) => decl(['flex-grow'], nn(pick({ '': '1', 0: '0' }, v, 'number'))));
fn('basis', 'basis', (v) => decl(['flex-basis'], nn(sp(v, BASIS))));
const tf = (vars) => (x) => x == null ? null : { d: [...vars.map((p) => [p, x]), ['transform', TRANSFORM]], needs: 'transform' };
fn('translate-x', 'translate-x', (v, n) => tf(['--tw-translate-x'])(signed(sp(v, FRAC_SM), n)), { neg: true });
fn('translate-y', 'translate-y', (v, n) => tf(['--tw-translate-y'])(signed(sp(v, FRAC_SM), n)), { neg: true });
fn('rotate', 'rotate', (v, n) => tf(['--tw-rotate'])(signed(pick(ROTATE, v, 'angle'), n)), { neg: true });
fn('skew-x', 'skew-x', (v, n) => tf(['--tw-skew-x'])(signed(pick(SKEW, v, 'angle'), n)), { neg: true });
fn('skew-y', 'skew-y', (v, n) => tf(['--tw-skew-y'])(signed(pick(SKEW, v, 'angle'), n)), { neg: true });
fn('scale', 'scale', (v, n) => tf(['--tw-scale-x', '--tw-scale-y'])(signed(pick(SCALE, v, 'number'), n)), { neg: true });
fn('scale-x', 'scale-x', (v, n) => tf(['--tw-scale-x'])(signed(pick(SCALE, v, 'number'), n)), { neg: true });
fn('scale-y', 'scale-y', (v, n) => tf(['--tw-scale-y'])(signed(pick(SCALE, v, 'number'), n)), { neg: true });
const KEYFRAMES = {
  spin: ['spin 1s linear infinite', '@keyframes spin{to{transform:rotate(360deg)}}'],
  ping: ['ping 1s cubic-bezier(0, 0, 0.2, 1) infinite', '@keyframes ping{75%,100%{transform:scale(2);opacity:0}}'],
  pulse: ['pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite', '@keyframes pulse{50%{opacity:.5}}'],
  bounce: ['bounce 1s infinite', '@keyframes bounce{0%,100%{transform:translateY(-25%);animation-timing-function:cubic-bezier(0.8,0,1,1)}50%{transform:none;animation-timing-function:cubic-bezier(0,0,0.2,1)}}'],
};
fn('animate', 'animate', (v) => own(KEYFRAMES, v) ? { d: [['animation', KEYFRAMES[v][0]]], kf: v } : null);
const COLUMNS = { ...ints(1, 12), auto: 'auto' };
fn('columns', 'columns', (v) => { const a = own(COLUMNS, v) ? { v: COLUMNS[v] } : arbitrary(v, ['integer', 'dim']); return decl(['columns'], a && (a.k === 'integer' ? posInt(a.v) : nn(a.v))); });
const arbTracks = (v) => v.length > 2 && v[0] === '[' && v.endsWith(']') && !BAD.test(v) ? gridTemplate(v.slice(1, -1)) : null;
const tracks = (v) => own(GRID, v) ? GRID[v] : arbTracks(v);
// grid-auto-columns/rows take a list of track sizes (no repeat()): auto-rows-[minmax(4rem,auto)].
const autoTracks = (v) => { if (own(AUTO_TRACK, v)) return AUTO_TRACK[v]; const x = arbTracks(v); return x && !x.includes('repeat(') ? x : null; };
fn('auto-cols', 'auto-cols', (v) => decl(['grid-auto-columns'], autoTracks(v)));
fn('auto-rows', 'auto-rows', (v) => decl(['grid-auto-rows'], autoTracks(v)));
fn('grid-cols', 'grid-cols', (v) => decl(['grid-template-columns'], tracks(v)));
fn('grid-rows', 'grid-rows', (v) => decl(['grid-template-rows'], tracks(v)));
fn('gap', 'gap', (v) => decl(['gap'], nn(sp(v))));
fn('gap-x', 'gap-x', (v) => decl(['column-gap'], nn(sp(v))));
fn('gap-y', 'gap-y', (v) => decl(['row-gap'], nn(sp(v))));
fn('space-x', 'space-x', (v, n) => { const x = signed(sp(v), n); return x && [['--tw-space-x-reverse', '0'], ['margin-right', `calc(${x} * var(--tw-space-x-reverse))`], ['margin-left', `calc(${x} * calc(1 - var(--tw-space-x-reverse)))`]]; }, { neg: true, child: CHILD });
fn('space-y', 'space-y', (v, n) => { const x = signed(sp(v), n); return x && [['--tw-space-y-reverse', '0'], ['margin-top', `calc(${x} * calc(1 - var(--tw-space-y-reverse)))`], ['margin-bottom', `calc(${x} * var(--tw-space-y-reverse))`]]; }, { neg: true, child: CHILD });
// Width utilities draw with the element's --tw-border-style (solid from the layered reset unless a
// border-dashed/dotted/... utility set it), so a responsive or state width class keeps the chosen style.
const BSTYLE = 'var(--tw-border-style, solid)';
fn('divide-x', 'divide-x', (v) => { const w = nn(pick(BORDER_W, v, 'dim')); return w && [['--tw-divide-x-reverse', '0'], ['border-right-width', `calc(${w} * var(--tw-divide-x-reverse))`], ['border-left-width', `calc(${w} * calc(1 - var(--tw-divide-x-reverse)))`], ['border-right-style', BSTYLE], ['border-left-style', BSTYLE]]; }, { child: CHILD, needs: 'border' });
fn('divide-y', 'divide-y', (v) => { const w = nn(pick(BORDER_W, v, 'dim')); return w && [['--tw-divide-y-reverse', '0'], ['border-top-width', `calc(${w} * calc(1 - var(--tw-divide-y-reverse)))`], ['border-bottom-width', `calc(${w} * var(--tw-divide-y-reverse))`], ['border-top-style', BSTYLE], ['border-bottom-style', BSTYLE]]; }, { child: CHILD, needs: 'border' });
fn('divide', 'divide-color', (v) => decl(['border-color'], color(v)), { child: CHILD, needs: 'border' });
const CORNERS = { '': ['border-radius'], s: ['border-start-start-radius', 'border-end-start-radius'], e: ['border-start-end-radius', 'border-end-end-radius'],
  t: ['border-top-left-radius', 'border-top-right-radius'], r: ['border-top-right-radius', 'border-bottom-right-radius'], b: ['border-bottom-right-radius', 'border-bottom-left-radius'],
  l: ['border-top-left-radius', 'border-bottom-left-radius'], ss: ['border-start-start-radius'], se: ['border-start-end-radius'], ee: ['border-end-end-radius'], es: ['border-end-start-radius'],
  tl: ['border-top-left-radius'], tr: ['border-top-right-radius'], br: ['border-bottom-right-radius'], bl: ['border-bottom-left-radius'] };
for (const [c, props] of Object.entries(CORNERS)) fn(c ? 'rounded-' + c : 'rounded', c ? 'rounded-' + c : 'rounded', (v) => decl(props, nn(pick(RADIUS, v, 'length'))));
const SIDES = { '': [''], x: ['-left', '-right'], y: ['-top', '-bottom'], s: ['-inline-start'], e: ['-inline-end'], t: ['-top'], r: ['-right'], b: ['-bottom'], l: ['-left'] };
for (const [s, sides] of Object.entries(SIDES)) {
  const k = s ? `border-${s}` : 'border';
  fn(k, k + '-w', (v) => {
    const c = own(BORDER_W, v) ? null : color(v), w = own(BORDER_W, v) ? BORDER_W[v] : c ? null : nn(arb(v, 'dim'));
    if (c) return { d: decl(sides.map((x) => `border${x}-color`), c), o: O(k + '-c') };
    return w && [...sides.map((x) => [`border${x}-width`, w]), ...sides.map((x) => [`border${x}-style`, BSTYLE])];
  }, { needs: 'border' });
}
fn('bg', 'bg', (v) => decl(['background-color'], color(v)));
fn('from', 'gradient-from', (v) => { const c = color(v); return c && { d: [['--tw-gradient-from', `${c} var(--tw-gradient-from-position)`], ['--tw-gradient-to', 'transparent var(--tw-gradient-to-position)'], ['--tw-gradient-stops', 'var(--tw-gradient-from), var(--tw-gradient-to)']], needs: 'gradient' }; });
fn('via', 'gradient-via', (v) => { const c = color(v); return c && { d: [['--tw-gradient-to', 'transparent var(--tw-gradient-to-position)'], ['--tw-gradient-stops', `var(--tw-gradient-from), ${c} var(--tw-gradient-via-position), var(--tw-gradient-to)`]], needs: 'gradient' }; });
fn('to', 'gradient-to', (v) => { const c = color(v); return c && { d: [['--tw-gradient-to', `${c} var(--tw-gradient-to-position)`]], needs: 'gradient' }; });
fn('fill', 'fill', (v) => decl(['fill'], color(v)));
fn('stroke', 'stroke', (v) => { const c = color(v); return c ? [['stroke', c]] : { d: decl(['stroke-width'], nn(pick({ 0: '0', 1: '1', 2: '2' }, v, 'number', 'length'))), o: O('stroke-w') }; });
fn('indent', 'indent', (v, n) => decl(['text-indent'], signed(sp(v), n)), { neg: true });
fn('font', 'font-weight', (v) => {
  if (own(FONT_FAMILY, v)) return { d: [['font-family', FONT_FAMILY[v]]], o: O('font-family') };
  const x = pick(FONT_WEIGHT, v, 'integer');
  return decl(['font-weight'], x && (VAR.test(x) || (+x >= 1 && +x <= 1000)) ? x : null);
});
fn('text', 'font-size', (v) => {
  const [b, m] = splitMod(v);
  if (own(FONT_SIZE, b)) {
    const lh = m == null ? FONT_SIZE[b][1] : nn(pick(LEADING, m, 'number', 'length'));
    return lh && [['font-size', FONT_SIZE[b][0]], ['line-height', lh]];
  }
  const c = color(v);
  if (c) return { d: [['color', c]], o: O('text-color') };
  return decl(['font-size'], nn(arb(v, 'length')));
});
fn('leading', 'leading', (v) => decl(['line-height'], nn(pick(LEADING, v, 'number', 'length'))));
fn('tracking', 'tracking', (v, n) => decl(['letter-spacing'], signed(pick(TRACKING, v, 'dim'), n)), { neg: true });
fn('decoration', 'decoration-thickness', (v) => {
  const c = color(v);
  if (c) return { d: [['text-decoration-color', c]], o: O('decoration-color') };
  return decl(['text-decoration-thickness'], nn(pick({ auto: 'auto', 'from-font': 'from-font', ...WIDTH5 }, v, 'length')));
});
fn('underline-offset', 'underline-offset', (v) => decl(['text-underline-offset'], pick({ auto: 'auto', ...WIDTH5 }, v, 'length')));
fn('placeholder', 'placeholder-color', (v) => { const c = color(v); return c && { d: [['color', c]], pe: '::placeholder' }; });
fn('caret', 'caret', (v) => decl(['caret-color'], color(v)));
fn('accent', 'accent-color', (v) => decl(['accent-color'], v === 'auto' ? 'auto' : color(v)));
fn('opacity', 'opacity', (v) => decl(['opacity'], pick(OPACITY, v, 'number')));
const BOX = 'var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow)';
fn('shadow', 'shadow', (v) => {
  if (own(SHADOW, v)) return [['--tw-shadow', SHADOW[v]], ['--tw-shadow-colored', SHADOW[v].replace(/rgb\(0 0 0 \/ [\d.]+\)/g, 'var(--tw-shadow-color)')], ['box-shadow', BOX]];
  const c = color(v);
  return c && { d: [['--tw-shadow-color', c], ['--tw-shadow', 'var(--tw-shadow-colored)']], o: O('shadow-color') };
}, { needs: 'ring' });
fn('outline', 'outline-w', (v) => {
  const c = color(v);
  if (c) return { d: [['outline-color', c]], o: O('outline-color') };
  return decl(['outline-width'], nn(pick(WIDTH5, v, 'dim')));
});
fn('outline-offset', 'outline-offset', (v) => decl(['outline-offset'], pick(WIDTH5, v, 'dim')));
fn('ring', 'ring-w', (v) => {
  const w = own(RING_W, v) ? RING_W[v] : null, c = w ? null : color(v);
  if (c) return { d: [['--tw-ring-color', c]], o: O('ring-color') };
  const x = w || nn(arb(v, 'dim'));
  return x && [['--tw-ring-offset-shadow', 'var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color)'],
    ['--tw-ring-shadow', `var(--tw-ring-inset) 0 0 0 calc(${x} + var(--tw-ring-offset-width)) var(--tw-ring-color)`], ['box-shadow', 'var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow, 0 0 #0000)']];
}, { needs: 'ring' });
fn('ring-offset', 'ring-offset-w', (v) => {
  const c = own(WIDTH5, v) ? null : color(v);
  if (c) return { d: [['--tw-ring-offset-color', c]], o: O('ring-offset-color') };
  return decl(['--tw-ring-offset-width'], nn(pick(WIDTH5, v, 'dim')));
}, { needs: 'ring' });
// blur and grayscale compose through --tw-* functions (reset to empty on every element) like Tailwind, so
// `blur-sm grayscale` applies both instead of the later class replacing the filter.
const FILTER = 'var(--tw-blur) var(--tw-grayscale)';
fn('blur', 'filter', (v) => { const x = nn(pick(BLUR, v, 'dim')); return x && { d: [['--tw-blur', `blur(${x})`], ['filter', FILTER]], needs: 'filter' }; });
fn('grayscale', 'filter', (v) => { const x = pick({ '': '100%', 0: '0' }, v); return x && { d: [['--tw-grayscale', `grayscale(${x})`], ['filter', FILTER]], needs: 'filter' }; });
fn('backdrop-blur', 'backdrop', (v) => { const x = nn(pick(BLUR, v, 'dim')); return decl(['-webkit-backdrop-filter', 'backdrop-filter'], x && `blur(${x})`); });
fn('duration', 'duration', (v) => decl(['transition-duration'], pick(DURATION, v, 'time')));
fn('delay', 'delay', (v) => decl(['transition-delay'], pick(DURATION, v, 'time')));
const CONTAINER = Object.freeze({ o: O('container'), d: [['width', '100%'], ['margin-right', 'auto'], ['margin-left', 'auto']], extra: SCREENS.map(([, w]) => [['max-width', w + 'px']]) });

// ---------------------------------------------------------------- variants
const PSEUDO = [['first', ':first-child'], ['last', ':last-child'], ['only', ':only-child'], ['odd', ':nth-child(odd)'], ['even', ':nth-child(even)'], ['first-of-type', ':first-of-type'],
  ['last-of-type', ':last-of-type'], ['visited', ':visited'], ['open', '[open]'], ['checked', ':checked'], ['required', ':required'], ['invalid', ':invalid'], ['read-only', ':read-only'],
  ['empty', ':empty'], ['focus-within', ':focus-within'], ['hover', ':hover'], ['focus', ':focus'], ['focus-visible', ':focus-visible'], ['active', ':active'], ['enabled', ':enabled'], ['disabled', ':disabled']];
const PC = Object.fromEntries(PSEUDO);
const VARIANTS = new Map();
let bit = 0;
const vdef = (name, d) => VARIANTS.set(name, { ...d, bit: 2 ** bit++ });
vdef('placeholder', { pe: '::placeholder' });
for (const [n, s] of PSEUDO) vdef(n, { pc: s });
for (const n of ['hover', 'focus', 'focus-within', 'focus-visible', 'active', 'disabled']) vdef('group-' + n, { group: PC[n] });
for (const n of ['hover', 'focus', 'focus-visible', 'checked', 'disabled', 'invalid']) vdef('peer-' + n, { peer: PC[n] });
for (const n of ['checked', 'disabled', 'expanded', 'pressed', 'selected']) vdef('aria-' + n, { pc: `[aria-${n}=true]` });
vdef('motion-safe', { mq: '(prefers-reduced-motion: no-preference)' });
vdef('motion-reduce', { mq: '(prefers-reduced-motion: reduce)' });
vdef('print', { print: true });
const SCREEN_UNIT = 2 ** bit; // breakpoints dominate the sort key, so responsive rules come last, in breakpoint order
SCREENS.forEach(([n, w], i) => VARIANTS.set(n, { screen: i + 1, mq: `(min-width: ${w}px)` }));
function variants(list) {
  const v = { key: 0, pc: '', pe: '', group: '', peer: '', sq: '', mq: [], print: false, dark: false };
  const seen = new Set();
  for (const n of list) {
    if (seen.has(n)) return null;
    seen.add(n);
    if (n === 'dark') { v.dark = true; continue; }
    const d = VARIANTS.get(n);
    if (!d) return null;
    if (d.screen) { if (v.sq) return null; v.sq = d.mq; v.key += d.screen * SCREEN_UNIT; continue; }
    v.key += d.bit;
    if (d.pe) v.pe = d.pe; else if (d.pc) v.pc += d.pc; else if (d.group) v.group += d.group; else if (d.peer) v.peer += d.peer;
    else if (d.mq) v.mq.push(d.mq); else v.print = true;
  }
  const q = [v.sq, ...v.mq].filter(Boolean);
  v.media = (v.print ? ['print', ...q] : q).join(' and ');
  return v;
}

// ---------------------------------------------------------------- class resolution
// CSSOM CSS.escape(): https://drafts.csswg.org/cssom/#serialize-an-identifier
function escapeClass(s) {
  s = String(s ?? '');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0) out += '\uFFFD';
    else if ((c >= 1 && c <= 31) || c === 127 || (i === 0 && c >= 48 && c <= 57) || (i === 1 && c >= 48 && c <= 57 && s.charCodeAt(0) === 45)) out += '\\' + c.toString(16) + ' ';
    else if (i === 0 && c === 45 && s.length === 1) out += '\\-';
    else if (c >= 128 || c === 45 || c === 95 || (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) out += s[i];
    else out += '\\' + s[i];
  }
  return out;
}
const MAX_CLASS = 160;
const SAFE_CLASS = /^[A-Za-z0-9_\-:/.[\]%#(),!]+$/;
const SAFE_VALUE = /^[^;{}<>\\"'`@]*$/;
function splitVariants(s) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') { if (--depth < 0) return null; }
    else if (c === ':' && !depth) { out.push(s.slice(start, i)); start = i + 1; }
  }
  if (depth) return null;
  out.push(s.slice(start));
  return out.some((x) => !x) ? null : out;
}
function run(f, v, neg) {
  if (neg && !f.neg) return null;
  let r = f.f(v, neg);
  if (!r) return null;
  if (Array.isArray(r)) r = { d: r };
  if (!r.d || !r.d.length || r.d.some(([, x]) => x == null || !SAFE_VALUE.test(x))) return null;
  return { o: f.o, needs: f.needs, child: f.child, ...r };
}
function utility(u, neg) {
  if (!neg && STATIC.has(u)) return STATIC.get(u);
  if (u === 'container') return neg ? null : CONTAINER;
  let f = FN.get(u), r;
  if (f && (r = run(f, '', neg))) return r;
  for (let i = u.lastIndexOf('-'); i > 0; i = u.lastIndexOf('-', i - 1)) if ((f = FN.get(u.slice(0, i))) && (r = run(f, u.slice(i + 1), neg))) return r;
  return null;
}
const NONE = Object.freeze({ rules: [] });
const CACHE = new Map();
function resolve(cls) {
  let r = CACHE.get(cls);
  if (r !== undefined) return r;
  r = compute(cls);
  if (CACHE.size >= 50000) CACHE.clear();
  CACHE.set(cls, r);
  return r;
}
function compute(cls) {
  if (typeof cls !== 'string' || !cls || cls.length > MAX_CLASS || !SAFE_CLASS.test(cls)) return null;
  const parts = splitVariants(cls);
  if (!parts) return null;
  let u = parts.pop(), imp = false, neg = false;
  const v = variants(parts);
  if (!v) return null;
  if (u[0] === '!') { imp = true; u = u.slice(1); }
  if (u[0] === '-') { neg = true; u = u.slice(1); }
  if (!u) return null;
  if (u === 'group' || u === 'peer') return !parts.length && !imp && !neg ? NONE : null;
  const x = utility(u, neg);
  if (!x || (x.extra && parts.length) || (v.pe && (x.child || x.pe))) return null;
  if (v.dark) return NONE; // dark: is valid but intentionally produces no CSS
  const e = '.' + escapeClass(cls), body = (d) => d.map(([p, val]) => `${p}:${val}${imp ? ' !important' : ''}`).join(';');
  let sel = e + v.pc + (x.pe || v.pe) + (x.child || '');
  if (v.peer) sel = `.peer${v.peer} ~ ${sel}`;
  if (v.group) sel = `.group${v.group} ${sel}`;
  // container is a Tailwind component: it and its breakpoint max-widths precede every utility, so
  // `container max-w-4xl` or `container md:px-8` let the utility win.
  const rules = [{ key: x.extra ? -SCREENS.length - 1 : v.key, media: v.media, o: x.o, cls, sel, body: body(x.d) }];
  if (x.extra) x.extra.forEach((d, i) => rules.push({ key: i - SCREENS.length, media: VARIANTS.get(SCREENS[i][0]).mq, o: x.o, cls, sel, body: body(d) }));
  return { rules, needs: x.needs, kf: x.kf, reset: x.needs === 'border' ? e + (x.child || '') : null };
}

// ---------------------------------------------------------------- public API
const WS = /[\t\n\f\r ]+/;
function* names(input) {
  if (input == null) return;
  if (typeof input === 'string') { yield* input.split(WS); return; }
  if (typeof input[Symbol.iterator] !== 'function') return;
  for (const c of input) if (typeof c === 'string') yield c;
}
const RESETS = {
  transform: '--tw-translate-x:0;--tw-translate-y:0;--tw-rotate:0;--tw-skew-x:0;--tw-skew-y:0;--tw-scale-x:1;--tw-scale-y:1;',
  ring: '--tw-ring-inset: ;--tw-ring-offset-width:0px;--tw-ring-offset-color:var(--background, #fff);--tw-ring-color:color-mix(in oklab, var(--accent, #3b82f6) 50%, transparent);--tw-ring-offset-shadow:0 0 #0000;--tw-ring-shadow:0 0 #0000;--tw-shadow:0 0 #0000;--tw-shadow-colored:0 0 #0000;',
  gradient: '--tw-gradient-from-position: ;--tw-gradient-via-position: ;--tw-gradient-to-position: ;',
  filter: '--tw-blur: ;--tw-grayscale: ;',
};
// Bare class names that are also Forma kit components (spec section 2: container, sr-only, table,
// list-item, plus whatever kit.KIT_CLASSES lists). Kit rules have zero specificity and load first, so a
// utility rule would silently override the component: utilityCSS emits nothing for these exact names.
// They still classify as supported, and variant/important forms (md:sr-only, !container) still generate.
let kitDeferred = null;
function deferred() {
  if (kitDeferred) return kitDeferred;
  kitDeferred = new Set(['container', 'sr-only', 'table', 'list-item']);
  try { for (const c of require('./kit.cjs').KIT_CLASSES || []) kitDeferred.add(c); } catch { /* kit unavailable: built-in list only */ }
  return kitDeferred;
}
// CSS for the supported classes only. `tokens` is accepted for API symmetry with kitCSS(); colours, radius
// and fonts resolve through the kit's CSS variables (--accent, --radius, --font, ...) so the same CSS
// follows token and tweak changes without regeneration.
function utilityCSS(classNames, tokens) {
  const rules = [], needs = new Set(), kfs = new Set(), resets = new Set(), seen = new Set(), kit = deferred();
  for (const c of names(classNames)) {
    if (!c || seen.has(c) || kit.has(c)) continue;
    seen.add(c);
    const r = resolve(c);
    if (!r) continue;
    for (const x of r.rules) rules.push(x);
    if (r.needs) needs.add(r.needs);
    if (r.kf) kfs.add(r.kf);
    if (r.reset) resets.add(r.reset);
  }
  if (!rules.length) return '';
  rules.sort((a, b) => a.key - b.key || a.o - b.o || (a.cls < b.cls ? -1 : a.cls > b.cls ? 1 : 0));
  const out = [];
  const vars = ['transform', 'ring', 'gradient', 'filter'].filter((k) => needs.has(k)).map((k) => RESETS[k]).join('');
  if (vars) out.push(`*,::before,::after{${vars}}`);
  // Tailwind's preflight border reset (width 0, solid, default colour), scoped to elements that carry a
  // border utility and placed in a cascade layer: every unlayered rule (kit components such as
  // `card border-accent`, utilities, model CSS) beats it, while browser defaults do not. Width utilities
  // also set the style of the sides they size (from --tw-border-style, reset here so it never inherits),
  // so `border` works where the kit resets with border:0.
  if (resets.size) out.push(`@layer forma-preflight{:where(${[...resets].sort().join(',')}){--tw-border-style:solid;border-width:0;border-style:solid;border-color:var(--border, #e5e7eb)}:where(hr){border-top-width:1px}}`);
  for (const k of [...kfs].sort()) out.push(KEYFRAMES[k][1]);
  let media = '', block = null;
  for (const r of rules) {
    const line = `${r.sel}{${r.body}}`;
    if (r.media !== media) { if (block) out.push(block.join('\n') + '\n}'); media = r.media; block = media ? [`@media ${media}{`] : null; }
    (block || out).push(line);
  }
  if (block) out.push(block.join('\n') + '\n}');
  return out.join('\n');
}
// Splits classNames into supported utilities and unknown classes (input order, de-duplicated).
// `known` optionally lists other valid classes (kit components, runtime state classes).
function classifyClasses(classNames, known) {
  const extra = known ? new Set(names(known)) : null, supported = [], unknown = [], seen = new Set();
  for (const c of names(classNames)) {
    if (!c || seen.has(c)) continue;
    seen.add(c);
    (resolve(c) || extra?.has(c) ? supported : unknown).push(c);
  }
  return { supported, unknown };
}
// Every class token used in HTML (or an array of HTML strings): quotes, entities and odd spacing are
// handled by htmlparser2 exactly as sanitize-html parses the same markup.
function collectClasses(html) {
  const out = new Set();
  const list = typeof html === 'string' ? [html] : Array.isArray(html) ? html : [];
  const { Parser } = require('htmlparser2');
  for (const h of list) {
    if (typeof h !== 'string' || !h) continue;
    const p = new Parser({ onattribute(name, value) { if (name === 'class') for (const c of value.split(WS)) if (c) out.add(c); } }, { decodeEntities: true, lowerCaseAttributeNames: true });
    p.write(h);
    p.end();
  }
  return out;
}

const UTILITY_REFERENCE = `Tailwind CSS v3 utilities are compiled on demand; only these families exist.
Layout: block inline-block flex inline-flex grid hidden contents; relative absolute fixed sticky, inset-0 top-4 -left-2, z-0…50, order-*, overflow-*, invisible, aspect-video aspect-square, object-cover.
Flex/grid: flex-col flex-wrap flex-1 grow shrink-0 basis-1/3, grid-cols-1…12 col-span-* row-span-*, grid-cols-[repeat(auto-fit,minmax(16rem,1fr))], gap-*, space-x-* space-y-*, divide-y, items-* justify-* content-* self-* place-*.
Spacing scale 0 px 0.5 1 1.5 2 … 12 14 16 20 24 … 96 for p- px- py- pt-…, m- (mx-auto, -mt-2), gap, inset.
Sizing w- h- size- min-w- min-h- max-w- max-h-: scale, fractions (w-1/2), full, screen, fit; max-w-xs…7xl, max-w-prose.
Type: text-xs…9xl (text-sm/6 sets line height), font-normal medium semibold bold, font-sans serif mono heading, leading-*, tracking-*, text-left center right, uppercase, italic, underline, truncate, line-clamp-1…6, whitespace-nowrap, break-words, tabular-nums.
Colours for bg- text- border- divide- ring- outline- fill- stroke- placeholder- shadow- from- via- to- (bg-gradient-to-r): tokens accent accent-2 accent-soft accent-strong background surface surface-2 text muted border border-strong success warning danger info (+ -soft -strong) on-accent chart-1…6 (bg-accent text-on-accent, text-muted, border-border, bg-danger-soft text-danger-strong); white black transparent current; Tailwind palette slate…rose 50–950. Prefer tokens. Opacity modifier: bg-accent/10, bg-black/50.
Effects: border border-2 border-t border-dashed, rounded-sm…3xl rounded-full (follow the design radius), shadow-sm…2xl, ring-2 ring-offset-2, outline-none, opacity-*, transition-colors duration-200 ease-out, translate-* scale-* rotate-*, animate-spin animate-pulse, backdrop-blur, cursor-pointer, select-none.
Variants: sm: md: lg: xl: 2xl: (mobile-first min-width), hover: focus: focus-visible: active: disabled: first: last: odd: even: placeholder: group-hover: (parent has class group), aria-selected:, motion-reduce:. !font-bold = important. dark: is ignored.
Arbitrary values only for lengths, percentages, numbers, #hex or var(--name): p-[18px], top-[var(--header-h)], bg-[#0f766e]. calc(), url(), quotes and arbitrary properties are dropped.`;

module.exports = { utilityCSS, classifyClasses, collectClasses, UTILITY_REFERENCE, escapeClass, PALETTE, SEMANTIC_COLORS };
