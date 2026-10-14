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
function imageIndex(x) {
  if (x == null) return null;
  if (!Number.isInteger(x) || x < 0 || x > 1) fail('imageIndex must be 0 or 1.');
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
function safeHTML(html) {
  return sanitize(str(html, 'HTML', 160000, true), {
    // A model may return a full document despite the body-fragment instruction.
    // Drop metadata text with its container instead of leaking it into the page.
    nonTextTags: ['script', 'style', 'textarea', 'option', 'head', 'title'],
    allowedTags: [
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
    },
    allowedSchemes: [],
    allowedEmptyAttributes: ['hidden', 'data-row'],
    transformTags: {
      a: (name, attrs) => ({
        tagName: name,
        attribs: { ...attrs, href: /^#[a-zA-Z][\w-]*$/.test(attrs.href || '') ? attrs.href : '#' },
      }),
      img: (name, attrs) => ({
        tagName: name,
        attribs: {
          ...attrs,
          src: /^\{\{reference:[01]\}\}$/.test(attrs.src || '') ? attrs.src : '',
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
  });
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
function designSystem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Design system must be an object.');
  const fonts = ['Arial', 'Segoe UI', 'Georgia', 'Verdana', 'Trebuchet MS'];
  const font = value.font || 'Segoe UI';
  if (!fonts.includes(font)) fail('Choose a supported local font.');
  const radius = value.radius ?? 12, spacing = value.spacing ?? 8;
  if (!Number.isInteger(radius) || radius < 0 || radius > 40 || !Number.isInteger(spacing) || spacing < 4 || spacing > 24) fail('Radius must be 0–40 and spacing 4–24.');
  return { name: str(value.name || 'Project style', 'Style name', 80, true), ...theme(value), surface: color(value.surface, '#ffffff'), muted: color(value.muted, '#667085'), font, radius, spacing };
}
function webScreens(a) { return a.screens || [{ id: 'home', name: 'Home', html: a.html }]; }
function references(refs = []) {
  return arr(refs, 'Reference images', 2).map((r) => {
    if (
      !r ||
      typeof r.data !== 'string' ||
      r.data.length > 4200000 ||
      !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(r.data)
    )
      fail('Reference images must be PNG or JPEG data URLs under 3 MB.');
    const b = Buffer.from(r.data.split(',')[1], 'base64');
    const png = b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = b[0] === 255 && b[1] === 216 && b[2] === 255;
    if ((!png && !jpeg) || png !== r.data.startsWith('data:image/png'))
      fail('Image contents do not match the declared format.');
    return { name: str(r.name, 'Image name', 150, true), data: r.data };
  });
}
module.exports = { artifact, references, str, theme, KINDS, fail, safeHTML, safeCSS, designSystem, webScreens };
