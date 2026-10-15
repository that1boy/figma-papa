'use strict';
// Slides v2 (spec 8): section, quote, stats, timeline, cards, chart and agenda layouts —
// validation, shared geometry, HTML preview, native PPTX (charts, icons, fonts) and DOCX fixes.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const S = require('../lib/schema.cjs');
const L = require('../lib/slide-layout.cjs');
const { pageHTML, warnings } = require('../lib/presentation.cjs');
const { exportPPTX, exportDOCX, numberFormat, iconShapes } = require('../lib/exports.cjs');
const { demo } = require('../lib/demo.cjs');

const THEME = { accent: '#4f46e5', background: '#ffffff', text: '#1f2333' };
const SLIDES = {
  section: { layout: 'section', title: 'Where we are today', subtitle: 'Baseline from the service review', body: 'Three findings shape the proposal.' },
  quote: { layout: 'quote', title: 'What employees told us', quote: 'I never know whether my request reached the right team.', attribution: 'Survey respondent' },
  stats: { layout: 'stats', title: 'The pilot in numbers', body: 'Figures supplied in the brief.', stats: [{ value: '42%', label: 'Faster first response', detail: 'Median time to first reply.' }, { value: 3, label: 'Service teams' }, { value: 'USD 6,000', label: 'Annual saving', detail: 'Lower-cost option.' }] },
  timeline: { layout: 'timeline', title: 'Rollout plan', steps: [{ label: 'Week 1', title: 'Confirm owners', detail: 'Each team nominates an owner.' }, { label: 'Week 2', title: 'Publish catalogue' }, { title: 'Run the pilot', detail: 'Employees submit and track requests.' }] },
  cards: { layout: 'cards', title: 'What changes', cards: [{ title: 'Employees', body: 'One place to find services.', icon: 'users' }, { title: 'Service teams', body: 'Consistent intake.', icon: 'group' }, { title: 'Leadership', body: 'Evidence before expansion.', icon: 'no-such-icon' }] },
  chart: { layout: 'chart', title: 'Requests by service', body: 'Time away drives most demand.', chart: { type: 'bar', title: 'Requests per service', labels: ['Time away', 'Equipment & tools', 'Facilities'], series: [{ name: 'Requests', values: [42, 27, 11] }], caption: 'Example data supplied in the brief.' } },
  agenda: { layout: 'agenda', title: 'Agenda', bullets: ['Context', 'Findings', 'Proposal', 'Rollout plan', 'Decisions'] },
};
const deck = (slides, extra = {}) => S.artifact({ kind: 'slides', title: 'Service desk modernisation', theme: THEME, slides, ...extra });
const all = (extra) => deck([...Object.values(SLIDES), { layout: 'chart', title: 'Channel mix', chart: { type: 'donut', labels: ['Portal', 'Email'], series: [{ values: [70, 30] }], unit: '%' } }], extra);
const bad = (slide, pattern) => assert.throws(() => deck([slide]), (e) => e.status === 400 && pattern.test(e.message), `expected ${pattern}`);

describe('validation', () => {
  test('every v2 layout validates and normalises its own fields', () => {
    const a = all();
    assert.deepEqual(a.slides.map((s) => s.layout), [...L.V2_LAYOUTS, 'chart']);
    const [section, quote, stats, timeline, cards, chart, agenda] = a.slides;
    assert.equal(section.body, 'Three findings shape the proposal.');
    assert.deepEqual({ quote: quote.quote, attribution: quote.attribution }, { quote: SLIDES.quote.quote, attribution: 'Survey respondent' });
    assert.deepEqual(stats.stats[1], { value: '3', label: 'Service teams', detail: '' });
    assert.deepEqual(timeline.steps[2], { label: '', title: 'Run the pilot', detail: 'Employees submit and track requests.' });
    assert.deepEqual(cards.cards.map((c) => c.icon), ['users', 'users', ''], 'aliases resolve; unknown icons are dropped');
    assert.equal(chart.chart.type, 'bar');
    assert.deepEqual(chart.chart.series, [{ name: 'Requests', values: [42, 27, 11] }]);
    assert.equal(agenda.bullets.length, 5);
    for (const s of a.slides) assert.deepEqual([s.table, s.imageIndex, s.columns], [null, null, []]);
  });
  test('limits and missing content give clear errors', () => {
    bad({ ...SLIDES.section, body: 'x'.repeat(301) }, /Slide 1 \(section\) body must be at most 300 characters/);
    bad({ ...SLIDES.quote, quote: '' }, /Slide 1 \(quote\) quote must be nonempty text, at most 300/);
    bad({ ...SLIDES.quote, body: 'Context' }, /shows only the quote and attribution/);
    bad({ ...SLIDES.stats, stats: SLIDES.stats.stats.slice(0, 1) }, /needs 2–4 stats, each \{"value","label","detail"\}/);
    bad({ ...SLIDES.stats, stats: Array(5).fill({ value: '1', label: 'x' }) }, /needs 2–4 stats/);
    bad({ ...SLIDES.stats, stats: [{ value: 'Many', label: 'Teams' }, { value: '2', label: 'Sites' }] }, /stat 1 value must be a number supplied in the brief/);
    bad({ ...SLIDES.stats, stats: [{ value: '1', label: '' }, { value: '2', label: 'Sites' }] }, /stat 1 label must be nonempty/);
    bad({ ...SLIDES.timeline, steps: SLIDES.timeline.steps.slice(0, 2) }, /needs 3–6 steps/);
    bad({ ...SLIDES.timeline, steps: Array(7).fill({ title: 'Step' }) }, /needs 3–6 steps/);
    bad({ ...SLIDES.timeline, steps: [...SLIDES.timeline.steps.slice(0, 2), { label: 'Week 3' }] }, /step 3 title must be nonempty/);
    bad({ ...SLIDES.cards, cards: SLIDES.cards.cards.slice(0, 2) }, /needs 3–4 cards/);
    bad({ ...SLIDES.cards, cards: [...SLIDES.cards.cards.slice(0, 2), { title: 'No body' }] }, /card 3 body must be nonempty/);
    bad({ ...SLIDES.cards, cards: [...SLIDES.cards.cards.slice(0, 2), 'text'] }, /cards 3 must be an object/);
    bad({ layout: 'chart', title: 'Chart' }, /Slide 1 \(chart\) needs chart/);
    bad({ ...SLIDES.chart, chart: { type: 'bar', labels: ['a', 'b', 'c'], series: [{ values: [1, 2] }] } }, /Slide 1 \(chart\) chart: Series .* has 2 values but there are 3 labels/);
    bad({ ...SLIDES.chart, chart: { type: 'radar', labels: ['a'], series: [{ values: [1] }] } }, /chart: Unknown chart type "radar"/);
    bad({ ...SLIDES.chart, body: 'x'.repeat(401) }, /body must be at most 400/);
    bad({ ...SLIDES.agenda, bullets: ['One', 'Two'] }, /needs 3–8 agenda items/);
    bad({ ...SLIDES.agenda, bullets: Array(9).fill('Item') }, /Agenda items must be an array with at most 8 items/);
    bad({ ...SLIDES.stats, bullets: ['A list'] }, /Slide 1 \(stats\) does not show bullets/);
    bad({ ...SLIDES.cards, table: { headers: ['A'], rows: [['1']] } }, /does not show a table/);
    bad({ ...SLIDES.timeline, imageIndex: 0 }, /does not show an image/);
    bad({ layout: 'mosaic', title: 'x' }, /Unknown slide layout. Use one of: cover, bullets, two-column, table, image, section, quote, stats, timeline, cards, chart, agenda/);
  });
  test('existing layouts keep their validation and output shape', () => {
    const s = deck([{ layout: 'bullets', title: 'Plain', body: 'Takeaway', bullets: ['One'], stats: [{ value: '1', label: 'ignored' }] }]).slides[0];
    assert.deepEqual(Object.keys(s), ['id', 'layout', 'title', 'subtitle', 'body', 'bullets', 'notes', 'imageIndex', 'table', 'columns']);
    assert.throws(() => deck([{ layout: 'bullets', title: 'Too many', bullets: Array(7).fill('x') }]), /Bullets must be an array with at most 6 items/);
    assert.throws(() => deck([{ layout: 'two-column', title: 'One', columns: [{ heading: 'A' }] }]), /Two-column slides require two columns/);
  });
  test('slides and documents keep a validated design system', () => {
    const a = deck([SLIDES.section], { designSystem: { name: 'Brand', headingFont: 'Inter', bodyFont: 'Source Serif 4' } });
    assert.equal(a.designSystem.headingFont, 'Inter');
    assert.throws(() => deck([SLIDES.section], { designSystem: { bodyFont: 'Comic Sans' } }), /supported local font/);
    assert.deepEqual(L.officeFonts(a), { heading: 'Segoe UI', body: 'Georgia' });
    assert.deepEqual(L.officeFonts(deck([SLIDES.section])), { heading: 'Arial', body: 'Arial' });
  });
  test('the demonstration deck exercises v2 layouts around the table slide', () => {
    const a = S.artifact(demo('slides'));
    assert.deepEqual(a.slides.map((s) => s.layout), ['cover', 'cards', 'table', 'timeline']);
    assert.deepEqual(warnings(a, []), []);
  });
});

describe('shared geometry', () => {
  test('every part of every layout stays on the slide, below the title', () => {
    const a = all(), numbers = L.sectionNumbers(a.slides);
    assert.deepEqual(numbers, [1, 0, 0, 0, 0, 0, 0, 0]);
    for (const [i, s] of a.slides.entries()) {
      const g = L.slideGeometry(s, { section: numbers[i] });
      assert.ok(g.parts.length, s.layout);
      assert.equal(g.dense, false, `${s.layout} fits`);
      for (const p of g.parts) {
        assert.ok(p.x >= 0.6 && p.y >= 1 && p.x + p.w <= 12.65 && p.y + p.h <= 6.7, `${s.layout} ${p.role} inside the slide`);
        if (!p.decorative && p.role !== 'quote-mark') assert.ok(p.y >= g.title.y + g.title.h - 0.01, `${s.layout} ${p.role} below the title`);
      }
    }
  });
  test('the palette picks readable text for accent fills and flags dense slides', () => {
    assert.equal(L.onFill('#4f46e5'), '#ffffff');
    assert.equal(L.onFill('#f5c400'), L.NEAR_BLACK);
    const P = L.slidePalette({ theme: THEME });
    assert.equal(P.chart.length, 6);
    assert.equal(P.chart[0], THEME.accent);
    const long = (n) => Array.from({ length: n }, (_, k) => ({ title: `Card ${k} `.padEnd(60, 'x'), body: 'word '.repeat(44) }));
    const dense = deck([{ layout: 'cards', title: 'Dense', subtitle: 'A subtitle that takes space', body: 'word '.repeat(40), cards: long(4) }]);
    assert.equal(L.slideGeometry(dense.slides[0]).dense, true);
    assert.deepEqual(warnings(dense, []), ['Slide 1 has dense content; inspect the native export.']);
  });
});

describe('HTML preview', () => {
  test('renders every layout from the shared geometry', () => {
    const html = pageHTML(all());
    for (const layout of L.V2_LAYOUTS) assert.match(html, new RegExp(`<section class="slide ${layout} v2">`));
    for (const text of ['Where we are today', 'I never know whether my request', 'USD 6,000', 'Confirm owners', 'WEEK 1', 'Leadership', 'Decisions', 'Example data supplied in the brief.', 'Requests per service']) assert.ok(html.includes(text), text);
    assert.match(html, /<figure class="part chart"[^>]*><svg[^>]*role="img"/);
    assert.match(html, /<div class="part icon" aria-hidden="true"[^>]*><svg/);
    assert.match(html, />03<\/div>/, 'a card without a known icon shows its number');
    assert.match(html, /--chart-1:#4f46e5/);
    assert.match(html, /\.slide\.section\{background:#4f46e5;color:#ffffff\}/);
    assert.match(html, />01<\/div>/, 'section number');
  });
  test('tables show only on table slides, like the PowerPoint export', () => {
    const a = deck([{ layout: 'bullets', title: 'Stray table', bullets: ['One'], table: { headers: ['A'], rows: [['1']] } }]);
    assert.doesNotMatch(pageHTML(a), /<table>/);
    assert.deepEqual(warnings(a, []), ['Slide 1 has a table that only the table layout shows; change its layout to table to include it.']);
    assert.match(pageHTML(deck([{ layout: 'table', title: 'Table', table: { headers: ['A'], rows: [['1']] } }])), /<table>/);
  });
  test('header cells on a light accent use near-black text', () => {
    const a = S.artifact({ kind: 'document', title: 'Doc', theme: { accent: '#f5c400' }, blocks: [{ type: 'table', table: { headers: ['A'], rows: [['1']] } }] });
    assert.match(pageHTML(a), /th\{background:#f5c400;color:#111111\}/);
  });
});

describe('PowerPoint export', () => {
  let zip, xml;
  before(async () => {
    zip = await JSZip.loadAsync(await exportPPTX(all()));
    xml = await Promise.all(Array.from({ length: 8 }, (_, i) => zip.file(`ppt/slides/slide${i + 1}.xml`).async('string')));
  });
  test('writes native text and shapes for every layout', () => {
    const expect = [['Where we are today', 'Baseline from the service review', '>01<'], ['I never know whether my request', 'Survey respondent'], ['42%', 'USD 6,000', 'Faster first response', 'Median time to first reply.'], ['WEEK 1', 'Confirm owners', 'Each team nominates an owner.', '<a:prstGeom prst="ellipse">'], ['Employees', 'Consistent intake.', '<a:prstGeom prst="roundRect">'], ['Time away drives most demand.', 'Requests per service'], ['Context', 'Decisions', '>05<']];
    expect.forEach((texts, i) => { for (const t of texts) assert.ok(xml[i].includes(t), `slide ${i + 1}: ${t}`); });
    assert.match(xml[0], /<p:bg><p:bgPr><a:solidFill><a:srgbClr val="4F46E5"/i, 'section slides fill the accent');
    assert.match(xml[0], /SERVICE DESK MODERNISATION/);
    assert.match(xml[1], /typeface="Georgia"/, 'quote mark');
    assert.match(xml[2], /typeface="Arial"/);
  });
  test('card icons are native, round-capped custom geometry', () => {
    assert.match(xml[4], /name="Icon users"/);
    assert.match(xml[4], /<a:custGeom>[\s\S]*?<a:cubicBezTo>/);
    assert.match(xml[4], /<a:ln w="\d+" cap="rnd">[\s\S]*?<a:round\/><\/a:ln>/);
    const { strokes, dots } = iconShapes('calendar-days');
    assert.ok(strokes.some((o) => o.t === 'C'), 'rounded rect corners become curves');
    assert.equal(dots.length, 6, 'zero-length subpaths become dots');
  });
  test('chart slides embed editable native charts with theme colours', async () => {
    const charts = Object.keys(zip.files).filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n));
    assert.equal(charts.length, 2);
    const bar = await zip.file(charts[0]).async('string'), donut = await zip.file(charts[1]).async('string');
    assert.match(bar, /<c:barChart>/);
    assert.match(bar, /<c:barDir val="col"\/>/);
    for (const t of ['Time away', 'Equipment &amp; tools', 'Requests', '<c:v>42</c:v>', '4F46E5']) assert.ok(bar.includes(t), t);
    assert.match(bar, /<c:max val="50"\/>/, 'value axis matches the preview scale');
    assert.match(donut, /<c:doughnutChart>/);
    assert.ok(Object.keys(zip.files).some((n) => /^ppt\/embeddings\/.*\.xlsx$/.test(n)), 'chart data workbook for editing');
    assert.match(xml[5], /<c:chart [^>]*r:id=/);
  });
  test('uses design-system office fonts and readable header text', async () => {
    const a = deck([SLIDES.stats, { layout: 'table', title: 'Table', table: { headers: ['Option'], rows: [['A']] } }], { designSystem: { name: 'Brand', headingFont: 'Inter', bodyFont: 'IBM Plex Sans' }, theme: { accent: '#f5c400', background: '#ffffff', text: '#1f2333' } });
    const z = await JSZip.loadAsync(await exportPPTX(a));
    const one = await z.file('ppt/slides/slide1.xml').async('string'), two = await z.file('ppt/slides/slide2.xml').async('string');
    assert.match(one, /typeface="Segoe UI"/);
    assert.match(one, /typeface="Arial"/, 'IBM Plex Sans maps to its office font');
    assert.match(two, /<a:srgbClr val="111111"\/><\/a:solidFill>(?:(?!<\/a:r>)[\s\S])*?<a:t>Option<\/a:t>/, 'near-black header text on a light accent');
  });
  test('number formats carry the chart unit', () => {
    const f = (unit, values = [1, 2]) => numberFormat({ unit, series: [{ values }] });
    assert.equal(f(''), '#,##0');
    assert.equal(f('%', [1.5, 2]), '#,##0.0"%"');
    assert.equal(f('$'), '"$"#,##0');
    assert.equal(f('kg'), '#,##0" kg"');
    assert.equal(f('a"b'), '#,##0" ab"');
  });
});

describe('Word export', () => {
  test('defines Caption, keeps line breaks and checks header contrast', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const a = S.artifact({ kind: 'document', title: 'Record', theme: { accent: '#f5c400' }, designSystem: { name: 'Brand', bodyFont: 'Source Serif 4' }, blocks: [{ type: 'paragraph', text: 'First line\nSecond line' }, { type: 'image', imageIndex: 0, text: 'Figure 1. Sample' }, { type: 'table', table: { headers: ['Owner'], rows: [['Asha\nDeputy: Ben']] } }] });
    const zip = await JSZip.loadAsync(await exportDOCX(a, [{ name: 'pixel.png', data: png }]));
    const styles = await zip.file('word/styles.xml').async('string'), doc = await zip.file('word/document.xml').async('string');
    assert.match(styles, /w:styleId="Caption"/);
    assert.match(styles, /w:ascii="Georgia"/);
    assert.match(doc, /<w:pStyle w:val="Caption"\/>[\s\S]*?Figure 1\. Sample/);
    assert.match(doc, /First line<\/w:t><\/w:r><w:r>(?:<w:rPr>[\s\S]*?<\/w:rPr>)?<w:br\/><w:t xml:space="preserve">Second line/);
    assert.match(doc, /<w:br\/><w:t xml:space="preserve">Deputy: Ben/);
    assert.match(doc, /<w:color w:val="111111"\/>[\s\S]*?Owner/);
  });
});

// Real layout in Chromium (skipped without a browser): no clipping, no title overlap, no overflowing part.
describe('preview layout in Chromium', () => {
  let browser, page, reason = '';
  before(async () => {
    try {
      browser = await require('playwright').chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}), args: ['--disable-dev-shm-usage'] });
      page = await browser.newPage({ viewport: { width: 1240, height: 800 } });
    } catch (e) { reason = 'Chromium unavailable: ' + e.message.split('\n')[0]; browser = null; }
  });
  after(async () => { await browser?.close(); });
  test('every v2 layout fits its boxes', async (t) => {
    if (!browser) return t.skip(reason);
    for (const a of [all(), all({ theme: { accent: '#f5c400', background: '#111318', text: '#f2f2f2' } }), S.artifact(demo('slides'))]) {
      await page.setContent(pageHTML(a));
      const results = await page.$$eval('.slide', (slides) => slides.map((el) => {
        const c = el.querySelector('.slide-content'), h = el.querySelector('h1');
        return {
          clip: c.scrollHeight > c.clientHeight + 2,
          overlap: h.getBoundingClientRect().bottom > c.getBoundingClientRect().top,
          parts: [...el.querySelectorAll('.part.text')].filter((p) => p.scrollHeight > p.clientHeight + 2 || p.scrollWidth > p.clientWidth + 2).map((p) => p.className),
        };
      }));
      results.forEach((r, i) => assert.deepEqual(r, { clip: false, overlap: false, parts: [] }, `${a.slides[i].layout} slide ${i + 1}`));
    }
  });
});
