'use strict';
// Design token import (ENGINE-SPEC section 6): CSS custom properties and declarations, W3C design tokens and
// Style Dictionary JSON, Forma tokens.json, and Tailwind theme object literals. Input is untrusted: nothing is
// evaluated (a small tokenizer reads JS literals), scanners are linear, var()/alias expansion is bounded,
// and every emitted value is a #RRGGBB colour, a plain font family name or an integer.
const { FONTS } = require('./presets.cjs');

const MAX_BYTES = 200 * 1024;
const MAX_VALUE = 500;
const fail = (message) => { throw Object.assign(new Error(message), { status: 400 }); };
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Unknown);
class Unknown { constructor(src) { this.src = src; } }
const label = (s) => String(s).replace(/[\u0000-\u001f\u007f<>"`]/g, '').slice(0, 80);

// ---------- Colours ----------

const NAMED = {
  white: 'ffffff', black: '000000', red: 'ff0000', green: '008000', blue: '0000ff', navy: '000080', teal: '008080', purple: '800080',
  orange: 'ffa500', gray: '808080', grey: '808080', silver: 'c0c0c0', maroon: '800000', olive: '808000', lime: '00ff00', aqua: '00ffff',
  cyan: '00ffff', fuchsia: 'ff00ff', magenta: 'ff00ff', yellow: 'ffff00', indigo: '4b0082', crimson: 'dc143c', tomato: 'ff6347',
  coral: 'ff7f50', gold: 'ffd700', ivory: 'fffff0', beige: 'f5f5dc', whitesmoke: 'f5f5f5', gainsboro: 'dcdcdc', ghostwhite: 'f8f8ff',
  snow: 'fffafa', slategray: '708090', dimgray: '696969', darkgray: 'a9a9a9', lightgray: 'd3d3d3', rebeccapurple: '663399',
  royalblue: '4169e1', steelblue: '4682b4', dodgerblue: '1e90ff', seagreen: '2e8b57', forestgreen: '228b22', firebrick: 'b22222',
  chocolate: 'd2691e', tan: 'd2b48c', linen: 'faf0e6', darkblue: '00008b', darkgreen: '006400', darkred: '8b0000', midnightblue: '191970',
};
const NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/;
function num(x, pctOf) {
  if (x === 'none') return 0;
  const pct = x.endsWith('%');
  const s = pct ? x.slice(0, -1) : x;
  if (!NUM.test(s)) return null;
  return pct ? (Number(s) / 100) * pctOf : Number(s);
}
function angle(x) {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))(deg|grad|rad|turn)?$/.exec(x);
  if (!m) return x === 'none' ? 0 : null;
  const v = Number(m[1]);
  return m[2] === 'turn' ? v * 360 : m[2] === 'rad' ? (v * 180) / Math.PI : m[2] === 'grad' ? v * 0.9 : v;
}
function hsl2rgb(h, s, l) {
  h = ((h % 360) + 360) % 360; s = clamp(s, 0, 1); l = clamp(l, 0, 1);
  const a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h / 30) % 12; return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); };
  return [f(0), f(8), f(4)];
}
function oklab2rgb(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
    .map((v) => { v = clamp(v, 0, 1); return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055); });
}
const rgba = (r, g, b, a = 1) => ([r, g, b, a].every(Number.isFinite) ? { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255), a: clamp(a, 0, 1) } : null);

function colorFunction(fn, args) {
  const halves = args.split('/');
  if (halves.length > 2) return null;
  const parts = halves[0].trim().split(/\s*,\s*|\s+/).filter(Boolean);
  let alpha = halves[1] !== undefined ? halves[1].trim() : undefined;
  if (fn === 'color') {
    if (parts[0] !== 'srgb' || parts.length !== 4) return null;
    const [r, g, b] = parts.slice(1).map((p) => num(p, 1));
    return r === null || g === null || b === null ? null : rgba(r * 255, g * 255, b * 255, alpha === undefined ? 1 : num(alpha, 1) ?? NaN);
  }
  if (alpha === undefined && parts.length === 4) alpha = parts.pop();
  if (parts.length !== 3) return null;
  const a = alpha === undefined ? 1 : num(alpha, 1);
  if (a === null) return null;
  if (fn === 'rgb' || fn === 'rgba') {
    const [r, g, b] = parts.map((p) => num(p, 255));
    return r === null || g === null || b === null ? null : rgba(r, g, b, a);
  }
  if (fn === 'hsl' || fn === 'hsla') {
    const h = angle(parts[0]), s = num(parts[1], 100), l = num(parts[2], 100);
    return h === null || s === null || l === null ? null : rgba(...hsl2rgb(h, s / 100, l / 100), a);
  }
  const L = num(parts[0], 1);
  if (L === null) return null;
  if (fn === 'oklch') {
    const C = num(parts[1], 0.4), H = angle(parts[2]);
    return C === null || H === null ? null : rgba(...oklab2rgb(L, C * Math.cos((H * Math.PI) / 180), C * Math.sin((H * Math.PI) / 180)), a);
  }
  const A = num(parts[1], 0.4), B = num(parts[2], 0.4);
  return A === null || B === null ? null : rgba(...oklab2rgb(L, A, B), a);
}

// parseColor(text, bare) -> { r, g, b, a } | null. bare=true also accepts channel lists used inside custom properties:
// "222.2 47.4% 11.2%" (shadcn HSL) and "79 70 229" / "79, 70, 229" (RGB).
function parseColor(input, bare = false) {
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  if (!s || s.length > 120) return null;
  let m = /^#([0-9a-f]+)$/.exec(s);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) return rgba(...[...h].map((c) => parseInt(c + c, 16)).slice(0, 3), h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1);
    if (h.length === 6 || h.length === 8) return rgba(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1);
    return null;
  }
  if (Object.hasOwn(NAMED, s)) return parseColor('#' + NAMED[s]);
  m = /^(rgba?|hsla?|oklch|oklab|color)\(([^()]*)\)$/.exec(s);
  if (m) return colorFunction(m[1], m[2]);
  if (bare) {
    const parts = s.split(/\s*,\s*|\s+/);
    if (parts.length === 3 && parts[1].endsWith('%') && parts[2].endsWith('%') && angle(parts[0]) !== null) return colorFunction('hsl', parts.join(' '));
    if (parts.length === 3 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return colorFunction('rgb', parts.join(' '));
  }
  return null;
}
const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
// normalizeColor(text, bare) -> '#rrggbb' | null. Alpha is dropped.
function normalizeColor(input, bare = false) {
  const c = parseColor(input, bare);
  return c ? hex(c) : null;
}
function blend(c, over) {
  const b = parseColor(over) || { r: 255, g: 255, b: 255 };
  return hex({ r: c.r * c.a + b.r * (1 - c.a), g: c.g * c.a + b.g * (1 - c.a), b: c.b * c.a + b.b * (1 - c.a) });
}
function luminance(h) {
  const c = parseColor(h);
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}
function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function saturation(h) {
  const c = parseColor(h);
  const max = Math.max(c.r, c.g, c.b) / 255, min = Math.min(c.r, c.g, c.b) / 255, l = (max + min) / 2;
  return { s: max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1)), l };
}

// Tailwind v3 palette, used to resolve `colors.indigo[600]` style references without evaluating the config.
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
let palette = null;
function tailwindPalette() {
  if (palette) return palette;
  palette = Object.create(null);
  for (const row of [
    'slate:f8fafc f1f5f9 e2e8f0 cbd5e1 94a3b8 64748b 475569 334155 1e293b 0f172a 020617',
    'gray:f9fafb f3f4f6 e5e7eb d1d5db 9ca3af 6b7280 4b5563 374151 1f2937 111827 030712',
    'zinc:fafafa f4f4f5 e4e4e7 d4d4d8 a1a1aa 71717a 52525b 3f3f46 27272a 18181b 09090b',
    'neutral:fafafa f5f5f5 e5e5e5 d4d4d4 a3a3a3 737373 525252 404040 262626 171717 0a0a0a',
    'stone:fafaf9 f5f5f4 e7e5e4 d6d3d1 a8a29e 78716c 57534e 44403c 292524 1c1917 0c0a09',
    'red:fef2f2 fee2e2 fecaca fca5a5 f87171 ef4444 dc2626 b91c1c 991b1b 7f1d1d 450a0a',
    'orange:fff7ed ffedd5 fed7aa fdba74 fb923c f97316 ea580c c2410c 9a3412 7c2d12 431407',
    'amber:fffbeb fef3c7 fde68a fcd34d fbbf24 f59e0b d97706 b45309 92400e 78350f 451a03',
    'yellow:fefce8 fef9c3 fef08a fde047 facc15 eab308 ca8a04 a16207 854d0e 713f12 422006',
    'lime:f7fee7 ecfccb d9f99d bef264 a3e635 84cc16 65a30d 4d7c0f 3f6212 365314 1a2e05',
    'green:f0fdf4 dcfce7 bbf7d0 86efac 4ade80 22c55e 16a34a 15803d 166534 14532d 052e16',
    'emerald:ecfdf5 d1fae5 a7f3d0 6ee7b7 34d399 10b981 059669 047857 065f46 064e3b 022c22',
    'teal:f0fdfa ccfbf1 99f6e4 5eead4 2dd4bf 14b8a6 0d9488 0f766e 115e59 134e4a 042f2e',
    'cyan:ecfeff cffafe a5f3fc 67e8f9 22d3ee 06b6d4 0891b2 0e7490 155e75 164e63 083344',
    'sky:f0f9ff e0f2fe bae6fd 7dd3fc 38bdf8 0ea5e9 0284c7 0369a1 075985 0c4a6e 082f49',
    'blue:eff6ff dbeafe bfdbfe 93c5fd 60a5fa 3b82f6 2563eb 1d4ed8 1e40af 1e3a8a 172554',
    'indigo:eef2ff e0e7ff c7d2fe a5b4fc 818cf8 6366f1 4f46e5 4338ca 3730a3 312e81 1e1b4b',
    'violet:f5f3ff ede9fe ddd6fe c4b5fd a78bfa 8b5cf6 7c3aed 6d28d9 5b21b6 4c1d95 2e1065',
    'purple:faf5ff f3e8ff e9d5ff d8b4fe c084fc a855f7 9333ea 7e22ce 6b21a8 581c87 3b0764',
    'fuchsia:fdf4ff fae8ff f5d0fe f0abfc e879f9 d946ef c026d3 a21caf 86198f 701a75 4a044e',
    'pink:fdf2f8 fce7f3 fbcfe8 f9a8d4 f472b6 ec4899 db2777 be185d 9d174d 831843 500724',
    'rose:fff1f2 ffe4e6 fecdd3 fda4af fb7185 f43f5e e11d48 be123c 9f1239 881337 4c0519',
  ]) {
    const [hue, list] = row.split(':');
    palette[hue] = Object.create(null);
    list.split(' ').forEach((h, i) => { palette[hue][SHADES[i]] = '#' + h; });
  }
  return palette;
}
function paletteRef(src) {
  const m = /^[A-Za-z_$][\w$]*\.([a-z]+)(?:\[['"]?(\d{2,3})['"]?\])?$/.exec(String(src).replace(/\s+/g, ''));
  if (!m) return null;
  if (m[1] === 'white' || m[1] === 'black') return m[2] ? null : m[1] === 'white' ? '#ffffff' : '#000000';
  const scale = tailwindPalette()[m[1]];
  if (!scale) return null;
  return m[2] ? scale[m[2]] || null : scale;
}

// ---------- Names to roles ----------

function words(name) {
  return String(name).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
const set = (s) => new Set(s.split(' '));
const FILLER = set('color colors colour colours clr theme sys system ref palette semantic global tokens token value default base');
const W = {
  accent: set('primary brand accent'), action: set('action interactive cta link'), accent2: set('secondary tertiary'),
  bg: set('background bg canvas page backdrop app'), surface: set('surface card panel popover paper elevated raised container sheet modal dialog tile well layer'),
  text: set('text ink copy content'), fg: set('foreground fg on contrast'), muted: set('muted subtle placeholder caption hint quiet dim weak'),
  border: set('border borders divider outline stroke line separator hairline rule input'), success: set('success positive valid'),
  warning: set('warning warn caution attention'), danger: set('danger error destructive negative critical invalid'),
  ignore: set('ring shadow overlay scrim selection chart gradient focus highlight info skeleton scrollbar'),
  context: set('sidebar nav navbar menu header footer code syntax tooltip toast badge button btn table kbd alert banner hero'),
  mod: set('hover active pressed focused disabled visited selected lighter lightest darker darkest soft strong emphasis inverse inverted alpha translucent transparent tint shade dim bright pale variant hint'),
};
const ROLE_WORDS = new Set(['accent', 'action', 'accent2', 'surface', 'text', 'muted', 'border', 'success', 'warning', 'danger'].flatMap((k) => [...W[k]]));
const SHADE_PENALTY = { 600: 0, 500: 1, 9: 2, 700: 6, 400: 8, 10: 8, 800: 12, 300: 14 };
const hasAny = (ws, s) => ws.some((w) => s.has(w));

// colorRole(name) -> { role, score } | null. Higher score wins; ties go to the first definition.
function colorRole(name) {
  const raw = words(name);
  if (!raw.length || hasAny(raw, W.ignore)) return null;
  if (raw.includes('body') && /^colou?r$/.test(raw[raw.length - 1]) && !hasAny(raw, W.bg)) return { role: 'text', score: 90 - raw.length };
  const ws = raw.filter((w) => !FILLER.has(w));
  if (!ws.length) return null;
  const has = (s) => hasAny(ws, s);
  const status = has(W.success) ? 'success' : has(W.warning) ? 'warning' : has(W.danger) ? 'danger' : null;
  // A neutral word before "primary" names the main neutral (bg-primary, border-primary); after it, a brand tint (primary-container).
  const neutralFirst = (s) => !ws.some((w) => w !== 'primary' && W.accent.has(w)) && (!ws.includes('primary') || ws.findIndex((w) => s.has(w)) < ws.indexOf('primary'));
  let role = null, score = 0;
  if (has(W.fg) && (ws.includes('foreground') || ws.includes('fg') || ws.indexOf('on') < ws.length - 1 || ws.includes('contrast'))) {
    if (has(W.muted) || ws.includes('secondary') || ws.includes('tertiary')) [role, score] = ['muted', 100];
    else if (!ws.some((w) => !W.fg.has(w) && !W.bg.has(w) && ROLE_WORDS.has(w))) [role, score] = ['text', 100];
    else if (has(W.surface) && !has(W.accent) && !status) [role, score] = ['text', 60];
    else return null;
  } else if (has(W.text) && !has(W.bg) && !has(W.surface)) {
    if (status || ws.some((w) => w !== 'primary' && (W.accent.has(w) || W.action.has(w))) || ws.includes('inverse') || ws.includes('white')) return null;
    if (has(W.muted) || ws.includes('secondary') || ws.includes('tertiary') || ws.includes('light') || ws.includes('soft')) [role, score] = ['muted', 90];
    else if (ws.includes('disabled')) [role, score] = ['muted', 40];
    else [role, score] = ['text', 90];
  } else if (status) [role, score] = [status, 90];
  else if (ws.includes('muted')) [role, score] = ['muted', 70];
  else if (has(W.border) && !has(W.action)) {
    if (!neutralFirst(W.border)) return null;
    [role, score] = ['border', ws.includes('input') && !ws.some((w) => w !== 'input' && W.border.has(w)) ? 60 : 90];
  } else if (has(W.surface)) {
    const s2 = ws.findIndex((w) => W.accent2.has(w));
    if (has(W.action) || !neutralFirst(W.surface) || (s2 >= 0 && s2 < ws.findIndex((w) => W.surface.has(w)))) return null;
    [role, score] = ['surface', s2 >= 0 ? 60 : 90];
  } else if (has(W.bg)) {
    if (has(W.action) || !neutralFirst(W.bg)) return null;
    [role, score] = ws.some((w) => w === 'secondary' || w === 'subtle' || w === 'alt' || w === 'tertiary' || (/^\d+$/.test(w) && w !== '0')) ? ['surface', 50] : ['background', 90];
  } else if (ws.includes('accent') && ws.includes('2')) [role, score] = ['accent2', 80];
  else if (has(W.accent2) && !ws.includes('primary')) [role, score] = ['accent2', has(W.accent) ? 75 : 60];
  else if (has(W.accent)) [role, score] = ['accent', ws.includes('primary') ? 100 : ws.includes('brand') ? 95 : 90];
  else if (has(W.action)) [role, score] = ['accent', ws.includes('link') ? 50 : 70];
  else return null;
  for (const w of ws) {
    if (W.mod.has(w) && !(role === 'muted' && W.muted.has(w))) score -= 25;
    if (W.context.has(w) && !(role === 'border' && w === 'input')) score -= 40;
  }
  const shade = ws.find((w) => /^\d+$/.test(w) && w !== '2');
  if (shade && /^(accent|accent2|success|warning|danger)$/.test(role)) score -= SHADE_PENALTY[shade] ?? 25;
  const dark = ws.indexOf('dark'), light = ws.indexOf('light');
  if (dark >= 0) score -= 50;
  if (light > 0 && role !== 'muted') score -= 25;
  return { role, score: score - ws.length };
}

const FONTISH = set('font fonts family typeface ff typography');
const NOT_FAMILY = set('size sizes weight weights leading line height tracking letter spacing style feature features variation scale smoothing stretch optical kerning');
// fontRole(name, requireFontWord) -> { role, score } | null
function fontRole(name, requireFontWord = true) {
  const ws = words(name);
  if (requireFontWord && !hasAny(ws, FONTISH)) return null;
  if (hasAny(ws, NOT_FAMILY)) return null;
  if (ws.some((w) => /^(heading|headings|display|title|headline|h[1-3]|hero)$/.test(w))) return { role: 'headingFont', score: 100 };
  if (ws.some((w) => /^(mono|monospace|code|pre)$/.test(w))) return { role: 'monoFont', score: 100 };
  if (ws.includes('serif') && !ws.includes('sans')) return { role: 'serif', score: 50 };
  if (ws.some((w) => /^(body|base|text|default|primary|ui|copy|paragraph|main|regular)$/.test(w))) return { role: 'bodyFont', score: 100 };
  if (ws.includes('sans')) return { role: 'bodyFont', score: 90 };
  return { role: 'bodyFont', score: 70 };
}
const GENERIC = set('serif sans-serif monospace cursive fantasy system-ui ui-serif ui-sans-serif ui-monospace ui-rounded emoji math fangsong -apple-system blinkmacsystemfont inherit initial unset revert revert-layer');
const EMOJI = /emoji|symbol/i;
function firstFamily(value) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.slice(0, MAX_VALUE).split(',') : [];
  for (const item of list.slice(0, 20)) {
    if (typeof item !== 'string') continue;
    const f = item.trim().replace(/^['"]+/, '').replace(/['"]+$/, '').trim();
    if (!f || GENERIC.has(f.toLowerCase()) || EMOJI.test(f) || !/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,59}$/u.test(f)) continue;
    return f;
  }
  return null;
}
const squash = (s) => s.toLowerCase().replace(/[\s_.-]+/g, '').replace(/(variable|var|vf)$/, '');
const FONT_KEYS = Object.keys(FONTS);
const mapFont = (name) => FONT_KEYS.find((k) => squash(k) === squash(name)) || name;

const RADIUS_WORDS = set('radius radii rounded corner corners');
function radiusScore(name) {
  const ws = words(name);
  if (!hasAny(ws, RADIUS_WORDS)) return null;
  const rest = ws.filter((w) => !RADIUS_WORDS.has(w) && !FILLER.has(w) && w !== 'border' && w !== 'size');
  if (!rest.length || rest.every((w) => /^(md|medium|m|base|default|normal|regular)$/.test(w))) return 100;
  if (rest.some((w) => /^(full|pill|circle|round|none|max)$/.test(w))) return null;
  if (rest.every((w) => /^(sm|small|s|lg|large|l)$/.test(w))) return 60;
  if (rest.every((w) => /^(card|button|btn|input|control|field|box|surface|component)$/.test(w))) return 70;
  return 20;
}
const SPACE_WORDS = set('space spacing spacer gap gutter');
function spaceScore(name) {
  const ws = words(name);
  if (!hasAny(ws, SPACE_WORDS) || ws.some((w) => /^(letter|line|word|tracking|leading)$/.test(w))) return null;
  const rest = ws.filter((w) => !SPACE_WORDS.has(w) && !FILLER.has(w) && !/^(size|sizes|dimension|dimensions)$/.test(w));
  if (!rest.length || rest.every((w) => /^(unit|base|grid|step|scale)$/.test(w))) return 'base';
  return 'scale';
}
function px(v, unitless = false) {
  if (typeof v === 'number') return unitless && Number.isFinite(v) ? v : null;
  if (isObj(v) && typeof v.value === 'number' && typeof v.unit === 'string') return px(`${v.value}${v.unit}`, unitless);
  if (typeof v !== 'string' || v.length > 40) return null;
  const m = /^\s*(-?(?:\d+\.?\d*|\.\d+))(px|rem|em)?\s*$/i.exec(v);
  if (!m || (!m[2] && !unitless && Number(m[1]) !== 0)) return null;
  return Number(m[1]) * (m[2] && m[2].toLowerCase() !== 'px' ? 16 : 1);
}
function baseUnit(values) {
  const v = values.filter((x) => x > 0 && x <= 128);
  if (v.length < 3) return null;
  for (const u of [12, 10, 8, 6, 5, 4]) {
    const hits = v.filter((x) => Math.abs(x / u - Math.round(x / u)) < 0.02).length;
    if (hits / v.length >= 0.8) return u;
  }
  return null;
}
const median = (v) => { const s = [...v].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

// ---------- Candidate store ----------

function store() {
  return { colors: [], fonts: [], radius: [], radiusDecl: [], spaceBase: [], spaceScale: [], spaceDecl: [], freq: new Map(), direct: {}, notes: [], unresolved: [], order: 0, read: [] };
}
function addColor(c, name, value, source, extra = 0, bare = true) {
  if (typeof value !== 'string' || value.length > MAX_VALUE) return false;
  const role = colorRole(name);
  if (!role) return false;
  const col = parseColor(value, bare);
  if (!col) { if (value.includes('var(')) c.unresolved.push(name); return false; }
  c.colors.push({ role: role.role, score: role.score + extra, color: col, source: source || name, order: c.order++ });
  return true;
}
function addFont(c, role, score, value, source) {
  const f = firstFamily(value);
  if (f) c.fonts.push({ role, score, name: f, source, order: c.order++ });
  else if (typeof value === 'string' && value.includes('var(')) c.unresolved.push(source);
}
function addRadius(c, name, value, unitless = false, extra = 0, source = name) {
  const score = radiusScore(name);
  const v = px(value, unitless);
  if (score === null || v === null || v < 0 || v >= 100) return false;
  c.radius.push({ score: score + extra, px: v, source, order: c.order++ });
  return true;
}
function addSpace(c, name, value, unitless = false, extra = 0) {
  const kind = spaceScore(name);
  const v = px(value, unitless);
  if (!kind || v === null || v <= 0 || v > 128) return false;
  if (kind === 'base') c.spaceBase.push({ score: 100 + extra, px: v, source: name, order: c.order++ });
  else c.spaceScale.push(v);
  return true;
}

// ---------- CSS ----------

// One linear pass: comments and strings respected, nested blocks tracked as a selector stack, declarations outside any block accepted.
function stripComments(s) {
  let out = '', i = 0;
  for (;;) {
    const k = s.indexOf('/*', i);
    if (k < 0) return out + s.slice(i);
    out += s.slice(i, k) + ' ';
    const e = s.indexOf('*/', k + 2);
    if (e < 0) return out;
    i = e + 2;
  }
}
// Selector context is derived incrementally from the parent block (one selector at a time), so deep nesting stays linear.
// sel/lower: the innermost selector; dark: any enclosing dark-theme selector; root: inside html/body/:root;
// rootish: top-level, :root-like or @theme/@layer context (custom properties defined there are global).
const TOP = { sel: '', lower: '', dark: false, root: false, anyRoot: false, allRoot: true, rootish: true };
function cssScope(parent, selector) {
  const sel = selector.replace(/\s+/g, ' ').slice(0, 300), lower = sel.toLowerCase();
  const dark = parent.dark || /dark|night/.test(lower);
  const anyRoot = parent.anyRoot || /(^|[\s,>])(html|body|:root|@theme)\b/.test(lower);
  const allRoot = parent.allRoot && ROOT_SEL.test(sel);
  return { sel, lower, dark, anyRoot, allRoot, rootish: allRoot || anyRoot, root: anyRoot && !dark && !/@theme/.test(lower) };
}
function scanCSS(css) {
  const out = [], stack = [];
  let start = 0, i = 0, scope = TOP;
  const n = css.length;
  const flush = (end) => {
    const s = stripComments(css.slice(start, end));
    const k = s.indexOf(':');
    if (k > 0) {
      const prop = s.slice(0, k).trim();
      let value = s.slice(k + 1).trim();
      const bang = value.lastIndexOf('!');
      if (bang >= 0 && /^!\s*important$/i.test(value.slice(bang))) value = value.slice(0, bang).trim();
      if (/^(--[\w-]{1,100}|[a-zA-Z-]{1,40})$/.test(prop) && value.length <= MAX_VALUE)
        out.push({ scope, sel: scope.sel, prop: prop.startsWith('--') ? prop : prop.toLowerCase(), value, dark: scope.dark });
    }
  };
  while (i < n) {
    const ch = css.charCodeAt(i);
    if (ch === 47 && css.charCodeAt(i + 1) === 42) { const e = css.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (ch === 34 || ch === 39) {
      let j = i + 1;
      while (j < n && css.charCodeAt(j) !== ch && css.charCodeAt(j) !== 10) j += css.charCodeAt(j) === 92 ? 2 : 1;
      i = j + 1;
      continue;
    }
    if (ch === 123) { stack.push(scope); scope = cssScope(scope, stripComments(css.slice(start, i)).trim()); start = i + 1; }
    else if (ch === 125) { flush(i); scope = stack.pop() || TOP; start = i + 1; }
    else if (ch === 59) { flush(i); start = i + 1; }
    i++;
  }
  flush(n);
  return out;
}
// Expands var(--x, fallback) with a depth and output budget, so self-referencing or exponential definitions stay cheap.
function resolveVars(value, vars) {
  if (typeof value !== 'string' || !value.includes('var(')) return value;
  let budget = 2000;
  const run = (v, depth) => {
    if (depth > 8) throw new Error('deep');
    let out = '', i = 0;
    for (;;) {
      const k = v.indexOf('var(', i);
      if (k < 0) { out += v.slice(i); break; }
      out += v.slice(i, k);
      let d = 0, j = k + 3, comma = -1;
      for (; j < v.length; j++) {
        const ch = v[j];
        if (ch === '(') d++;
        else if (ch === ')' && --d === 0) break;
        else if (ch === ',' && d === 1 && comma < 0) comma = j;
      }
      if (j >= v.length) throw new Error('unbalanced');
      const name = v.slice(k + 4, comma < 0 ? j : comma).trim();
      const def = vars.get(name);
      if (def !== undefined) out += run(def, depth + 1);
      else if (comma >= 0) out += run(v.slice(comma + 1, j).trim(), depth + 1);
      else throw new Error('unknown');
      i = j + 1;
      if ((budget -= out.length) < 0) throw new Error('budget');
    }
    return out;
  };
  try { return run(value, 0); } catch { return value; }
}
function styleBlocks(html) {
  const lower = html.toLowerCase(), parts = [];
  for (let i = lower.indexOf('<style'); i >= 0 && parts.length < 50; i = lower.indexOf('<style', i + 1)) {
    const open = lower.indexOf('>', i), close = lower.indexOf('</style', open);
    if (open < 0) break;
    parts.push(html.slice(open + 1, close < 0 ? html.length : close));
    if (close < 0) break;
    i = close;
  }
  return parts.join('\n');
}
const ROOT_SEL = /^(?:|:root|html|body|@theme|@layer \w+(?: :root)?|:root,? ?\.light|\[data-theme=["']?light["']?\])$/i;
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\([^()]{1,120}\)/g;

function fromCSS(css, c, quiet = false) {
  const decls = scanCSS(css);
  const vars = new Map(), darkVars = new Map();
  for (const d of decls) if (d.prop.startsWith('--')) { const m = d.dark ? darkVars : vars; if (!m.has(d.prop)) m.set(d.prop, d.value); }
  for (const [k, v] of darkVars) if (!vars.has(k)) vars.set(k, v);
  let props = 0, darkSkipped = 0;
  const seen = new Set();
  for (const d of decls) {
    const extra = (d.dark ? -50 : 0) + (d.scope.rootish ? 0 : -10);
    if (d.prop.startsWith('--')) {
      props++;
      const key = d.prop + (d.dark ? ':dark' : '');
      if (seen.has(key)) continue;
      seen.add(key);
      const value = resolveVars(d.value, vars);
      const fr = fontRole(d.prop);
      if (addColor(c, d.prop, value, d.prop, extra)) { if (d.dark) darkSkipped++; }
      else if (fr && !/^-?[\d.]+(px|rem|em|%)?$/.test(value.trim())) addFont(c, fr.role, fr.score + extra, value, d.prop);
      else if (!addRadius(c, d.prop, value, false, extra)) addSpace(c, d.prop, value, false, extra);
      continue;
    }
    const value = resolveVars(d.value, vars);
    const sel = d.scope.lower, isRoot = d.scope.root;
    if (d.prop === 'font-family') {
      const role = /\bh[1-6]\b|head|title|display|hero/.test(sel) ? 'headingFont' : /\b(code|pre|kbd|samp|tt)\b|mono/.test(sel) ? 'monoFont' : 'bodyFont';
      addFont(c, role, (isRoot || role !== 'bodyFont' ? 70 : 20) + (d.dark ? -50 : 0), value, `${d.sel.slice(0, 40) || 'top level'} font-family`);
    } else if ((d.prop === 'background' || d.prop === 'background-color') && isRoot && !value.includes('gradient')) {
      const lit = (value.match(COLOR_LITERAL) || [value.split(/\s+/)[0]])[0];
      const col = parseColor(lit);
      if (col) c.colors.push({ role: 'background', score: 80, color: col, source: `${d.sel.slice(0, 40)} background`, order: c.order++ });
    } else if (d.prop === 'color' && isRoot) {
      const col = parseColor(value);
      if (col) c.colors.push({ role: 'text', score: 80, color: col, source: `${d.sel.slice(0, 40)} color`, order: c.order++ });
    } else if (/^border(-(top|bottom)-(left|right))?-radius$/.test(d.prop)) {
      const v = px(value.split(/\s+/).find((x) => px(x) !== null && px(x) > 0) || value.split(/\s+/)[0]);
      if (v !== null && v >= 0 && v < 100) c.radiusDecl.push(v);
    } else if (/^(gap|row-gap|column-gap|padding|margin)(-(top|right|bottom|left|inline|block)(-(start|end))?)?$/.test(d.prop)) {
      for (const part of value.split(/\s+/).slice(0, 4)) { const v = px(part); if (v !== null && v > 0 && v <= 128) c.spaceDecl.push(v); }
    }
    if (!d.prop.startsWith('--') && d.value.length <= MAX_VALUE) {
      for (const lit of value.match(COLOR_LITERAL) || []) {
        const h = normalizeColor(lit);
        if (h) c.freq.set(h, (c.freq.get(h) || 0) + 1);
      }
    }
  }
  if (props || (decls.length && !quiet)) c.read.push(`CSS: ${props} custom properties, ${decls.length - props} declarations`);
  if (darkSkipped) c.notes.push('Dark theme values were found; light theme values were preferred.');
  return vars;
}

// ---------- JSON tokens ----------

const DIRECT_COLORS = ['accent', 'accent2', 'background', 'surface', 'text', 'muted', 'border', 'success', 'warning', 'danger'];
const DIRECT_KEYS = new Set([...DIRECT_COLORS, 'headingFont', 'bodyFont', 'monoFont', 'font', 'radius', 'spacing', 'density', 'shadow', 'typeScale']);
function fromDirect(obj, c) {
  for (const k of DIRECT_COLORS) {
    const col = typeof obj[k] === 'string' ? parseColor(obj[k]) : null;
    if (col) c.colors.push({ role: k, score: 1000, color: col, source: `"${k}"`, order: c.order++ });
  }
  for (const [k, role] of [['headingFont', 'headingFont'], ['bodyFont', 'bodyFont'], ['font', 'bodyFont'], ['monoFont', 'monoFont']])
    if (typeof obj[k] === 'string') addFont(c, role, k === 'font' ? 990 : 1000, obj[k], `"${k}"`);
  if (px(obj.radius, true) !== null) c.radius.push({ score: 1000, px: px(obj.radius, true), source: '"radius"', order: c.order++ });
  if (px(obj.spacing, true) !== null) c.spaceBase.push({ score: 1000, px: px(obj.spacing, true), source: '"spacing"', order: c.order++ });
  if (['compact', 'comfortable', 'spacious'].includes(obj.density)) c.direct.density = obj.density;
  if (['none', 'soft', 'medium', 'crisp'].includes(obj.shadow)) c.direct.shadow = obj.shadow;
  if (typeof obj.typeScale === 'number' && obj.typeScale >= 1.1 && obj.typeScale <= 1.5) c.direct.typeScale = obj.typeScale;
  c.read.push('Forma design tokens');
}
function collectTokens(node, pathParts, type, out, state, depth = 0) {
  if (depth > 40 || ++state.nodes > 20000 || out.length >= 5000) return;
  if (Array.isArray(node)) { if (pathParts.length && node.every((x) => typeof x === 'string')) out.push({ path: pathParts, value: node, type }); return; }
  if (isObj(node)) {
    if (Object.hasOwn(node, '$value')) { state.w3c++; out.push({ path: pathParts, value: node.$value, type: node.$type || type }); return; }
    if (Object.hasOwn(node, 'value') && (!isObj(node.value) || Object.hasOwn(node, 'type') || Object.hasOwn(node.value, 'fontFamily'))) {
      state.sd++;
      out.push({ path: pathParts, value: node.value, type: node.type || type });
      return;
    }
    const t = typeof node.$type === 'string' ? node.$type : type;
    for (const k of Object.keys(node)) if (!k.startsWith('$')) collectTokens(node[k], [...pathParts, k], t, out, state, depth + 1);
    return;
  }
  if ((typeof node === 'string' || typeof node === 'number') && pathParts.length) out.push({ path: pathParts, value: node, type });
}
function w3cColor(v) {
  if (typeof v === 'string') return v;
  if (isObj(v)) {
    if (typeof v.hex === 'string') return v.hex;
    if (v.colorSpace === 'srgb' && Array.isArray(v.components) && v.components.length === 3 && v.components.every((x) => typeof x === 'number'))
      return `rgb(${v.components.map((x) => clamp(x, 0, 1) * 255).join(' ')})`;
  }
  return null;
}
function fromJSON(obj, c) {
  const root = isObj(obj) && isObj(obj.designSystem) ? obj.designSystem : obj;
  if (isObj(root) && Object.keys(root).filter((k) => DIRECT_KEYS.has(k) && (typeof root[k] !== 'object' || root[k] === null)).length >= 2) fromDirect(root, c);
  const tokens = [], state = { nodes: 0, w3c: 0, sd: 0 };
  collectTokens(root, [], undefined, tokens, state);
  const byPath = new Map(tokens.map((t) => [t.path.join('.'), t]));
  const resolve = (v) => {
    for (let i = 0; i < 10 && typeof v === 'string'; i++) {
      const m = /^\{([^{}]{1,200})\}$/.exec(v.trim());
      if (!m) return v;
      const t = byPath.get(m[1]) || byPath.get(m[1].replace(/\.value$/, ''));
      if (!t) return null;
      v = t.value;
    }
    return typeof v === 'string' && /^\{[^{}]*\}$/.test(v.trim()) ? null : v;
  };
  for (const t of tokens) {
    const name = t.path.join('-');
    const type = String(t.type || '').toLowerCase();
    const value = resolve(t.value);
    if (value === null || value === undefined) { if (typeof t.value === 'string' && t.value.includes('{')) c.unresolved.push(name); continue; }
    if (type === 'color' || (!type && typeof value === 'string' && parseColor(value, false))) { addColor(c, name, w3cColor(value), name, 0, false); continue; }
    if (type === 'typography' && isObj(value)) {
      const fr = fontRole(name, false);
      if (fr && value.fontFamily !== undefined) addFont(c, fr.role, fr.score - 10, resolve(value.fontFamily), name);
      continue;
    }
    const fr = fontRole(name, type !== 'fontfamily' && type !== 'fontfamilies');
    if (fr && (type === 'fontfamily' || type === 'fontfamilies' || ((typeof value === 'string' || Array.isArray(value)) && px(value, true) === null))) { addFont(c, fr.role, fr.score, value, name); continue; }
    const unitless = typeof value === 'number' || /^(dimension|borderradius|spacing|sizing|number)$/.test(type);
    if (!addRadius(c, name, value, unitless)) addSpace(c, name, value, unitless);
  }
  if (state.w3c) c.read.push(`W3C design tokens: ${state.w3c} tokens`);
  else if (state.sd) c.read.push(`Style Dictionary tokens: ${state.sd} tokens`);
  else if (tokens.length && !c.read.length) c.read.push(`JSON: ${tokens.length} values`);
}

// ---------- Tailwind (lenient JS literal reader, never evaluated) ----------

function jsTokens(src) {
  const ts = [], n = src.length;
  const ident = /[A-Za-z_$][\w$]*/y, number = /-?(?:0x[0-9a-fA-F]+|\d*\.?\d+(?:[eE][+-]?\d+)?)/y;
  let i = 0;
  while (i < n && ts.length < 200000) {
    const ch = src[i];
    if (ch <= ' ') { i++; continue; }
    if (ch === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = e < 0 ? n : e; continue; }
    if (ch === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1, s = '', bad = false;
      while (j < n && src[j] !== ch) {
        if (src[j] === '\\') {
          const e = src[j + 1];
          if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(src.slice(j + 2, j + 6))) { s += String.fromCharCode(parseInt(src.slice(j + 2, j + 6), 16)); j += 6; continue; }
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e ?? '';
          j += 2;
          continue;
        }
        if (ch === '`' && src[j] === '$' && src[j + 1] === '{') bad = true;
        if (ch !== '`' && src[j] === '\n') break;
        if (s.length < 2000) s += src[j];
        j++;
      }
      ts.push({ k: bad ? 'x' : 's', v: s, p: i, e: j + 1 });
      i = j + 1;
      continue;
    }
    ident.lastIndex = i;
    let m = ident.exec(src);
    if (m) { ts.push({ k: 'id', v: m[0], p: i, e: i + m[0].length }); i += m[0].length; continue; }
    number.lastIndex = i;
    m = /[\d.]/.test(ch) || (ch === '-' && /[\d.]/.test(src[i + 1] || '')) ? number.exec(src) : null;
    if (m && m[0] !== '-' && m[0] !== '.') { ts.push({ k: 'n', v: Number(m[0]), p: i, e: i + m[0].length }); i += m[0].length; continue; }
    if (src.startsWith('...', i)) { ts.push({ k: 'p', v: '...', p: i, e: i + 3 }); i += 3; continue; }
    ts.push({ k: 'p', v: ch, p: i, e: i + 1 });
    i++;
  }
  return ts;
}
const OPEN = { '{': '}', '[': ']', '(': ')' };
// Skips one expression: stops before a ',' ';' or closing bracket at depth 0.
function skipExpr(ts, pos) {
  const stack = [];
  for (; pos < ts.length; pos++) {
    const t = ts[pos];
    if (t.k !== 'p') continue;
    if (OPEN[t.v]) stack.push(OPEN[t.v]);
    else if (t.v === '}' || t.v === ']' || t.v === ')') { if (!stack.length) return pos; stack.pop(); }
    else if ((t.v === ',' || t.v === ';') && !stack.length) return pos;
  }
  return pos;
}
function parseValue(ts, pos, depth, src) {
  const t = ts[pos];
  if (!t) return { v: new Unknown(''), pos };
  const unknown = () => { const end = Math.max(pos + 1, skipExpr(ts, pos)); return { v: new Unknown(src.slice(t.p, ts[end - 1].e).slice(0, 80)), pos: end }; };
  if (depth > 40) return unknown();
  if (t.k === 'p' && t.v === '{') return parseObject(ts, pos + 1, depth + 1, src);
  if (t.k === 'p' && t.v === '[') {
    const arr = [];
    let p = pos + 1;
    while (p < ts.length) {
      const x = ts[p];
      if (x.k === 'p' && x.v === ']') { p++; break; }
      if (x.k === 'p' && x.v === ',') { p++; continue; }
      if (x.k === 'p' && (x.v === '}' || x.v === ')' || x.v === ';')) break;
      if (x.k === 'p' && x.v === '...') { p = Math.max(p + 1, skipExpr(ts, p + 1)); continue; }
      const r = parseValue(ts, p, depth + 1, src);
      if (arr.length < 1000) arr.push(r.v);
      p = Math.max(r.pos, p + 1);
      if (ts[p] && !(ts[p].k === 'p' && (ts[p].v === ',' || ts[p].v === ']'))) p = Math.max(p, skipExpr(ts, p));
    }
    return { v: arr, pos: p };
  }
  const next = ts[pos + 1];
  const ends = !next || (next.k === 'p' && (next.v === ',' || next.v === '}' || next.v === ']' || next.v === ')' || next.v === ';'));
  if (t.k === 's' && ends) return { v: t.v, pos: pos + 1 };
  if (t.k === 'n' && ends) return { v: t.v, pos: pos + 1 };
  if (t.k === 'id' && ends && (t.v === 'true' || t.v === 'false' || t.v === 'null')) return { v: t.v === 'null' ? null : t.v === 'true', pos: pos + 1 };
  return unknown();
}
function parseObject(ts, pos, depth, src) {
  const obj = Object.create(null);
  let p = pos, count = 0;
  while (p < ts.length) {
    const t = ts[p];
    if (t.k === 'p' && t.v === '}') return { v: obj, pos: p + 1 };
    if (t.k === 'p' && (t.v === ']' || t.v === ')')) return { v: obj, pos: p };
    if (t.k === 'p' && (t.v === ',' || t.v === ';')) { p++; continue; }
    if (t.k === 'p' && t.v === '...') { p = Math.max(p + 1, skipExpr(ts, p + 1)); continue; }
    let key = null;
    if (t.k === 'id' || t.k === 's') { key = t.v; p++; }
    else if (t.k === 'n') { key = String(t.v); p++; }
    else if (t.k === 'p' && t.v === '[') { p = Math.max(p + 1, skipExpr(ts, p + 1) + 1); }
    else { p = Math.max(p + 1, skipExpr(ts, p)); continue; }
    let value;
    if (ts[p] && ts[p].k === 'p' && ts[p].v === ':') { const r = parseValue(ts, p + 1, depth, src); value = r.v; p = Math.max(r.pos, p + 1); }
    else { value = new Unknown(key || ''); p = Math.max(p, skipExpr(ts, p)); }
    if (key !== null && key !== '__proto__' && count++ < 2000) obj[key] = value;
    if (ts[p] && !(ts[p].k === 'p' && (ts[p].v === ',' || ts[p].v === '}' || ts[p].v === ';'))) p = Math.max(p + 1, skipExpr(ts, p));
  }
  return { v: obj, pos: p };
}
function parseLiteral(src) {
  const ts = jsTokens(src);
  const i = ts.findIndex((t) => t.k === 'p' && t.v === '{');
  return i < 0 ? null : parseValue(ts, i, 0, src).v;
}
const THEME_KEYS = new Set(['colors', 'fontFamily', 'borderRadius', 'extend', 'spacing']);
function tailwindThemes(src) {
  const ts = jsTokens(src), themes = [], frag = Object.create(null);
  const keyAt = (i) => (ts[i].k === 'id' || ts[i].k === 's') && ts[i + 1] && ts[i + 1].k === 'p' && ts[i + 1].v === ':' && ts[i + 2] && ts[i + 2].k === 'p' && ts[i + 2].v === '{';
  for (let i = 0; i + 2 < ts.length; i++) {
    if (ts[i].v === 'theme' && keyAt(i)) { const r = parseValue(ts, i + 2, 0, src); if (isObj(r.v)) themes.push(r.v); i = r.pos - 1; }
  }
  if (!themes.length) {
    for (let i = 0; i + 2 < ts.length; i++) {
      if (THEME_KEYS.has(ts[i].v) && keyAt(i) && !(ts[i].v in frag)) { const r = parseValue(ts, i + 2, 0, src); frag[ts[i].v] = r.v; i = r.pos - 1; }
    }
    if (Object.keys(frag).length) themes.push(frag);
  }
  return themes;
}
function twColors(obj, prefix, c, vars, depth = 0) {
  for (const k of Object.keys(obj)) {
    const v = obj[k], name = prefix ? `${prefix}-${k}` : k;
    if (typeof v === 'string') addColor(c, name, resolveVars(v.replace(/<alpha-value>/g, '1'), vars), `theme.colors.${name.replace(/-/g, '.')}`, 0, false);
    else if (v instanceof Unknown) {
      const pal = paletteRef(v.src);
      if (typeof pal === 'string') addColor(c, name, pal, `theme.colors.${name.replace(/-/g, '.')} (${label(v.src)})`, 0, false);
      else if (pal) for (const s of SHADES) addColor(c, `${name}-${s}`, pal[s], `theme.colors.${name.replace(/-/g, '.')} (${label(v.src)}[${s}])`, 0, false);
      else if (colorRole(name)) c.unresolved.push(`${name} (${label(v.src)})`);
    } else if (isObj(v) && depth < 4) twColors(v, name, c, vars, depth + 1);
  }
}
function fromTailwind(themes, c, vars) {
  const seen = [];
  for (const theme of themes) {
    for (const t of [theme, theme.extend]) {
      if (!isObj(t)) continue;
      if (isObj(t.colors)) { twColors(t.colors, '', c, vars); seen.push('colors'); }
      if (isObj(t.fontFamily)) {
        seen.push('fontFamily');
        for (const k of Object.keys(t.fontFamily)) {
          const fr = fontRole(k, false), v = t.fontFamily[k];
          const list = Array.isArray(v) ? v.filter((x) => typeof x === 'string').map((x) => resolveVars(x, vars)) : typeof v === 'string' ? resolveVars(v, vars) : null;
          if (fr && list) addFont(c, fr.role, fr.score, list, `theme.fontFamily.${k}`);
        }
      }
      if (isObj(t.borderRadius)) {
        seen.push('borderRadius');
        for (const k of Object.keys(t.borderRadius)) {
          const v = t.borderRadius[k];
          if (typeof v === 'string') addRadius(c, `radius-${k}`, resolveVars(v, vars), false, 0, `theme.borderRadius.${k}`);
        }
      }
    }
  }
  if (seen.length) c.read.push(`Tailwind theme: ${[...new Set(seen)].join(', ')}`);
}

// ---------- Assignment ----------

const best = (list) => list.reduce((a, b) => (!a || b.score > a.score || (b.score === a.score && b.order < a.order) ? b : a), null);

function assign(c) {
  const tokens = {}, notes = [];
  const note = (s) => { if (notes.length < 40) notes.push(s); };
  for (const r of c.read) note(`Read ${r}.`);
  const byRole = (role) => c.colors.filter((x) => x.role === role).sort((a, b) => b.score - a.score || a.order - b.order);
  const take = (role, pick, check) => {
    for (const cand of byRole(role)) {
      const translucent = cand.color.a < 1;
      const value = translucent && pick ? blend(cand.color, tokens.background) : hex(cand.color);
      const why = check ? check(value, cand) : null;
      if (why) { note(`Skipped ${label(cand.source)} (${value}) for ${role}: ${why}.`); continue; }
      tokens[role] = value;
      note(`${role}: ${value} from ${label(cand.source)}${translucent ? (pick ? ' (translucent, blended over the background)' : ' (alpha dropped)') : ''}.`);
      return;
    }
  };
  take('background');
  take('text');
  take('surface');
  take('accent');
  if (!tokens.accent && c.freq.size) {
    const [h, n] = [...c.freq].filter(([x]) => { const s = saturation(x); return s.s >= 0.3 && s.l >= 0.2 && s.l <= 0.8; }).sort((a, b) => b[1] - a[1])[0] || [];
    if (h) { tokens.accent = h; note(`accent: ${h} guessed from the most frequent saturated colour (used ${n} time${n === 1 ? '' : 's'}).`); }
  }
  take('accent2', false, (v) => { const x = saturation(v); return x.s < 0.2 || x.l > 0.85 || x.l < 0.12 ? 'too grey, light or dark to be an accent' : null; });
  const bg = tokens.background || '#ffffff';
  take('muted', true, (v) => (contrast(v, bg) < 2.5 ? 'too close to the background to be muted text' : null));
  take('border', true);
  for (const role of ['success', 'warning', 'danger']) take(role);
  if (tokens.text && contrast(tokens.text, bg) < 3) note(`Text ${tokens.text} has low contrast (${contrast(tokens.text, bg).toFixed(2)}:1) on ${bg}; check the colours.`);

  for (const role of ['headingFont', 'bodyFont', 'monoFont']) {
    let cand = best(c.fonts.filter((f) => f.role === role));
    if (!cand && role === 'headingFont') cand = best(c.fonts.filter((f) => f.role === 'serif'));
    if (!cand && role === 'bodyFont') cand = best(c.fonts.filter((f) => f.role === 'serif'));
    if (!cand) continue;
    const name = mapFont(cand.name);
    tokens[role] = name;
    note(`${role}: ${name} from ${label(cand.source)}${FONTS[name] ? '' : ` (not bundled with Forma; a bundled font will be used unless it is installed)`}.`);
  }

  const named = c.radius.filter((r) => r.score >= 60);
  let radius = null, rsrc = '';
  if (named.length) { const r = best(named); radius = r.px; rsrc = r.source; }
  else if (c.radius.length) { radius = median(c.radius.map((r) => r.px)); rsrc = 'radius scale (median)'; }
  else if (c.radiusDecl.length) {
    const nz = c.radiusDecl.filter((v) => v > 0);
    radius = median(nz.length ? nz : c.radiusDecl);
    rsrc = `${c.radiusDecl.length} border-radius declarations (median)`;
  }
  if (radius !== null) {
    const r = Math.round(clamp(radius, 0, 40));
    tokens.radius = r;
    note(`radius: ${r}px from ${label(rsrc)}${r !== Math.round(radius) ? ' (clamped to 0-40)' : ''}.`);
  }
  let space = null, ssrc = '';
  const base = best(c.spaceBase);
  if (base) { space = base.px; ssrc = base.source; }
  else if ((space = baseUnit(c.spaceScale)) !== null) ssrc = 'spacing scale (common base unit)';
  else if ((space = baseUnit(c.spaceDecl)) !== null) ssrc = 'gap, padding and margin values (common base unit)';
  if (space !== null) {
    const s = Math.round(clamp(space, 4, 24));
    tokens.spacing = s;
    note(`spacing: ${s}px from ${label(ssrc)}${s !== Math.round(space) ? ' (clamped to 4-24)' : ''}.`);
  }
  Object.assign(tokens, c.direct);
  for (const n of c.notes) note(n);
  if (c.unresolved.length) note(`Could not resolve ${c.unresolved.length} reference${c.unresolved.length === 1 ? '' : 's'}: ${c.unresolved.slice(0, 5).map(label).join(', ')}${c.unresolved.length > 5 ? ', \u2026' : ''}.`);
  if (!Object.keys(tokens).length) note('No colours, fonts, radius or spacing were recognised. Paste CSS custom properties, design tokens JSON or a Tailwind theme.');
  return { tokens, notes };
}

const JS_HINT = /\b(?:module\.exports|export\s+default|require\s*\(|defineConfig|satisfies)|\b(?:theme|extend|colors|fontFamily|borderRadius)\s*:/;

// importTokens(text) -> { tokens: partial token object, notes: string[] }
function importTokens(text) {
  if (typeof text !== 'string') fail('Paste CSS, design tokens JSON or a Tailwind config as text.');
  if (Buffer.byteLength(text) > MAX_BYTES) fail('Design token text must be at most 200 KB.');
  const src = text.trim();
  if (!src) fail('Paste CSS, design tokens JSON or a Tailwind config.');
  const c = store();
  let json;
  if (src[0] === '{' || src[0] === '[') { try { json = JSON.parse(src); } catch {} }
  if (json !== undefined) fromJSON(json, c);
  else if (src[0] === '{') {
    const obj = parseLiteral(src);
    const themes = tailwindThemes(src);
    if (themes.length) fromTailwind(themes, c, new Map());
    else if (isObj(obj)) fromJSON(obj, c);
  } else {
    const js = JS_HINT.test(src);
    const vars = fromCSS(/<style[\s>]/i.test(src) ? styleBlocks(src) : src, c, js);
    if (js) fromTailwind(tailwindThemes(src), c, vars);
  }
  return assign(c);
}

module.exports = { importTokens, normalizeColor, parseColor, contrast, scanCSS, parseLiteral, colorRole };
