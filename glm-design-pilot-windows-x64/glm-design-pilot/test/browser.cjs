'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { start, stop, freePort, root } = require('./helpers.cjs');
const { artifact } = require('../lib/schema.cjs');
const { pageHTML } = require('../lib/presentation.cjs');
const { demo } = require('../lib/demo.cjs');
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'design-browser-test-'));
  const results = process.env.TEST_RESULTS_DIR || path.join(root, 'test-results');
  await fs.mkdir(results, { recursive: true });
  let renderer, app, browser;
  try {
    const renderPort = await freePort();
    renderer = await start('renderer.cjs', {
      RENDER_TOKEN: 'test-render-token-12345',
      RENDER_PORT: String(renderPort),
      RENDER_HOST: '127.0.0.1',
    });
    app = await start('server.cjs', {
      APP_PASSWORD: 'test-pilot-password',
      MODEL_MODE: 'demo',
      DATA_DIR: dir,
      RENDER_URL: renderer.url,
      RENDER_TOKEN: 'test-render-token-12345',
      HOST: '127.0.0.1',
    });
    browser = await chromium.launch({
      headless: true,
      ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => {
      errors.push(e.message);
      console.error('Browser exception:', e.message);
    });
    page.on('console', (m) => {
      if (m.type() === 'error') console.error('Browser console:', m.text());
    });
    // Exercise the sanitized output in a real mobile browser: the CSS depends
    // on semantic tags and data-label surviving validation and export.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setContent(pageHTML(artifact({
      kind: 'web', title: 'Metadata regression',
      html: '<html><head><title>Do not show this metadata</title></head><body><main>' +
        '<dl class="meta"><dt>Owner</dt><dd>IT Operations</dd></dl>' +
        '<table><tr><td data-label="Owner">Asha</td></tr></table></main></body></html>',
      css: 'body{margin:0}.meta{display:grid;grid-template-columns:1fr 1fr}' +
        '@media(max-width:600px){td::before{content:attr(data-label);margin-right:12px}}',
    })));
    assert.equal(await page.locator('.meta dt').textContent(), 'Owner');
    assert.equal(await page.locator('td').evaluate(el => getComputedStyle(el, '::before').content), '"Owner"');
    assert.doesNotMatch(await page.locator('body').innerText(), /Do not show this metadata/);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    // Exercise the actual renderer, including diagnostics outside the desktop view.
    const unlabeled = artifact({kind:'web',title:'Mobile regression fixture',
      html:'<main><table><thead><tr><th>Owner</th></tr></thead><tbody><tr><td>Asha</td></tr></tbody></table></main>',
      css:'body{margin:0}@media(max-width:600px){thead{display:none}table{width:600px}td::before{content:attr(data-label)}}'});
    const probeResponse = await fetch(renderer.url + '/render', { method:'POST', headers:{'Content-Type':'application/json',Authorization:'Bearer test-render-token-12345'}, body:JSON.stringify({html:pageHTML(unlabeled)}) });
    assert.equal(probeResponse.status,200);
    const probe = await probeResponse.json();
    assert.equal(probe.metrics.horizontalOverflow,false);
    assert.equal(probe.metrics.mobileHorizontalOverflow,true);
    assert.equal(probe.metrics.mobileMissingLabels,1);
    assert.equal(probe.screenshots.length,3);
    assert.equal(Buffer.from(probe.screenshots[1],'base64').readUInt32BE(16),768);
    assert.equal(Buffer.from(probe.screenshots[2],'base64').readUInt32BE(16),390);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const deck = artifact(demo('slides'));
    deck.theme = {accent:'#275DAD',background:'#ffffff',text:'#202333'};
    deck.slides[2].body = 'Each workstream has a defined deliverable and an owner to confirm.';
    deck.slides[2].bullets = ['Dates and service commitments remain unspecified.'];
    await page.setContent(pageHTML(deck));
    for (const [index, slide] of (await page.locator('.slide').all()).entries()) {
      assert(await slide.locator('.slide-content').evaluate(el => el.scrollHeight <= el.clientHeight + 2), `Slide ${index + 1} content clips`);
      const heading = await slide.locator('h1').boundingBox();
      const content = await slide.locator('.slide-content').boundingBox();
      assert(heading.y + heading.height <= content.y, `Slide ${index + 1} heading overlaps content`);
      await slide.screenshot({path:path.join(results,`quality-slide-${index + 1}.png`)});
    }
    await page.setViewportSize({width:390,height:844});
    await page.setContent(pageHTML(artifact(demo('document'))));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({path:path.join(results,'quality-document-mobile.png'),fullPage:true});
    await page.setViewportSize({width:1440,height:1000});
    await page.goto(app.url);
    await page.getByLabel('Pilot password').fill('test-pilot-password');
    await page.getByRole('button', { name: /Open workspace/ }).click();
    await page.locator('#library').waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(results, '01-library.png'), fullPage: true });
    const jsonExport = path.join(results, 'round-trip-document.json');
    for (const kind of ['web', 'slides', 'document']) {
      await page.locator('#new-project').click();
      await page.locator('#create-kind').selectOption(kind);
      await page.locator('#create-title').fill('Browser test ' + kind);
      await page.getByRole('button', { name: /Create project/ }).click();
      await page.locator('#workspace').waitFor({ state: 'visible' });
      await page
        .locator('#prompt')
        .fill(
          'Make an employee services ' +
            kind +
            ' with clear navigation, specific content, and a restrained visual style.',
        );
      await page.locator('#generate-button').click();
      await page.locator('#preview-panel').waitFor({ state: 'visible', timeout: 90000 });
      await page.screenshot({ path: path.join(results, `02-${kind}.png`), fullPage: true });
      if (kind === 'web') {
        // Chromium/Playwright hit testing inside transformed opaque-origin frames
        // reports unscaled points. Exercise the interaction flow at actual size;
        // fit-mode navigation is also checked in the interactive browser.
        await page.locator('#canvas-zoom').selectOption('1');
        const frame = page.frameLocator('#preview-frame');
        await frame.getByRole('button', { name: 'View leave details' }).click();
        await frame.locator('#leave').waitFor({ state: 'visible', timeout: 5000 });
        await frame.getByLabel('Search requests').fill('monitor');
        assert.equal(await frame.locator('#requests tr:visible').count(), 1);
        await frame.getByRole('button', { name: /Create a request/ }).click();
        await frame.getByPlaceholder('Describe your request').fill('Test request');
        await frame.getByRole('button', { name: 'Save example request' }).click();
        assert.match(await frame.locator('form [role="status"]').textContent(), /No request has been sent/);
        await frame.getByRole('button', { name: 'Close', exact: true }).click();
        await page.locator('#mobile-view').click();
        await page.waitForFunction(
          () =>
            Math.abs(document.getElementById('preview-frame').getBoundingClientRect().width - 390) <
            2,
        );
        await page.screenshot({ path: path.join(results, '03-mobile.png'), fullPage: true });
        await page.locator('#desktop-view').click();
        await page.getByRole('button',{name:'Checks',exact:true}).click();
        await page.getByRole('heading',{name:'Model quality review',exact:true}).waitFor();
        assert.match(await page.locator('#checks-panel').innerText(),/mobile top\/bottom/);
        await page.getByRole('button',{name:'Preview',exact:true}).click();
      }
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      await page.locator('[data-field="title"]').fill('Edited ' + kind);
      await page.locator('#save-edit').click();
      await page
        .locator('#project-title')
        .filter({ hasText: 'Edited ' + kind })
        .waitFor();
      await page
        .locator('#export-format')
        .selectOption(kind === 'web' ? 'html' : kind === 'slides' ? 'pptx' : 'docx');
      const download = page.waitForEvent('download');
      await page.locator('#export-button').click();
      const file = await download;
      await file.saveAs(
        path.join(
          results,
          kind + '.' + (kind === 'web' ? 'html' : kind === 'slides' ? 'pptx' : 'docx'),
        ),
      );
      assert.equal(await file.failure(), null);
      if (kind === 'document') {
        await page.locator('#export-format').selectOption('json');
        const jsonDownload = page.waitForEvent('download');
        await page.locator('#export-button').click();
        await (await jsonDownload).saveAs(jsonExport);
      }
      await page.locator('#evaluate-button').click();
      await page.locator('#baseline-minutes').fill('30');
      await page.locator('#work-minutes').fill('10');
      await page.locator('#cleanup-minutes').fill('5');
      await page.locator('#accepted').check();
      await page
        .locator('#evaluation-notes')
        .fill('Browser smoke test only; this is demo content.');
      await page.getByRole('button', { name: 'Save evaluation' }).click();
      await page.locator('#evaluate-dialog').waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'History', exact: true }).click();
      assert.equal(await page.locator('.history-item').count(), 2);
      await page.locator('#nav-projects').click();
    }
    let modelRequests = 0;
    page.on('request', request => {
      if (/\/generate$|\/model\/test$/.test(request.url())) modelRequests++;
    });
    await page.locator('#import-project').click();
    await page.locator('#import-file').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{bad')});
    await page.locator('#import-submit').click();
    await page.locator('#import-error').filter({hasText:'not valid JSON'}).waitFor();
    assert.equal(await page.locator('#import-dialog').evaluate(el=>el.open),true);
    await page.locator('#import-file').setInputFiles(jsonExport);
    await page.locator('#import-brief').fill('Keep the source content. Imported fixture for workflow testing.');
    await page.screenshot({path:path.join(results,'05-import-dialog.png'),fullPage:true});
    await page.locator('#import-submit').click();
    await page.locator('#import-dialog').waitFor({state:'hidden'});
    await page.locator('#project-kind').filter({hasText:'Imported · no model'}).waitFor();
    await page.frameLocator('#preview-frame').getByRole('heading',{name:'Edited document',exact:true}).waitFor();
    assert.match(await page.locator('#chat-history').innerText(),/IMPORTED ARTIFACT/);
    await page.getByRole('button',{name:'Edit',exact:true}).click();
    await page.locator('[data-field="title"]').fill('Offline document');
    await page.locator('#save-edit').click();
    await page.locator('#project-title').filter({hasText:'Offline document'}).waitFor();
    assert.match(await page.locator('#project-kind').innerText(),/Imported · no model/i);
    await page.screenshot({path:path.join(results,'06-import-workspace.png'),fullPage:true});
    await page.locator('#export-format').selectOption('docx');
    const importedDownload = page.waitForEvent('download');
    await page.locator('#export-button').click();
    const importedFile = await importedDownload;
    await importedFile.saveAs(path.join(results,'imported-document.docx'));
    assert.equal(await importedFile.failure(),null);
    await page.getByRole('button',{name:'History',exact:true}).click();
    assert.equal(await page.locator('.history-item').count(),2);
    await page.locator('[data-restore]').last().click();
    await page.locator('#project-title').filter({hasText:'Edited document'}).waitFor();
    await page.getByRole('button',{name:'Checks',exact:true}).click();
    assert.match(await page.locator('#checks-panel').innerText(),/0\s+Model calls/);
    await page.screenshot({path:path.join(results,'07-import-checks.png'),fullPage:true});
    await page.locator('#evaluate-button').click();
    await page.locator('#baseline-minutes').fill('20');
    await page.locator('#work-minutes').fill('5');
    await page.locator('#accepted').check();
    await page.getByRole('button',{name:'Save evaluation'}).click();
    await page.locator('#evaluate-dialog').waitFor({state:'hidden'});
    assert.equal(modelRequests,0);
    await page.locator('#nav-evaluation').click();
    await page.locator('#evaluation').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#evaluation-rows tr').count(), 4);
    assert.equal(await page.locator('#evaluation-rows tr').filter({hasText:'import'}).count(),1);
    assert.match(
      await page.locator('#evaluation-summary').textContent(),
      /0 of 0 GLM revisions accepted/,
    );
    await page.screenshot({ path: path.join(results, '04-evaluation.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log(
      'Browser smoke passed: login, all formats, web interactions, responsive preview, manual edits, downloads, revisions, JSON round-trip import, and demo/import-separated evaluations.',
    );
    console.log('Screenshots:', results);
  } finally {
    await browser?.close();
    await stop(app);
    await stop(renderer);
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
