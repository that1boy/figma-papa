'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const S = require('../lib/schema.cjs');
const { demo } = require('../lib/demo.cjs');
const { pageHTML } = require('../lib/presentation.cjs');
const { exportPPTX, exportDOCX } = require('../lib/exports.cjs');
const { parseJSON, configFromEnv } = require('../lib/model.cjs');
test('all demonstration artifacts conform to the supported schema', () => {
  for (const k of S.KINDS) {
    const a = S.artifact(demo(k), k);
    assert.equal(a.kind, k);
    assert.match(pageHTML(a), /Content-Security-Policy/);
    if (k === 'web') {
      assert.match(a.html, /<p id="leave" hidden/);
      assert.match(a.html, /<tr data-row/);
    }
  }
});
test('web sanitization blocks executable markup and network resources', () => {
  const html = S.safeHTML(
    '<script>fetch("http://internal")</script><img src="http://internal/x" onerror="alert(1)"><iframe src="http://internal"></iframe><a href="javascript:alert(1)">x</a><form action="https://external"><input formaction="https://external"></form><style>@import "http://external";</style>',
  );
  assert.doesNotMatch(html, /script|iframe|onerror|formaction|https?:|javascript|@import/i);
  assert.match(html, /<form>/);
  for (const css of [
    'a{background:url(https://x)}',
    '@import "x";',
    'a{background:u\\72l(x)}',
    'a{/*hidden*/color:red}',
    '</style><script>alert(1)</script>',
  ])
    assert.throws(() => S.safeCSS(css));
  assert.equal(S.safeCSS('main > p { color: red }'), 'main > p { color: red }');
});
test('schema refuses malformed content rather than silently making a demo', () => {
  assert.throws(() => S.artifact({ ...demo('slides'), slides: [] }, 'slides'));
  assert.throws(() => S.artifact(demo('web'), 'document'));
  assert.throws(() => S.artifact({ ...demo('web'), theme: { accent: 'red; color:black' } }));
  assert.throws(() => S.references([{ name: 'fake.png', data: 'data:image/png;base64,AAAA' }]));
  assert.throws(() => parseJSON('Here is some prose'));
  assert.deepEqual(parseJSON('```json\n{"ok":true}\n```'), { ok: true });
});
test('model configuration cannot override messages or disable destination validation', () => {
  assert.throws(() => configFromEnv({ MODEL_MODE: 'glm', GLM_BASE_URL: 'file:///secrets' }));
  assert.throws(() =>
    configFromEnv({
      MODEL_MODE: 'glm',
      GLM_BASE_URL: 'http://model/v1',
      GLM_EXTRA_BODY: '{"messages":[]}',
    }),
  );
  assert.equal(
    configFromEnv({ MODEL_MODE: 'glm', GLM_BASE_URL: 'http://model/v1' }).model,
    'glm-5.3-flash',
  );
});
test('PowerPoint export contains native editable text, table, and speaker notes', async () => {
  const a = S.artifact(demo('slides'));
  const zip = await JSZip.loadAsync(await exportPPTX(a));
  const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  assert.equal(slides.length, 4);
  const third = await zip.file('ppt/slides/slide3.xml').async('string');
  assert.match(third, /<a:tbl>/);
  assert.match(third, /Workplace technology/);
  const first = await zip.file('ppt/slides/slide1.xml').async('string');
  assert.match(first, /A better employee service experience/);
  assert.ok(Object.keys(zip.files).some((n) => n.startsWith('ppt/notesSlides/notesSlide')));
});
test('Word export contains editable paragraphs and native tables', async () => {
  const a = S.artifact(demo('document'));
  a.blocks[0].text = 'Updated and editable proposal.';
  const zip = await JSZip.loadAsync(await exportDOCX(a));
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /Updated and editable proposal/);
  assert.match(xml, /<w:tbl>/);
  assert.match(xml, /Evaluation/);
});
