'use strict';
// Builds the portable Windows package (dist/forma-windows-x64-<version>.zip):
// program files + Node.js runtime/node.exe + production node_modules, so the
// organisation PC needs no internet, npm or installer.
//
// Run on any machine with Node.js 24, npm and internet access:
//   node scripts/package-windows.cjs
// Behind a proxy, set HTTPS_PROXY and NODE_USE_ENV_PROXY=1 first.
// Offline options:
//   --skip-download  reuse runtime/node.exe and node_modules already in this folder
//   --dry-run        list what would be packaged; download and write nothing
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const JSZip = require('jszip');

const NODE_VERSION = 'v24.18.0';
const NODE_ZIP = `node-${NODE_VERSION}-win-x64.zip`;
const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run'), skipDownload = args.has('--skip-download') || dryRun;
const EXCLUDE = new Set(['node_modules', 'data', 'test-results', 'dist', '.git', '.env', 'SHA256SUMS.txt']);
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function walk(dir, prefix = '', skip = EXCLUDE) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (skip.has(entry.name)) continue;
    const rel = prefix + entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel + '/', skip));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

async function download(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function runtime() {
  const local = path.join(root, 'runtime', 'node.exe');
  if (skipDownload) {
    if (fs.existsSync(local)) return { 'runtime/node.exe': fs.readFileSync(local), 'runtime/LICENSE': fs.readFileSync(path.join(root, 'runtime', 'LICENSE')) };
    if (dryRun) return { 'runtime/node.exe': null, 'runtime/LICENSE': null };
    throw new Error('runtime/node.exe is missing. Run without --skip-download, or copy it from an existing Forma installation.');
  }
  console.log(`Downloading Node.js ${NODE_VERSION} for Windows x64…`);
  const base = `https://nodejs.org/dist/${NODE_VERSION}/`;
  const [archive, sums] = await Promise.all([download(base + NODE_ZIP), download(base + 'SHASUMS256.txt')]);
  const expected = sums.toString('utf8').split('\n').find((line) => line.endsWith('  ' + NODE_ZIP))?.slice(0, 64);
  if (!expected || sha256(archive) !== expected) throw new Error(`${NODE_ZIP} does not match the published SHASUMS256.txt.`);
  const zip = await JSZip.loadAsync(archive);
  const folder = `node-${NODE_VERSION}-win-x64/`;
  const exe = zip.file(folder + 'node.exe'), license = zip.file(folder + 'LICENSE');
  if (!exe || !license) throw new Error('The Node.js archive does not contain node.exe and LICENSE.');
  console.log('Verified the Node.js archive against SHASUMS256.txt.');
  return { 'runtime/node.exe': await exe.async('nodebuffer'), 'runtime/LICENSE': await license.async('nodebuffer') };
}

async function dependencies() {
  if (skipDownload) {
    const local = path.join(root, 'node_modules');
    if (fs.existsSync(local)) return { dir: local, files: walk(local, '', new Set(['.cache', '.bin'])) };
    if (dryRun) return { dir: null, files: [] };
    throw new Error('node_modules is missing. Run without --skip-download to install production dependencies.');
  }
  const stage = await fsp.mkdtemp(path.join(os.tmpdir(), 'forma-package-'));
  for (const f of ['package.json', 'package-lock.json']) await fsp.copyFile(path.join(root, f), path.join(stage, f));
  console.log('Installing production dependencies with npm ci (no install scripts)…');
  // Every dependency is plain JavaScript; Playwright browsers are not downloaded
  // because install scripts are disabled. The installed Edge/Chrome is used.
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage, stdio: 'inherit', shell: process.platform === 'win32' });
  const dir = path.join(stage, 'node_modules');
  return { dir, files: walk(dir, '', new Set(['.cache', '.bin'])), stage };
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Use Node.js 24 or newer to build the package.');
  const program = walk(root).filter((f) => f !== 'runtime/node.exe' && f !== 'runtime/LICENSE');
  const [rt, deps] = await Promise.all([runtime(), dependencies()]);
  const name = `forma-windows-x64-${pkg.version}`;
  if (dryRun) {
    console.log(`Dry run: ${name}.zip would contain glm-design-pilot/ with`);
    console.log(`  ${program.length} program files, runtime/node.exe ${rt['runtime/node.exe'] ? 'from this folder' : '(downloaded at build time)'},`);
    console.log(`  ${deps.files.length ? deps.files.length + ' node_modules files' : 'node_modules (installed at build time)'} and SHA256SUMS.txt.`);
    console.log(`  Excluded: ${[...EXCLUDE].join(', ')}.`);
    for (const f of program) console.log('  ' + f);
    return;
  }
  const zip = new JSZip();
  const top = zip.folder('glm-design-pilot');
  const sums = [];
  const add = (rel, buf) => {
    top.file(rel, buf, { binary: true, createFolders: false });
    sums.push(`${sha256(buf)}  ${rel}`);
  };
  for (const f of program) add(f, fs.readFileSync(path.join(root, f)));
  for (const [rel, buf] of Object.entries(rt)) add(rel, buf);
  for (const f of deps.files) add('node_modules/' + f, fs.readFileSync(path.join(deps.dir, f)));
  top.file('SHA256SUMS.txt', sums.sort((a, b) => (a.slice(66) < b.slice(66) ? -1 : 1)).join('\n') + '\n');
  await fsp.mkdir(path.join(root, 'dist'), { recursive: true });
  const out = path.join(root, 'dist', name + '.zip');
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 }, platform: 'DOS' });
  await fsp.writeFile(out, buffer);
  await fsp.writeFile(out + '.sha256', `${sha256(buffer)}  ${name}.zip\n`);
  if (deps.stage) await fsp.rm(deps.stage, { recursive: true, force: true });
  console.log(`Wrote ${path.relative(root, out)} (${(buffer.length / 1048576).toFixed(1)} MB, ${sums.length} files) and its .sha256.`);
  console.log('Copy the ZIP to the organisation PC, Extract All, then run 01-configure.cmd and 02-start.cmd.');
}
main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
