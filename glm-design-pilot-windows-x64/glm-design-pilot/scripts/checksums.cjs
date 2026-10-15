'use strict';
// Writes SHA256SUMS.txt for the program files in this folder (or `--check` to
// verify them). Installed dependencies, the Node runtime, settings, data and
// generated output are excluded: they differ per installation.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const SKIP = new Set(['node_modules', 'data', 'test-results', 'dist', '.git', 'SHA256SUMS.txt', '.env']);
const SKIP_FILES = new Set(['runtime/node.exe']);

function list(dir = root, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = prefix + entry.name;
    if (SKIP.has(entry.name) || SKIP_FILES.has(rel)) continue;
    if (entry.isDirectory()) out.push(...list(path.join(dir, entry.name), rel + '/'));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');

if (process.argv.includes('--check')) {
  const lines = fs.readFileSync(path.join(root, 'SHA256SUMS.txt'), 'utf8').trim().split('\n');
  let bad = 0;
  for (const line of lines) {
    const [sum, file] = [line.slice(0, 64), line.slice(66)];
    if (!fs.existsSync(path.join(root, file))) console.log(`MISSING ${file}`), bad++;
    else if (hash(file) !== sum) console.log(`CHANGED ${file}`), bad++;
  }
  console.log(bad ? `${bad} of ${lines.length} files differ.` : `All ${lines.length} files match.`);
  process.exit(bad ? 1 : 0);
}
const files = list();
fs.writeFileSync(path.join(root, 'SHA256SUMS.txt'), files.map((f) => `${hash(f)}  ${f}`).join('\n') + '\n');
console.log(`SHA256SUMS.txt lists ${files.length} program files.`);
