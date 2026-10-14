'use strict';
// Source text extraction (ENGINE-SPEC section 6). Every byte is untrusted: sizes are checked before any work,
// ZIP packages are vetted from the central directory and then inflated against a shared byte budget, and XML is
// tokenised by htmlparser2 in xmlMode (only the five predefined and numeric entities decode; DTDs are refused).
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const JSZip = require('jszip');
const { Parser } = require('htmlparser2');

const LIMITS = Object.freeze({
  bytes: 15 * 1024 * 1024, chars: 60000, entries: 2000, unzipped: 80 * 1024 * 1024,
  rows: 200, cols: 30, cell: 1000, slides: 1000, pdfPages: 100, pdfTimeout: 60000,
});
const LABEL = { docx: 'DOCX', pptx: 'PPTX', xlsx: 'XLSX', csv: 'CSV', tsv: 'TSV', txt: 'Text', md: 'Markdown', json: 'JSON', html: 'HTML', pdf: 'PDF' };
const EXT = {
  docx: 'docx', docm: 'docx', dotx: 'docx', pptx: 'pptx', pptm: 'pptx', potx: 'pptx', xlsx: 'xlsx', xlsm: 'xlsx', xltx: 'xlsx',
  csv: 'csv', tsv: 'tsv', tab: 'tsv', txt: 'txt', text: 'txt', log: 'txt', md: 'md', markdown: 'md', mdown: 'md', mkd: 'md',
  json: 'json', html: 'html', htm: 'html', xhtml: 'html', pdf: 'pdf',
};
const OOXML = new Set(['docx', 'pptx', 'xlsx']);
const NO_WORDS = new Set(['xlsx', 'csv', 'tsv', 'json']);
const SUPPORTED = 'DOCX, PPTX, XLSX, PDF, CSV, TSV, TXT, MD, JSON or HTML';
const MARK = '\n[Truncated]';

const bad = (message) => Object.assign(new Error(message), { status: 400 });
function fail(message) { throw bad(message); }
const fmt = (n) => n.toLocaleString('en-US');
const plural = (n, word) => `${fmt(n)} ${word}${n === 1 ? '' : 's'}`;
const local = (n) => n.slice(n.indexOf(':') + 1);
// Attributes are parsed lazily (most elements never need them). Prefixes vary between producers, so 'val' also matches 'w:val'.
function att(tag, k) {
  const a = tag.map || (tag.map = parseAttrs(tag.raw));
  if (a[k] !== undefined) return a[k];
  for (const key in a) if (key.endsWith(':' + k)) return a[key];
}
function rid(tag) {
  const a = tag.map || (tag.map = parseAttrs(tag.raw));
  if (a['r:id'] !== undefined) return a['r:id'];
  for (const key in a) if (key !== 'id' && key.endsWith(':id')) return a[key];
}
// C0/C1 controls (except tab and newline), BOMs, zero-width space and bidi embeddings/overrides/isolates.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b\u202a-\u202e\u2066-\u2069\ufeff\ufffe\uffff]/g;
const cellText = (s) => String(s).replace(/\s+/g, ' ').trim().slice(0, LIMITS.cell);

function cleanName(name) {
  let s = typeof name === 'string' ? name.slice(-1000) : '';
  s = s.slice(Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\')) + 1).replace(CONTROL, '').replace(/["<>]/g, '').replace(/\s+/g, ' ').trim();
  if (s.length > 120) { const ext = (/\.[A-Za-z0-9]{1,10}$/.exec(s) || [''])[0]; s = s.slice(0, 120 - ext.length) + ext; }
  return s || 'Untitled source';
}

function toBuffer(data) {
  let buf;
  if (Buffer.isBuffer(data)) buf = data;
  else if (data instanceof Uint8Array) buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  else if (data instanceof ArrayBuffer) buf = Buffer.from(data);
  else if (typeof data === 'string') {
    let s = data;
    const head = /^data:[^,]{0,200},/.exec(s);
    if (head) {
      if (!/;base64,$/i.test(head[0])) fail('Source file data must be base64 encoded.');
      s = s.slice(head[0].length);
    }
    if (s.length > LIMITS.bytes * 1.4 + 4096) fail('Source files must be at most 15 MB.');
    s = s.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(s)) fail('Source file data must be base64 encoded.');
    buf = Buffer.from(s, 'base64');
  } else fail('Source file data must be base64 text.');
  if (!buf.length) fail('The file is empty.');
  if (buf.length > LIMITS.bytes) fail('Source files must be at most 15 MB.');
  return buf;
}

function sniff(buf, pdfExt) {
  const at = (...bytes) => bytes.every((b, i) => buf[i] === b);
  if (at(0x50, 0x4b) && ((buf[2] === 3 && buf[3] === 4) || (buf[2] === 5 && buf[3] === 6) || (buf[2] === 7 && buf[3] === 8))) return 'zip';
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-' || (pdfExt && buf.subarray(0, 1024).includes('%PDF-'))) return 'pdf';
  if (at(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) return 'cfb';
  if (at(0x89, 0x50, 0x4e, 0x47) || at(0xff, 0xd8, 0xff) || at(0x47, 0x49, 0x46, 0x38) ||
    (at(0x52, 0x49, 0x46, 0x46) && buf.subarray(8, 12).toString('latin1') === 'WEBP')) return 'image';
  if (buf.subarray(0, 5).toString('latin1') === '{\\rtf') return 'rtf';
  if (at(0x1f, 0x8b) || at(0x37, 0x7a, 0xbc, 0xaf) || at(0x52, 0x61, 0x72, 0x21) || at(0x42, 0x5a, 0x68)) return 'archive';
  if ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff)) return 'text';
  const head = buf.subarray(0, 65536);
  let odd = 0;
  for (const b of head) {
    if (b === 0) return 'binary';
    if (b < 9 || (b > 13 && b < 32 && b !== 27)) odd++;
  }
  return odd > Math.max(2, head.length * 0.01) ? 'binary' : 'text';
}

function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('windows-1252').decode(buf); }
}

function tidy(s) {
  s = s.replace(/\r\n?/g, '\n').replace(CONTROL, '');
  return s.split('\n').map((l) => l.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function collector() {
  const lines = [];
  let size = 0;
  const max = LIMITS.chars + 1000;
  return {
    lines,
    get full() { return size > max; },
    push(s) { lines.push(s); size += s.length + 1; return size <= max; },
    gap() { if (lines.length && lines[lines.length - 1] !== '') lines.push(''); },
  };
}

// ---------- XML ----------

// Only the five predefined entities and numeric references are decoded; anything else stays literal text.
const XML_ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeEntities(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(?:#x([0-9a-fA-F]{1,6})|#([0-9]{1,7})|(amp|lt|gt|quot|apos));/g, (m, hx, dec, name) => {
    if (name) return XML_ENTITY[name];
    const cp = hx ? parseInt(hx, 16) : Number(dec);
    return cp > 0 && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff) ? String.fromCodePoint(cp) : '\ufffd';
  });
}
function parseAttrs(s) {
  const out = Object.create(null), n = s.length;
  let i = 0;
  while (i < n) {
    while (i < n && s.charCodeAt(i) <= 32) i++;
    const k0 = i;
    while (i < n && s.charCodeAt(i) > 32 && s[i] !== '=') i++;
    const key = s.slice(k0, i);
    while (i < n && s.charCodeAt(i) <= 32) i++;
    if (s[i] !== '=') { if (i === k0) i++; continue; }
    i++;
    while (i < n && s.charCodeAt(i) <= 32) i++;
    const q = s[i];
    if (q !== '"' && q !== "'") continue;
    const e = s.indexOf(q, i + 1);
    if (e < 0) break;
    if (key && out[key] === undefined) out[key] = decodeEntities(s.slice(i + 1, e));
    i = e + 1;
  }
  return out;
}
// Linear XML tokenizer for OOXML parts. htmlparser2's element stack uses unshift/indexOf, which is quadratic on
// hostile nesting, so this keeps its own stack with per-name counts: every element is pushed and popped once.
// Close events are always balanced with open events; stray end tags are ignored. DTDs are refused.
const nameStart = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 58 || c >= 128;
const nameChar = (c) => nameStart(c) || (c >= 48 && c <= 57) || c === 45 || c === 46;
function walkXml(xml, h) {
  const n = xml.length, stack = [], open = new Map();
  let i = 0, stopped = false;
  h.stop = () => { stopped = true; };
  const text = (t) => { if (t && h.text) h.text(decodeEntities(t)); };
  const pop = () => { const name = stack.pop(); open.set(name, open.get(name) - 1); if (h.close) h.close(name); };
  while (i < n && !stopped) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) { text(xml.slice(i)); break; }
    if (lt > i) text(xml.slice(i, lt));
    if (stopped) break;
    const c = xml.charCodeAt(lt + 1);
    if (c === 33) { // <!
      if (xml.startsWith('<!--', lt)) { const e = xml.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
      if (xml.startsWith('<![CDATA[', lt)) {
        const e = xml.indexOf(']]>', lt + 9);
        if (h.text) h.text(xml.slice(lt + 9, e < 0 ? n : e));
        i = e < 0 ? n : e + 3;
        continue;
      }
      if (/^<!doctype/i.test(xml.slice(lt, lt + 9)) || xml.startsWith('<!ENTITY', lt)) fail('The document contains an XML document type declaration, which is not allowed.');
      const e = xml.indexOf('>', lt);
      i = e < 0 ? n : e + 1;
      continue;
    }
    if (c === 63) { const e = xml.indexOf('?>', lt + 2); i = e < 0 ? n : e + 2; continue; } // <? processing instruction
    if (c === 47) { // </name>: the name must follow directly, so a stray '</' never rescans the input
      let e = lt + 2;
      while (e < n && nameChar(xml.charCodeAt(e))) e++;
      let k = e;
      while (k < n && xml.charCodeAt(k) <= 32) k++;
      if (e === lt + 2 || xml.charCodeAt(k) !== 62) { text('<'); i = lt + 1; continue; }
      i = k + 1;
      const name = xml.slice(lt + 2, e);
      if (open.get(name) > 0) while (stack.length && !stopped) { const top = stack[stack.length - 1]; pop(); if (top === name) break; }
      continue;
    }
    if (!nameStart(c)) { text('<'); i = lt + 1; continue; }
    let j = lt + 1, q = 0;
    for (; j < n; j++) {
      const k = xml.charCodeAt(j);
      if (q) { if (k === q) q = 0; } else if (k === 34 || k === 39) q = k; else if (k === 62) break;
    }
    if (j >= n) break; // truncated tag at the end of the part
    i = j + 1;
    let e = lt + 1;
    while (e < j && nameChar(xml.charCodeAt(e))) e++;
    const name = xml.slice(lt + 1, e);
    const self = xml.charCodeAt(j - 1) === 47;
    if (h.open) h.open(name, { raw: xml.slice(e, self ? j - 1 : j), map: null });
    if (self) { if (h.close) h.close(name); }
    else { stack.push(name); open.set(name, (open.get(name) || 0) + 1); }
  }
}

function decodeXml(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  return new TextDecoder('utf-8').decode(buf);
}

// ---------- ZIP ----------

const DAMAGED = 'is damaged or is not a valid Office document.';

// Walks the central directory exactly like JSZip does (every consecutive header, not just the EOCD count)
// and refuses archives with too many entries or too much declared uncompressed data before anything inflates.
function scanZip(buf) {
  const len = buf.length;
  const damaged = () => fail(`The file ${DAMAGED}`);
  if (len < 22) damaged();
  let eocd = -1;
  for (let i = len - 22, stop = Math.max(0, len - 65557); i >= stop; i--)
    if (buf[i] === 0x50 && buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) damaged();
  let count = buf.readUInt16LE(eocd + 10), size = buf.readUInt32LE(eocd + 12), offset = buf.readUInt32LE(eocd + 16), end = eocd;
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc < 0 || buf.readUInt32LE(loc) !== 0x07064b50) damaged();
    const z = Number(buf.readBigUInt64LE(loc + 8));
    if (!(z + 56 <= loc) || buf.readUInt32LE(z) !== 0x06064b50) damaged();
    count = Number(buf.readBigUInt64LE(z + 32)); size = Number(buf.readBigUInt64LE(z + 40)); offset = Number(buf.readBigUInt64LE(z + 48)); end = z;
  }
  if (count > LIMITS.entries) fail(`The file has more than ${fmt(LIMITS.entries)} parts and was rejected.`);
  const shift = end - size - offset;
  if (!(shift >= 0)) damaged();
  let p = offset + shift, n = 0, total = 0;
  while (p + 46 <= len && buf.readUInt32LE(p) === 0x02014b50) {
    if (++n > LIMITS.entries) fail(`The file has more than ${fmt(LIMITS.entries)} parts and was rejected.`);
    let usize = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    if (usize === 0xffffffff) {
      usize = Infinity;
      for (let q = p + 46 + nl, stop = Math.min(q + xl, len); q + 4 <= stop;) {
        const id = buf.readUInt16LE(q), sz = buf.readUInt16LE(q + 2);
        if (id === 1 && sz >= 8 && q + 12 <= len) { usize = Number(buf.readBigUInt64LE(q + 4)); break; }
        q += 4 + sz;
      }
    }
    total += usize;
    if (total > LIMITS.unzipped) fail(`The file expands to more than ${LIMITS.unzipped / 1048576} MB and was rejected.`);
    p += 46 + nl + xl + cl;
  }
  if (n < count || (count && !n)) damaged();
  return { entries: n, size: total };
}

function inflate(file, budget) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, done = false, h;
    const stop = (e) => { if (!done) { done = true; reject(e); } };
    try { h = file.internalStream('nodebuffer'); } catch { return stop(bad(`The file ${DAMAGED}`)); }
    h.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > budget.left) { h.pause(); stop(bad(`The file expands to more than ${LIMITS.unzipped / 1048576} MB and was rejected.`)); }
      else chunks.push(c);
    })
      .on('error', () => stop(bad(`The file ${DAMAGED}`)))
      .on('end', () => { if (done) return; done = true; budget.left -= size; resolve(Buffer.concat(chunks, size)); })
      .resume();
  });
}

async function openZip(buf, name) {
  scanZip(buf);
  let zip;
  try { zip = await JSZip.loadAsync(buf, { checkCRC32: false, createFolders: false }); }
  catch (e) {
    fail(/encrypt/i.test(String(e && e.message)) ? `"${name}" is encrypted. Remove the password and try again.` : `"${name}" ${DAMAGED}`);
  }
  const all = Object.keys(zip.files);
  if (all.length > LIMITS.entries) fail(`The file has more than ${fmt(LIMITS.entries)} parts and was rejected.`);
  const files = new Map();
  for (const key of all) { const f = zip.files[key]; if (!f.dir) files.set(key.replace(/^\/+/, '').toLowerCase(), f); }
  const budget = { left: LIMITS.unzipped };
  return {
    names: [...files.values()].map((f) => f.name.replace(/^\/+/, '')),
    has: (n) => typeof n === 'string' && files.has(n.toLowerCase()),
    async read(n) {
      const f = typeof n === 'string' ? files.get(n.toLowerCase()) : null;
      return f ? decodeXml(await inflate(f, budget)) : null;
    },
  };
}

const relsPath = (part) => {
  const i = part.lastIndexOf('/');
  return `${part.slice(0, i + 1)}_rels/${part.slice(i + 1)}.rels`;
};
function resolvePart(from, target) {
  if (typeof target !== 'string' || !target || /^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
  let t = target.split('#')[0];
  try { t = decodeURIComponent(t); } catch {}
  const base = t.startsWith('/') ? '/' : '/' + path.posix.dirname(from || 'x');
  return path.posix.normalize(path.posix.join(base, t)).replace(/^\/+/, '');
}
async function rels(z, part) {
  const xml = await z.read(relsPath(part));
  const out = [];
  if (xml) walkXml(xml, {
    open(name, a) {
      if (local(name) !== 'Relationship' || out.length >= 5000) return;
      const external = /^external$/i.test(att(a, 'TargetMode') || '');
      out.push({ id: att(a, 'Id') || '', type: att(a, 'Type') || '', target: external ? null : resolvePart(part, att(a, 'Target')) });
    },
  });
  return out;
}
async function mainPart(z) {
  const r = (await rels(z, '')).find((x) => /\/officeDocument$/.test(x.type) && z.has(x.target));
  if (r) return r.target;
  return ['word/document.xml', 'ppt/presentation.xml', 'xl/workbook.xml'].find((p) => z.has(p)) || null;
}

// Shared table accumulator for WordprocessingML and DrawingML tables: cells become TSV columns, nested tables flatten into their cell.
function tableStack() {
  const st = [];
  const top = () => st[st.length - 1];
  return {
    get depth() { return st.length; },
    open() { st.push({ rows: [], row: null, cell: null }); },
    row() { if (top()) top().row = []; },
    cell() { if (top()) top().cell = []; },
    text(s) { const t = top(); if (t && t.cell) t.cell.push(s); },
    endCell() { const t = top(); if (t && t.cell && t.row) t.row.push(cellText(t.cell.join(' '))); if (t) t.cell = null; },
    endRow() { const t = top(); if (t && t.row) { if (t.row.some(Boolean)) t.rows.push(t.row); t.row = null; } },
    close() {
      const t = st.pop();
      if (!t) return null;
      const parent = top();
      if (parent) { if (parent.cell) parent.cell.push(t.rows.map((r) => r.join(' ')).join(' ')); return null; }
      return t.rows.map((r) => r.join('\t'));
    },
  };
}

// ---------- DOCX ----------

async function docxStyles(z, main) {
  const rel = (await rels(z, main)).find((r) => /\/styles$/.test(r.type) && r.target);
  const xml = await z.read(rel ? rel.target : 'word/styles.xml');
  const map = new Map();
  if (xml) {
    let cur = null;
    walkXml(xml, {
      open(name, a) {
        const n = local(name);
        if (n === 'style') cur = { id: att(a, 'styleId') || '', type: att(a, 'type') || 'paragraph', name: '', based: '', lvl: -1, list: false };
        else if (!cur) return;
        else if (n === 'name') cur.name = String(att(a, 'val') || '').toLowerCase();
        else if (n === 'basedOn') cur.based = att(a, 'val') || '';
        else if (n === 'outlineLvl') cur.lvl = Number(att(a, 'val'));
        else if (n === 'numId') cur.list = att(a, 'val') !== '0';
      },
      close(name) { if (local(name) === 'style' && cur) { if (cur.id && cur.type === 'paragraph' && map.size < 5000) map.set(cur.id, cur); cur = null; } },
    });
  }
  const memo = new Map();
  function info(id, depth = 0) {
    if (memo.has(id)) return memo.get(id);
    const r = { level: 0, list: false };
    memo.set(id, r);
    const s = map.get(id);
    const nm = s ? s.name : id.toLowerCase().replace(/^heading(\d)$/, 'heading $1');
    const m = /^heading ?([1-6])$/.exec(nm);
    if (m) r.level = Number(m[1]);
    else if (nm === 'title') r.level = 1;
    else if (s && s.lvl >= 0 && s.lvl < 6) r.level = s.lvl + 1;
    r.list = (s && s.list) || /^list ?(bullet|number)/.test(nm);
    if (s && s.based && depth < 10 && !r.level && s.lvl < 0) {
      const b = info(s.based, depth + 1);
      r.level = b.level;
      r.list = r.list || b.list;
    }
    return r;
  }
  return (id) => info(String(id || ''));
}

// mc:Fallback duplicates mc:Choice; tracked deletions/moves and *PrChange hold old content; w:tabs holds tab stops, not tabs.
const DOCX_SKIP = new Set(['Fallback', 'del', 'moveFrom', 'pPrChange', 'rPrChange', 'sectPrChange', 'tblPrChange', 'trPrChange', 'tcPrChange', 'numberingChange', 'tabs', 'sdtPr', 'fldData', 'instrText', 'delText']);

async function readDocx(z, main) {
  const xml = await z.read(main);
  if (xml == null) fail('The Word document has no main document part.');
  const style = await docxStyles(z, main);
  const out = collector(), tbl = tableStack(), paras = [];
  let skip = 0, inT = 0, tables = 0, stopped = false;
  const p = () => paras[paras.length - 1];
  const h = {
    open(name, a) {
      if (skip) { skip++; return; }
      const n = local(name), q = p();
      if (DOCX_SKIP.has(n)) { skip = 1; return; }
      switch (n) {
        case 'p': paras.push({ text: '', level: 0, list: false, ilvl: 0 }); break;
        case 'pStyle': if (q) { const s = style(att(a, 'val')); if (s.level) q.level = s.level; if (s.list) q.list = true; } break;
        case 'outlineLvl': if (q) { const v = Number(att(a, 'val')); if (v >= 0 && v < 6) q.level = v + 1; } break;
        case 'numId': if (q) q.list = att(a, 'val') !== '0'; break;
        case 'ilvl': if (q) q.ilvl = Math.min(8, Number(att(a, 'val')) || 0); break;
        case 't': inT++; break;
        case 'tab': if (q) q.text += '\t'; break;
        case 'br': case 'cr': if (q) q.text += '\n'; break;
        case 'noBreakHyphen': if (q) q.text += '-'; break;
        case 'tbl': tbl.open(); break;
        case 'tr': tbl.row(); break;
        case 'tc': tbl.cell(); break;
      }
    },
    close(name) {
      if (skip) { skip--; return; }
      let ok = true;
      switch (local(name)) {
        case 't': inT = Math.max(0, inT - 1); break;
        case 'p': {
          const q = paras.pop();
          if (!q) break;
          const body = q.text.trim();
          if (tbl.depth) { if (body) tbl.text(body); break; }
          if (!body) ok = out.push('');
          else if (q.level) { out.gap(); ok = out.push('#'.repeat(q.level) + ' ' + body.replace(/\s+/g, ' ')); }
          else if (q.list) ok = out.push('  '.repeat(q.ilvl) + '- ' + body);
          else ok = out.push(body);
          break;
        }
        case 'tc': tbl.endCell(); break;
        case 'tr': tbl.endRow(); break;
        case 'tbl': {
          const rows = tbl.close();
          if (rows) { tables++; out.gap(); for (const r of rows) ok = out.push(r) && ok; out.push(''); }
          break;
        }
      }
      if (!ok) { stopped = true; h.stop(); }
    },
    text(t) { if (!skip && inT && p()) p().text += t; },
  };
  walkXml(xml, h);
  return { text: out.lines.join('\n'), details: tables ? [plural(tables, 'table')] : [], stopped };
}

// ---------- PPTX ----------

const PPTX_NOISE = new Set(['sldNum', 'dt', 'ftr', 'hdr', 'sldImg']);

function drawingText(xml) {
  const shapes = [], stack = [], tbl = tableStack(), loose = { ph: null, lines: [] };
  let skip = 0, inT = 0, para = null, hidden = false;
  walkXml(xml, {
    open(name, a) {
      if (skip) { skip++; return; }
      const n = local(name);
      switch (n) {
        case 'Fallback': case 'extLst': skip = 1; break;
        case 'sld': hidden = att(a, 'show') === '0' || att(a, 'show') === 'false'; break;
        case 'sp': case 'graphicFrame': case 'cxnSp': case 'pic': stack.push({ ph: null, lines: [] }); break;
        case 'ph': if (stack.length) stack[stack.length - 1].ph = att(a, 'type') || 'body'; break;
        case 'p': para = { text: '', lvl: 0 }; break;
        case 'pPr': if (para) para.lvl = Math.min(8, Number(att(a, 'lvl')) || 0); break;
        case 't': inT++; break;
        case 'br': if (para) para.text += '\n'; break;
        case 'tbl': tbl.open(); break;
        case 'tr': tbl.row(); break;
        case 'tc': tbl.cell(); break;
      }
    },
    close(name) {
      if (skip) { skip--; return; }
      const shape = stack[stack.length - 1] || loose;
      switch (local(name)) {
        case 't': inT = Math.max(0, inT - 1); break;
        case 'p': {
          if (!para) break;
          const body = para.text.trim();
          if (tbl.depth) { if (body) tbl.text(body); }
          else if (body) shape.lines.push('  '.repeat(para.lvl) + body);
          para = null;
          break;
        }
        case 'tc': tbl.endCell(); break;
        case 'tr': tbl.endRow(); break;
        case 'tbl': { const rows = tbl.close(); if (rows) shape.lines.push(...rows); break; }
        case 'sp': case 'graphicFrame': case 'cxnSp': case 'pic': if (stack.length) shapes.push(stack.pop()); break;
      }
    },
    text(t) { if (!skip && inT && para) para.text += t; },
  });
  if (loose.lines.length) shapes.push(loose);
  return { shapes, hidden };
}

async function readPptx(z, main) {
  const pres = await z.read(main);
  const prels = await rels(z, main);
  let slides = [];
  if (pres) walkXml(pres, {
    open(name, a) {
      if (local(name) !== 'sldId') return;
      const r = prels.find((x) => x.id === rid(a));
      if (r && r.target && !slides.includes(r.target)) slides.push(r.target);
    },
  });
  if (!slides.length) {
    const num = (n) => Number(/(\d+)\.xml$/i.exec(n)[1]);
    slides = z.names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n)).sort((a, b) => num(a) - num(b));
  }
  if (!slides.length) fail('The presentation has no slides.');
  const out = collector();
  let count = 0, noted = 0, stopped = false;
  for (const [i, part] of slides.slice(0, LIMITS.slides).entries()) {
    if (out.full) { stopped = true; break; }
    const xml = await z.read(part);
    if (xml == null) continue;
    count++;
    const { shapes, hidden } = drawingText(xml);
    const title = shapes.filter((s) => s.ph === 'title' || s.ph === 'ctrTitle').flatMap((s) => s.lines).join(' ').replace(/\s+/g, ' ').trim();
    out.push(`Slide ${i + 1}${hidden ? ' (hidden)' : ''}:${title ? ' ' + title : ''}`);
    for (const s of shapes) if (s.ph !== 'title' && s.ph !== 'ctrTitle' && !PPTX_NOISE.has(s.ph)) for (const l of s.lines) out.push(l);
    const nrel = (await rels(z, part)).find((r) => /\/notesSlide$/.test(r.type) && r.target);
    const nxml = nrel ? await z.read(nrel.target) : null;
    if (nxml) {
      const ns = drawingText(nxml).shapes;
      const body = ns.filter((s) => s.ph === 'body');
      const lines = (body.length ? body : ns.filter((s) => !PPTX_NOISE.has(s.ph))).flatMap((s) => s.lines);
      if (lines.length) { noted++; out.push('Notes: ' + lines[0]); for (const l of lines.slice(1)) out.push(l); }
    }
    out.push('');
  }
  if (slides.length > LIMITS.slides) stopped = true;
  return { text: out.lines.join('\n'), details: [plural(count, 'slide'), ...(noted ? [`speaker notes on ${plural(noted, 'slide')}`] : [])], stopped };
}

// ---------- XLSX ----------

const DATE_IDS = { 14: 'date', 15: 'date', 16: 'date', 17: 'date', 18: 'time', 19: 'time', 20: 'time', 21: 'time', 22: 'datetime', 45: 'time', 46: 'time', 47: 'time' };
for (let i = 27; i <= 36; i++) DATE_IDS[i] = 'date';
for (let i = 50; i <= 58; i++) DATE_IDS[i] = 'date';
function formatKind(code) {
  if (typeof code !== 'string' || code.length > 200) return null;
  const c = code.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '');
  if (/[yd]/i.test(c)) return /[hs]/i.test(c) ? 'datetime' : 'date';
  if (/[hs]/i.test(c)) return 'time';
  if (/m/i.test(c) && !/[0#?]/.test(c)) return 'date';
  return null;
}
function dateStyles(xml) {
  const fmts = new Map(), xfs = [];
  let inXfs = 0;
  if (xml) walkXml(xml, {
    open(name, a) {
      const n = local(name);
      if (n === 'numFmt') fmts.set(Number(att(a, 'numFmtId')), formatKind(att(a, 'formatCode')));
      else if (n === 'cellXfs') inXfs++;
      else if (n === 'xf' && inXfs && xfs.length < 65536) xfs.push(Number(att(a, 'numFmtId')) || 0);
    },
    close(name) { if (local(name) === 'cellXfs') inXfs--; },
  });
  const out = new Map();
  xfs.forEach((id, i) => { const k = fmts.has(id) ? fmts.get(id) : DATE_IDS[id]; if (k) out.set(i, k); });
  return out;
}
function excelDate(x, kind, d1904) {
  if (!(x >= 0 && x < 2958466)) return String(x);
  let ms = Math.round(((d1904 ? x + 1462 : x) - 25569) * 86400000);
  if (!d1904 && x < 61) ms += 86400000; // Excel's fictional 1900-02-29
  const iso = new Date(ms).toISOString();
  const time = iso.slice(17, 19) === '00' ? iso.slice(11, 16) : iso.slice(11, 19);
  return kind === 'time' ? time : kind === 'datetime' ? `${iso.slice(0, 10)} ${time}` : iso.slice(0, 10);
}
function sharedStrings(xml) {
  const list = [];
  let cur = null, inT = 0, skip = 0;
  if (xml) walkXml(xml, {
    open(name) {
      if (skip) { skip++; return; }
      const n = local(name);
      if (n === 'rPh' || n === 'extLst') skip = 1;
      else if (n === 'si') cur = '';
      else if (n === 't' && cur !== null) inT++;
    },
    close(name) {
      if (skip) { skip--; return; }
      const n = local(name);
      if (n === 't') inT = Math.max(0, inT - 1);
      else if (n === 'si' && cur !== null) { list.push(cur); cur = null; }
    },
    text(t) { if (!skip && inT && cur !== null && cur.length < LIMITS.cell * 4) cur += t; },
  });
  return list;
}
function colIndex(ref) {
  let c = 0;
  for (let i = 0; i < ref.length && i < 4; i++) {
    const k = ref.charCodeAt(i) & ~32;
    if (k < 65 || k > 90) break;
    c = c * 26 + (k - 64);
  }
  return c - 1;
}
function sheetRows(xml, strings, dates, d1904) {
  const rows = [];
  let row = null, cell = null, inV = 0, inIs = 0, inT = 0, skip = 0, more = false, wide = false;
  const h = {
    open(name, a) {
      if (skip) { skip++; return; }
      const n = local(name);
      if (n === 'rPh' || n === 'extLst' || n === 'Fallback') { skip = 1; return; }
      if (n === 'row') {
        if (rows.length >= LIMITS.rows) { more = true; h.stop(); return; }
        row = { cells: [], last: -1 };
      } else if (n === 'c' && row) {
        const ref = att(a, 'r');
        const col = ref ? colIndex(ref) : row.last + 1;
        cell = { col: col < 0 ? row.last + 1 : col, t: att(a, 't') || 'n', s: Number(att(a, 's')) || 0, v: '', is: '' };
      } else if (n === 'v' && cell) inV++;
      else if (n === 'is' && cell) inIs++;
      else if (n === 't' && inIs) inT++;
    },
    close(name) {
      if (skip) { skip--; return; }
      const n = local(name);
      if (n === 'v') inV = Math.max(0, inV - 1);
      else if (n === 'is') inIs = Math.max(0, inIs - 1);
      else if (n === 't') inT = Math.max(0, inT - 1);
      else if (n === 'c' && cell && row) {
        const val = cellText(cellValue(cell, strings, dates, d1904));
        if (val) { if (cell.col < LIMITS.cols) row.cells[cell.col] = val; else wide = true; }
        row.last = cell.col;
        cell = null;
      } else if (n === 'row' && row) { if (row.cells.length) rows.push(row.cells); row = null; }
    },
    text(t) {
      if (skip || !cell) return;
      if (inV && cell.v.length < LIMITS.cell * 4) cell.v += t;
      else if (inT && cell.is.length < LIMITS.cell * 4) cell.is += t;
    },
  };
  walkXml(xml, h);
  let min = LIMITS.cols;
  for (const r of rows) { const i = r.findIndex((v) => v !== undefined); if (i >= 0 && i < min) min = i; }
  return { rows: rows.map((r) => Array.from(r.slice(min), (v) => v || '').join('\t').trimEnd()), more, wide };
}
function cellValue(c, strings, dates, d1904) {
  switch (c.t) {
    case 's': return strings[Number(c.v)] ?? '';
    case 'inlineStr': return c.is;
    case 'b': return c.v === '1' ? 'TRUE' : c.v === '0' ? 'FALSE' : c.v;
    case 'str': case 'e': case 'd': return c.v;
    default: {
      if (c.v === '') return c.is;
      const x = Number(c.v);
      if (!Number.isFinite(x)) return c.v;
      const kind = dates.get(c.s);
      return kind ? excelDate(x, kind, d1904) : String(Number(x.toPrecision(15)));
    }
  }
}

async function readXlsx(z, main) {
  const wb = await z.read(main);
  if (wb == null) fail('The workbook has no main workbook part.');
  const wrels = await rels(z, main);
  const sheets = [];
  let d1904 = false;
  walkXml(wb, {
    open(name, a) {
      const n = local(name);
      if (n === 'sheet' && sheets.length < 1000) sheets.push({ name: att(a, 'name') || `Sheet${sheets.length + 1}`, rid: rid(a), hidden: /hidden/i.test(att(a, 'state') || '') });
      else if (n === 'workbookPr') d1904 = /^(1|true)$/i.test(att(a, 'date1904') || '');
    },
  });
  const find = (type, fallback) => { const r = wrels.find((x) => x.type.endsWith('/' + type) && x.target); return r ? r.target : fallback; };
  const strings = sharedStrings(await z.read(find('sharedStrings', 'xl/sharedStrings.xml')));
  const dates = dateStyles(await z.read(find('styles', 'xl/styles.xml')));
  const out = collector();
  let used = 0, total = 0, cut = false, stopped = false;
  for (const s of sheets) {
    if (out.full) { stopped = true; break; }
    const r = wrels.find((x) => x.id === s.rid);
    if (!r || !r.target || !/\/worksheet$/.test(r.type)) continue;
    const xml = await z.read(r.target);
    if (xml == null) continue;
    const { rows, more, wide } = sheetRows(xml, strings, dates, d1904);
    used++;
    total += rows.length;
    cut = cut || more || wide;
    out.push(`Sheet: ${cellText(s.name)}${s.hidden ? ' (hidden)' : ''}`);
    if (!rows.length) out.push('(empty)');
    for (const line of rows) out.push(line);
    out.push('');
  }
  if (!used) fail('The workbook has no worksheets.');
  const details = [plural(used, 'sheet'), plural(total, 'row')];
  if (cut) details.push(`first ${LIMITS.rows} rows and ${LIMITS.cols} columns per sheet`);
  return { text: out.lines.join('\n'), details, stopped };
}

async function fromZip(buf, name) {
  const z = await openZip(buf, name);
  const main = await mainPart(z);
  const dir = main ? main.slice(0, main.indexOf('/') + 1).toLowerCase() : '';
  if (dir === 'word/') return { kind: 'docx', ...(await readDocx(z, main)) };
  if (dir === 'ppt/') return { kind: 'pptx', ...(await readPptx(z, main)) };
  if (dir === 'xl/') return { kind: 'xlsx', ...(await readXlsx(z, main)) };
  if (z.has('mimetype') && z.has('content.xml'))
    fail(`OpenDocument files are not supported. Save "${name}" as DOCX, PPTX or XLSX.`);
  fail(`"${name}" is a ZIP archive but not a Word, PowerPoint or Excel document.`);
}

// ---------- Text formats ----------

// RFC 4180 style parsing: quoted fields, doubled quotes, delimiters and newlines inside quotes, CRLF or LF.
// onRow returns false to stop. Linear in the input size.
function parseDelimited(text, delim, onRow) {
  const D = delim.charCodeAt(0), n = text.length;
  let i = 0, field = '', row = [], quoted = false, started = false;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (quoted) {
      const j = text.indexOf('"', i);
      if (j < 0) { field += text.slice(i); i = n; break; }
      field += text.slice(i, j);
      if (text.charCodeAt(j + 1) === 34) { field += '"'; i = j + 2; } else { quoted = false; i = j + 1; }
      continue;
    }
    if (c === 34 && !started) { quoted = true; started = true; i++; continue; }
    if (c === D) { row.push(field); field = ''; started = false; i++; continue; }
    if (c === 10 || c === 13) {
      row.push(field); field = ''; started = false;
      if (onRow(row) === false) return;
      row = [];
      i += c === 13 && text.charCodeAt(i + 1) === 10 ? 2 : 1;
      continue;
    }
    field += text[i]; started = true; i++;
  }
  if (field !== '' || row.length || started) { row.push(field); onRow(row); }
}
function sniffDelimiter(text) {
  const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 };
  let quoted = false;
  for (let i = 0; i < text.length && i < 8192; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === '\n' || c === '\r')) break;
    else if (!quoted && c in counts) counts[c]++;
  }
  return Object.keys(counts).reduce((a, b) => (counts[b] > counts[a] ? b : a), ',');
}
function readDelimited(raw, kind) {
  const delim = kind === 'tsv' ? '\t' : sniffDelimiter(raw);
  const out = collector();
  let rows = 0, cols = 0;
  parseDelimited(raw, delim, (r) => {
    if (r.length === 1 && !r[0].trim()) return;
    rows++;
    if (r.length > cols) cols = r.length;
    if (!out.full) out.push(r.slice(0, 200).map(cellText).join('\t').trimEnd());
  });
  return { text: out.lines.join('\n'), details: [plural(rows, 'row'), plural(cols, 'column')], stopped: out.full };
}

const HTML_SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'math', 'iframe', 'object', 'embed', 'canvas', 'select', 'audio', 'video', 'map', 'datalist']);
const HTML_BLOCK = new Set(['address', 'article', 'aside', 'blockquote', 'body', 'caption', 'dd', 'details', 'dialog', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'header', 'hgroup', 'hr', 'html', 'legend', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'tfoot', 'thead', 'ul']);

// HTML to plain text: scripts, styles and hidden subtrees dropped, block elements become line breaks,
// headings get '#', list items '- ', table cells tabs. Entities are decoded by htmlparser2 (HTML5 table).
const HTML_DEPTH = 256;
function htmlText(html) {
  let s = '', title = '', depth = 0, skipAt = 0, inTitle = false, stopped = false;
  const cells = [];
  const parser = new Parser({
    onopentag(name, a) {
      // htmlparser2 keeps its element stack with unshift/indexOf; capping depth keeps hostile nesting linear.
      if (++depth > HTML_DEPTH) { stopped = true; parser.pause(); return; }
      if (skipAt) return;
      if (name === 'title') { inTitle = true; return; }
      if (HTML_SKIP.has(name) || a.hidden !== undefined || a['aria-hidden'] === 'true' || /display\s*:\s*none/i.test(String(a.style || '').slice(0, 500))) { skipAt = depth; return; }
      if (name === 'br') s += '\n';
      else if (name === 'li') s += '\n- ';
      else if (/^h[1-6]$/.test(name)) s += '\n\n' + '#'.repeat(Number(name[1])) + ' ';
      else if (name === 'tr') { s += '\n'; cells.push(0); }
      else if (name === 'td' || name === 'th') { if (cells.length && cells[cells.length - 1]++) s += '\t'; }
      else if (HTML_BLOCK.has(name)) s += '\n';
    },
    ontext(t) {
      if (skipAt) return;
      if (inTitle) { if (title.length < 500) title += t; return; }
      s += t.replace(/\s+/g, ' ');
      if (s.length > LIMITS.chars * 3) { stopped = true; parser.pause(); }
    },
    onclosetag(name) {
      if (skipAt) { if (depth === skipAt) skipAt = 0; depth--; return; }
      depth--;
      if (name === 'title') inTitle = false;
      else if (name === 'tr') cells.pop();
      else if (HTML_BLOCK.has(name) || /^h[1-6]$/.test(name)) s += '\n';
    },
  }, { decodeEntities: true });
  parser.write(html);
  parser.end();
  const lines = [];
  let bullet = false;
  for (const raw of s.split('\n')) {
    let l = raw.replace(/[ \u00a0]+/g, ' ').trim();
    if (!l) continue;
    if (l === '-') { bullet = true; continue; } // <li><p>...</p></li>: attach the marker to the first text line
    if (bullet && !l.startsWith('- ')) l = '- ' + l;
    bullet = false;
    if (/^#{1,6} /.test(l) && lines.length) lines.push('');
    lines.push(l);
  }
  const body = lines.join('\n');
  title = title.replace(/\s+/g, ' ').trim();
  return { text: title && !body.includes(title) ? `# ${title}\n\n${body}` : body, stopped };
}
// htmlToText(html) -> plain text (scripts, styles and hidden subtrees removed; headings '#', list items '- ', cells tab-separated).
const htmlToText = (html) => htmlText(html).text;

function readJson(raw) {
  try {
    const v = JSON.parse(raw);
    const text = JSON.stringify(v, null, 2) ?? '';
    const details = Array.isArray(v) ? [`array of ${plural(v.length, 'item')}`]
      : v && typeof v === 'object' ? [`object with ${plural(Object.keys(v).length, 'key')}`] : [];
    return { text, details };
  } catch {
    return { text: raw, details: ['not valid JSON, read as text'] };
  }
}

function guessText(raw) {
  const t = raw.trimStart().slice(0, 200).toLowerCase();
  if (t.startsWith('{') || t.startsWith('[')) return 'json';
  if (/^(<!doctype html|<html|<head|<body)/.test(t)) return 'html';
  return 'txt';
}

// ---------- PDF ----------

function pdftotextBin(env) {
  const usable = (p) => !/[\\/]/.test(p) || fs.existsSync(p);
  if (env.PDFTOTEXT_PATH) return usable(env.PDFTOTEXT_PATH) ? env.PDFTOTEXT_PATH : null;
  if (env.PDFINFO_PATH) {
    const p = env.PDFINFO_PATH;
    if (!/[\\/]/.test(p)) return 'pdftotext' + path.extname(p);
    const sibling = path.join(path.dirname(p), 'pdftotext' + path.extname(p));
    return fs.existsSync(sibling) ? sibling : null;
  }
  return null;
}
const NO_PDF = 'PDF import needs Poppler pdftotext. Set PDFTOTEXT_PATH (or PDFINFO_PATH with pdftotext beside it), or save the document as DOCX or TXT.';

async function readPdf(buf, name, opts) {
  const bin = pdftotextBin(opts.env || process.env);
  if (!bin) fail(NO_PDF);
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forma-pdf-'));
  try {
    const file = path.join(dir, 'source.pdf');
    await fsp.writeFile(file, buf);
    const stdout = await new Promise((resolve, reject) => {
      execFile(bin, ['-q', '-enc', 'UTF-8', '-eol', 'unix', '-l', String(LIMITS.pdfPages), file, '-'],
        { timeout: opts.pdfTimeout || LIMITS.pdfTimeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true, encoding: 'buffer', signal: opts.signal },
        (err, out) => {
          if (!err) return resolve(out);
          if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' && out && out.length) return resolve(out);
          if (err.code === 'ENOENT' || err.code === 'EACCES') return reject(bad(NO_PDF));
          if (err.name === 'AbortError') return reject(Object.assign(new Error('PDF extraction was cancelled.'), { code: 'cancelled' }));
          if (err.killed) return reject(bad(`Reading "${name}" took too long. Save it as DOCX or TXT instead.`));
          reject(bad(`Could not read "${name}". The PDF may be encrypted or damaged.`));
        });
    });
    const text = new TextDecoder('utf-8').decode(stdout);
    let pages = 0;
    for (let i = text.indexOf('\f'); i >= 0; i = text.indexOf('\f', i + 1)) pages++;
    return { text: text.replace(/\f/g, '\n\n'), details: pages ? [plural(pages, 'page')] : [] };
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

// ---------- Entry point ----------

function finish(name, kind, { text: raw, details = [], stopped = false }) {
  let text = tidy(raw.length > LIMITS.chars * 3 ? raw.slice(0, LIMITS.chars * 3) : raw);
  let truncated = stopped || raw.length > LIMITS.chars * 3;
  if (!text) fail(kind === 'pdf' ? `No text found in "${name}". It may be a scanned PDF; paste the text instead.` : `No text found in "${name}".`);
  if (text.length > LIMITS.chars) {
    const max = LIMITS.chars - MARK.length;
    let k = text.lastIndexOf('\n', max);
    if (k < max * 0.8) k = max;
    const code = text.charCodeAt(k - 1);
    if (code >= 0xd800 && code <= 0xdbff) k--;
    text = text.slice(0, k).trimEnd();
    truncated = true;
  }
  if (truncated) text += MARK;
  const parts = [LABEL[kind]];
  if (!NO_WORDS.has(kind)) { let w = 0; for (const _ of text.matchAll(/\S+/g)) w++; parts.push(plural(w, 'word')); }
  parts.push(...details);
  if (truncated) parts.push(`truncated to ${fmt(LIMITS.chars)} characters`);
  return { name, kind, text, chars: text.length, truncated, summary: parts.join(', ') };
}

// extractSource({ name, data }, { env?, signal?, pdfTimeout? }) -> Promise<{ name, kind, text, chars, truncated, summary }>
// data: base64 string (data: URL prefix allowed), Buffer, Uint8Array or ArrayBuffer. Errors carry status 400.
async function extractSource(input, opts = {}) {
  if (!input || typeof input !== 'object') fail('Choose a file to import.');
  const name = cleanName(input.name);
  const buf = toBuffer(input.data);
  const extMatch = /\.([A-Za-z0-9]{1,10})$/.exec(name);
  const ext = extMatch ? EXT[extMatch[1].toLowerCase()] || null : null;
  const magic = sniff(buf, ext === 'pdf');
  if (magic === 'zip') { const r = await fromZip(buf, name); return finish(name, r.kind, r); }
  if (magic === 'pdf') return finish(name, 'pdf', await readPdf(buf, name, opts));
  if (magic === 'cfb')
    fail(`"${name}" is an encrypted or legacy Office file (.doc, .xls or .ppt). Save it as DOCX, XLSX or PPTX without a password and try again.`);
  if (OOXML.has(ext)) fail(`"${name}" is not a valid ${LABEL[ext]} file.`);
  if (ext === 'pdf') fail(`"${name}" is not a valid PDF file.`);
  if (magic === 'image') fail(`"${name}" is an image. Attach images as references instead of sources.`);
  if (magic === 'rtf') fail(`RTF files are not supported. Save "${name}" as DOCX or TXT.`);
  if (magic === 'archive') fail(`"${name}" is a compressed archive. Extract it and import the documents inside.`);
  if (magic === 'binary') fail(`"${name}" is not a supported file type. Use ${SUPPORTED}.`);
  const raw = decodeText(buf);
  const kind = ext || guessText(raw);
  if (kind === 'csv' || kind === 'tsv') return finish(name, kind, readDelimited(raw, kind));
  if (kind === 'html') return finish(name, kind, htmlText(raw));
  if (kind === 'json') return finish(name, kind, readJson(raw));
  return finish(name, kind, { text: raw });
}

module.exports = { extractSource, LIMITS, scanZip, parseDelimited, htmlToText, cleanName };
