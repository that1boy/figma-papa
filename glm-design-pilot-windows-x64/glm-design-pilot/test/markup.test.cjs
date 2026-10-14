'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Parser } = require('htmlparser2');
const S = require('../lib/schema.cjs');
const svg = require('../lib/svg.cjs');
const icons = require('../lib/icons.cjs');
const charts = require('../lib/charts.cjs');
const markup = require('../lib/markup.cjs');

// Parse HTML into a flat list of elements the way a tolerant HTML tokenizer sees it.
function elements(html) {
  const out = [];
  const p = new Parser({ onopentag: (name, attribs) => out.push({ name, attribs }) }, { decodeEntities: true });
  p.write(html);
  p.end();
  return out;
}
const DANGEROUS_TAGS = /^(?:script|style|iframe|object|embed|foreignobject|use|image|animate|animatemotion|animatetransform|set|feimage|math|template|base|link|meta|xmp|noscript|forma-drop|forma-drop-text)$/i;
// Expanded output may carry generated inline styles: only constant tokens, never spec data.
const TRUSTED_STYLE = /^[a-z0-9:;,.()%#\s-]*$/i;
function assertInert(html, label = html, trustedStyle = false) {
  for (const el of elements(html)) {
    assert.doesNotMatch(el.name, DANGEROUS_TAGS, `${label}: <${el.name}> survived`);
    for (const [k, v] of Object.entries(el.attribs)) {
      if (trustedStyle && k === 'style') {
        assert.match(v, TRUSTED_STYLE, `${label}: style=${v}`);
        assert.doesNotMatch(v, /url\(|expression|@import|javascript/i, `${label}: style=${v}`);
        continue;
      }
      assert.doesNotMatch(k, /^on|^style$|^xlink:|^xmlns:|^src(?:doc|set)$|^formaction$|^action$/i, `${label}: ${k} survived on <${el.name}>`);
      if (k === 'href') assert.match(v, /^#/, `${label}: href=${v}`);
      if (k === 'src') assert.match(v, /^(?:\{\{reference:[0-5]\}\})?$/, `${label}: src=${v}`);
      assert.doesNotMatch(v, /javascript:|vbscript:|data:text|expression\(|url\((?!#)/i, `${label}: ${k}=${v}`);
    }
  }
}

// ---------------------------------------------------------------- svg.cjs
test('svg value validators accept drawing values and reject everything else', () => {
  for (const ok of ['none', 'currentColor', 'currentcolor', 'transparent', '#fff', '#ffff', '#a1b2c3', '#a1b2c3d4', 'rebeccapurple', 'Red', 'var(--accent)', 'var(--chart-2, #333)', 'var(--x,white)', 'url(#grad-1)', ' #000 '])
    assert.ok(svg.paint(ok) != null, ok);
  for (const bad of ['url(http://x/a.svg#g)', 'url(javascript:alert(1))', "url('#g')", 'url(#g) red', 'red;background:url(x)', 'expression(alert(1))', '#12', '#12345', 'notacolour', 'var(--a, url(x))', 'var(--a, var(--b))', 'var(--a);x:y', 'rgb(1,2,3)', 'red !important', ''])
    assert.equal(svg.paint(bad), null, bad);
  assert.equal(svg.colour('url(#g)'), null);
  for (const ok of ['translate(10 20)', 'translate(10,20) scale(2)', 'rotate(45 12 12)', 'matrix(1 0 0 1 5 5)', 'scale(-1, 1)', 'rotate(-90)'])
    assert.equal(svg.transform(ok), ok);
  for (const bad of ['skewX(10)', 'translate(1 2 3)', 'rotate(1 2)', 'matrix(1 2 3)', 'translate(a)', 'translate(1) url(#x)', 'translate(1);fill:red', 'TRANSLATE(1)', 'translate(1', ''])
    assert.equal(svg.transform(bad), null, bad);
  assert.equal(svg.pathData('M0 0L10 10Z'), 'M0 0L10 10Z');
  assert.equal(svg.pathData('m4.5-3a2 2 0 0 1 1e-3 2z'), 'm4.5-3a2 2 0 0 1 1e-3 2z');
  for (const bad of ['L0 0', 'M0 0 url(#x)', 'M0 0<script>', 'M0 0;', 'javascript:M0']) assert.equal(svg.pathData(bad), null, bad);
  assert.equal(svg.viewBox('0 0 24 24'), '0 0 24 24');
  assert.equal(svg.viewBox('0,0,24,24'), '0,0,24,24');
  for (const bad of ['0 0 24', '0 0 24 24 1', '0 0 a 24']) assert.equal(svg.viewBox(bad), null, bad);
});

test('svg validators stay linear on adversarial input', () => {
  const started = Date.now();
  const long = '1'.repeat(50000);
  assert.equal(svg.transform(`translate(${long}x)`), null);
  assert.equal(svg.transform('translate(1 '.repeat(5000)), null);
  assert.equal(svg.paint(`var(--${'a'.repeat(50000)})`), null);
  assert.equal(svg.viewBox(`${long} ${long} ${long} ${long}x`), null);
  svg.pathData(`M${'0 '.repeat(29999)}!`);
  const html = S.safeHTML(`<svg><path d="M${'1,'.repeat(20000)}x"/><polygon points="${'1 '.repeat(30000)}a"/></svg>`);
  assert.doesNotMatch(html, /\sd=|points=/);
  assert.ok(Date.now() - started < 2000, 'validators took too long');
});

test('sanitizing and expanding stay linear on whitespace-heavy input', () => {
  const started = Date.now();
  const spaces = ' '.repeat(70000);
  S.safeHTML(`<i${spaces}x`);
  S.safeHTML(`<figure${spaces}class="a"${spaces}x></figure>`);
  for (const el of [`<polygon points="1${spaces}x"/>`, `<path d="M0 0${spaces}x"/>`, `<rect width="1${spaces}"/>`, `<text x="1${' ,'.repeat(5000)}">t</text>`, `<g transform="${spaces}x"/>`])
    assert.doesNotMatch(S.safeHTML(`<svg>${el}</svg>`), /points=|d=|width=|x=|transform=/);
  const host = S.safeHTML(`<figure class="a${' '.repeat(50000)}b" data-chart='{"type":"bar","values":[1]}'></figure>`);
  assert.match(charts.expandCharts(host), /data-forma-expanded="chart"/);
  icons.resolveIcon(`a${' '.repeat(100000)}b`);
  assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
});

test('drop markers are removed linearly, with their subtree when required', () => {
  const p = svg.svgPolicy();
  assert.equal(p.finish('a<forma-drop>b</forma-drop>c'), 'abc');
  assert.equal(p.finish('a<forma-drop-text>b<forma-drop-text>c</forma-drop-text>d</forma-drop-text>e'), 'ae');
  assert.equal(p.finish('a<forma-drop-text>b'), 'ab', 'unbalanced markers keep the text');
  assert.equal(p.finish('a</forma-drop-text>b'), 'ab');
  assert.equal(p.finish('plain'), 'plain');
});

test('findElements reports exact source ranges and splice keeps other bytes', () => {
  const html = '<p class="a">x <i data-icon="search"></i> y <i data-icon="x">text</i><i data-icon="z"><b>no</b></i></p>';
  const found = svg.findElements(html, (n, a) => n === 'i' && 'data-icon' in a);
  assert.equal(found.length, 3);
  assert.equal(html.slice(found[0].start, found[0].end), '<i data-icon="search"></i>');
  assert.equal(html.slice(found[1].start, found[1].end), '<i data-icon="x">text</i>');
  assert.equal(found[1].text, 'text');
  assert.equal(found[2].textOnly, false);
  assert.equal(svg.splice(html, [{ start: found[0].start, end: found[0].end, text: '[I]' }]), '<p class="a">x [I] y <i data-icon="x">text</i><i data-icon="z"><b>no</b></i></p>');
  assert.equal(svg.splice('abcdef', [{ start: 1, end: 5, text: 'X' }, { start: 2, end: 3, text: 'Y' }]), 'aXf');
});

// ---------------------------------------------------------------- safeHTML
test('safeHTML keeps inline SVG drawings with validated attributes', () => {
  const html = S.safeHTML(
    '<svg viewBox="0 0 24 24" width="48" height="48" class="logo" role="img" aria-label="Logo" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox"><stop offset="0%" stop-color="var(--accent)"/><stop offset="100%" stop-color="#fff" stop-opacity=".4"/></linearGradient>' +
      '<radialGradient id="r" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="gold"/></radialGradient><clipPath id="c" clipPathUnits="userSpaceOnUse"><circle cx="12" cy="12" r="10"/></clipPath></defs>' +
      '<title>Company logo</title><desc>A rounded square</desc>' +
      '<g transform="translate(1 1)" opacity="0.9" clip-path="url(#c)"><rect x="0" y="0" width="22" height="22" rx="5" fill="url(#g)" stroke="currentColor" stroke-width="1.5"/>' +
      '<path d="M4 12h16" stroke="var(--on-accent)" stroke-linecap="round" stroke-dasharray="2 2" fill="none" vector-effect="non-scaling-stroke"/>' +
      '<ellipse cx="12" cy="6" rx="3" ry="2" fill-opacity="50%"/><line x1="0" y1="0" x2="24" y2="24"/><polyline points="1,2 3,4"/><polygon points="0 0 5 5 0 5" fill-rule="evenodd"/>' +
      '<text x="12" y="20" text-anchor="middle" font-size="4" font-weight="600" font-family="Inter, sans-serif" dominant-baseline="middle">Hi <tspan dx="1">there</tspan></text></g></svg>',
  );
  for (const want of [
    '<svg viewbox="0 0 24 24" width="48" height="48" class="logo" role="img" aria-label="Logo" xmlns="http://www.w3.org/2000/svg" preserveaspectratio="xMidYMid meet">',
    '<linearGradient id="g" x1="0" y1="0" x2="1" y2="1" gradientunits="objectBoundingBox">',
    '<stop offset="0%" stop-color="var(--accent)"></stop>',
    '<radialGradient id="r" cx="50%" cy="50%" r="50%">',
    '<clipPath id="c" clippathunits="userSpaceOnUse">',
    '<title>Company logo</title><desc>A rounded square</desc>',
    '<g transform="translate(1 1)" opacity="0.9" clip-path="url(#c)">',
    '<rect x="0" y="0" width="22" height="22" rx="5" fill="url(#g)" stroke="currentColor" stroke-width="1.5"></rect>',
    'vector-effect="non-scaling-stroke"',
    '<polygon points="0 0 5 5 0 5" fill-rule="evenodd"></polygon>',
    '<text x="12" y="20" text-anchor="middle" font-size="4" font-weight="600" font-family="Inter, sans-serif" dominant-baseline="middle">Hi <tspan dx="1">there</tspan></text>',
  ])
    assert.ok(html.includes(want), `missing ${want}\n${html}`);
  assertInert(html);
});

test('safeHTML drops invalid SVG values instead of passing them through', () => {
  const html = S.safeHTML(
    '<svg viewBox="0 0 24 javascript:1" width="100%;x" xmlns="http://evil"><rect fill="url(http://x/#a)" stroke="red;background:url(x)" width="expression(alert(1))" transform="skewX(9)" rx="4" opacity="2;x"/><path d="M0 0 url(x)" fill="#abc"/><circle r="5" cx="1em" fill="RED"/></svg>',
  );
  assert.equal(html, '<svg><rect rx="4"></rect><path fill="#abc"></path><circle r="5" cx="1em" fill="RED"></circle></svg>');
});

const XSS = {
  'svg onload': '<svg onload="window.__xss=1"><rect width="1" height="1"/></svg>',
  'svg script': '<svg><script>window.__xss=1</script><script href="data:,window.__xss=1"></script></svg>',
  'animate href': '<svg><a><animate attributeName="href" values="javascript:window.__xss=1"/><text y="10">x</text></a></svg>',
  'set onclick': '<svg><set attributeName="onmouseover" to="window.__xss=1"/><animateTransform attributeName="transform"/><animateMotion/></svg>',
  'use href': '<svg><use href="data:image/svg+xml,<svg id=x><script>window.__xss=1</script></svg>#x"/><use xlink:href="#a"/></svg>',
  'image href': '<svg><image href="x" onerror="window.__xss=1"/><feImage href="x"/></svg>',
  foreignObject: '<svg><foreignObject><div><img src=x onerror="window.__xss=1"></div><iframe srcdoc="<script>parent.__xss=1</script>"></iframe></foreignObject></svg>',
  'javascript in paint url': '<svg><rect fill="url(javascript:window.__xss=1)" stroke="url(&quot;javascript:x&quot;)" width="5" height="5"/></svg>',
  'css in attributes': '<svg style="background:url(javascript:x)"><rect fill="red;behavior:url(x.htc)" style="fill:url(x)" font-family="a;}*{background:url(x)}" width="5"/></svg>',
  'entity encoded paint': '<svg><rect fill="&#117;&#114;&#108;(&#106;avascript:window.__xss=1)" stroke="u&#x72;l(https://x)" width="5"/></svg>',
  'entity encoded href': '<svg><a href="&#106;avascript:window.__xss=1" xlink:href="&#x6A;avascript:1"><text>x</text></a></svg><a href="jav&#x09;ascript:window.__xss=1">x</a>',
  math: '<math><mtext><table><mglyph><style><img src=x onerror="window.__xss=1"></style></mglyph></table></mtext></math>',
  'math href': '<math href="javascript:window.__xss=1"><mi xlink:href="javascript:x">x</mi></math>',
  'mxss svg style': '<svg></p><style><a id="</style><img src=1 onerror=window.__xss=1>">',
  'mxss noscript': '<noscript><p title="</noscript><img src=x onerror=window.__xss=1>"></noscript>',
  'mxss title': '<svg><title><img src=x onerror="window.__xss=1"></title></svg><title><img src=x onerror="window.__xss=1"></title>',
  'mxss desc breakout': '<svg><desc><svg><style><img src=x onerror="window.__xss=1"></style></svg></desc></svg>',
  'mxss textarea': '<svg><textarea></textarea><img src=x onerror="window.__xss=1"></svg>',
  'svg in svg handlers': '<svg><svg onload="window.__xss=1"><g onclick="window.__xss=1"><circle onmouseover="window.__xss=1" r="4"/></g></svg></svg>',
  'xmp raw text': '<xmp><img src=x onerror="window.__xss=1"></xmp>',
  'self closing icon': '<i data-icon="x" onclick="window.__xss=1"/><i data-icon="javascript:alert(1)"></i>',
  'data-chart script': '<figure data-chart=\'{"type":"bar","title":"</script><script>window.__xss=1</script>","labels":["<img src=x onerror=window.__xss=1>"],"series":[{"values":[1]}]}\'></figure>',
  'data-forma spoofing': '<div data-forma-expanded="chart" data-forma-source="<img src=x onerror=window.__xss=1>"><i data-icon="x" data-forma-expanded="icon"></i></div>',
};

test('safeHTML neutralises SVG, MathML and mutation XSS vectors', () => {
  for (const [name, payload] of Object.entries(XSS)) {
    const html = S.safeHTML(payload);
    assertInert(html, name);
    assert.doesNotMatch(html, /<forma-drop|<\/forma-drop/, name);
    // Expanded output of hostile stored markup is still inert.
    assertInert(markup.expandMarkup(html), `${name} expanded`, true);
  }
  assert.doesNotMatch(S.safeHTML(XSS['data-forma spoofing']), /data-forma/);
  assert.match(S.safeHTML(XSS['data-chart script']), /data-chart="\{&quot;type&quot;:&quot;bar&quot;,&quot;title&quot;:&quot;&lt;\/script&gt;/);
  assert.equal(S.safeHTML(XSS.math), '');
  assert.equal(S.safeHTML(XSS.foreignObject), '<svg></svg>');
});

test('safeHTML keeps SVG elements only inside <svg> and closes them correctly', () => {
  assert.equal(S.safeHTML('<title>Doc title</title><p>Body</p>'), '<p>Body</p>');
  assert.equal(S.safeHTML('<path d="M0 0">loose</path><text>t</text><p>x</p>'), 'looset<p>x</p>');
  // sanitize-html keeps a stale rename for skipped renamed tags; the policy must not leak it.
  const html = S.safeHTML('<title>T</title><path d="M0 0">a</path><svg><circle r="1"/></svg><main><button type="button">ok</button></main>');
  assert.equal(html, 'a<svg><circle r="1"></circle></svg><main><button type="button">ok</button></main>');
  assert.equal(S.safeHTML('<svg><title>Chart <b>bold</b> <img src="x"></title><desc>d<desc>e</desc></desc></svg>'), '<svg><title>Chart bold </title><desc>de</desc></svg>');
  assert.equal(S.safeHTML('<desc>a<desc>b</desc>c</desc><p>ok</p>'), '<p>ok</p>');
});

test('safeHTML allows the extra semantic tags, icons and chart hosts', () => {
  const html = S.safeHTML(
    '<figure class="chart" data-chart=\'{"type":"bar","labels":["a"],"series":[{"values":[1]}]}\'><figcaption>Cap</figcaption></figure>' +
      '<h5>h5</h5><h6>h6</h6><blockquote>q</blockquote><pre><code>c</code></pre><kbd>K</kbd><mark>m</mark><time datetime="2026-10-14">today</time>' +
      '<progress value="3" max="10">30%</progress><meter value="0.6" min="0" max="1" low="0.2" high="0.8" optimum="0.5">60%</meter>' +
      '<form><fieldset disabled name="f"><legend>Legend</legend><output for="a" name="o">5</output></fieldset></form>' +
      '<i data-icon="search" class="size-4" aria-hidden="true"></i><i data-icon=" Arrow_Right "></i><i data-icon="HomeIcon"></i><i data-icon="bad name!"></i><i class="italic">it</i>',
  );
  for (const want of [
    '<figure class="chart" data-chart="{&quot;type&quot;:&quot;bar&quot;,&quot;labels&quot;:[&quot;a&quot;],&quot;series&quot;:[{&quot;values&quot;:[1]}]}"><figcaption>Cap</figcaption></figure>',
    '<h5>h5</h5><h6>h6</h6><blockquote>q</blockquote><pre><code>c</code></pre><kbd>K</kbd><mark>m</mark><time datetime="2026-10-14">today</time>',
    '<progress value="3" max="10">30%</progress>',
    '<meter value="0.6" min="0" max="1" low="0.2" high="0.8" optimum="0.5">60%</meter>',
    '<fieldset disabled name="f"><legend>Legend</legend><output for="a" name="o">5</output></fieldset>',
    '<i data-icon="search" class="size-4" aria-hidden="true"></i>',
    '<i data-icon="arrow-right"></i>',
    '<i data-icon="home-icon"></i>',
    '<i></i><i class="italic">it</i>',
  ])
    assert.ok(html.includes(want), `missing ${want}\n${html}`);
});

test('safeHTML closes self-closing icon and chart hosts instead of swallowing siblings', () => {
  assert.equal(S.safeHTML('<p><i data-icon="search" class="size-4"/> Search</p>'), '<p><i data-icon="search" class="size-4"></i> Search</p>');
  assert.equal(S.safeHTML('<div><figure data-chart=\'{"type":"bar","values":[1]}\' /><p>after</p></div>'), '<div><figure data-chart="{&quot;type&quot;:&quot;bar&quot;,&quot;values&quot;:[1]}"></figure><p>after</p></div>');
});

test('data-chart survives only as a bounded JSON object on figure or div', () => {
  const ok = '{"type":"line","values":[1,2]}';
  assert.match(S.safeHTML(`<div data-chart='${ok}'>x</div>`), /^<div data-chart=/);
  for (const bad of ['[1,2]', 'null', '"text"', '{bad json', '', `{"a":"${'x'.repeat(6000)}"}`])
    assert.equal(S.safeHTML(`<figure data-chart='${bad}'>x</figure>`), '<figure>x</figure>', bad.slice(0, 20));
  assert.equal(S.safeHTML(`<span data-chart='${ok}'>x</span>`), '<span>x</span>');
  assert.equal(svg.chartAttribute(ok), ok);
  assert.equal(svg.chartAttribute(`{"a":"${'x'.repeat(5992)}"}`).length, 6000);
  assert.equal(svg.chartAttribute(`{"a":"${'x'.repeat(5993)}"}`), null);
});

test('safeHTML is idempotent on rich markup and keeps the legacy restrictions', () => {
  const rich = S.safeHTML(
    '<main><svg viewBox="0 0 10 10"><defs><linearGradient id="a"><stop offset="0" stop-color="#000"/></linearGradient></defs><rect width="10" height="10" fill="url(#a)"/><title>t &amp; u</title></svg>' +
      '<i data-icon="bell"></i><figure data-chart=\'{"type":"pie","labels":["a","b"],"series":[{"values":[1,2]}],"title":"A & B <c>"}\'></figure><a href="https://x">x</a><img src="{{reference:5}}" alt="r"><img src="{{reference:6}}"></main>',
  );
  assert.equal(S.safeHTML(rich), rich);
  assert.match(rich, /<img src="\{\{reference:5\}\}" alt="r" \/><img \/>/);
  assert.match(rich, /<a href="#">x<\/a>/);
});

// ---------------------------------------------------------------- icons
test('icon set loads all Lucide icons and the prompt list only names real icons', () => {
  const names = icons.iconNames();
  assert.equal(names.length, 1890);
  assert.ok(names.every((n) => /^[a-z0-9-]{1,48}$/.test(n)));
  const set = new Set(names);
  assert.ok(icons.ICON_PROMPT_NAMES.length >= 120 && icons.ICON_PROMPT_NAMES.length <= 170);
  assert.equal(new Set(icons.ICON_PROMPT_NAMES).size, icons.ICON_PROMPT_NAMES.length);
  for (const n of icons.ICON_PROMPT_NAMES) assert.ok(set.has(n), `prompt icon ${n}`);
  for (const [alias, target] of Object.entries(icons.ICON_ALIASES)) {
    assert.ok(set.has(target), `alias ${alias} -> ${target}`);
    assert.ok(!set.has(alias), `alias ${alias} shadows a real icon`);
    assert.match(alias, /^[a-z0-9-]+$/);
  }
  assert.ok(set.has(icons.FALLBACK_ICON));
});

test('resolveIcon maps common non-Lucide names', () => {
  const expected = {
    close: 'x', delete: 'trash', 'trash-2': 'trash', home: 'house', settings: 'settings', user: 'user', edit: 'pencil', warning: 'triangle-alert',
    info: 'info', success: 'circle-check', 'check-circle': 'circle-check', error: 'circle-x', cart: 'shopping-cart', dashboard: 'layout-dashboard',
    logout: 'log-out', notification: 'bell', menu: 'menu', hamburger: 'menu', more: 'ellipsis', calendar: 'calendar', chart: 'chart-column', filter: 'funnel',
    'alert-circle': 'circle-alert', 'help-circle': 'circle-question-mark', 'x-circle': 'circle-x', 'bar-chart-2': 'chart-column', 'more-vertical': 'ellipsis-vertical',
    'external-link': 'external-link', HomeIcon: 'house', ChevronDown: 'chevron-down', 'fa-home': 'house', 'lucide-user': 'user', 'bell-outline': 'bell',
    'star-filled': 'star', arrow_forward: 'arrow-right', Settings2: 'settings-2', 'users-2': 'users', 'building-2': 'building', history: 'rotate-ccw-clock',
  };
  for (const [name, want] of Object.entries(expected)) assert.equal(icons.resolveIcon(name), want, name);
  for (const none of ['zzz-not-an-icon', '', '   ', 'x'.repeat(80), null, 42, '<script>']) assert.equal(icons.resolveIcon(none), null, String(none));
  assert.equal(icons.resolveIcon('__proto__'), null);
  assert.equal(icons.resolveIcon('constructor'), null);
});

test('expandIcons inlines Lucide SVG and keeps the stored form recoverable', () => {
  const stored = S.safeHTML('<p>Find <i data-icon="search" class="size-4 text-muted" id="s" data-design-id="d1"></i> it</p>');
  const out = icons.expandIcons(stored);
  assert.equal(
    out,
    '<p>Find <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-icon="search" class="size-4 text-muted" id="s" data-design-id="d1" aria-hidden="true" data-forma-expanded="icon" data-forma-source="&lt;i data-icon=&quot;search&quot; class=&quot;size-4 text-muted&quot; id=&quot;s&quot; data-design-id=&quot;d1&quot;&gt;&lt;/i&gt;" focusable="false"><path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/></svg> it</p>',
  );
  const host = elements(out).find((e) => e.name === 'svg');
  assert.equal(host.attribs['data-forma-source'], '<i data-icon="search" class="size-4 text-muted" id="s" data-design-id="d1"></i>');
  assert.equal(icons.expandIcons(out), out, 'idempotent');
});

test('expandIcons labels, titles, falls back and leaves other markup alone', () => {
  const stored = S.safeHTML(
    '<button type="button" aria-label="Close dialog"><i data-icon="close"></i></button><i data-icon="bell" aria-label="Alerts &amp; news"></i><i data-icon="info" title="More &quot;info&quot;"></i><i data-icon="mystery-icon"></i><i data-icon="x">x</i><i data-icon="menu"><span>no</span></i><p>plain &amp; text</p>',
  );
  const out = icons.expandIcons(stored);
  const svgs = elements(out).filter((e) => e.name === 'svg');
  assert.equal(svgs.length, 5);
  assert.equal(svgs[0].attribs['aria-hidden'], 'true');
  assert.equal(svgs[1].attribs.role, 'img');
  assert.equal(svgs[1].attribs['aria-label'], 'Alerts & news');
  assert.equal(svgs[1].attribs['aria-hidden'], undefined);
  assert.equal(svgs[2].attribs.role, 'img');
  assert.match(out, /<title>More &quot;info&quot;<\/title>/);
  assert.equal(svgs[3].attribs['data-forma-fallback'], 'true');
  assert.equal(svgs[3].attribs['data-icon'], 'mystery-icon');
  assert.ok(out.includes('<i data-icon="menu"><span>no</span></i><p>plain &amp; text</p>'), 'non-text icon and the rest untouched');
  assert.equal(icons.expandIcons('<p>no icons</p>'), '<p>no icons</p>');
  assert.equal(icons.expandIcons(''), '');
  assert.equal(icons.expandIcons(null), '');
  assertInert(out);
});

test('iconSVG renders standalone icons for application code', () => {
  assert.match(icons.iconSVG('home'), /^<svg [^>]*aria-hidden="true"[^>]*>.*<\/svg>$/);
  assert.match(icons.iconSVG('nope', { label: 'A "b"', className: 'x' }), /class="x" role="img" aria-label="A &quot;b&quot;"/);
});

// ---------------------------------------------------------------- charts
test('niceTicks produces round, covering axes', () => {
  const cases = [
    [0, 105, 5, false, [0, 25, 50, 75, 100, 125]],
    [0, 100, 5, false, [0, 20, 40, 60, 80, 100]],
    [0, 9, 5, true, [0, 2, 4, 6, 8, 10]],
    [0, 1234, 5, false, [0, 250, 500, 750, 1000, 1250]],
    [0, 12, 5, true, [0, 5, 10, 15]],
    [0, 0.9, 5, false, [0, 0.2, 0.4, 0.6, 0.8, 1]],
    [-20, 55, 5, true, [-20, 0, 20, 40, 60]],
    [99.1, 99.95, 5, false, [99, 99.2, 99.4, 99.6, 99.8, 100]],
    [0, 0, 5, true, [0, 1]],
    [5, 5, 5, true, [0, 1, 2, 3, 4, 5]],
    [-3, -3, 4, true, [-3, -2, -1, 0]],
  ];
  for (const [lo, hi, count, int, want] of cases) assert.deepEqual(charts.niceTicks(lo, hi, count, int).ticks, want, `${lo}..${hi}`);
  const s = charts.niceTicks(0, 1.7e9, 5);
  assert.equal(s.min, 0);
  assert.ok(s.max >= 1.7e9 && s.ticks.length <= 8);
});

test('number formatting is compact, unit-aware and deterministic', () => {
  const { compact, tickLabel, unitize } = charts;
  assert.deepEqual([0, 7, 45.25, 950, 1284, 12900, 999999, 1500000, 2.5e9, 3e12, -15300].map(compact), ['0', '7', '45.3', '950', '1,284', '12.9k', '1M', '1.5M', '2.5B', '3T', '−15.3k']);
  assert.deepEqual([0, 250, 500, 1000, 1250, -1750].map((t) => tickLabel(t, 250)), ['0', '250', '500', '1k', '1.25k', '\u22121.75k']);
  assert.deepEqual([0, 5e5, 1e6, 1.5e6].map((t) => tickLabel(t, 5e5)), ['0', '500', '1M', '1.5M'].map((x, i) => (i === 1 ? '500k' : x)));
  assert.equal(tickLabel(1025, 25), '1,025');
  assert.equal(tickLabel(0.25, 0.25), '0.25');
  assert.equal(unitize('12.9k', '$'), '$12.9k');
  assert.equal(unitize('−5', '€'), '−€5');
  assert.equal(unitize('45', '%'), '45%');
  assert.equal(unitize('12', 'ms'), '12 ms');
  assert.equal(unitize('21', '°C'), '21°C');
});

test('validateChart normalises specs and explains what is wrong', () => {
  const c = charts.validateChart('{"type":"bar","title":"T","labels":["a",2],"series":[{"name":"S","values":[1,"2.5"]}],"unit":"%"}');
  assert.deepEqual(c, { type: 'bar', title: 'T', caption: '', unit: '%', labels: ['a', '2'], series: [{ name: 'S', values: [1, 2.5] }] });
  assert.deepEqual(charts.validateChart({ type: 'sparkline', values: [1, 2, 3] }).labels, ['1', '2', '3']);
  assert.equal(charts.validateChart({ values: [1] }).type, 'bar');
  const errors = [
    ['{bad', /not valid JSON/],
    ['x'.repeat(6001), /exceeds 6,000/],
    [[], /must be a JSON object/],
    [null, /must be a JSON object/],
    [{ type: 'radar', values: [1] }, /Unknown chart type "radar". Use one of: bar, hbar, stacked-bar, line, area, donut, pie, sparkline/],
    [{ type: 'bar', labels: ['a'] }, /series must be an array of 1–6/],
    [{ type: 'bar', labels: ['a'], series: Array(7).fill({ values: [1] }) }, /1–6 series/],
    [{ type: 'bar', labels: ['a'], series: [{ name: 'Rev', values: [Infinity] }] }, /Series "Rev" value 1 is not a finite number/],
    [{ type: 'bar', labels: ['a'], series: [{ values: [null] }] }, /value 1 is not a finite number/],
    [{ type: 'bar', labels: ['a'], series: [{ values: [1e16] }] }, /outside ±1e15/],
    [{ type: 'bar', labels: ['a', 'b'], series: [{ name: 'Rev', values: [1] }] }, /Series "Rev" has 1 values but there are 2 labels/],
    [{ type: 'bar', labels: Array(25).fill('a'), series: [{ values: Array(25).fill(1) }] }, /labels must be an array of 1–24/],
    [{ type: 'bar', labels: [{}], series: [{ values: [1] }] }, /Label 1 must be text/],
    [{ type: 'bar', title: 'x'.repeat(161), values: [1] }, /Chart title must be text of at most 160/],
    [{ type: 'bar', unit: 'dollars and cents', values: [1] }, /Chart unit/],
    [{ type: 'pie', labels: ['a', 'b'], series: [{ values: [1, 2] }, { values: [1, 2] }] }, /exactly one series/],
    [{ type: 'donut', labels: ['a', 'b'], series: [{ values: [0, 0] }] }, /add up to more than zero/],
    [{ type: 'pie', labels: ['a', 'b'], series: [{ values: [-1, 2] }] }, /zero or positive/],
    [{ type: 'pie', values: Array(13).fill(1) }, /at most 12 slices/],
    [{ type: 'stacked-bar', labels: ['a'], series: [{ values: [-1] }] }, /Stacked bar values must be zero or positive/],
    [{ type: 'sparkline', values: [1] }, /at least 2 values/],
    [{ type: 'line', values: [1] }, /need at least 2 labels/],
    [{ type: 'bar', series: [{ values: 'abc' }] }, /Series 1 must be an object with a "values" array/],
  ];
  for (const [spec, re] of errors) {
    assert.throws(() => charts.validateChart(spec), (e) => e.code === 'chart' && re.test(e.message), String(re));
  }
});

const SPECS = {
  bar: { type: 'bar', title: 'Tickets', labels: ['Ops', 'IT', 'HR'], series: [{ name: 'Closed', values: [12, 7, -3] }] },
  grouped: { type: 'bar', title: 'Revenue', labels: ['Q1', 'Q2'], series: [{ name: '2025', values: [1.2e6, 1.4e6] }, { name: '2026', values: [1.3e6, 1.9e6] }], unit: '$' },
  hbar: { type: 'hbar', title: 'Top', labels: ['Password resets', 'VPN'], series: [{ name: 'n', values: [412, 190] }] },
  hbar2: { type: 'hbar', labels: ['a', 'b'], series: [{ name: 'x', values: [1, -2] }, { name: 'y', values: [3, 4] }] },
  stacked: { type: 'stacked-bar', labels: ['Jan', 'Feb'], series: [{ name: 'A', values: [4, 0] }, { name: 'B', values: [2, 3] }] },
  line: { type: 'line', title: 'Uptime', labels: ['a', 'b', 'c', 'd'], series: [{ name: 'Up', values: [99.1, 99.5, 99.3, 99.9] }], unit: '%' },
  area: { type: 'area', labels: Array.from({ length: 20 }, (_, i) => `D${i}`), series: [{ name: 'W', values: Array.from({ length: 20 }, (_, i) => i * i) }, { name: 'M', values: Array.from({ length: 20 }, (_, i) => 50 + i) }] },
  donut: { type: 'donut', title: 'Spend', labels: ['Cloud', 'Other'], series: [{ values: [42000, 0] }], unit: '$' },
  pie: { type: 'pie', labels: ['Win', 'Mac', 'Linux'], series: [{ values: [62, 30, 8] }], unit: '%' },
  sparkline: { type: 'sparkline', title: 'Trend', values: [3, 5, 4, 6, 8] },
  flat: { type: 'sparkline', values: [2, 2, 2] },
};

test('chartSVG renders every type as accessible, deterministic SVG', () => {
  for (const [name, spec] of Object.entries(SPECS)) {
    const out = charts.chartSVG(spec);
    assert.match(out, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 [\d.]+ [\d.]+"(?: preserveAspectRatio="none")? role="img"/, name);
    assert.match(out, /<title>[^<]+<\/title><desc>[^<]+<\/desc>/, name);
    assert.doesNotMatch(out, /NaN|Infinity|undefined|\[object/, name);
    assert.equal(charts.chartSVG(spec), out, `${name} deterministic`);
    assertInert(out, name, true);
  }
  const bar = charts.chartSVG(SPECS.bar);
  assert.match(bar, /fill:var\(--chart-1,#2a78d6\)/);
  assert.match(bar, /<title>Ops: 12<\/title>/);
  assert.match(bar, /A4 4 0 0 1/, 'rounded data end');
  assert.match(bar, /fill:var\(--muted,#667085\)/);
  assert.doesNotMatch(bar, /--chart-2/, 'single series uses one colour');
  const grouped = charts.chartSVG(SPECS.grouped);
  assert.match(grouped, /--chart-2/);
  assert.match(grouped, />2025<\/text>/, 'legend for several series');
  assert.match(grouped, />\$2M</, 'unit prefix on ticks');
  assert.match(grouped, /<title>Q2 · 2026: \$1,900,000<\/title>/);
  assert.doesNotMatch(charts.chartSVG(SPECS.grouped, { legend: false }), />2025<\/text>/);
  assert.match(charts.chartSVG(SPECS.donut), />\$42k<\/text><text[^>]*>Total</);
  assert.match(charts.chartSVG(SPECS.line), />99\.9%</, 'end value label');
  assert.match(charts.chartSVG(SPECS.sparkline), /preserveAspectRatio="none"/);
  assert.match(charts.chartSVG(SPECS.bar, { variant: 'sm' }), /viewBox="0 0 360 236"/);
  assert.match(charts.chartSVG(SPECS.bar, { width: 1000, height: 400 }), /viewBox="0 0 1000 400"/);
});

test('chart text is escaped everywhere it appears', () => {
  const evil = '</text><script>alert(1)</script><img src=x onerror=alert(1)>"\'&';
  const spec = { type: 'bar', title: evil, caption: evil, unit: '<b>', labels: [evil, 'b'], series: [{ name: evil, values: [1, 2] }, { name: 'n', values: [3, 4] }] };
  for (const out of [charts.chartSVG(spec), charts.chartHTML(spec), charts.chartHTML({ ...spec, type: 'pie', series: [spec.series[0]] }), charts.chartHTML({ ...spec, type: 'hbar' })]) {
    assert.doesNotMatch(out, /<script|<img|<b>|onerror="/);
    assert.match(out, /&lt;\/text&gt;&lt;script&gt;/);
    assertInert(out, 'escaped chart', true);
  }
});

test('chartHTML adds width variants, legend, caption and a hidden data table', () => {
  const out = charts.chartHTML({ ...SPECS.grouped, caption: 'Source: finance' });
  assert.match(out, /^<div data-forma-generated="" class="forma-chart" data-forma-chart="bar"/);
  assert.equal((out.match(/data-forma-variant="(sm|md|lg)"/g) || []).length, 3);
  assert.match(out, /data-forma-variant="md" style="display:block;/);
  assert.match(out, /data-forma-variant="sm" style="display:none;/);
  assert.match(out, /<div aria-hidden="true" style="display:flex;flex-wrap:wrap[^"]*">.*2025.*2026/);
  assert.match(out, /<p [^>]*>Source: finance<\/p>/);
  assert.match(out, /<div class="sr-only" style="position:absolute;width:1px;height:1px;[^"]*"><table><caption>Revenue<\/caption><thead><tr><th scope="col">Category<\/th><th scope="col">2025<\/th><th scope="col">2026<\/th><\/tr><\/thead>/);
  assert.match(out, /<tr><th scope="row">Q1<\/th><td data-label="2025">\$1,200,000<\/td><td data-label="2026">\$1,300,000<\/td><\/tr>/);
  const single = charts.chartHTML(SPECS.bar);
  assert.doesNotMatch(single, /display:flex;flex-wrap:wrap;gap:6px 16px/, 'no legend for one series');
  const pie = charts.chartHTML(SPECS.pie);
  assert.equal((pie.match(/<svg/g) || []).length, 1);
  assert.match(pie, /<th scope="col">Share<\/th>/);
  assert.doesNotMatch(pie, /min-width:3\.2em/, 'no duplicate share column when the unit is %');
  assert.match(charts.chartHTML(SPECS.donut), /min-width:3\.2em[^>]*>100%</);
  assert.equal((charts.chartHTML(SPECS.sparkline).match(/<svg/g) || []).length, 1);
});

test('expandCharts fills hosts, marks them and shows invalid specs visibly', () => {
  const stored = S.safeHTML(
    '<section><figure class="chart" id="c1" data-chart=\'{"type":"line","title":"Signups","labels":["a","b"],"series":[{"name":"s","values":[1,2]}]}\'><figcaption>Weekly</figcaption></figure>' +
      '<div class="chart" data-chart=\'{"type":"pie","labels":["a"],"series":[{"values":[-1]}]}\'></div><p>after &amp; more</p></section>',
  );
  const out = charts.expandCharts(stored);
  const hosts = elements(out).filter((e) => e.attribs['data-forma-expanded'] === 'chart');
  assert.equal(hosts.length, 2);
  assert.equal(hosts[0].name, 'figure');
  assert.equal(hosts[0].attribs.id, 'c1');
  assert.equal(hosts[0].attribs['data-forma-source'], stored.slice(stored.indexOf('<figure'), stored.indexOf('</figure>') + 9));
  assert.match(out, /<figcaption>Weekly<\/figcaption><\/figure>/, 'host children kept after the chart');
  assert.match(out, /role="note" class="forma-chart-invalid"[^>]*><strong[^>]*>Chart data invalid:<\/strong> Pie and donut values must be zero or positive and add up to more than zero\.<\/div><\/div>/);
  assert.ok(out.endsWith('<p>after &amp; more</p></section>'));
  assert.ok(out.startsWith('<section><figure class="chart" id="c1" data-chart="'));
  assert.equal(charts.expandCharts(out), out, 'idempotent');
  assert.equal(charts.expandCharts('<p>No charts</p>'), '<p>No charts</p>');
  assert.match(charts.expandCharts('<figure data-chart="{oops"></figure>'), /Chart data invalid:<\/strong> Chart data is not valid JSON\./);
});

test('expandMarkup expands charts and icons together; markup.cjs re-exports the API', () => {
  const stored = S.safeHTML('<div class="card"><h2><i data-icon="chart"></i> Usage</h2><figure data-chart=\'{"type":"bar","values":[1,2]}\'><figcaption><i data-icon="info"></i> Note</figcaption></figure></div>');
  const out = markup.expandMarkup(stored);
  assert.equal(out, charts.expandMarkup(stored));
  assert.equal((out.match(/data-forma-expanded="icon"/g) || []).length, 2);
  assert.equal((out.match(/data-forma-expanded="chart"/g) || []).length, 1);
  const host = elements(out).find((e) => e.name === 'figure');
  assert.equal(host.attribs['data-forma-source'], '<figure data-chart="{&quot;type&quot;:&quot;bar&quot;,&quot;values&quot;:[1,2]}"><figcaption><i data-icon="info"></i> Note</figcaption></figure>');
  assert.equal(markup.expandMarkup(out), out);
  for (const k of ['expandMarkup', 'expandIcons', 'expandCharts', 'validateChart', 'chartSVG', 'chartHTML', 'iconNames', 'resolveIcon', 'ICON_PROMPT_NAMES', 'MARKUP_CSS'])
    assert.ok(markup[k] != null, k);
  assert.doesNotMatch(markup.MARKUP_CSS, /url\(|@import|<|\\/);
});

// ---------------------------------------------------------------- real browser
async function browser(t) {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
    return await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  } catch (e) {
    t.skip(`Chromium unavailable: ${e.message.split('\n')[0]}`);
    return null;
  }
}
const PAGE_CSS = `:root{--accent:#ff0000;--surface:#fff;--muted:#667085;--border:#e4e7ec;--chart-1:#2a78d6;--chart-2:#eb6834}body{margin:0;font:16px system-ui,sans-serif}`;

test('Chromium re-cases sanitized SVG names and renders gradients and var() paint', async (t) => {
  const b = await browser(t);
  if (!b) return;
  try {
    const page = await b.newPage();
    const html = S.safeHTML(
      '<svg viewBox="0 0 10 10" width="100" height="100" preserveAspectRatio="none"><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" x2="10" gradientTransform="rotate(0)"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="#00f"/></linearGradient><clipPath id="c" clipPathUnits="userSpaceOnUse"><rect width="10" height="5"/></clipPath></defs><rect id="r" width="10" height="10" fill="url(#g)" clip-path="url(#c)"/><circle id="v" cx="5" cy="5" r="2" fill="var(--accent)"/><text id="t" x="1" y="9" font-size="2">Hi</text></svg>',
    );
    assert.match(html, /viewbox=|lineargradient|linearGradient/i);
    await page.setContent(`<!doctype html><style>${PAGE_CSS}</style><body>${html}</body>`);
    const r = await page.evaluate(() => {
      const s = document.querySelector('svg'), g = document.getElementById('g'), rect = document.getElementById('r');
      const box = rect.getBBox(), px = s.getBoundingClientRect();
      return {
        viewBox: s.getAttribute('viewBox'), aspect: s.getAttribute('preserveAspectRatio'), size: [px.width, px.height], svgNS: s.namespaceURI,
        grad: [g.tagName, g.namespaceURI, g.getAttribute('gradientUnits'), g.getAttribute('gradientTransform'), g instanceof SVGLinearGradientElement],
        clip: document.querySelector('clipPath')?.getAttribute('clipPathUnits'),
        bbox: [box.width, box.height], fill: getComputedStyle(rect).fill, stop: getComputedStyle(g.querySelector('stop')).stopColor,
        varFill: getComputedStyle(document.getElementById('v')).fill, text: document.getElementById('t').getComputedTextLength() > 0,
      };
    });
    assert.equal(r.viewBox, '0 0 10 10');
    assert.equal(r.aspect, 'none');
    assert.deepEqual(r.size, [100, 100]);
    assert.equal(r.svgNS, 'http://www.w3.org/2000/svg');
    assert.deepEqual(r.grad, ['linearGradient', 'http://www.w3.org/2000/svg', 'userSpaceOnUse', 'rotate(0)', true]);
    assert.equal(r.clip, 'userSpaceOnUse');
    assert.deepEqual(r.bbox, [10, 10]);
    assert.match(r.fill, /^url\(.*#g"?\)$/);
    assert.equal(r.stop, 'rgb(255, 0, 0)');
    assert.equal(r.varFill, 'rgb(255, 0, 0)');
    assert.equal(r.text, true);
    // Read rendered pixels back: inside the clip the gradient starts red; below the clip nothing is painted.
    const png = (await page.screenshot({ clip: { x: 0, y: 0, width: 100, height: 100 } })).toString('base64');
    const [top, bottom] = await page.evaluate(async (data) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + data;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = c.height = 100;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0);
      return [[...x.getImageData(2, 20, 1, 1).data], [...x.getImageData(2, 80, 1, 1).data]];
    }, png);
    assert.ok(top[0] > 200 && top[2] < 80, `gradient pixel ${top}`);
    assert.ok(bottom[0] > 240 && bottom[1] > 240 && bottom[2] > 240, `clipped pixel ${bottom}`);
  } finally {
    await b.close();
  }
});

test('Chromium executes none of the XSS payloads after sanitization and expansion', async (t) => {
  const b = await browser(t);
  if (!b) return;
  try {
    const page = await b.newPage();
    const dialogs = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      d.dismiss().catch(() => {});
    });
    await page.route('**/*', (r) => r.abort());
    const body = Object.values(XSS).map((p) => `<div>${markup.expandMarkup(S.safeHTML(p))}</div>`).join('');
    await page.setContent(`<!doctype html><style>${PAGE_CSS}${markup.MARKUP_CSS}</style><body>${body}</body>`);
    await page.mouse.move(5, 5);
    await page.mouse.click(10, 10);
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({
      xss: window.__xss,
      scripts: document.body.querySelectorAll('script,iframe,object,embed,foreignObject,use,image,animate,set,style').length,
      handlers: [...document.querySelectorAll('*')].filter((n) => [...n.attributes].some((a) => /^on/i.test(a.name) || a.name === 'style' && !n.closest('[data-forma-generated],[data-forma-expanded]'))).length,
      hrefs: [...document.querySelectorAll('[href],[xlink\\:href]')].map((n) => n.getAttribute('href')).filter((h) => h && !h.startsWith('#')),
    }));
    assert.deepEqual(r, { xss: undefined, scripts: 0, handlers: 0, hrefs: [] });
    assert.deepEqual(dialogs, []);
  } finally {
    await b.close();
  }
});

test('Chromium shows the chart variant that fits its container and hides the data table', async (t) => {
  const b = await browser(t);
  if (!b) return;
  try {
    const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
    const chart = S.safeHTML(`<figure class="chart" data-chart='${JSON.stringify(SPECS.grouped)}'></figure>`);
    const boxes = [320, 600, 1000].map((w) => `<div style="width:${w}px" class="box">${markup.expandMarkup(chart)}</div>`).join('');
    const flexRow = `<div style="display:flex;gap:12px;width:500px" id="row"><span>KPI</span>${markup.expandMarkup(chart)}</div>`;
    await page.setContent(`<!doctype html><style>${PAGE_CSS}${markup.MARKUP_CSS}</style><body>${boxes}${flexRow}</body>`);
    const r = await page.evaluate(() => ({
      visible: [...document.querySelectorAll('.box')].map((box) => [...box.querySelectorAll('[data-forma-variant]')].filter((s) => getComputedStyle(s).display !== 'none').map((s) => s.dataset.formaVariant)),
      widths: [...document.querySelectorAll('.box')].map((box) => Math.round([...box.querySelectorAll('[data-forma-variant]')].find((s) => getComputedStyle(s).display !== 'none').getBoundingClientRect().width)),
      table: (() => {
        const t = document.querySelector('.sr-only').getBoundingClientRect();
        return [t.width, t.height];
      })(),
      rowChart: Math.round(document.querySelector('#row figure').getBoundingClientRect().width),
      overflow: document.documentElement.scrollWidth > innerWidth,
      titles: document.querySelectorAll('svg[role="img"] > title').length,
    }));
    assert.deepEqual(r.visible, [['sm'], ['md'], ['lg']]);
    assert.deepEqual(r.widths, [320, 600, 1000]);
    assert.deepEqual(r.table, [1, 1]);
    assert.ok(r.rowChart > 300, `chart in a flex row keeps its width (${r.rowChart})`);
    assert.equal(r.overflow, false);
    assert.ok(r.titles >= 12);
    // Without MARKUP_CSS the inline default still shows exactly one variant.
    await page.setContent(`<!doctype html><style>${PAGE_CSS}</style><body>${markup.expandMarkup(chart)}</body>`);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[data-forma-variant]')].filter((s) => getComputedStyle(s).display !== 'none').map((s) => s.dataset.formaVariant)), ['md']);
  } finally {
    await b.close();
  }
});
