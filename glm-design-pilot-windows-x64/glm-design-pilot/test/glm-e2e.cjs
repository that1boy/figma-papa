'use strict';
// GLM-mode end-to-end flow: the real server and renderer in MODEL_MODE=glm
// against the scripted GLM mock (test/fixtures/glm-mock.cjs), driven through the
// browser UI with Playwright. Covers create (preset, PNG reference, DOCX
// source) → staged generation with review and live progress → checks → three
// directions → design-mode GLM element edit → live tweaks → changed-screens
// revision → HTML/ZIP/JSON exports → a document project with DOCX export.
// Screenshots go to TEST_RESULTS_DIR (default test-results/glm-e2e).
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const JSZip = require('jszip');
const { Document, Packer, Paragraph, HeadingLevel } = require('docx');
const { start, stop, freePort, client, root } = require('./helpers.cjs');
const { startMock } = require('./fixtures/glm-mock.cjs');

const PASSWORD = 'test-pilot-password', TOKEN = 'glm-e2e-render-token';
const DOCX_NAME = 'service-desk-facts.docx';
const BRIEF = 'Design an IT service desk portal for support agents: an overview of open work and SLA risk, the request queue with search, and a request detail screen. Use the facts in the source document.';
const REVISION = 'On the Requests screen, add a warning callout above the table saying how many requests are breaching the first-response SLA. Keep every other screen unchanged.';

async function sourceDocx() {
  const p = (text) => new Paragraph(text);
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: 'Service desk facts: September', heading: HeadingLevel.HEADING_1 }),
        p('There are 48 open requests. 131 requests resolved in September. 3 requests are breaching SLA.'),
        p('SLA: agents send a first response within 8 business hours.'),
        p('Finance: 14 open. People: 9 open. Sales: 25 open.'),
        new Paragraph({ text: 'Requests', heading: HeadingLevel.HEADING_2 }),
        p('REQ-311 | VPN drops for remote staff | Sales | Rosa Nunez | Breaching SLA'),
        p('REQ-307 | Payroll export fails | Finance | Asha Kumar | Breaching SLA'),
        p('REQ-302 | Shared drive access for new team | People | Leo Martin | Breaching SLA'),
        p('REQ-305 | New laptop for starter | People | Leo Martin | Waiting'),
        p('REQ-298 | Invoice approval access | Finance | Asha Kumar | In progress'),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forma-glm-e2e-'));
  const results = process.env.TEST_RESULTS_DIR || path.join(root, 'test-results', 'glm-e2e');
  await fs.mkdir(results, { recursive: true });
  const shots = [];
  let mock, renderer, app, browser, page;
  const t0 = Date.now(), steps = [];
  const step = (name) => (steps.push({ name, s: Math.round((Date.now() - t0) / 1000) }), console.log(`[${steps.at(-1).s}s] ${name}`));
  try {
    mock = await startMock({ pace: Number(process.env.GLM_MOCK_PACE || 1) });
    renderer = await start('renderer.cjs', { RENDER_PORT: String(await freePort()), RENDER_HOST: '127.0.0.1', RENDER_TOKEN: TOKEN });
    app = await start('server.cjs', {
      APP_PASSWORD: PASSWORD, MODEL_MODE: 'glm', GLM_BASE_URL: mock.base, GLM_API_KEY: 'test-glm-key', GLM_MODEL: 'glm-5.3-flash',
      GLM_PARALLEL: '3', DATA_DIR: dir, HOST: '127.0.0.1', RENDER_URL: renderer.url, RENDER_TOKEN: TOKEN,
    });
    const api = await client(app.url, PASSWORD);
    browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
    // Wide enough that the 1280 px canvas at 100% fits without scrolling the canvas sideways.
    const context = await browser.newContext({ viewport: { width: 2000, height: 1100 }, acceptDownloads: true });
    page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && console.error('Browser console:', m.text()));
    const frame = page.frameLocator('#preview-frame');
    // The preview's runtime script follows the (large, font-inlining) page body: wait for it before clicking.
    const frameReady = () => frame.locator('body').evaluate(() => new Promise((r) => { const t = setInterval(() => typeof window.formaNavigate === 'function' && (clearInterval(t), r()), 25); }));
    let liveShots = 0;
    const shot = async (name) => { const file = path.join(results, name + '.png'); await page.screenshot({ path: file }); shots.push(file); };
    // Waits for the active job to start and finish while sampling the live label.
    async function runJob(timeout = 240000) {
      await page.locator('#job-status').waitFor({ state: 'visible', timeout: 20000 });
      const labels = [], end = Date.now() + timeout;
      let midShot = false;
      while (await page.locator('#job-status').isVisible()) {
        if (Date.now() > end) throw new Error('Job did not finish. Labels: ' + labels.join(' | '));
        const label = (await page.locator('#live-label').textContent().catch(() => '')) || '';
        if (label && labels.at(-1) !== label) labels.push(label);
        if (!midShot && /Built|Building/.test(label)) { midShot = true; await shot(`02-live-progress-${++liveShots}`); }
        await page.waitForTimeout(120);
      }
      return labels;
    }
    const download = async (format, name) => {
      await page.locator('#export-format').selectOption(format);
      const wait = page.waitForEvent('download');
      await page.locator('#export-button').click();
      const file = await wait;
      assert.equal(await file.failure(), null);
      const target = path.join(results, name);
      await file.saveAs(target);
      return fs.readFile(target);
    };
    const project = async () => (await api('/projects/' + pid)).data;
    const revisionOf = async (rid) => (await api(`/projects/${pid}/revisions/${rid}`)).data;
    let pid;

    // ---- reference image: a small rendered PNG ----
    // Its own context: a second page that resizes and screenshots inside the test context leaves
    // Chromium routing later clicks to the sandboxed (out-of-process) preview frame's parent.
    const pngContext = await browser.newContext();
    const pngPage = await pngContext.newPage();
    await pngPage.setViewportSize({ width: 480, height: 300 });
    await pngPage.setContent('<body style="margin:0;font:600 28px system-ui;background:#eef2ff;display:grid;place-items:center;height:100vh"><div style="background:#1d4ed8;color:#fff;padding:24px 32px;border-radius:14px">Queue · 48 open</div></body>');
    const png = await pngPage.screenshot();
    await pngContext.close();
    assert.equal(png.readUInt32BE(0), 0x89504e47);

    // ---- login and create ----
    step('login');
    await page.goto(app.url);
    await page.getByLabel('Pilot password').fill(PASSWORD);
    await page.getByRole('button', { name: /Open workspace/ }).click();
    await page.locator('#library').waitFor({ state: 'visible' });
    assert.match(await page.locator('#model-label').innerText(), /glm-5\.3-flash|GLM/i);
    step('create web project');
    await page.locator('#new-project').click();
    await page.locator('#create-title').fill('Service desk (GLM e2e)');
    await page.locator('.look-card[data-preset="fintech"]').click();
    await page.locator('#create-images').setInputFiles({ name: 'queue-reference.png', mimeType: 'image/png', buffer: png });
    await page.locator('#image-list .ref-thumb').waitFor();
    await page.locator('#create-sources').setInputFiles({ name: DOCX_NAME, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await sourceDocx() });
    await page.locator('#create-source-list li').waitFor();
    await shot('01-create-dialog');
    await page.locator('#create-submit').click();
    await page.locator('#workspace').waitFor({ state: 'visible' });
    await page.locator('#project-title').filter({ hasText: 'Service desk (GLM e2e)' }).waitFor();
    pid = (await api('/projects')).data[0].id;
    let p = await project();
    assert.equal(p.sources.length, 1);
    assert.equal(p.sources[0].kind, 'docx');
    assert.equal(p.references.length, 1);
    assert.match(await page.locator('#sources-count').innerText(), /1 doc · 1 image/);

    // ---- staged generation with review ----
    step('generate with review');
    await page.locator('#prompt').fill(BRIEF);
    assert.equal(await page.locator('#review-checkbox').isChecked(), true);
    assert.match(await page.locator('#generate-button').innerText(), /Generate/);
    await page.locator('#generate-button').click();
    const labels = await runJob();
    console.log('  live labels:', labels.join(' | '));
    assert(labels.length >= 3, 'the live progress label changes during generation: ' + labels.join(' | '));
    assert(labels.some((l) => /Planning/.test(l)), 'planning label shown');
    assert(labels.some((l) => /Build/.test(l)), 'build label shown');
    assert(labels.some((l) => /Render|Checking|correction/i.test(l)), 'render/review label shown');
    await page.locator('#preview-panel').waitFor({ state: 'visible' });
    p = await project();
    const generated = p.current;
    assert.equal(generated.origin, 'glm');
    assert.equal(generated.artifact.screens.length, 3);
    assert.deepEqual(generated.artifact.screens.map((s) => s.id), ['overview', 'requests', 'request-detail']);
    assert.equal(generated.artifact.designSystem.preset, 'fintech', 'the project preset seeds the design');
    assert(generated.metrics.review?.refined, 'review found an issue and one correction pass ran');
    assert.match(generated.artifact.screens[2].html, /SLA target/, 'the correction reached Request detail');
    assert.equal(generated.artifact.screens[0].html.includes('data-icon="layout-dashboard"'), true, 'stored HTML keeps compact icons');
    assert.deepEqual(generated.artifact.tweaks.map((t) => t.var), ['--sidebar-width', '--aside-width']);
    assert.equal(await page.locator('.screen-item').count(), 3);
    await page.locator('#canvas-zoom').selectOption('1');
    await frame.getByRole('heading', { name: 'Service overview' }).waitFor();
    await frameReady();
    assert((await frame.locator('[data-forma-expanded="icon"]').count()) > 5, 'icons expanded in the preview');
    assert.equal(await frame.locator('[data-forma-screen="overview"] i[data-icon]').count(), 0, 'no unexpanded icon hosts');
    await frame.locator('[data-forma-expanded="chart"] svg[role="img"]:visible').first().waitFor();
    assert.match(await frame.locator('[data-forma-expanded="chart"]').first().innerText(), /Finance|Sales/);
    // Real navigation in the prototype.
    await frame.getByRole('button', { name: 'Open the queue' }).click();
    await frame.getByRole('heading', { name: 'Requests', exact: true }).waitFor();
    await frame.getByRole('searchbox', { name: 'Search requests' }).fill('payroll');
    assert.equal(await frame.locator('#request-rows tr:visible').count(), 1);
    await frame.getByRole('button', { name: /REQ-307/ }).click();
    await frame.getByRole('heading', { name: /REQ-311/ }).waitFor();
    await page.locator('[data-screen="overview"]').click();
    await frame.getByRole('heading', { name: 'Service overview' }).waitFor();
    await shot('03-generated-preview');

    step('checks');
    await page.locator('[data-tab="checks"]').click();
    const score = Number(await page.locator('#lint-card .score strong').innerText());
    assert(Number.isInteger(score) && score >= 80, 'lint score shown: ' + score);
    const calls = await page.locator('#calls-card .calls-table tbody tr').allInnerTexts();
    const stages = calls.map((t) => t.split(/\s/)[0].toLowerCase());
    console.log('  lint score', score, 'calls', stages.join(','));
    for (const s of ['plan', 'build', 'review']) assert(stages.includes(s), `calls table lists ${s}`);
    assert(calls.length >= 6, 'plan, three builds, review and the correction call');
    assert.match(await page.locator('#checks-panel').innerText(), /Model quality review[\s\S]*SLA/);
    await shot('04-checks');
    await page.locator('[data-tab="preview"]').click();
    // What the model received.
    const sent = mock.requests;
    const planCall = sent.find((r) => r.stage === 'plan');
    assert.match(planCall.text, new RegExp(`Source document "${DOCX_NAME}"`));
    assert.match(planCall.text, /REQ-307 \| Payroll export fails/);
    assert.equal(planCall.images, 1, 'the reference image reaches the plan call');
    assert.equal(planCall.stream, true);
    assert.equal(planCall.auth, 'bearer');
    const builds = sent.filter((r) => r.stage === 'build');
    assert.equal(builds.length, 3);
    assert.equal(builds[0].images, 1);
    assert(sent.some((r) => r.stage === 'review' && r.images > 1), 'screenshots reach the review');
    assert(sent.some((r) => r.stage === 'revise' && /Correct these review findings/.test(r.text)), 'correction pass is a changed-screens revision');

    // ---- directions ----
    step('three directions');
    await page.locator('[data-directions="3"]').click();
    assert.match(await page.locator('#generate-button').innerText(), /Explore 3/);
    await page.locator('#prompt').fill('Explore three directions for this service desk portal.');
    await page.locator('#generate-button').click();
    await runJob();
    await page.locator('#directions-strip .direction-card').nth(2).waitFor();
    assert.equal(await page.locator('#directions-strip .direction-card').count(), 3);
    const cardNames = await page.locator('#directions-strip .direction-info strong').allInnerTexts();
    assert.deepEqual(cardNames, ['Clear and calm', 'Bold and expressive', 'Dense and efficient']);
    await page.locator('#directions-strip .direction-card img').first().waitFor();
    await shot('05-directions');
    await page.locator('#directions-strip [data-direction-view]').nth(1).click();
    await page.locator('#directions-strip .direction-card.is-viewing').filter({ hasText: 'Bold and expressive' }).waitFor();
    await frame.getByText('Live queue', { exact: true }).waitFor();
    await frameReady();
    await shot('06-direction-viewing');
    const viewed = (await project()).revisions.find((r) => r.metrics?.direction?.name === 'Bold and expressive');
    await page.locator(`[data-direction-use="${viewed.id}"]`).click();
    await page.locator('#directions-strip .direction-card.is-current').filter({ hasText: 'Bold and expressive' }).waitFor();
    p = await project();
    assert.equal(p.current.origin, 'restore');
    assert.equal(p.current.parent_id, viewed.id);
    assert.equal(p.current.artifact.title, 'IT service desk · Bold and expressive');

    // ---- design mode: GLM element edit ----
    step('element edit');
    await page.locator('#canvas-zoom').selectOption('1');
    await frame.getByRole('heading', { name: 'Service overview' }).waitFor();
    await frameReady();
    await page.locator('#design-mode').click();
    await frame.getByRole('heading', { name: 'Service overview' }).click();
    await page.locator('#element-instruction').waitFor();
    assert.match(await page.locator('#design-inspector .inspector-title').innerText(), /h1/);
    await page.locator('#element-instruction').fill('Make this heading more specific and add a live status badge.');
    await page.locator('#element-edit-submit').click();
    await frame.locator('h1', { hasText: 'Service desk overview' }).waitFor();
    await frameReady();
    await page.locator('#draft-status').filter({ hasText: 'Unsaved changes' }).waitFor();
    assert.match(await page.locator('#element-edit-status').innerText(), /Applied/);
    const edit = mock.requests.filter((r) => r.stage === 'element').at(-1);
    assert.match(edit.text, /Selected element \(stored HTML\):\n<h1>Service overview<\/h1>/);
    await shot('07-element-edit');
    await page.locator('#studio-save').click();
    await page.locator('#draft-status').filter({ hasText: 'Saved revision' }).waitFor();
    p = await project();
    assert.equal(p.current.origin, 'manual');
    assert.match(p.current.prompt, /GLM element edit: Make this heading more specific/);
    assert.match(p.current.metrics.note, /^GLM element edit:/);
    assert.match(p.current.artifact.screens[0].html, /<h1>Service desk overview<span class="badge badge-success badge-dot ml-3 align-middle">Live<\/span><\/h1>/);
    const beforeEdit = await revisionOf(p.current.parent_id);
    for (const i of [1, 2]) assert.equal(p.current.artifact.screens[i].html, beforeEdit.artifact.screens[i].html, 'element edit leaves other screens alone');
    assert.match(await page.locator('#chat-history').innerText(), /GLM ELEMENT EDIT/);
    // The strip still knows which direction the saved edit builds on.
    await page.locator('#directions-strip .direction-card.is-current').filter({ hasText: 'Bold and expressive' }).waitFor();
    assert.equal(await page.locator('#directions-strip .direction-card.is-current [data-direction-use]').count(), 0);

    // ---- tweaks ----
    step('tweaks');
    await page.locator('#studio-tweaks').click();
    const slider = page.locator('[data-tweak="--aside-width"]');
    await slider.waitFor();
    await frame.locator('.overview-grid').waitFor();
    await frameReady();
    const asideWidth = () => frame.locator('.overview-grid > section').nth(1).evaluate((n) => Math.round(n.getBoundingClientRect().width));
    const cssVar = () => frame.locator('html').evaluate((n) => getComputedStyle(n).getPropertyValue('--aside-width').trim());
    assert.equal(await cssVar(), '340px');
    const widthBefore = await asideWidth();
    await slider.evaluate((n) => { n.value = '424'; n.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.locator(`output[for="${await slider.getAttribute('id')}"]`).filter({ hasText: '424px' }).waitFor();
    await frame.locator('html').evaluate((n) => new Promise((r) => { const t = setInterval(() => n.style.getPropertyValue('--aside-width') === '424px' && (clearInterval(t), r()), 30); }));
    assert.equal(await cssVar(), '424px', 'the CSS variable changes live in the iframe');
    const widthAfter = await asideWidth();
    assert(widthAfter > widthBefore + 60, `the side panel widens live (${widthBefore} → ${widthAfter})`);
    assert.match(await page.locator('#tweaks-status').innerText(), /Previewing unapplied/);
    await shot('08-tweaks-live');
    await page.locator('#tweaks-apply').click();
    await page.locator('#draft-status').filter({ hasText: 'Unsaved changes' }).waitFor();
    await page.locator('#studio-save').click();
    await page.locator('#draft-status').filter({ hasText: 'Saved revision' }).waitFor();
    p = await project();
    assert.equal(p.current.artifact.tweaks.find((t) => t.var === '--aside-width').value, 424);
    await frame.locator('.overview-grid').waitFor();
    assert.equal(await cssVar(), '424px', 'the applied tweak is part of the saved page');

    // ---- changed-screens revision ----
    step('revise');
    await page.locator('#interact-mode').click();
    const base = p.current;
    await page.locator('#prompt').fill(REVISION);
    await page.locator('#review-checkbox').uncheck();
    assert.match(await page.locator('#generate-button').innerText(), /Revise/);
    await page.locator('#generate-button').click();
    await runJob();
    p = await project();
    const revised = p.current;
    assert.equal(revised.parent_id, base.id);
    assert.deepEqual(revised.metrics.pipeline, { mode: 'revision', changed: ['requests'] });
    assert.equal(revised.artifact.css, base.artifact.css);
    for (const id of ['overview', 'request-detail']) {
      const a = base.artifact.screens.find((s) => s.id === id).html, b = revised.artifact.screens.find((s) => s.id === id).html;
      assert.equal(b, a, `${id} is byte-identical after the revision`);
    }
    assert.notEqual(revised.artifact.screens[1].html, base.artifact.screens[1].html);
    assert.match(revised.artifact.screens[1].html, /3 requests are breaching SLA/);
    assert.deepEqual(revised.artifact.tweaks, base.artifact.tweaks, 'tweaks survive a revision');
    assert.match(revised.artifact.screens[0].html, /Service desk overview/, 'the element edit survives a revision');
    await page.locator('[data-screen="requests"]').click();
    await frame.getByText('3 requests are breaching SLA').waitFor();
    await shot('09-revised');

    // ---- exports ----
    step('exports');
    const html = (await download('html', 'service-desk.html')).toString('utf8');
    assert.match(html, /^<!doctype html>/i);
    assert.match(html, /data-forma-expanded="chart"/);
    assert.match(html, /--aside-width:424px/);
    const zip = await JSZip.loadAsync(await download('zip', 'service-desk-handoff.zip'), { checkCRC32: true });
    for (const name of ['kit.css', 'tokens.json', 'styles.css', 'index.html']) assert(zip.file(name), `zip contains ${name}`);
    assert.equal(Object.keys(zip.files).filter((n) => /^screens\/.+\.html$/.test(n)).length, 3);
    const tokens = JSON.parse(await zip.file('tokens.json').async('string'));
    assert.equal(tokens.preset ?? tokens.designSystem?.preset, 'fintech');
    assert.match(await zip.file('kit.css').async('string'), /--accent:/);
    assert.equal(await zip.file('styles.css').async('string'), revised.artifact.css);
    const json = JSON.parse((await download('json', 'service-desk.json')).toString('utf8'));
    assert.equal(json.kind, 'web');
    assert.equal(json.screens.length, 3);

    // ---- document project through the mock ----
    step('document project');
    await page.locator('#nav-projects').click();
    await page.locator('#new-project').click();
    await page.locator('.format-choice').filter({ hasText: 'Document' }).click();
    assert.equal(await page.locator('#create-kind').inputValue(), 'document');
    await page.locator('#create-title').fill('Service desk summary (GLM e2e)');
    await page.locator('#create-sources').setInputFiles({ name: DOCX_NAME, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await sourceDocx() });
    await page.locator('#create-source-list li').waitFor();
    await page.locator('#create-submit').click();
    await page.locator('#project-title').filter({ hasText: 'Service desk summary' }).waitFor();
    pid = (await api('/projects')).data[0].id;
    await page.locator('#review-checkbox').check();
    await page.locator('#prompt').fill('Write a one-page summary of the service desk queue for IT operations leads, using the source document.');
    await page.locator('#generate-button').click();
    await runJob();
    await frame.getByRole('heading', { name: 'Service desk summary: September' }).waitFor();
    p = await project();
    assert.equal(p.current.artifact.kind, 'document');
    assert.equal(p.current.metrics.pipeline.mode, 'single');
    assert(mock.requests.some((r) => r.stage === 'document' && /Source document "/.test(r.text)));
    // Document previews use the canvas height instead of collapsing to the 500 px minimum.
    const [frameHeight, canvasHeight] = await page.evaluate(() => [document.querySelector('#preview-frame').getBoundingClientRect().height, document.querySelector('#canvas-center').clientHeight]);
    assert(frameHeight > canvasHeight * 0.8, `document preview fills the canvas (${Math.round(frameHeight)} of ${canvasHeight} px)`);
    await shot('10-document');
    const docx = await JSZip.loadAsync(await download('docx', 'service-desk-summary.docx'));
    const xml = await docx.file('word/document.xml').async('string');
    assert.match(xml, /Service desk summary: September/);
    assert.match(xml, /REQ-307 Payroll export fails/);

    assert.deepEqual(errors, []);
    const findings = (r) => (r.metrics.lint || []).filter((f) => f.severity !== 'info').map((f) => `${f.severity} ${f.rule} ${f.screen}/${f.viewport}: ${f.message}`);
    const lintNotes = { generated: findings(generated), revised: findings(revised) };
    console.log('  lint (non-info):', JSON.stringify(lintNotes));
    const counts = mock.requests.reduce((m, r) => ((m[r.stage] = (m[r.stage] || 0) + 1), m), {});
    await fs.writeFile(path.join(results, 'glm-e2e-summary.json'), JSON.stringify({ steps, labels, lintScore: score, lintNotes, calls: stages, mockRequests: counts, screenshots: shots }, null, 2));
    console.log('GLM e2e passed:', JSON.stringify(counts), `in ${Math.round((Date.now() - t0) / 1000)}s`);
    console.log('Evidence: ' + results);
  } catch (e) {
    await page?.screenshot({ path: path.join(results, 'failure.png'), fullPage: true }).catch(() => {});
    console.error('Server log tail:\n' + (app?.logs?.() || '').slice(-3000));
    throw e;
  } finally {
    await browser?.close();
    await stop(app);
    await stop(renderer);
    await mock?.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
