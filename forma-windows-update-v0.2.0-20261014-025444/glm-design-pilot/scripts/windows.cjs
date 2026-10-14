'use strict';
// Local Windows runner. No installation, downloads, or model calls during setup.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
process.chdir(root);
const children = new Set();
let stopping = false;
let stopCode = 0;
function finishStop() {
  if (stopping && children.size === 0) {
    process.stdin.destroy();
    setImmediate(() => process.exit(stopCode));
  }
}

function stop(code = 0) {
  stopCode = Math.max(stopCode, code);
  if (stopping) return;
  stopping = true;
  process.stdin.pause();
  process.exitCode = stopCode;
  for (const child of children) child.kill();
  finishStop();
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
process.on('exit', () => {
  for (const child of children) child.kill();
});

function existing(paths) {
  return paths.filter(Boolean).find((file) => fs.existsSync(file));
}
function under(base, suffix) {
  return base ? path.join(base, suffix) : undefined;
}
function port(value, fallback) {
  const n = Number(value || fallback);
  if (!Number.isInteger(n) || n < 1024 || n > 65535)
    throw new Error('Use port numbers between 1024 and 65535 in .env.');
  return n;
}
async function available(portNumber) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', () => reject(new Error(
      `Port ${portNumber} is unavailable. Stop the other app or change PORT / RENDER_PORT in .env.`,
    )));
    server.listen(portNumber, '127.0.0.1', resolve);
  });
  await new Promise((resolve) => server.close(resolve));
}
async function launch(file, portNumber) {
  if (stopping) throw new Error('Startup stopped.');
  const child = spawn(process.execPath, [file], {
    cwd: root,
    env: process.env,
    windowsHide: true,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  children.add(child);
  let ended = false;
  child.on('error', (error) => {
    console.error(`Could not start ${file}: ${error.message}`);
    stop(1);
  });
  child.on('exit', (code) => {
    ended = true;
    children.delete(child);
    if (!stopping) {
      console.error(`${file} exited (${code}). Stopping the pilot.`);
      stop(1);
    }
    finishStop();
  });
  for (let i = 0; i < 100; i++) {
    if (ended || stopping) throw new Error(`${file} did not stay running. See the error above.`);
    try {
      const response = await fetch(`http://127.0.0.1:${portNumber}/healthz`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`${file} did not become ready. Check the messages above.`);
}

async function main() {
  if (process.platform !== 'win32') throw new Error('This launcher is for Windows. See README.md for Docker.');
  if (Number(process.versions.node.split('.')[0]) < 24)
    throw new Error('Node.js 24 or newer is required. Use the runtime included in the Windows ZIP.');
  const envFile = path.join(root, '.env');
  if (!fs.existsSync(envFile)) {
    let template = fs.readFileSync(path.join(root, '.env.windows.example'), 'utf8');
    for (const key of ['APP_PASSWORD', 'SESSION_SECRET', 'RENDER_TOKEN'])
      template = template.replace(`GENERATE_${key}`, crypto.randomBytes(key === 'APP_PASSWORD' ? 12 : 32).toString('hex'));
    fs.writeFileSync(envFile, template, { flag: 'wx' });
    console.log('Created .env with a unique login password and secrets.');
  }
  if (process.argv.includes('--setup')) {
    console.log('Edit .env: set MODEL_MODE=glm, your internal API base URL, exact model ID and API key if needed.');
    console.log('APP_PASSWORD in .env is your app login password. Save the file before starting.');
    return;
  }
  process.loadEnvFile(envFile);
  // Always keep this personal experiment on loopback. Compose handles shared hosting.
  process.env.HOST = '127.0.0.1';
  process.env.RENDER_HOST = '127.0.0.1';
  const appPort = port(process.env.PORT, 8080);
  const renderPort = port(process.env.RENDER_PORT, 8081);
  if (appPort === renderPort) throw new Error('PORT and RENDER_PORT must be different.');
  process.env.PORT = String(appPort);
  process.env.RENDER_PORT = String(renderPort);
  process.env.RENDER_URL = `http://127.0.0.1:${renderPort}`;
  // Dependencies are included in the transfer ZIP; never run npm here.
  for (const dependency of ['docx', 'pptxgenjs', 'playwright', 'sanitize-html']) require(dependency);
  require('node:sqlite');
  require('../lib/model.cjs').configFromEnv();
  if ((process.env.APP_PASSWORD || '').length < 12)
    throw new Error('APP_PASSWORD in .env must have at least 12 characters.');
  if ((process.env.RENDER_TOKEN || '').length < 16)
    throw new Error('RENDER_TOKEN in .env must have at least 16 characters.');

  const browser = process.env.BROWSER_EXECUTABLE || existing([
    under(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'),
    under(process.env.ProgramFiles, 'Microsoft/Edge/Application/msedge.exe'),
    under(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'),
    under(process.env['ProgramFiles(x86)'], 'Google/Chrome/Application/chrome.exe'),
    under(process.env.LOCALAPPDATA, 'Microsoft/Edge/Application/msedge.exe'),
    under(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  ]);
  if (browser) {
    if (!fs.existsSync(browser)) throw new Error('BROWSER_EXECUTABLE does not exist. Correct its path in .env.');
    process.env.BROWSER_EXECUTABLE = browser;
  }
  const office = process.env.LIBREOFFICE_PATH || existing([
    under(process.env.ProgramFiles, 'LibreOffice/program/soffice.exe'),
    under(process.env['ProgramFiles(x86)'], 'LibreOffice/program/soffice.exe'),
  ]);
  if (office) process.env.LIBREOFFICE_PATH = office;
  console.log(`Node ${process.version} (${process.arch}); bundled application dependencies loaded.`);
  console.log(`Mode: ${process.env.MODEL_MODE || 'demo'}. ${process.env.MODEL_MODE === 'glm' ? 'Uses the configured model endpoint.' : 'Fixed demo examples; not GLM-generated work.'}`);
  console.log(browser ? 'Installed browser found for web rendering.' : 'No Edge/Chrome found. Generation and editable exports still work; web rendering needs a browser.');
  console.log(office ? 'LibreOffice found. Office rendering also needs pdfinfo and pdftoppm (Poppler).' : 'LibreOffice not found. PPTX/DOCX exports work; Office PDF and image review need LibreOffice + Poppler.');
  if (process.argv.includes('--check')) {
    console.log('Local setup checks passed. No model, browser, or native Office rendering was tested.');
    return;
  }
  await available(appPort);
  await available(renderPort);
  await launch('renderer.cjs', renderPort);
  await launch('server.cjs', appPort);
  console.log(`\nOpen http://127.0.0.1:${appPort}/ in your browser.`);
  console.log('Log in with APP_PASSWORD from .env.');
  console.log('Keep this window open. Press ENTER here or Ctrl+C to stop both services.');
  process.stdin.on('data', (chunk) => {
    if (/[\r\n]/.test(chunk.toString())) stop();
  });
  process.stdin.resume();
}
main().catch((error) => {
  console.error(`\n${error.message}`);
  stop(1);
});
