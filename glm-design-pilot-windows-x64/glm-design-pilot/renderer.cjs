'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const { chromium } = require('playwright');
const { body, send } = require('./lib/http.cjs');
const token = process.env.RENDER_TOKEN;
if (!token || token.length < 16)
  throw new Error('RENDER_TOKEN must contain at least 16 characters.');
let active = 0;
async function browserRender(payload) {
  if (typeof payload.html !== 'string' || payload.html.length > 9000000)
    throw new Error('Invalid HTML render request.');
  // This worker renders only application-sanitized markup. It never loads external sites.
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
    args: ['--disable-dev-shm-usage'],
  });
  let timer;
  try {
    timer = setTimeout(() => browser.close().catch(() => {}), 45000);
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      serviceWorkers: 'block',
      acceptDownloads: false,
    });
    await context.route('**/*', (r) => r.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
    await page.setContent(payload.html, { waitUntil: 'load', timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);
    const metrics = await page.evaluate(() => ({
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 2,
      height: document.documentElement.scrollHeight,
    }));
    const png = await page.screenshot({ fullPage: false });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', right: '14mm', bottom: '14mm', left: '14mm' },
    });
    return {
      screenshots: [png.toString('base64')],
      pdf: pdf.toString('base64'),
      pageCount: 1,
      basis: 'browser preview; first viewport inspected',
      metrics: { ...metrics, errors },
    };
  } finally {
    clearTimeout(timer);
    await browser.close();
  }
}
async function officeRender(payload) {
  if (
    !['pptx', 'docx'].includes(payload.extension) ||
    typeof payload.file !== 'string' ||
    payload.file.length > 14000000
  )
    throw new Error('Invalid Office render request.');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'design-render-'));
  try {
    const input = path.join(dir, `artifact.${payload.extension}`);
    await fs.writeFile(input, Buffer.from(payload.file, 'base64'));
    const lo = process.env.LIBREOFFICE_PATH || 'soffice';
    await exec(
      lo,
      [
        `-env:UserInstallation=${pathToFileURL(path.join(dir, 'profile')).href}`,
        '--headless',
        '--convert-to',
        'pdf',
        '--outdir',
        dir,
        input,
      ],
      { timeout: 60000, maxBuffer: 1000000, windowsHide: true },
    );
    const pdf = await fs.readFile(path.join(dir, 'artifact.pdf'));
    const info = await exec(
      process.env.PDFINFO_PATH || 'pdfinfo',
      [path.join(dir, 'artifact.pdf')],
      { timeout: 10000, windowsHide: true },
    );
    const pageCount = Number(info.stdout.match(/Pages:\s+(\d+)/)?.[1]);
    if (!pageCount) throw new Error('Could not determine exported page count.');
    await exec(
      process.env.PDFTOPPM_PATH || 'pdftoppm',
      [
        '-png',
        '-scale-to',
        '1400',
        '-f',
        '1',
        '-l',
        '16',
        path.join(dir, 'artifact.pdf'),
        path.join(dir, 'page'),
      ],
      { timeout: 60000, maxBuffer: 1000000, windowsHide: true },
    );
    const files = (await fs.readdir(dir))
      .filter((n) => /^page-\d+\.png$/.test(n))
      .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
    const screenshots = await Promise.all(
      files.map(async (n) => (await fs.readFile(path.join(dir, n))).toString('base64')),
    );
    return {
      pdf: pdf.toString('base64'),
      screenshots,
      pageCount,
      basis: 'native Office export rendered by LibreOffice',
      metrics: { renderedPages: screenshots.length, truncated: pageCount > screenshots.length },
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
const server = http.createServer(async (req, res) => {
  if (req.url === '/healthz' && req.method === 'GET') return send(res, 200, { ok: true });
  if (req.headers.authorization !== `Bearer ${token}`)
    return send(res, 401, { error: 'Unauthorized' });
  if (req.method !== 'POST' || !['/render', '/office'].includes(req.url))
    return send(res, 404, { error: 'Not found' });
  if (active >= 2) return send(res, 429, { error: 'Renderer is busy; try again.' });
  active++;
  try {
    const input = await body(req, 15000000);
    send(res, 200, await (req.url === '/office' ? officeRender(input) : browserRender(input)));
  } catch (e) {
    console.error('Render failed:', e.code || e.name);
    send(res, 503, {
      error:
        req.url === '/office'
          ? 'Native Office rendering failed. Verify LibreOffice and Poppler in the renderer image.'
          : 'Browser rendering failed. Verify the Playwright browser installation.',
    });
  } finally {
    active--;
  }
});
server.requestTimeout = 170000;
server.listen(Number(process.env.RENDER_PORT || 8081), process.env.RENDER_HOST || '0.0.0.0', () =>
  console.log('Renderer listening on ' + (process.env.RENDER_PORT || 8081)),
);
