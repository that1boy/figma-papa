'use strict';
const sanitize = require('sanitize-html');
const KINDS = ['web', 'slides', 'document'];
function fail(message) {
  throw Object.assign(new Error(message), { status: 400 });
}
function str(x, name, max = 2000, required = false) {
  if (x == null && !required) return '';
  if (typeof x !== 'string' || x.length > max || (required && !x.trim()))
    fail(`${name} must be ${required ? 'nonempty ' : ''}text, at most ${max} characters.`);
  return x;
}
function arr(x, name, max) {
  if (!Array.isArray(x) || x.length > max)
    fail(`${name} must be an array with at most ${max} items.`);
  return x;
}
function strings(x, name, max = 8, length = 300) {
  return arr(x || [], name, max).map((v) => str(v, name, length, true));
}
function table(x) {
  if (!x) return null;
  const headers = strings(x.headers, 'Table headers', 5, 70);
  if (!headers.length) fail('A table needs headers.');
  const rows = arr(x.rows, 'Table rows', 8).map((row) => {
    const r = strings(row, 'Table cells', 5, 160);
    if (r.length !== headers.length) fail('Each table row must match the header count.');
    return r;
  });
  return { headers, rows };
}
const MAX_REFERENCES = 6;
function imageIndex(x) {
  if (x == null) return null;
  if (!Number.isInteger(x) || x < 0 || x >= MAX_REFERENCES) fail(`imageIndex must be 0–${MAX_REFERENCES - 1}.`);
  return x;
}
function color(x, fallback) {
  if (x == null) return fallback;
  if (!/^#[a-fA-F0-9]{6}$/.test(x)) fail('Colours must use #RRGGBB.');
  return x;
}
function theme(x = {}) {
  return {
    accent: color(x.accent, '#6554c0'),
    background: color(x.background, '#faf9f6'),
    text: color(x.text, '#202333'),
  };
}
function safeCSS(css) {
  css = str(css || '', 'CSS', 60000);
  // Backslash escapes and comments could conceal forbidden tokens. Keep the pilot CSS subset explicit.
  if (
    /[\\<]/.test(css) ||
    /\/\*/.test(css) ||
    /(?:url\s*\(|@import|@font-face|expression\s*\(|-moz-binding)/i.test(css)
  )
    fail('CSS cannot contain external resources, escapes, comments, or executable expressions.');
  return css;
}
// Rich markup (0.3): inline SVG drawing elements with validated attribute values
// (lib/svg.cjs), <i data-icon>, data-chart hosts and a few more semantic tags.
const markupPolicy = require('./svg.cjs');
const chartHost = (name, attrs) => {
  const attribs = { ...attrs };
  if (Object.hasOwn(attribs, 'data-chart') && markupPolicy.chartAttribute(attribs['data-chart']) == null) delete attribs['data-chart'];
  return { tagName: name, attribs };
};
function safeHTML(html) {
  // HTML ignores "/>" on non-void elements, so <i data-icon="x"/> would swallow
  // the rest of its parent. Close such icon and chart hosts explicitly; the
  // sanitizer below still checks everything.
  html = str(html, 'HTML', 160000, true).replace(/<(i|figure)(\s[^<>]*)?\/>/gi, (_, tag, rest = '') => `<${tag}${rest.trimEnd()}></${tag}>`);
  const svg = markupPolicy.svgPolicy();
  return svg.finish(sanitize(html, {
    // A model may return a full document despite the body-fragment instruction.
    // Drop metadata text with its container instead of leaking it into the page.
    // math and foreignObject subtrees are dropped whole (namespace-confusion vectors).
    // <title> outside <svg> is renamed to svg.DROP_TEXT and removed by svg.finish.
    nonTextTags: ['script', 'style', 'textarea', 'option', 'head', 'title', 'xmp', 'math', 'foreignObject', 'foreignobject'],
    onOpenTag: svg.onOpenTag,
    onCloseTag: svg.onCloseTag,
    allowedTags: [
      ...markupPolicy.SVG_TAGS,
      svg.DROP,
      svg.DROP_TEXT,
      'i',
      'figure',
      'figcaption',
      'h5',
      'h6',
      'blockquote',
      'code',
      'pre',
      'kbd',
      'mark',
      'time',
      'progress',
      'meter',
      'fieldset',
      'legend',
      'output',
      'main',
      'header',
      'footer',
      'nav',
      'section',
      'article',
      'aside',
      'div',
      'span',
      'p',
      'h1',
      'h2',
      'h3',
      'h4',
      'strong',
      'em',
      'small',
      'br',
      'hr',
      'ul',
      'ol',
      'li',
      'dl',
      'dt',
      'dd',
      'a',
      'button',
      'input',
      'label',
      'select',
      'option',
      'textarea',
      'form',
      'table',
      'thead',
      'tbody',
      'tr',
      'td',
      'th',
      'caption',
      'img',
      'details',
      'summary',
      'dialog',
    ],
    allowedAttributes: {
      '*': [
        'class',
        'id',
        'hidden',
        'role',
        'aria-label',
        'aria-labelledby',
        'aria-modal',
        'aria-pressed',
        'aria-selected',
        'aria-expanded',
        'aria-controls',
        'aria-describedby',
        'aria-current',
        'aria-live',
        'tabindex',
        'title',
        'data-design-id',
        'data-action',
        'data-target',
        'data-group',
        'data-panel',
        'data-row',
      ],
      a: ['href'],
      img: ['src', 'alt', 'width', 'height'],
      input: ['type', 'placeholder', 'value', 'required', 'name', 'min', 'max', 'step', 'checked', 'disabled', 'autocomplete'],
      label: ['for'],
      select: ['name', 'required', 'disabled'],
      option: ['value', 'selected'],
      textarea: ['placeholder', 'name', 'rows', 'required', 'disabled'],
      button: ['type', 'disabled'],
      td: ['data-label'],
      th: ['data-label', 'scope'],
      i: ['data-icon', 'aria-hidden'],
      figure: ['data-chart'],
      div: ['data-chart'],
      time: ['datetime'],
      progress: ['value', 'max'],
      meter: ['value', 'min', 'max', 'low', 'high', 'optimum'],
      fieldset: ['disabled', 'name'],
      output: ['for', 'name'],
      ...markupPolicy.SVG_ALLOWED_ATTRIBUTES,
    },
    allowedSchemes: [],
    allowedEmptyAttributes: ['hidden', 'data-row'],
    transformTags: {
      ...svg.transformTags,
      '*': svg.transformAll,
      figure: chartHost,
      div: chartHost,
      i: (name, attrs) => {
        const attribs = { ...attrs };
        if (Object.hasOwn(attribs, 'data-icon')) {
          const icon = markupPolicy.iconAttribute(attribs['data-icon']);
          if (icon) attribs['data-icon'] = icon;
          else delete attribs['data-icon'];
        }
        if (Object.hasOwn(attribs, 'aria-hidden') && !/^(?:true|false)$/.test(attribs['aria-hidden'])) delete attribs['aria-hidden'];
        return { tagName: name, attribs };
      },
      a: (name, attrs) => ({
        tagName: name,
        attribs: { ...attrs, href: /^#[a-zA-Z][\w-]*$/.test(attrs.href || '') ? attrs.href : '#' },
      }),
      img: (name, attrs) => ({
        tagName: name,
        attribs: {
          ...attrs,
          src: /^\{\{reference:[0-5]\}\}$/.test(attrs.src || '') ? attrs.src : '',
        },
      }),
      input: (name, attrs) => ({
        tagName: name,
        attribs: {
          ...attrs,
          type: [
            'text',
            'search',
            'email',
            'number',
            'date',
            'checkbox',
            'radio',
            'range',
          ].includes(attrs.type)
            ? attrs.type
            : 'text',
        },
      }),
    },
    allowedSchemesByTag: { img: [] },
    allowProtocolRelative: false,
  }));
}
function artifact(a, expectedKind) {
  if (
    !a ||
    typeof a !== 'object' ||
    !KINDS.includes(a.kind) ||
    (expectedKind && a.kind !== expectedKind)
  )
    fail('Artifact kind must match the project.');
  const out = {
    kind: a.kind,
    title: str(a.title, 'Title', 140, true),
    summary: str(a.summary, 'Summary', 1200),
    theme: theme(a.theme),
  };
  if (a.kind === 'web') {
    if (a.screens != null) {
      out.screens = arr(a.screens, 'Screens', 12).map((s) => {
        if (!s || typeof s !== 'object' || !/^[a-zA-Z][\w-]{0,47}$/.test(s.id)) fail('Each screen needs an ID starting with a letter, up to 48 characters.');
        return { id: s.id, name: str(s.name, 'Screen name', 80, true), html: safeHTML(s.html) };
      });
      if (!out.screens.length || new Set(out.screens.map(s => s.id)).size !== out.screens.length) fail('Use 1–12 screens with unique IDs.');
      if (out.screens.some(s => s.html.length < 10)) fail('A screen is empty after sanitization.');
      if (out.screens.reduce((n,s) => n + s.html.length, 0) > 400000) fail('Combined screen HTML exceeds 400,000 characters.');
    }
    out.html = out.screens ? out.screens[0].html : safeHTML(a.html);
    out.css = safeCSS(a.css);
    if (a.designSystem) out.designSystem = designSystem(a.designSystem);
    if (a.tweaks != null) {
      const t = tweaks(a.tweaks);
      if (t.length) out.tweaks = t;
    }
    if (out.html.length < 10) fail('Web HTML is empty after sanitization.');
  } else if (a.kind === 'slides') {
    out.slides = arr(a.slides, 'Slides', 12).map((s, i) => {
      if (!['cover', 'bullets', 'two-column', 'table', 'image'].includes(s.layout))
        fail('Unknown slide layout.');
      const slide = {
        id: `slide-${i + 1}`,
        layout: s.layout,
        title: str(s.title, 'Slide title', 100, true),
        subtitle: str(s.subtitle, 'Subtitle', 200),
        body: str(s.body, 'Slide body', 650),
        bullets: strings(s.bullets, 'Bullets', 6, 180),
        notes: str(s.notes, 'Speaker notes', 3000),
        imageIndex: imageIndex(s.imageIndex),
        table: table(s.table),
        columns: arr(s.columns || [], 'Columns', 2).map((c) => ({
          heading: str(c.heading, 'Column heading', 80),
          body: str(c.body, 'Column body', 400),
          bullets: strings(c.bullets, 'Column bullets', 4, 150),
        })),
      };
      if (s.layout === 'table' && !slide.table) fail('Table slides require a table.');
      if (s.layout === 'two-column' && slide.columns.length !== 2)
        fail('Two-column slides require two columns.');
      if (s.layout === 'image' && slide.imageIndex == null)
        fail('Image slides require imageIndex.');
      return slide;
    });
    if (!out.slides.length) fail('At least one slide is required.');
  } else {
    out.subtitle = str(a.subtitle, 'Subtitle', 300);
    out.blocks = arr(a.blocks, 'Document blocks', 60).map((b, i) => {
      if (!['heading', 'paragraph', 'bullets', 'table', 'image'].includes(b.type))
        fail('Unknown document block.');
      const block = {
        id: `block-${i + 1}`,
        type: b.type,
        text: str(b.text, 'Block text', 5000),
        items: strings(b.items, 'List items', 12, 600),
        table: table(b.table),
        imageIndex: imageIndex(b.imageIndex),
      };
      if (['heading', 'paragraph'].includes(b.type) && !block.text)
        fail('Text blocks require text.');
      if (b.type === 'table' && !block.table) fail('Table blocks require a table.');
      if (b.type === 'image' && block.imageIndex == null) fail('Image blocks require imageIndex.');
      return block;
    });
    if (!out.blocks.length) fail('At least one document block is required.');
  }
  return out;
}
const TOKEN_COLORS = ['accent', 'accent2', 'background', 'surface', 'text', 'muted', 'border', 'success', 'warning', 'danger'];
// Strict at the boundary (user and model input), then normalized by the kit so
// 0.2 design systems and partial overrides gain every 0.3 token.
function designSystem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Design system must be an object.');
  const { FONTS } = require('./presets.cjs');
  const { normalizeTokens } = require('./kit.cjs');
  for (const k of ['font', 'headingFont', 'bodyFont', 'monoFont'])
    if (value[k] != null && !Object.hasOwn(FONTS, value[k])) fail('Choose a supported local font.');
  for (const k of TOKEN_COLORS) if (value[k] != null) color(value[k]);
  const radius = value.radius ?? 12, spacing = value.spacing ?? 8;
  if (!Number.isInteger(radius) || radius < 0 || radius > 40 || !Number.isInteger(spacing) || spacing < 4 || spacing > 24) fail('Radius must be 0–40 and spacing 4–24.');
  if (value.density != null && !['compact', 'comfortable', 'spacious'].includes(value.density)) fail('Density must be compact, comfortable or spacious.');
  if (value.shadow != null && !['none', 'soft', 'medium', 'crisp'].includes(value.shadow)) fail('Shadow must be none, soft, medium or crisp.');
  if (value.typeScale != null && !(typeof value.typeScale === 'number' && value.typeScale >= 1.1 && value.typeScale <= 1.5)) fail('Type scale must be between 1.1 and 1.5.');
  if (value.preset != null) str(value.preset, 'Preset', 40);
  const out = normalizeTokens({ ...value, name: str(value.name || 'Project style', 'Style name', 80, true), radius, spacing });
  // Keep the user's spelling of colours they supplied (normalization lowercases).
  for (const k of TOKEN_COLORS) if (value[k] != null) out[k] = value[k];
  return out;
}
const TWEAK_UNITS = ['px', 'rem', 'em', '%', 'vh', 'vw', ''];
function tweaks(list) {
  return arr(list, 'Tweaks', 8).map((t) => {
    if (!t || typeof t !== 'object' || typeof t.var !== 'string' || !/^--[a-z][a-z0-9-]{1,40}$/.test(t.var))
      fail('Each tweak needs a CSS custom property name such as --sidebar-width.');
    const min = Number(t.min), max = Number(t.max), step = Number(t.step ?? 1), value = Number(t.value ?? t.min);
    if (![min, max, step, value].every(Number.isFinite) || min >= max || step <= 0) fail('Tweak ranges need numeric min < max and a positive step.');
    if (!TWEAK_UNITS.includes(t.unit ?? 'px')) fail('Tweak units must be px, rem, em, %, vh, vw or empty.');
    return { var: t.var, label: str(t.label || t.var.slice(2), 'Tweak label', 40, true), min, max, step, unit: t.unit ?? 'px', value: Math.min(max, Math.max(min, value)) };
  }).filter((t, i, all) => all.findIndex((x) => x.var === t.var) === i);
}
function webScreens(a) { return a.screens || [{ id: 'home', name: 'Home', html: a.html }]; }
function references(refs = []) {
  return arr(refs, 'Reference images', MAX_REFERENCES).map((r) => {
    if (
      !r ||
      typeof r.data !== 'string' ||
      r.data.length > 4200000 ||
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(r.data)
    )
      fail('Reference images must be PNG, JPEG or WebP data URLs under 3 MB.');
    const b = Buffer.from(r.data.split(',')[1], 'base64');
    const kind = b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'png'
      : b[0] === 255 && b[1] === 216 && b[2] === 255
        ? 'jpeg'
        : b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'
          ? 'webp'
          : null;
    if (!kind || !r.data.startsWith(`data:image/${kind};`))
      fail('Image contents do not match the declared format.');
    return { name: str(r.name, 'Image name', 150, true), data: r.data };
  });
}
module.exports = { artifact, references, str, theme, KINDS, fail, safeHTML, safeCSS, designSystem, tweaks, webScreens, MAX_REFERENCES };
