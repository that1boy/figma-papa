'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { start, stop, freePort, root } = require('./helpers.cjs');
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
    await page.goto(app.url);
    await page.getByLabel('Pilot password').fill('test-pilot-password');
    await page.getByRole('button', { name: /Open workspace/ }).click();
    await page.locator('#library').waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(results, '01-library.png'), fullPage: true });
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
        const frame = page.frameLocator('#preview-frame');
        await frame.getByRole('button', { name: 'View leave details' }).click();
        await frame.locator('#leave').waitFor({ state: 'visible', timeout: 5000 });
        await frame.getByLabel('Search requests').fill('monitor');
        assert.equal(await frame.locator('#requests tr:visible').count(), 1);
        await frame.getByRole('button', { name: /Create a request/ }).click();
        await frame.getByPlaceholder('Describe your request').fill('Test request');
        await frame.getByRole('button', { name: 'Save example request' }).click();
        assert.match(await frame.getByRole('status').textContent(), /No request has been sent/);
        await frame.getByRole('button', { name: 'Close', exact: true }).click();
        await page.locator('#mobile-view').click();
        await page.waitForFunction(
          () =>
            Math.abs(document.getElementById('preview-frame').getBoundingClientRect().width - 390) <
            2,
        );
        await page.screenshot({ path: path.join(results, '03-mobile.png'), fullPage: true });
        await page.locator('#desktop-view').click();
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
    await page.locator('#nav-evaluation').click();
    await page.locator('#evaluation').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#evaluation-rows tr').count(), 3);
    assert.match(
      await page.locator('#evaluation-summary').textContent(),
      /0 of 0 GLM revisions accepted/,
    );
    await page.screenshot({ path: path.join(results, '04-evaluation.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log(
      'Browser smoke passed: login, all formats, web interactions, responsive preview, manual edits, downloads, revisions, and demo-separated evaluations.',
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
