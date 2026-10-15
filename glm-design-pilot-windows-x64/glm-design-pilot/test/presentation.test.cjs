'use strict';
// Page assembly (ENGINE-SPEC section 9): CSP, stylesheet order, icon and chart expansion,
// inspector index parity with the studio's DOMParser view of stored HTML, live token
// messages and the handoff ZIP.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const JSZip = require('jszip');
const S = require('../lib/schema.cjs');
const { pageHTML, CSP, webStyles, webCSS, tweakCSS } = require('../lib/presentation.cjs');
const { MARKUP_CSS } = require('../lib/markup.cjs');
const { handoff } = require('../lib/handoff.cjs');
const { tokenVars } = require('../lib/kit.cjs');
const { demo } = require('../lib/demo.cjs');

let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch {}
const exe = process.env.BROWSER_EXECUTABLE;
const browserReady = !!chromium && (exe ? fs.existsSync(exe) : (() => { try { return fs.existsSync(chromium.executablePath()); } catch { return false; } })());
const launch = () => chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : {}), args: ['--disable-dev-shm-usage'] });

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfZkAAAAASUVORK5CYII=';
const chart = (spec) => `<figure class="chart" id="volume" data-chart='${JSON.stringify(spec)}'><figcaption>Source: <i data-icon="info"></i> sample</figcaption></figure>`;
// One screen with icons (inside buttons, a heading and a chart caption), a chart, a table
// without <tbody> (the HTML parser adds one), an image reference and a dialog without a close button.
const SCREEN = `<main class="page"><div class="page-header"><h1><i data-icon="inbox" class="size-5"></i>Requests</h1><button class="btn btn-primary sm:w-auto" data-action="open" data-target="dlg"><i data-icon="plus"></i>New</button></div>
<section class="card">${chart({ type: 'bar', title: 'Open by team', labels: ['Ops', 'IT'], series: [{ name: 'Open', values: [12, 7] }] })}</section>
<table><tr><th>Owner</th><th>Status</th></tr><tr><td data-label="Owner">Asha</td><td data-label="Status"><span class="badge badge-success"><i data-icon="check"></i>Done</span></td></tr></table>
<img src="{{reference:0}}" alt="Sketch"><p id="after">After <strong>the table</strong></p>
<dialog id="dlg" aria-label="New request"><p>Dialog body</p></dialog></main>`;
const artifact = () =>
  S.artifact(
    {
      kind: 'web',
      title: 'Assembly',
      designSystem: { name: 'Test', preset: 'editorial' },
      css: '.my-model-rule{gap:var(--space-4)}',
      tweaks: [{ var: '--sidebar-width', label: 'Sidebar', min: 200, max: 320, step: 4, unit: 'px', value: 260 }],
      screens: [
        { id: 'home', name: 'Home', html: SCREEN },
        { id: 'other', name: 'Other', html: '<main><h1>Other</h1><button data-action="navigate" data-target="home">Back</button></main>' },
      ],
    },
    'web',
  );
const styleOf = (html) => html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'));

test('pages carry the strict CSP with font-src data: and no network sources', () => {
  const html = pageHTML(artifact(), [{ name: 'r', data: png }]);
  assert.match(CSP, /(^|; )font-src data:(;|$)/);
  for (const d of ["default-src 'none'", 'img-src data:', "connect-src 'none'", "frame-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"]) assert.ok(CSP.includes(d), d);
  assert.doesNotMatch(CSP, /https?:|\*/);
  assert.ok(html.includes(`<meta http-equiv="Content-Security-Policy" content="${CSP}">`));
  // Bundled fonts are inlined as data URIs, so nothing is fetched.
  assert.match(styleOf(html), /@font-face\{font-family:'Fraunces';src:url\(data:font\/woff2;base64,/);
  assert.doesNotMatch(html, /url\((?!data:font\/woff2;base64,)/);
});

test('stylesheet order: base fallbacks, kit (fonts, tokens, components), markup, utilities, model CSS, tweaks', () => {
  const a = artifact();
  const css = styleOf(pageHTML(a));
  const s = webStyles(a);
  assert.equal(css, `${webCSS(a)}\n[hidden]{display:none!important}img{max-width:100%}`);
  const at = (needle) => {
    const i = css.indexOf(needle);
    assert.ok(i >= 0, `missing ${needle}`);
    return i;
  };
  const order = [
    at(':where(button,a){touch-action:manipulation}'), // 0.2 zero-specificity base
    at('@font-face{'), // kit: bundled fonts
    at(':root{color-scheme:'), // kit: tokens
    at(':where(.btn)'), // kit: components
    at('@layer forma-markup{'), // icon and chart support
    at('.sm\\:w-auto'), // utilities for classes used on any screen
    at('.my-model-rule{gap:var(--space-4)}'), // model CSS
    at(':root{--sidebar-width:260px}'), // tweak values
    at('[hidden]{display:none!important}'),
  ];
  assert.deepEqual([...order].sort((x, y) => x - y), order, 'cascade order');
  assert.deepEqual(Object.keys(s), ['tokens', 'base', 'kit', 'markup', 'utilities', 'model', 'tweaks']);
  assert.equal(s.markup, MARKUP_CSS);
  assert.equal(s.tokens.preset, 'editorial');
  assert.match(s.kit, new RegExp(`--accent:${s.tokens.accent}`));
  // Utilities come from every screen, not only the visible one; unknown classes produce nothing.
  assert.match(s.utilities, /\.size-5\{/);
  assert.doesNotMatch(s.utilities, /my-model-rule|btn-primary/);
  // A page restricted to one screen still gets the shared stylesheet.
  assert.equal(styleOf(pageHTML(a, [], 'other')), css);
});

test('tweak values are re-validated before they are written into <style>', () => {
  assert.equal(tweakCSS({ tweaks: [{ var: '--aa', value: 3, unit: 'rem' }, { var: '--bad;}body{', value: 1 }, { var: '--bb', value: 'x' }, { var: '--cc', value: 1, unit: 'px;color:red' }, { var: '--dd', value: 1e9 }, { var: '--ee', value: 2.123456, unit: '' }, { var: '--x' }] }), ':root{--aa:3rem;--ee:2.1235}');
  assert.equal(tweakCSS({ tweaks: [] }), '');
  assert.equal(tweakCSS({}), '');
  assert.equal(tweakCSS({ tweaks: [{ var: '--side', value: 10 }] }, 'html:root'), 'html:root{--side:10px}');
});

test('stored icons and charts are expanded in the page; references are substituted first', () => {
  const a = artifact();
  assert.match(a.screens[0].html, /<i data-icon="plus"><\/i>/, 'stored form stays compact');
  const html = pageHTML(a, [{ name: 'r', data: png }]);
  assert.doesNotMatch(html, /<i data-icon/);
  assert.equal((html.match(/<svg[^>]*data-forma-expanded="icon"/g) || []).length, 4);
  assert.match(html, /<svg[^>]*class="size-5"[^>]*data-forma-expanded="icon"|<svg[^>]*data-forma-expanded="icon"[^>]*class="size-5"/, 'icon keeps its classes');
  assert.match(html, /<figure class="chart" id="volume" data-chart="[^"]*" data-forma-expanded="chart" data-forma-source="/);
  assert.match(html, /<svg[^>]*role="img"[^>]*><title>Open by team<\/title>/);
  assert.match(html, /<figcaption>Source: <svg[^>]*data-forma-expanded="icon"/, 'icons inside a chart caption expand too');
  assert.match(html, /<p data-forma-generated="" class="forma-chart-title"[^>]*>Open by team<\/p>/, 'visible title (the figure has its own figcaption)');
  assert.ok(html.includes(`<img src="${png}" alt="Sketch" />`));
  assert.doesNotMatch(html, /\{\{reference:/);
  // A missing reference leaves an empty src rather than the placeholder.
  assert.match(pageHTML(a), /<img src="" alt="Sketch" \/>/);
  // Editor previews remember the reference number for stored-equivalent selections.
  assert.ok(pageHTML(a, [{ name: 'r', data: png }], null, { channel: 'c', screen: 'home' }).includes(`src="${png}" data-forma-reference="0"`));
});

test('all screens of a page share one chart budget, so many large charts cannot exceed the renderer limit', () => {
  const labels = Array.from({ length: 24 }, (_, i) => `Label ${i}`);
  const big = `<figure class="chart" data-chart='${JSON.stringify({ type: 'bar', title: 'Big', labels, series: Array.from({ length: 6 }, (_, j) => ({ name: `S${j}`, values: labels.map((_, i) => i + j) })) })}'></figure>`;
  const screens = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, html: `<main><h1>S${i}</h1>${big.repeat(20)}</main>` }));
  const a = S.artifact({ kind: 'web', title: 'Charts', screens }, 'web');
  assert.ok(a.screens.reduce((n, s) => n + s.html.length, 0) > 300000, 'within the stored size limit');
  const page = pageHTML(a);
  assert.ok(page.length < 9000000, `page is ${page.length} characters`);
  const drawn = (page.match(/class="forma-chart"/g) || []).length, notices = (page.match(/Too many or too large charts on one page/g) || []).length;
  assert.ok(drawn >= 40 && notices > 0 && drawn + notices === 240, `${drawn} drawn, ${notices} notices`);
  // One screen alone still draws its charts.
  assert.equal((pageHTML(a, [], 's11').match(/class="forma-chart"/g) || []).length, 20);
});

test('the demo web artifact is built on the kit: preset tokens, utilities, icons and a chart', () => {
  const a = S.artifact(demo('web'), 'web');
  assert.equal(a.designSystem.preset, 'neutral');
  assert.deepEqual(a.theme, { accent: a.designSystem.accent, background: a.designSystem.background, text: a.designSystem.text });
  assert.match(a.html, /class="btn btn-primary[^"]*"/);
  assert.match(a.html, /<i data-icon="[a-z-]+"><\/i>/);
  assert.equal((a.html.match(/data-chart=/g) || []).length, 1);
  assert.ok(a.css.length < 200, 'the kit does the styling');
  const page = pageHTML(a);
  assert.match(page, /data-forma-expanded="chart"/);
  assert.match(page, /\.sm\\:py-12\{/);
  assert.deepEqual(require('../lib/lint.cjs').staticLint(a), []);
});

// ---- inspector parity in Chromium -------------------------------------------------------

// The preview runs in an iframe like the studio canvas; the host page plays the studio:
// it collects inspector messages and computes indexes the way public/studio.js does.
function host(page) {
  return `<!doctype html><html><body><iframe id="f" style="width:1100px;height:800px" srcdoc="${page.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe><script>
    window.messages = [];
    addEventListener('message', (e) => { if (e.data && e.data.channel === 'chan') window.messages.push(e.data); });
    window.send = (data) => document.getElementById('f').contentWindow.postMessage({ channel: 'chan', ...data }, '*');
    window.stored = (html) => [...new DOMParser().parseFromString(html, 'text/html').body.querySelectorAll('*')];
  </script></body></html>`;
}

test('inspector indexes match DOMParser(stored HTML) with icons, charts, a tbody-less table and runtime nodes', { skip: !browserReady && 'Chromium is not available', timeout: 120000 }, async () => {
  const a = artifact();
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.setContent(host(pageHTML(a, [{ name: 'r', data: png }], null, { channel: 'chan', screen: 'home' })));
    await page.waitForFunction(() => window.messages.some((m) => m.type === 'ready'));
    const stored = a.screens[0].html;
    const r = await page.evaluate((html) => {
      const layers = window.messages.find((m) => m.type === 'layers' && m.screen === 'home').layers;
      return { layers: layers.map((l) => l.tag), expected: window.stored(html).map((n) => n.tagName.toLowerCase()), texts: layers.map((l) => l.text) };
    }, stored);
    assert.ok(r.expected.includes('tbody'), 'the parser adds the implicit tbody in both views');
    assert.equal(r.expected.filter((t) => t === 'i').length, 4);
    assert.deepEqual(r.layers, r.expected, 'one layer per stored element, in order');
    assert.ok(r.texts.includes('Icon · plus') && r.texts.includes('Chart · Open by team'));

    // Selecting by index returns the stored-equivalent outer HTML of that element.
    const select = async (index) => {
      await page.evaluate((i) => { window.messages.length = 0; window.send({ type: 'select', index: i }); }, index);
      await page.waitForFunction(() => window.messages.some((m) => m.type === 'selection'));
      return page.evaluate(() => window.messages.find((m) => m.type === 'selection'));
    };
    const outer = (index) => page.evaluate(([html, i]) => window.stored(html)[i].outerHTML, [stored, index]);
    for (const tag of ['i', 'figure', 'td', 'img', 'table', 'p']) {
      const index = r.expected.indexOf(tag);
      const sel = await select(index);
      assert.equal(sel.index, index);
      assert.equal(sel.tag, tag);
      assert.equal(sel.html, await outer(index), `${tag} selection html`);
    }
    const figure = await select(r.expected.indexOf('figure'));
    assert.equal(figure.expanded, 'chart');
    assert.equal(figure.text, 'Open by team');
    assert.match(figure.html, /^<figure class="chart" id="volume" data-chart=/);
    assert.doesNotMatch(figure.html, /data-forma|<svg/);
    assert.match((await select(r.expected.indexOf('img'))).html, /src="\{\{reference:0\}\}"/);
    // The element after the runtime-touched dialog and the expanded chart keeps its index.
    const after = r.expected.lastIndexOf('strong');
    assert.equal((await select(after)).html, '<strong>the table</strong>');

    // A click inside an expanded subtree selects its host.
    await page.evaluate(() => { window.messages.length = 0; window.send({ type: 'mode', designing: true }); });
    const frame = page.frameLocator('#f');
    await frame.locator('button.btn-primary svg path').first().click({ force: true });
    await page.waitForFunction(() => window.messages.some((m) => m.type === 'selection'));
    const icon = await page.evaluate(() => window.messages.find((m) => m.type === 'selection'));
    assert.equal(icon.index, r.expected.indexOf('i', r.expected.indexOf('button')));
    assert.equal(icon.html, '<i data-icon="plus"></i>');
    await page.evaluate(() => { window.messages.length = 0; });
    await frame.locator('figure.chart svg[data-forma-variant]:visible path:has(> title)').first().click();
    await page.waitForFunction(() => window.messages.some((m) => m.type === 'selection'));
    assert.equal((await page.evaluate(() => window.messages.find((m) => m.type === 'selection'))).index, r.expected.indexOf('figure'));
  } finally {
    await browser.close();
  }
});

test('expansion never changes how the browser parses stored elements, even for hosts in invalid places', { skip: !browserReady && 'Chromium is not available', timeout: 60000 }, async () => {
  const { expandMarkup } = require('../lib/markup.cjs');
  const spec = JSON.stringify({ type: 'bar', title: 'T', labels: ['a', 'b'], series: [{ name: 's', values: [1, 2] }] });
  const cases = [
    `<table><tr><td>a</td><figure data-chart='${spec}'></figure></tr></table><p>after</p>`, // foster-parented host
    `<table><figure data-chart='${spec}'></figure><tr><td>a</td></tr></table><p>after</p>`,
    `<table><tbody><div data-chart='${spec}'></div></tbody></table><p>after</p>`,
    `<table><tr><td>a</td><i data-icon="check"></i></tr></table><p>after</p>`,
    `<p>x<div data-chart='${spec}'></div>y</p>`,
    `<ul><figure data-chart='${spec}'><figcaption>c</figcaption></figure></ul><button><div data-chart='${spec}'></div></button>`,
    `<table><tr><td><figure data-chart='${spec}'></figure></td></tr></table>`, // valid: keeps its data table
  ];
  const browser = await launch();
  try {
    const page = await browser.newPage();
    for (const c of cases) {
      const stored = S.safeHTML(c), expanded = expandMarkup(stored);
      const r = await page.evaluate(([s, e]) => {
        const parse = (html) => new DOMParser().parseFromString(html, 'text/html').body;
        // The inspector's rule: skip generated nodes and the insides of expanded icons.
        const own = (n) => !n.closest('[data-forma-generated]') && !(n.parentElement?.closest('[data-forma-expanded]') && n.parentElement.closest('[data-forma-expanded]').getAttribute('data-forma-expanded') !== 'chart');
        const tags = (body, skip) => [...body.querySelectorAll('*')].filter((n) => !skip || own(n)).map((n) => (n.getAttribute('data-forma-expanded') === 'icon' ? 'i' : n.tagName.toLowerCase()));
        const body = parse(e);
        return { stored: tags(parse(s)).join(), page: tags(body, true).join(), tables: [...body.querySelectorAll('[data-forma-expanded="chart"] table')].map((t) => !!t.closest('.sr-only[data-forma-generated] , [data-forma-generated] .sr-only')) };
      }, [stored, expanded]);
      assert.equal(r.page, r.stored, c);
      assert.ok(r.tables.every(Boolean), `every data table stays visually hidden: ${c}`);
    }
    assert.match(expandMarkup(S.safeHTML(cases[6])), /<caption>T<\/caption>/, 'charts in table cells keep the accessible data table');
  } finally {
    await browser.close();
  }
});

test('live token messages set only custom properties with plain values', { skip: !browserReady && 'Chromium is not available', timeout: 60000 }, async () => {
  const a = artifact();
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setContent(host(pageHTML(a, [], null, { channel: 'chan', screen: 'home' })));
    await page.waitForFunction(() => window.messages.some((m) => m.type === 'ready'));
    const vars = {
      '--accent': '#ff0000',
      '--radius': '14px',
      '--type-scale': 1.3,
      '--font': 'Space Grotesk, sans-serif',
      '--font-heading': "'Inter', serif", // spec: plain values start with a letter
      '--sidebar-width': '-12.5rem',
      '--bg-image': 'url(https://example.com/x.png)',
      '--x1': 'red;color:blue',
      '--x2': 'a{}',
      '--x3': 'expression(alert(1))',
      '--x4': 'var(--accent)',
      '--x5': '#12',
      '--x6': 'calc(1px + 2px)',
      '--x7': 'a'.repeat(90),
      color: 'red',
      '--UPPER': '#000000',
      '--x8': ['#000'],
    };
    await page.evaluate((v) => window.send({ type: 'tokens', vars: v }), vars);
    const read = () =>
      page.frames()[1].evaluate((names) => Object.fromEntries(names.map((n) => [n, document.documentElement.style.getPropertyValue(n)])), Object.keys(vars));
    await page.waitForFunction(() => document.getElementById('f').contentDocument.documentElement.style.getPropertyValue('--accent') === '#ff0000');
    assert.deepEqual(await read(), {
      '--accent': '#ff0000',
      '--radius': '14px',
      '--type-scale': '1.3',
      '--font': 'Space Grotesk, sans-serif',
      '--font-heading': '',
      '--sidebar-width': '-12.5rem',
      '--bg-image': '',
      '--x1': '',
      '--x2': '',
      '--x3': '',
      '--x4': '',
      '--x5': '',
      '--x6': '',
      '--x7': '',
      color: '',
      '--UPPER': '',
      '--x8': '',
    });
    assert.equal(await page.frames()[1].evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()), '#ff0000', 'the live value wins over the stylesheet');
    // null removes a live value again; malformed payloads are ignored.
    await page.evaluate(() => { window.send({ type: 'tokens', vars: { '--accent': null } }); window.send({ type: 'tokens', vars: ['--radius', '1px'] }); window.send({ type: 'tokens', vars: 'x' }); });
    await page.waitForFunction(() => document.getElementById('f').contentDocument.documentElement.style.getPropertyValue('--accent') === '');
    assert.equal(await page.frames()[1].evaluate(() => document.documentElement.style.getPropertyValue('--radius')), '14px');
    // Messages from anything but the parent, or on another channel, are ignored.
    await page.frames()[1].evaluate(() => postMessage({ channel: 'chan', type: 'tokens', vars: { '--radius': '1px' } }, '*'));
    await page.evaluate(() => document.getElementById('f').contentWindow.postMessage({ channel: 'other', type: 'tokens', vars: { '--radius': '2px' } }, '*'));
    await page.waitForTimeout(100);
    assert.equal(await page.frames()[1].evaluate(() => document.documentElement.style.getPropertyValue('--radius')), '14px');
  } finally {
    await browser.close();
  }
});

// ---- handoff ----------------------------------------------------------------------------

test('the handoff ZIP adds kit.css and tokens.json; styles.css stays the model CSS', async () => {
  const a = artifact();
  const project = { references: [{ name: 'r', data: png }] };
  const revision = { id: 'rev-1', origin: 'glm', prompt: 'Brief', artifact: a, metrics: { mode: 'glm', model: 'glm-5.3-flash' } };
  const zip = await JSZip.loadAsync(handoff(project, revision, [], null), { checkCRC32: true });
  const names = Object.keys(zip.files).sort();
  for (const n of ['index.html', 'artifact.json', 'styles.css', 'kit.css', 'tokens.json', 'design-system.json', 'README.md', 'screens/home.html', 'screens/other.html', 'references/1.png']) assert.ok(names.includes(n), n);
  assert.equal(await zip.file('styles.css').async('string'), a.css);
  const kit = await zip.file('kit.css').async('string');
  const s = webStyles(a, 'html:root');
  assert.match(kit, /^\/\* Forma kit for "Assembly"/);
  for (const part of [s.base, s.kit, s.markup, s.utilities]) assert.ok(kit.includes(part));
  assert.match(kit, /@font-face\{font-family:'Fraunces';src:url\(data:font\/woff2;base64,/, 'fonts inlined');
  assert.ok(kit.includes('html:root{--sidebar-width:260px}'), 'tweaks win over styles.css :root defaults');
  assert.ok(!kit.includes('.my-model-rule'), 'model CSS lives in styles.css only');
  assert.ok(kit.indexOf(s.kit) < kit.indexOf(s.markup) && kit.indexOf(s.markup) < kit.indexOf(s.utilities));
  const tokens = JSON.parse(await zip.file('tokens.json').async('string'));
  assert.equal(tokens.preset, 'editorial');
  assert.equal(tokens.tokens.headingFont, 'Fraunces');
  assert.deepEqual(tokens.cssVariables, tokenVars(s.tokens));
  assert.deepEqual(tokens.tweaks, a.tweaks);
  assert.equal(await zip.file('screens/home.html').async('string'), a.screens[0].html, 'screens keep the compact stored form');
  const index = await zip.file('index.html').async('string');
  assert.equal(index, pageHTML(a, project.references));
  assert.match(await zip.file('README.md').async('string'), /kit\.css[\s\S]*tokens\.json/);
  // A hostile title cannot close the kit.css comment.
  const evil = S.artifact({ ...a, title: 'x */ body{display:none} /*' }, 'web');
  const evilKit = await (await JSZip.loadAsync(handoff(project, { ...revision, artifact: evil }, [], null))).file('kit.css').async('string');
  assert.equal(evilKit.indexOf('*/'), evilKit.indexOf('. Link it before styles.css. */') + 29);
});
