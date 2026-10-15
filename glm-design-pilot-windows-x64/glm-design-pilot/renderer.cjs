'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const { body, send } = require('./lib/http.cjs');
const token = process.env.RENDER_TOKEN;
if (!token || token.length < 16)
  throw new Error('RENDER_TOKEN must contain at least 16 characters.');
let active = 0;
const { browserRender } = require('./lib/browser-render.cjs');
async function officeRender(payload) {
  if (
    !['pptx', 'docx'].includes(payload.extension) ||
    typeof payload.file !== 'string' ||
    payload.file.length > 30000000
  )
    throw new Error('Invalid Office render request.');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'design-render-'));
  try {
    const input = path.join(dir, `artifact.${payload.extension}`);
    await fs.writeFile(input, Buffer.from(payload.file, 'base64'));
    const lo = process.env.LIBREOFFICE_PATH || 'soffice';
    let converterVersion = 'Version not reported';
    try { converterVersion = (await exec(lo, ['--version'], {timeout:10000,windowsHide:true,maxBuffer:10000})).stdout.trim().slice(0,160); } catch {}
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
      basis: 'Office export rendered by the configured converter: ' + converterVersion,
      metrics: { converterVersion, renderedPages: screenshots.length, truncated: pageCount > screenshots.length },
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
    // Pages embed up to six reference images (about 4.2 MB each as data URLs) plus fonts.
    const input = await body(req, 32000000);
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
