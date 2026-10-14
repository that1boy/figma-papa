'use strict';
// Inline SVG policy for model-authored markup (used by schema.safeHTML) plus the
// small HTML helpers shared by the icon and chart expanders.
//
// htmlparser2 lowercases attribute names and, inside <svg>, re-cases the tag
// names it knows (lineargradient -> linearGradient). Browsers' HTML parsers
// re-case SVG attributes on the way in (viewbox -> viewBox), so lowercase output
// is correct. Every attribute value is validated; anything unrecognised is
// dropped. No href/xlink:href, style, event handler, <use>, <image>,
// <foreignObject>, animation or filter element is ever emitted.
const { Parser } = require('htmlparser2');

const escapeHTML = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const attrs = (o) =>
  Object.entries(o).filter(([, v]) => v != null && v !== false).map(([k, v]) => ` ${k}="${escapeHTML(v === true ? '' : v)}"`).join('');

const NUM = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{1,3})?$/;
const LEN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{1,3})?(?:px|%|em|rem|ex|ch|pt)?$/;
// Splitting first keeps every check linear (no nested quantifiers to backtrack).
const tokens = (v, max) => {
  const s = v.trim();
  if (!s || /^,|,$|,\s*,/.test(s)) return null;
  const t = s.replace(/,/g, ' ').split(/\s+/);
  return t.length && t.length <= max ? t : null;
};
const list = (re, max) => (v) => {
  if (v.length > max * 24) return null;
  const t = tokens(v, max);
  return t && t.every((x) => re.test(x)) ? v.trim() : null;
};
const number = (v) => (v.length <= 32 && NUM.test(v.trim()) ? v.trim() : null);
const length = (v) => (v.length <= 32 && LEN.test(v.trim()) ? v.trim() : null);
const lengths = list(LEN, 512);
const numbers = list(NUM, 5000);
const opacity = (v) => (v.length <= 16 && /^(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(v.trim()) ? v.trim() : null);
const oneOf = (...values) => (v) => (values.includes(v.trim()) ? v.trim() : null);
const NAMED = new Set(
  'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'.split(' '),
);
const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const VAR = /^var\(\s*--[A-Za-z0-9_-]{1,60}\s*(?:,\s*([#A-Za-z0-9]{1,24})\s*)?\)$/;
const LOCAL_URL = /^url\(#[A-Za-z][\w-]{0,63}\)$/;
// Colours: currentColor, transparent, #hex, CSS colour names, var(--token[, colour]).
function colour(v) {
  const s = v.trim();
  if (s.length > 100) return null;
  if (/^(?:currentcolor|transparent)$/i.test(s) || HEX.test(s) || NAMED.has(s.toLowerCase())) return s;
  const m = VAR.exec(s);
  return m && (!m[1] || (m[1] !== s && colour(m[1]))) ? s : null;
}
// Paint adds none and a same-document url(#id) reference (gradients, clip paths).
const paint = (v) => (/^\s*none\s*$/i.test(v) || LOCAL_URL.test(v.trim()) ? v.trim() : colour(v));
const localRef = (v) => (/^\s*none\s*$/i.test(v) || LOCAL_URL.test(v.trim()) ? v.trim() : null);
// Path data: commands and numbers only, starting with a moveto.
const pathData = (v) => (v.length <= 60000 && /^\s*[Mm][MmZzLlHhVvCcSsQqTtAa0-9eE.,+\-\s]*$/.test(v) ? v.trim() : null);
const TRANSFORM_ARGS = { translate: [1, 2], scale: [1, 2], rotate: [1, 3], matrix: [6] };
function transform(v) {
  if (v.length > 400) return null;
  const re = /\s*(translate|scale|rotate|matrix)\s*\(([^()]*)\)\s*,?/y;
  let at = 0, n = 0;
  while (at < v.length && v.slice(at).trim()) {
    re.lastIndex = at;
    const m = re.exec(v);
    if (!m || ++n > 12) return null;
    const args = tokens(m[2], 6);
    if (!args || !args.every((a) => NUM.test(a)) || !TRANSFORM_ARGS[m[1]].includes(args.length)) return null;
    at = re.lastIndex;
  }
  return n ? v.trim() : null;
}
const viewBox = (v) => {
  const t = tokens(v, 4);
  return t && t.length === 4 && t.every((x) => NUM.test(x)) ? v.trim() : null;
};
const dashes = (v) => (/^\s*none\s*$/.test(v) ? 'none' : lengths(v));
const fontFamily = (v) => (/^[A-Za-z0-9 ,'"-]{1,100}$/.test(v) ? v.trim() : null);
const fontWeight = (v) => (/^(?:normal|bold|bolder|lighter|[1-9]00)$/.test(v.trim()) ? v.trim() : null);
const aspect = (v) => (/^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max))(?:\s+(?:meet|slice))?$/.test(v.trim()) ? v.trim() : null);
const UNITS = oneOf('userSpaceOnUse', 'objectBoundingBox');

const PRESENTATION = {
  fill: paint,
  stroke: paint,
  color: colour,
  'stroke-width': length,
  'stroke-linecap': oneOf('butt', 'round', 'square'),
  'stroke-linejoin': oneOf('miter', 'round', 'bevel', 'miter-clip', 'arcs'),
  'stroke-dasharray': dashes,
  'stroke-dashoffset': length,
  'stroke-miterlimit': number,
  'stroke-opacity': opacity,
  'fill-opacity': opacity,
  'fill-rule': oneOf('nonzero', 'evenodd'),
  'clip-rule': oneOf('nonzero', 'evenodd'),
  'clip-path': localRef,
  opacity,
  transform,
  'vector-effect': oneOf('none', 'non-scaling-stroke'),
  'shape-rendering': oneOf('auto', 'optimizeSpeed', 'crispEdges', 'geometricPrecision'),
  'font-size': length,
  'font-weight': fontWeight,
  'font-family': fontFamily,
  'font-style': oneOf('normal', 'italic', 'oblique'),
  'letter-spacing': length,
  'text-anchor': oneOf('start', 'middle', 'end'),
  'dominant-baseline': oneOf('auto', 'middle', 'central', 'hanging', 'alphabetic', 'ideographic', 'mathematical', 'text-top', 'text-bottom', 'text-before-edge', 'text-after-edge'),
};
const textPos = { x: lengths, y: lengths, dx: lengths, dy: lengths };
// Tag names as htmlparser2 reports them inside <svg> (SVG casing applied).
const SVG_ATTRIBUTES = {
  svg: { viewbox: viewBox, width: length, height: length, x: length, y: length, preserveaspectratio: aspect, xmlns: oneOf('http://www.w3.org/2000/svg'), 'aria-hidden': oneOf('true', 'false') },
  g: {},
  path: { d: pathData, pathlength: number },
  circle: { cx: length, cy: length, r: length },
  ellipse: { cx: length, cy: length, rx: length, ry: length },
  rect: { x: length, y: length, width: length, height: length, rx: length, ry: length },
  line: { x1: length, y1: length, x2: length, y2: length },
  polyline: { points: numbers },
  polygon: { points: numbers },
  text: textPos,
  tspan: textPos,
  defs: {},
  title: {},
  desc: {},
  linearGradient: { x1: length, y1: length, x2: length, y2: length, gradientunits: UNITS, gradienttransform: transform, spreadmethod: oneOf('pad', 'reflect', 'repeat') },
  radialGradient: { cx: length, cy: length, r: length, fx: length, fy: length, fr: length, gradientunits: UNITS, gradienttransform: transform, spreadmethod: oneOf('pad', 'reflect', 'repeat') },
  stop: { offset: opacity, 'stop-color': colour, 'stop-opacity': opacity },
  clipPath: { clippathunits: UNITS },
};
const DRAWING = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'text', 'tspan', 'clipPath']);
const SVG_TAGS = Object.keys(SVG_ATTRIBUTES);
const SVG_ALLOWED_ATTRIBUTES = Object.fromEntries(
  SVG_TAGS.map((t) => [t, [...Object.keys(SVG_ATTRIBUTES[t]), ...(DRAWING.has(t) ? Object.keys(PRESENTATION) : [])]]),
);
// Names the sanitizer's global allowlist may still accept; everything else is dropped here.
const GLOBAL = /^(?:class|id|role|tabindex|title|hidden|aria-[a-z]+|data-(?!forma-)[a-z0-9-]+)$/;
function svgAttributes(tag, attribs) {
  const own = SVG_ATTRIBUTES[tag] || {}, out = {};
  for (const [k, v] of Object.entries(attribs)) {
    const check = own[k] || (DRAWING.has(tag) && PRESENTATION[k]);
    if (check) {
      const ok = typeof v === 'string' ? check(v) : null;
      if (ok != null) out[k] = ok;
    } else if (GLOBAL.test(k) && k !== 'aria-hidden') out[k] = v;
  }
  return out;
}
// Renamed tags: DROP keeps the text content, DROP_TEXT discards the whole subtree.
// Both must be *allowed* tags: sanitize-html never clears its rename record for a
// renamed tag it skips, and the stale name would later replace an unrelated
// closing tag (</forma-drop> instead of </svg>). finish() removes the markers;
// sanitized text and attributes cannot contain a literal "<", so only these
// generated tags match.
const DROP = 'forma-drop', DROP_TEXT = 'forma-drop-text';
function finish(html) {
  if (!html.includes('forma-drop')) return html;
  const re = /<(\/?)forma-drop(-text)?>/g;
  let out = '', depth = 0, at = 0, m;
  while ((m = re.exec(html))) {
    if (!depth) out += html.slice(at, m.index);
    if (m[2]) depth += m[1] ? -1 : 1;
    if (depth < 0) break;
    at = re.lastIndex;
  }
  // Balanced markers are the normal case; otherwise keep the text and drop only the markers.
  return depth === 0 ? out + html.slice(at) : html.replace(/<\/?forma-drop(?:-text)?>/g, '');
}
// One policy per sanitize call: it tracks the open-element stack through
// sanitize-html's onOpenTag/onCloseTag hooks so SVG elements are only kept
// inside <svg>, and <title>/<desc> keep only text.
function svgPolicy() {
  const stack = [];
  const context = () => {
    const up = stack.slice(0, -1); // onOpenTag runs before transforms, so the current tag is last
    return { inSvg: up.includes('svg'), parent: up[up.length - 1], svgText: up.length > 1 && ['title', 'desc'].includes(up[up.length - 1]) && up.includes('svg') };
  };
  const svgTag = (name, attribs) => {
    const c = context();
    if (name !== 'svg' && !c.inSvg) return { tagName: name === 'title' || name === 'desc' ? DROP_TEXT : DROP, attribs: {} };
    return { tagName: name, attribs: svgAttributes(name, attribs) };
  };
  return {
    DROP,
    DROP_TEXT,
    finish,
    onOpenTag: (name) => void stack.push(name),
    onCloseTag: (name) => {
      const i = stack.lastIndexOf(name);
      if (i >= 0) stack.length = i;
    },
    transformTags: Object.fromEntries(SVG_TAGS.map((t) => [t, svgTag])),
    // Runs after the per-tag transforms for every element.
    transformAll: (name, attribs) => (context().svgText ? { tagName: DROP, attribs: {} } : { tagName: name, attribs }),
  };
}
// data-chart survives sanitization only as a JSON object of bounded size.
function chartAttribute(v) {
  if (typeof v !== 'string' || !v.trim() || v.length > 6000) return null;
  try {
    const o = JSON.parse(v);
    return o && typeof o === 'object' && !Array.isArray(o) ? v : null;
  } catch {
    return null;
  }
}
const ICON_NAME = /^[a-z0-9-]{1,48}$/;
const iconAttribute = (v) => {
  const s = String(v ?? '').trim().replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[\s_]+/g, '-');
  return ICON_NAME.test(s) ? s : null;
};

// Locate elements in (sanitized) HTML with htmlparser2 so callers can splice
// replacements into the original string without re-serializing anything else.
// Returns [{ name, attribs (decoded), start, openEnd, end, textOnly, text }].
function findElements(html, test) {
  const found = [], open = [];
  const parser = new Parser(
    {
      onopentag(name, attribs) {
        for (const o of open) if (o) o.textOnly = false;
        const rec = test(name, attribs) ? { name, attribs, start: parser.startIndex, openEnd: parser.endIndex + 1, textOnly: true, text: '' } : null;
        open.push(rec);
      },
      ontext(t) {
        for (const o of open) if (o) o.text += t;
      },
      onclosetag(name, implied) {
        const rec = open.pop();
        if (!rec) return;
        rec.end = !implied ? parser.endIndex + 1 : Math.max(rec.openEnd, Math.min(parser.startIndex, html.length));
        found.push(rec);
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  return found.sort((a, b) => a.start - b.start);
}
// Apply non-overlapping [start, end) replacements; nested ones lose to their container.
function splice(html, edits) {
  let out = '', at = 0;
  for (const e of [...edits].sort((a, b) => a.start - b.start || b.end - a.end)) {
    if (e.start < at) continue;
    out += html.slice(at, e.start) + e.text;
    at = e.end;
  }
  return out + html.slice(at);
}

module.exports = {
  SVG_TAGS,
  SVG_ALLOWED_ATTRIBUTES,
  svgPolicy,
  svgAttributes,
  chartAttribute,
  iconAttribute,
  paint,
  colour,
  transform,
  pathData,
  viewBox,
  escapeHTML,
  attrs,
  findElements,
  splice,
};
