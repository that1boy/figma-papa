'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const JSZip = require('jszip');
const docx = require('docx');
const PptxGenJS = require('pptxgenjs');
const { extractSource, LIMITS, scanZip, parseDelimited, htmlToText, cleanName } = require('../lib/inputs.cjs');
const { importTokens, normalizeColor, parseColor, contrast, colorRole, parseLiteral } = require('../lib/tokens-import.cjs');
const { PRESETS, FONTS } = require('../lib/presets.cjs');

const rejects = (promise, pattern) => assert.rejects(promise, (e) => { assert.equal(e.status, 400, e.message); assert.match(e.message, pattern); return true; });

// Minimal ZIP writer with full control over declared sizes, flags and entry counts (zip bomb and malformed archive tests).
function buildZip(entries, { eocdCount } = {}) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name), raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data || '');
    const method = e.method ?? 8, data = method === 0 ? raw : zlib.deflateRawSync(raw), crc = zlib.crc32(raw);
    const usize = e.declared ?? raw.length, flags = e.flags || 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flags, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(usize, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(flags, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(usize, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, data);
    centrals.push(ch, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals), eocd = Buffer.alloc(22);
  const count = eocdCount ?? entries.length;
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(count, 8); eocd.writeUInt16LE(count, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';
const ROOT_RELS = (target) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${target}"/></Relationships>`;
const wordZip = (body) => buildZip([{ name: '_rels/.rels', data: ROOT_RELS('word/document.xml') }, { name: 'word/document.xml', data: `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>` }]);

async function makeDocx(extra = []) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, Tab, Header, Footer, ExternalHyperlink, FootnoteReferenceRun, DeletedTextRun, InsertedTextRun } = docx;
  const cell = (...paras) => new TableCell({ children: paras.map((p) => (typeof p === 'string' ? new Paragraph(p) : p)) });
  const inner = new Table({ rows: [new TableRow({ children: [cell('in1'), cell('in2')] })] });
  const doc = new Document({
    numbering: { config: [{ reference: 'num', levels: [{ level: 0, format: 'decimal', text: '%1.' }] }] },
    footnotes: { 1: { children: [new Paragraph('FOOTNOTE BODY')] } },
    sections: [{
      headers: { default: new Header({ children: [new Paragraph('HEADER TEXT')] }) },
      footers: { default: new Footer({ children: [new Paragraph('FOOTER TEXT')] }) },
      children: [
        new Paragraph({ text: 'Launch plan', heading: HeadingLevel.TITLE }),
        new Paragraph({ text: 'Goals', heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ text: 'Details', heading: HeadingLevel.HEADING_3 }),
        new Paragraph({ children: [new TextRun('Fish & chips <cost> "a lot"'), new FootnoteReferenceRun(1)] }),
        new Paragraph({ children: [new TextRun('Line one'), new TextRun({ text: 'Line two', break: 1 }), new TextRun({ children: [new Tab(), 'tabbed'] })] }),
        new Paragraph({ children: [new ExternalHyperlink({ children: [new TextRun('linked words')], link: 'https://example.com' })] }),
        new Paragraph({ children: [new TextRun('Kept '), new DeletedTextRun({ text: 'REMOVED', id: 1, author: 'a', date: '2024-01-01T00:00:00Z' }), new InsertedTextRun({ text: 'added', id: 2, author: 'a', date: '2024-01-01T00:00:00Z' })] }),
        new Paragraph({ text: 'First bullet', bullet: { level: 0 } }),
        new Paragraph({ text: 'Nested bullet', bullet: { level: 1 } }),
        new Paragraph({ text: 'Numbered item', numbering: { reference: 'num', level: 0 } }),
        new Table({ rows: [
          new TableRow({ children: [cell('Metric'), cell('Target')] }),
          new TableRow({ children: [cell('Signups', 'per week'), cell('1,000')] }),
          new TableRow({ children: [cell('Nested'), new TableCell({ children: [new Paragraph('outer'), inner] })] }),
        ] }),
        new Paragraph('Closing paragraph.'),
        ...extra,
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

async function makePptx(count = 2) {
  const p = new PptxGenJS();
  p.defineSlideMaster({ title: 'M', objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: 0.5, y: 0.2, w: 9, h: 1 }, text: '' } },
    { placeholder: { options: { name: 'body', type: 'body', x: 0.5, y: 1.5, w: 9, h: 3 }, text: '' } },
  ] });
  const s = p.addSlide({ masterName: 'M' });
  s.addText('Quarterly review', { placeholder: 'title' });
  s.addText([{ text: 'Revenue up 12%', options: { bullet: true, breakLine: true } }, { text: 'Churn down', options: { bullet: true, indentLevel: 1 } }], { placeholder: 'body' });
  s.addTable([[{ text: 'Region' }, { text: 'Sales' }], [{ text: 'EMEA' }, { text: '4.2' }]], { x: 1, y: 4, w: 4 });
  s.addNotes('Mention the hiring plan.');
  for (let i = 2; i <= count; i++) {
    const x = p.addSlide();
    x.addText(`Content of slide ${i}`, { x: 1, y: 1, w: 5, h: 1 });
    if (i === 2) x.hidden = true;
  }
  return p.write({ outputType: 'nodebuffer' });
}

function xlsxParts() {
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const rel = (id, type, target) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
  const big = Array.from({ length: 250 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>r${i + 1}</t></is></c><c r="B${i + 1}"><v>${i}</v></c></row>`).join('');
  return {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    '_rels/.rels': ROOT_RELS('xl/workbook.xml'),
    'xl/workbook.xml': `<?xml version="1.0"?><workbook ${NS}><workbookPr/><sheets><sheet name="Data &amp; Stats" sheetId="1" r:id="rId1"/><sheet name="Secret" sheetId="2" state="hidden" r:id="rId2"/><sheet name="Chart" sheetId="3" r:id="rId5"/><sheet name="Big" sheetId="4" r:id="rId6"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel('rId1', 'worksheet', 'worksheets/sheet1.xml')}${rel('rId2', 'worksheet', 'worksheets/sheet2.xml')}${rel('rId3', 'sharedStrings', 'sharedStrings.xml')}${rel('rId4', 'styles', 'styles.xml')}${rel('rId5', 'chartsheet', 'chartsheets/sheet1.xml')}${rel('rId6', 'worksheet', '/xl/worksheets/sheet3.xml')}</Relationships>`,
    'xl/sharedStrings.xml': `<?xml version="1.0"?><sst ${NS}><si><t>Name</t></si><si><t>Score</t></si><si><r><t xml:space="preserve">Rich </t></r><r><rPr><b/></rPr><t>text</t></r></si><si><t>漢字</t><rPh sb="0" eb="2"><t>カンジ</t></rPh></si><si><t xml:space="preserve">tab\tand\nnewline</t></si></sst>`,
    'xl/styles.xml': `<?xml version="1.0"?><styleSheet ${NS}><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd hh:mm"/></numFmts><cellStyleXfs count="1"><xf numFmtId="14"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet ${NS}><dimension ref="A1:AE5"/><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>Inline</t></is></c></row>
      <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>0.30000000000000004</v></c><c r="C2" t="b"><v>1</v></c><c r="D2" t="e"><v>#DIV/0!</v></c></row>
      <row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3" s="1"><v>45306</v></c><c r="C3" s="2"><v>45306.5</v></c><c r="D3" t="str"><f>CONCAT("a","b")</f><v>formula result</v></c></row>
      <row r="4"><c r="A4" t="s"><v>4</v></c><c r="AE4" t="inlineStr"><is><t>beyond column 30</t></is></c></row>
      <row><c t="inlineStr"><is><t>x</t></is></c><c><v>2</v></c><c t="s"><v>99</v></c></row>
    </sheetData></worksheet>`,
    'xl/worksheets/sheet2.xml': `<?xml version="1.0"?><worksheet ${NS}><sheetData><row r="1"><c r="B1" t="inlineStr"><is><t>hidden value</t></is></c></row></sheetData></worksheet>`,
    'xl/chartsheets/sheet1.xml': `<?xml version="1.0"?><chartsheet ${NS}/>`,
    'xl/worksheets/sheet3.xml': `<?xml version="1.0"?><worksheet ${NS}><sheetData>${big}</sheetData></worksheet>`,
  };
}
async function makeXlsx(parts = xlsxParts()) {
  const z = new JSZip();
  for (const [name, data] of Object.entries(parts)) z.file(name, data);
  return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function makePdf(text) {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = `BT /F1 18 Tf 20 100 Td (${text}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// ---------------- inputs: Office formats ----------------

test('DOCX: headings, lists, tables, entities, breaks, tracked changes; headers, footers and footnotes excluded', async () => {
  const buf = await makeDocx();
  const r = await extractSource({ name: 'plan.docx', data: buf.toString('base64') });
  assert.equal(r.kind, 'docx');
  assert.equal(r.name, 'plan.docx');
  assert.equal(r.truncated, false);
  assert.equal(r.chars, r.text.length);
  const lines = r.text.split('\n');
  assert.equal(lines[0], '# Launch plan');
  assert.ok(lines.includes('# Goals'));
  assert.ok(lines.includes('### Details'));
  assert.ok(lines.includes('Fish & chips <cost> "a lot"'));
  assert.match(r.text, /Line one\nLine two\ttabbed/);
  assert.ok(lines.includes('linked words'));
  assert.ok(lines.includes('Kept added'));
  assert.ok(lines.includes('- First bullet'));
  assert.ok(lines.includes('  - Nested bullet'));
  assert.ok(lines.includes('- Numbered item'));
  assert.ok(lines.includes('Metric\tTarget'));
  assert.ok(lines.includes('Signups per week\t1,000'));
  assert.ok(lines.includes('Nested\touter in1 in2'));
  assert.equal(lines[lines.length - 1], 'Closing paragraph.');
  for (const absent of ['HEADER TEXT', 'FOOTER TEXT', 'FOOTNOTE BODY', 'REMOVED']) assert.ok(!r.text.includes(absent), absent);
  assert.ok(r.text.indexOf('Goals') < r.text.indexOf('Metric') && r.text.indexOf('Metric') < r.text.indexOf('Closing'));
  assert.match(r.summary, /^DOCX, \d+ words, 1 table$/);
  const words = r.text.match(/\S+/g).length;
  assert.equal(r.summary, `DOCX, ${words} words, 1 table`);
});

test('DOCX: same result from Buffer, Uint8Array, base64 and data URL input', async () => {
  const buf = await makeDocx();
  const a = await extractSource({ name: 'a.docx', data: buf });
  const b = await extractSource({ name: 'a.docx', data: new Uint8Array(buf) });
  const c = await extractSource({ name: 'a.docx', data: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${buf.toString('base64')}` });
  const d = await extractSource({ name: 'a.docx', data: buf.toString('base64').replace(/(.{76})/g, '$1\n') });
  assert.equal(a.text, b.text);
  assert.equal(a.text, c.text);
  assert.equal(a.text, d.text);
});

test('DOCX: content wins over a misleading extension, and styles resolve through basedOn and outline levels', async () => {
  const buf = await makeDocx();
  const r = await extractSource({ name: 'notes.txt', data: buf });
  assert.equal(r.kind, 'docx');
  const styles = `<?xml version="1.0"?><w:styles ${W}><w:style w:type="paragraph" w:styleId="Big"><w:name w:val="My Big Heading"/><w:basedOn w:val="Heading2"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style><w:style w:type="paragraph" w:styleId="Loop"><w:name w:val="loop"/><w:basedOn w:val="Loop"/></w:style><w:style w:type="paragraph" w:styleId="Outline"><w:name w:val="custom"/><w:pPr><w:outlineLvl w:val="3"/></w:pPr></w:style></w:styles>`;
  const body = ['Big', 'Loop', 'Outline'].map((s) => `<w:p><w:pPr><w:pStyle w:val="${s}"/></w:pPr><w:r><w:t>${s} text</w:t></w:r></w:p>`).join('') +
    '<w:p><w:pPr><w:pStyle w:val="Heading5"/></w:pPr><w:r><w:t>No styles part</w:t></w:r></w:p>';
  const z = buildZip([{ name: '_rels/.rels', data: ROOT_RELS('word/document.xml') }, { name: 'word/document.xml', data: `<w:document ${W}><w:body>${body}</w:body></w:document>` }, { name: 'word/styles.xml', data: styles }]);
  const t = (await extractSource({ name: 's.docx', data: z })).text;
  assert.match(t, /^## Big text$/m);
  assert.match(t, /^Loop text$/m);
  assert.match(t, /^#### Outline text$/m);
  assert.match(t, /^##### No styles part$/m);
});

test('DOCX: mc:Fallback, w:tabs stops and change history are skipped; unknown entities stay literal', async () => {
  const body = `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs><w:pPrChange><w:pPr><w:pStyle w:val="Heading1"/></w:pPr></w:pPrChange></w:pPr><w:r><w:t>plain &amp;lt; &xxe; &#65;&#x42;</w:t></w:r></w:p>` +
    `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:t>CHOICE</w:t></mc:Choice><mc:Fallback><w:t>FALLBACK</w:t></mc:Fallback></mc:AlternateContent></w:r></w:p>` +
    `<w:p><w:r><w:instrText>PAGEREF _Toc1</w:instrText><w:t>field result</w:t></w:r><w:del><w:r><w:delText>gone</w:delText></w:r></w:del><w:moveFrom><w:r><w:t>moved away</w:t></w:r></w:moveFrom></w:p>`;
  const r = await extractSource({ name: 'x.docx', data: wordZip(body) });
  assert.equal(r.text, 'plain &lt; &xxe; AB\nCHOICE\nfield result');
});

test('DOCX: CDATA, comments, processing instructions and stray markup in text', async () => {
  const body = '<!-- <w:t>comment</w:t> --><w:p><w:r><w:t><![CDATA[a<b & c]]></w:t><?pi <w:t>no</w:t>?><w:t> 1 < 2 </w:t><w:t>&#0;&#xD800;&#x1F600;</w:t></w:r></w:p></w:nope><w:p><w:r><w:t>second</w:t></w:r>';
  const r = await extractSource({ name: 'c.docx', data: wordZip(body) });
  assert.equal(r.text, 'a<b & c 1 < 2 \ufffd\ufffd\u{1F600}\nsecond');
});

test('DOCX: DTDs are refused (no entity expansion, no XXE)', async () => {
  const xml = `<?xml version="1.0"?><!DOCTYPE w:document [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;"><!ENTITY xxe SYSTEM "file:///etc/passwd">]><w:document ${W}><w:body><w:p><w:r><w:t>&lol2; &xxe;</w:t></w:r></w:p></w:body></w:document>`;
  const z = buildZip([{ name: '_rels/.rels', data: ROOT_RELS('word/document.xml') }, { name: 'word/document.xml', data: xml }]);
  await rejects(extractSource({ name: 'bomb.docx', data: z }), /document type declaration/);
});

test('DOCX: very long documents stop early and are truncated at 60,000 characters', async () => {
  const para = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(4);
  const body = Array.from({ length: 2000 }, (_, i) => `<w:p><w:r><w:t>${i} ${para}</w:t></w:r></w:p>`).join('');
  const r = await extractSource({ name: 'long.docx', data: wordZip(body) });
  assert.equal(r.truncated, true);
  assert.ok(r.chars <= LIMITS.chars, String(r.chars));
  assert.equal(r.chars, r.text.length);
  assert.ok(r.text.endsWith('\n[Truncated]'));
  assert.ok(!r.text.includes('1999 '));
  assert.match(r.summary, /truncated to 60,000 characters$/);
});

test('PPTX: slide titles, paragraphs with levels, tables, notes, hidden slides', async () => {
  const r = await extractSource({ name: 'deck.pptx', data: await makePptx(3) });
  assert.equal(r.kind, 'pptx');
  assert.equal(r.text, [
    'Slide 1: Quarterly review', 'Revenue up 12%', '  Churn down', 'Region\tSales', 'EMEA\t4.2', 'Notes: Mention the hiring plan.', '',
    'Slide 2 (hidden):', 'Content of slide 2', '',
    'Slide 3:', 'Content of slide 3',
  ].join('\n'));
  assert.match(r.summary, /^PPTX, \d+ words, 3 slides, speaker notes on 1 slide$/);
});

test('PPTX: slides follow numeric order (slide10 after slide9) with or without presentation.xml', async () => {
  const buf = await makePptx(11);
  const ordered = (t) => [...t.matchAll(/^Slide (\d+)/gm)].map((m) => Number(m[1]));
  const r = await extractSource({ name: 'd.pptx', data: buf });
  assert.deepEqual(ordered(r.text), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.match(r.text, /Slide 10:\nContent of slide 10\n/);
  const z = await JSZip.loadAsync(buf);
  z.remove('ppt/_rels/presentation.xml.rels');
  const r2 = await extractSource({ name: 'd.pptx', data: await z.generateAsync({ type: 'nodebuffer' }) });
  assert.deepEqual(ordered(r2.text), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.match(r2.text, /Slide 10:\nContent of slide 10\n/);
  assert.match(r2.text, /Slide 11:\nContent of slide 11$/);
});

test('XLSX: sheet names, shared/inline/rich strings, numbers, booleans, errors, dates, gaps, limits', async () => {
  const r = await extractSource({ name: 'book.xlsx', data: await makeXlsx() });
  assert.equal(r.kind, 'xlsx');
  const [first, secret, big] = r.text.split('\n\n');
  assert.equal(first, [
    'Sheet: Data & Stats',
    'Name\tScore\t\tInline',
    'Rich text\t0.3\tTRUE\t#DIV/0!',
    '漢字\t2024-01-15\t2024-01-15 12:00\tformula result',
    'tab and newline',
    'x\t2',
  ].join('\n'));
  assert.equal(secret, 'Sheet: Secret (hidden)\nhidden value');
  const bigLines = big.split('\n');
  assert.equal(bigLines[0], 'Sheet: Big');
  assert.equal(bigLines.length, 201);
  assert.equal(bigLines[1], 'r1\t0');
  assert.equal(bigLines[200], 'r200\t199');
  assert.ok(!r.text.includes('beyond column 30'));
  assert.ok(!r.text.includes('カンジ'));
  assert.ok(!r.text.includes('Sheet: Chart'));
  assert.equal(r.summary, 'XLSX, 3 sheets, 206 rows, first 200 rows and 30 columns per sheet');
});

test('XLSX: 1904 date system and a workbook without worksheets', async () => {
  const parts = xlsxParts();
  parts['xl/workbook.xml'] = parts['xl/workbook.xml'].replace('<workbookPr/>', '<workbookPr date1904="1"/>');
  const r = await extractSource({ name: 'b.xlsx', data: await makeXlsx(parts) });
  assert.match(r.text, /漢字\t2028-01-16\t/);
  const none = xlsxParts();
  none['xl/workbook.xml'] = none['xl/workbook.xml'].replace(/<sheets>.*<\/sheets>/, '<sheets><sheet name="Chart" sheetId="3" r:id="rId5"/></sheets>');
  await rejects(extractSource({ name: 'c.xlsx', data: await makeXlsx(none) }), /no worksheets/);
});

// ---------------- inputs: text formats ----------------

test('CSV and TSV: quotes, doubled quotes, embedded newlines, CRLF, delimiter sniffing', async () => {
  const csv = 'name,quote,n\r\n"Smith, J","He said ""hi""",1\r\nplain,"multi\nline",2\r\n\r\n';
  const r = await extractSource({ name: 'people.csv', data: Buffer.from(csv) });
  assert.equal(r.kind, 'csv');
  assert.equal(r.text, 'name\tquote\tn\nSmith, J\tHe said "hi"\t1\nplain\tmulti line\t2');
  assert.equal(r.summary, 'CSV, 3 rows, 3 columns');
  const semi = await extractSource({ name: 'eu.csv', data: Buffer.from('a;b;c\n1,5;2;"x;y"\n') });
  assert.equal(semi.text, 'a\tb\tc\n1,5\t2\tx;y');
  const tsv = await extractSource({ name: 't.tsv', data: Buffer.from('a\tb\n"q\tq"\t2\n') });
  assert.equal(tsv.kind, 'tsv');
  assert.equal(tsv.text, 'a\tb\nq q\t2');
});

test('parseDelimited edge cases', () => {
  const rows = [];
  parseDelimited('a,,b,\n"",x"y,"z"\n"unterminated,1', ',', (r) => rows.push(r));
  assert.deepEqual(rows, [['a', '', 'b', ''], ['', 'x"y', 'z'], ['unterminated,1']]);
  const first = [];
  parseDelimited('1\n2\n3\n', ',', (r) => { first.push(r[0]); return first.length < 2; });
  assert.deepEqual(first, ['1', '2']);
});

test('HTML: scripts, styles and hidden content removed; blocks, headings, lists and tables kept', async () => {
  const html = `<!doctype html><html><head><title>Pricing page</title><style>body{color:red}</style><script>var secret = "SCRIPT";</script></head>
    <body><nav aria-hidden="true">NAVHIDDEN</nav><h1>Plans</h1><p>Simple &amp; fair&nbsp;pricing<br>for teams &mdash; &lt;b&gt;</p>
    <ul><li>Free</li><li><p>Pro</p></li></ul><table><tr><th>Plan</th><th>Price</th></tr><tr><td>Pro</td><td>$9</td></tr></table>
    <div hidden>HIDDEN</div><div style="display: none">NONE</div><noscript>NOSCRIPT</noscript><svg><text>SVGTEXT</text></svg><template>TPL</template><p>End</p></body></html>`;
  const r = await extractSource({ name: 'page.html', data: Buffer.from(html) });
  assert.equal(r.kind, 'html');
  assert.equal(r.text, '# Pricing page\n\n# Plans\nSimple & fair pricing\nfor teams — <b>\n- Free\n- Pro\nPlan\tPrice\nPro\t$9\nEnd');
  for (const bad of ['SCRIPT', 'color:red', 'NAVHIDDEN', 'HIDDEN', 'NONE', 'NOSCRIPT', 'SVGTEXT', 'TPL']) assert.ok(!r.text.includes(bad), bad);
  assert.equal(htmlToText('<p>a<p>b'), 'a\nb');
});

test('JSON: pretty printed; invalid JSON falls back to text; unknown extensions are sniffed', async () => {
  const r = await extractSource({ name: 'data.json', data: Buffer.from('{"plans":[{"name":"Pro","price":9}],"ok":true}') });
  assert.equal(r.text, '{\n  "plans": [\n    {\n      "name": "Pro",\n      "price": 9\n    }\n  ],\n  "ok": true\n}');
  assert.equal(r.summary, 'JSON, object with 2 keys');
  const arr = await extractSource({ name: 'a.json', data: Buffer.from('[1,2,3]') });
  assert.equal(arr.summary, 'JSON, array of 3 items');
  const broken = await extractSource({ name: 'b.json', data: Buffer.from('{"a": 1,}') });
  assert.equal(broken.text, '{"a": 1,}');
  assert.equal(broken.summary, 'JSON, not valid JSON, read as text');
  const sniffed = await extractSource({ name: 'export', data: Buffer.from(' {"x": 1}') });
  assert.equal(sniffed.kind, 'json');
  const page = await extractSource({ name: 'page.unknownext', data: Buffer.from('<!DOCTYPE html><p>Hi</p>') });
  assert.equal(page.kind, 'html');
  assert.equal(page.text, 'Hi');
  const yaml = await extractSource({ name: 'conf.yaml', data: Buffer.from('a: 1\nb: 2\n') });
  assert.equal(yaml.kind, 'txt');
});

test('Text and Markdown: BOM, CRLF, control characters, UTF-16 and Windows-1252 decoding', async () => {
  const md = await extractSource({ name: 'README.md', data: Buffer.from('\ufeff# Title\r\n\r\n\r\n\r\nBody\u0007 text\u202e here  \r\n') });
  assert.equal(md.kind, 'md');
  assert.equal(md.text, '# Title\n\nBody text here');
  assert.equal(md.summary, 'Markdown, 5 words');
  const u16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('héllo wörld', 'utf16le')]);
  assert.equal((await extractSource({ name: 'u.txt', data: u16 })).text, 'héllo wörld');
  const u16be = Buffer.from([0xfe, 0xff, 0x00, 0x68, 0x00, 0x69]);
  assert.equal((await extractSource({ name: 'b.txt', data: u16be })).text, 'hi');
  const latin = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x80]);
  assert.equal((await extractSource({ name: 'l.txt', data: latin })).text, 'café €');
  assert.equal((await extractSource({ name: 'n.txt', data: Buffer.from('one two') })).summary, 'Text, 2 words');
});

test('Large text input is truncated at a line boundary with a marker', async () => {
  const line = 'x'.repeat(99) + '\n';
  const r = await extractSource({ name: 'big.txt', data: Buffer.from(line.repeat(5000)) });
  assert.equal(r.truncated, true);
  assert.ok(r.chars <= LIMITS.chars);
  assert.ok(r.text.endsWith('x\n[Truncated]'));
  assert.ok(r.text.split('\n').slice(0, -1).every((l) => l.length === 99));
  const emoji = await extractSource({ name: 'e.txt', data: Buffer.from('😀'.repeat(40000)) });
  assert.ok(emoji.chars <= LIMITS.chars);
  assert.ok(!/[\ud800-\udbff]\n/.test(emoji.text), 'no split surrogate pair');
});

// ---------------- inputs: validation and hostile input ----------------

test('Input validation: size, encoding, empty and missing data', async () => {
  await rejects(extractSource(null), /Choose a file/);
  await rejects(extractSource({ name: 'a.txt', data: 42 }), /base64/);
  await rejects(extractSource({ name: 'a.txt', data: '' }), /empty/);
  await rejects(extractSource({ name: 'a.txt', data: 'not*base64!' }), /base64/);
  await rejects(extractSource({ name: 'a.txt', data: 'data:text/plain,hello' }), /base64/);
  await rejects(extractSource({ name: 'a.txt', data: Buffer.alloc(LIMITS.bytes + 1, 0x61) }), /15 MB/);
  await rejects(extractSource({ name: 'a.txt', data: 'A'.repeat(Math.ceil(LIMITS.bytes * 1.4) + 5000) }), /15 MB/);
  await rejects(extractSource({ name: 'a.txt', data: Buffer.from('   \n\t  ') }), /No text found/);
  const ok = await extractSource({ name: 'a.txt', data: Buffer.from('x'.repeat(1000)).toString('base64url') });
  assert.equal(ok.chars, 1000);
});

test('Binary files are rejected with clear messages', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  await rejects(extractSource({ name: 'logo.png', data: png }), /is an image/);
  await rejects(extractSource({ name: 'photo', data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]) }), /is an image/);
  await rejects(extractSource({ name: 'old.doc', data: Buffer.from('d0cf11e0a1b11ae1000000', 'hex') }), /legacy Office file/);
  await rejects(extractSource({ name: 'locked.docx', data: Buffer.from('d0cf11e0a1b11ae1000000', 'hex') }), /encrypted or legacy/);
  await rejects(extractSource({ name: 'a.rtf', data: Buffer.from('{\\rtf1\\ansi hello}') }), /RTF/);
  await rejects(extractSource({ name: 'a.tar.gz', data: Buffer.from([0x1f, 0x8b, 8, 0, 0, 0]) }), /compressed archive/);
  await rejects(extractSource({ name: 'tool.exe', data: Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]) }), /not a supported file type/);
  await rejects(extractSource({ name: 'blob.txt', data: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 65]) }), /not a supported file type/);
  await rejects(extractSource({ name: 'fake.docx', data: Buffer.from('just text') }), /not a valid DOCX file/);
  await rejects(extractSource({ name: 'fake.pptx', data: Buffer.from('just text') }), /not a valid PPTX file/);
  await rejects(extractSource({ name: 'fake.pdf', data: Buffer.from('just text') }), /not a valid PDF file/);
});

test('Zip bombs: declared sizes over 80 MB, too many entries and lying headers are all refused', async () => {
  const zeros = Buffer.alloc(41 * 1024 * 1024);
  const honest = buildZip([{ name: '_rels/.rels', data: ROOT_RELS('word/document.xml') }, { name: 'word/document.xml', data: zeros }, { name: 'word/media/pad.bin', data: zeros }]);
  assert.ok(honest.length < 1024 * 1024);
  await rejects(extractSource({ name: 'bomb.docx', data: honest }), /expands to more than 80 MB/);
  assert.throws(() => scanZip(honest), /expands to more than 80 MB/);

  const many = buildZip(Array.from({ length: LIMITS.entries + 1 }, (_, i) => ({ name: `f${i}.xml`, data: 'x', method: 0 })));
  await rejects(extractSource({ name: 'many.xlsx', data: many }), /more than 2,000 parts/);
  const lyingCount = buildZip(Array.from({ length: LIMITS.entries + 1 }, (_, i) => ({ name: `f${i}.xml`, data: 'x', method: 0 })), { eocdCount: 1 });
  await rejects(extractSource({ name: 'many.xlsx', data: lyingCount }), /more than 2,000 parts/);

  // Central directory claims 1 KB but the entry really inflates past the budget: the streaming cap stops it.
  const big = Buffer.alloc(LIMITS.unzipped + 1024 * 1024, 0x20);
  const lying = buildZip([{ name: '_rels/.rels', data: ROOT_RELS('word/document.xml') }, { name: 'word/document.xml', data: big, declared: 1024 }]);
  assert.equal(scanZip(lying).size, 1024 + Buffer.byteLength(ROOT_RELS('word/document.xml')));
  await rejects(extractSource({ name: 'liar.docx', data: lying }), /expands to more than 80 MB/);
});

test('Malformed and unsupported archives fail cleanly', async () => {
  const good = await makeDocx();
  await rejects(extractSource({ name: 'half.docx', data: good.subarray(0, Math.floor(good.length / 2)) }), /damaged|not a valid/);
  await rejects(extractSource({ name: 'junk.docx', data: Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(200, 7)]) }), /damaged/);
  const corrupt = Buffer.from(good);
  for (let i = 200; i < 2000; i++) corrupt[i] ^= 0x5a;
  await assert.rejects(extractSource({ name: 'c.docx', data: corrupt }), (e) => e.status === 400);
  await rejects(extractSource({ name: 'other.zip', data: buildZip([{ name: 'readme.txt', data: 'hello' }]) }), /ZIP archive but not a Word, PowerPoint or Excel/);
  await rejects(extractSource({ name: 'doc.odt', data: buildZip([{ name: 'mimetype', data: 'application/vnd.oasis.opendocument.text', method: 0 }, { name: 'content.xml', data: '<x/>' }]) }), /OpenDocument/);
  await rejects(extractSource({ name: 'enc.docx', data: buildZip([{ name: 'word/document.xml', data: '<w:document/>', flags: 1 }]) }), /encrypted/);
  await rejects(extractSource({ name: 'empty.docx', data: wordZip('') }), /No text found/);
  const traversal = buildZip([{ name: '_rels/.rels', data: ROOT_RELS('../../../../etc/passwd') }, { name: 'word/document.xml', data: `<w:document ${W}><w:body><w:p><w:r><w:t>safe</w:t></w:r></w:p></w:body></w:document>` }]);
  assert.equal((await extractSource({ name: 't.docx', data: traversal })).text, 'safe');
  const proto = buildZip([{ name: '_rels/.rels', data: ROOT_RELS('__proto__') }, { name: 'word/document.xml', data: `<w:document ${W}><w:body><w:p><w:r><w:t>ok</w:t></w:r></w:p></w:body></w:document>` }]);
  assert.equal((await extractSource({ name: 'p.docx', data: proto })).text, 'ok');
});

test('scanZip reports entries and declared size of a real package', async () => {
  const buf = await makeDocx();
  const z = await JSZip.loadAsync(buf);
  const info = scanZip(buf);
  assert.equal(info.entries, Object.keys(z.files).length);
  assert.ok(info.size > 0 && info.size < LIMITS.unzipped);
  assert.throws(() => scanZip(Buffer.from('not a zip at all, definitely not')), /damaged/);
});

test('cleanName strips paths, control characters and quotes', () => {
  assert.equal(cleanName('C:\\Users\\me\\Report "Q3".docx'), 'Report Q3.docx');
  assert.equal(cleanName('../../etc/passwd.txt'), 'passwd.txt');
  assert.equal(cleanName('<b>notes</b>.txt'), 'b.txt');
  assert.equal(cleanName('a\u0000b\tc.md'), 'ab c.md');
  assert.equal(cleanName(undefined), 'Untitled source');
  const long = cleanName('x'.repeat(300) + '.pptx');
  assert.equal(long.length, 120);
  assert.ok(long.endsWith('.pptx'));
  assert.ok(!/[\u0000-\u001f"<>\\/]/.test(cleanName('a/b\\c"d<e>f\u0001g')));
});

// ---------------- inputs: PDF ----------------

const posix = process.platform !== 'win32';

test('PDF: clear error without Poppler, and extraction through a configured pdftotext sibling', { skip: !posix }, async (t) => {
  const pdf = makePdf('Hello PDF world');
  await rejects(extractSource({ name: 'a.pdf', data: pdf }, { env: {} }), /pdftotext/);
  await rejects(extractSource({ name: 'a.pdf', data: pdf }, { env: { PDFTOTEXT_PATH: '/nonexistent/pdftotext' } }), /pdftotext/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-inputs-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'pdfinfo'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await rejects(extractSource({ name: 'a.pdf', data: pdf }, { env: { PDFINFO_PATH: path.join(dir, 'pdfinfo') } }), /pdftotext/);
  fs.writeFileSync(path.join(dir, 'pdftotext'), '#!/bin/sh\nprintf "Fake page one\\fFake page two\\f"\n', { mode: 0o755 });
  const r = await extractSource({ name: 'a.pdf', data: pdf }, { env: { PDFINFO_PATH: path.join(dir, 'pdfinfo') } });
  assert.equal(r.kind, 'pdf');
  assert.equal(r.text, 'Fake page one\n\nFake page two');
  assert.equal(r.summary, 'PDF, 6 words, 2 pages');
  fs.writeFileSync(path.join(dir, 'broken'), '#!/bin/sh\necho "Syntax Error" >&2\nexit 1\n', { mode: 0o755 });
  await rejects(extractSource({ name: 'a.pdf', data: pdf }, { env: { PDFTOTEXT_PATH: path.join(dir, 'broken') } }), /encrypted or damaged/);
  fs.writeFileSync(path.join(dir, 'empty'), '#!/bin/sh\nprintf "\\f"\n', { mode: 0o755 });
  await rejects(extractSource({ name: 'scan.pdf', data: pdf }, { env: { PDFTOTEXT_PATH: path.join(dir, 'empty') } }), /scanned PDF/);
});

const realPdftotext = ['/usr/bin/pdftotext', '/usr/local/bin/pdftotext', '/opt/homebrew/bin/pdftotext'].find((p) => fs.existsSync(p));
test('PDF: real Poppler pdftotext extracts text', { skip: !realPdftotext && 'pdftotext not installed' }, async () => {
  const r = await extractSource({ name: 'hello.pdf', data: makePdf('Hello PDF world').toString('base64') }, { env: { PDFTOTEXT_PATH: realPdftotext } });
  assert.equal(r.kind, 'pdf');
  assert.match(r.text, /Hello PDF world/);
  assert.match(r.summary, /^PDF, 3 words, 1 page$/);
});

// ---------------- tokens-import ----------------

const HEX = /^#[0-9a-f]{6}$/;
function assertSafeTokens(tokens) {
  for (const k of ['accent', 'accent2', 'background', 'surface', 'text', 'muted', 'border', 'success', 'warning', 'danger'])
    if (k in tokens) assert.match(tokens[k], HEX, k);
  for (const k of ['headingFont', 'bodyFont', 'monoFont']) if (k in tokens) assert.match(tokens[k], /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,59}$/u, k);
  if ('radius' in tokens) assert.ok(Number.isInteger(tokens.radius) && tokens.radius >= 0 && tokens.radius <= 40);
  if ('spacing' in tokens) assert.ok(Number.isInteger(tokens.spacing) && tokens.spacing >= 4 && tokens.spacing <= 24);
}

test('normalizeColor: hex, rgb(a), hsl(a), oklch, oklab, color(), named; alpha dropped', () => {
  const cases = {
    '#ABC': '#aabbcc', '#abcd': '#aabbcc', '#4F46E5': '#4f46e5', '#11223380': '#112233',
    'rgb(79, 70, 229)': '#4f46e5', 'rgb(79 70 229)': '#4f46e5', 'rgba(79,70,229,0.5)': '#4f46e5', 'rgb(79 70 229 / 50%)': '#4f46e5',
    'rgb(100%, 0%, 50%)': '#ff0080', 'hsl(120, 100%, 25%)': '#008000', 'hsl(120deg 100% 25%)': '#008000', 'hsla(240, 100%, 50%, .2)': '#0000ff',
    'hsl(0.5turn 100% 50%)': '#00ffff', 'hsl(180 100 50)': '#00ffff', 'oklch(0.623 0.214 259.815)': '#2b7fff', 'oklch(62.3% 0.214 259.815 / 0.5)': '#2b7fff',
    'oklab(1 0 0)': '#ffffff', 'oklch(0 0 0)': '#000000', 'color(srgb 1 0 0.5)': '#ff0080', 'White': '#ffffff', ' rebeccapurple ': '#663399',
  };
  for (const [input, want] of Object.entries(cases)) assert.equal(normalizeColor(input), want, input);
  for (const bad of ['#12345', '#ggg', 'rgb(1,2)', 'rgb(1 2 3 4 5)', 'hsl(x, 1%, 1%)', 'url(#a)', 'var(--x)', 'transparent', '', 'expression(alert(1))', 'rgb(1,2,3) red', null, 42])
    assert.equal(normalizeColor(bad), null, String(bad));
  assert.equal(normalizeColor('222.2 47.4% 11.2%'), null);
  assert.equal(normalizeColor('222.2 47.4% 11.2%', true), '#0f172a');
  assert.equal(normalizeColor('79 70 229', true), '#4f46e5');
  assert.equal(normalizeColor('79, 70, 229', true), '#4f46e5');
  assert.equal(normalizeColor('300 70 229', true), null);
  assert.equal(parseColor('#4f46e580').a.toFixed(2), '0.50');
  assert.ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 1e-9);
});

test('colorRole maps common token names to roles', () => {
  const role = (n) => colorRole(n)?.role ?? null;
  const expect = {
    '--primary': 'accent', '--color-brand': 'accent', '--accent': 'accent', '--md-sys-color-primary': 'accent', '--link-color': 'accent',
    '--background': 'background', '--bg': 'background', '--color-bg-primary': 'background', '--bs-body-bg': 'background', '--page-background': 'background',
    '--foreground': 'text', '--color-text': 'text', '--text-primary': 'text', '--bs-body-color': 'text', '--md-sys-color-on-background': 'text',
    '--muted-foreground': 'muted', '--text-muted': 'muted', '--color-text-secondary': 'muted', '--muted': 'muted',
    '--card': 'surface', '--surface': 'surface', '--bg-secondary': 'surface', '--surface-primary': 'surface',
    '--border': 'border', '--divider': 'border', '--border-primary': 'border', '--input': 'border',
    '--destructive': 'danger', '--color-error': 'danger', '--success': 'success', '--warning': 'warning', '--secondary': 'accent2', '--accent-2': 'accent2',
    '--primary-foreground': null, '--on-primary': null, '--ring': null, '--chart-1': null, '--shadow-color': null, '--gray-500': null,
    '--primary-container': null, '--primary-bg': null, '--text-brand': null, '--font-sans': null, '--radius': null,
  };
  for (const [name, want] of Object.entries(expect)) assert.equal(role(name), want, name);
  assert.ok(colorRole('--primary').score > colorRole('--primary-hover').score);
  assert.ok(colorRole('--primary-600').score > colorRole('--primary-100').score);
  assert.ok(colorRole('--background').score > colorRole('--sidebar-background').score);
  assert.ok(colorRole('--background').score > colorRole('--dark-background').score);
});

const SHADCN = `@tailwind base;
@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --popover: 0 0% 100%;
    --primary: 221.2 83.2% 53.3%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --destructive: 0 84.2% 60.2%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 221.2 83.2% 53.3%;
    --radius: 0.75rem;
    --sidebar-background: 0 0% 98%;
  }
  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --primary: 217.2 91.2% 59.8%;
  }
}
/* body { font-family: Comic Sans; } */
body { font-family: "Inter var", -apple-system, BlinkMacSystemFont, sans-serif; background: hsl(var(--background)); }
h1, h2, .display { font-family: 'Fraunces', Georgia, serif; }
pre, code { font-family: ui-monospace, "JetBrains Mono", monospace; }
.card { padding: 24px; gap: 16px; margin: 8px 0 32px; border-radius: 12px !important; }
.stack > * + * { margin-top: 16px; }
.btn { padding: 8px 16px; border-radius: 6px; }`;

test('importTokens: shadcn-style CSS with HSL channels, dark theme and font stacks', () => {
  const { tokens, notes } = importTokens(SHADCN);
  assert.deepEqual(tokens, {
    background: '#ffffff', text: '#020817', surface: '#ffffff', accent: '#2563eb', muted: '#64748b', border: '#e2e8f0', danger: '#ef4444',
    headingFont: 'Fraunces', bodyFont: 'Inter', monoFont: 'JetBrains Mono', radius: 12, spacing: 8,
  });
  assertSafeTokens(tokens);
  assert.ok(notes.some((n) => /^Read CSS: 20 custom properties, \d+ declarations\.$/.test(n)));
  assert.ok(notes.some((n) => /accent: #2563eb from --primary/.test(n)));
  assert.ok(notes.some((n) => /Skipped --secondary .* accent2/.test(n)));
  assert.ok(notes.some((n) => /Dark theme values/.test(n)));
  assert.ok(notes.every((n) => typeof n === 'string' && n.length <= 300));
});

test('importTokens: plain CSS falls back to selectors, declarations and colour frequency', () => {
  const css = `html { background-color: #FAF8F5; color: rgb(28, 25, 23); font-family: Manrope, sans-serif; }
    a, .link { color: #b4532a; } .btn { background: #b4532a; border-radius: 10px; padding: 12px 24px; }
    .card { border-radius: 14px; padding: 24px; gap: 12px } .chip { border-radius: 9999px; } .x { border-radius: 50%; }
    .note { color: #b4532a; border: 1px solid #ebe5dd; }`;
  const { tokens, notes } = importTokens(css);
  assert.equal(tokens.background, '#faf8f5');
  assert.equal(tokens.text, '#1c1917');
  assert.equal(tokens.bodyFont, 'Manrope');
  assert.equal(tokens.accent, '#b4532a');
  assert.equal(tokens.radius, 12);
  assert.equal(tokens.spacing, 12);
  assert.ok(notes.some((n) => /guessed from the most frequent saturated colour \(used 3 times\)/.test(n)));
  assertSafeTokens(tokens);
});

test('importTokens: Tailwind v4 @theme CSS with oklch, var() chains, scales and clamping', () => {
  const css = `@import "tailwindcss";
  @theme {
    --color-brand-500: oklch(0.623 0.214 259.815);
    --color-primary: var(--color-brand-500);
    --color-surface: #ffffff;
    --color-canvas: var(--missing, #f8fafc);
    --color-ink: #0f172a;
    --color-line: #0f172a1a;
    --font-sans: "Plus Jakarta Sans", ui-sans-serif, system-ui;
    --font-display: 'dm serif display', serif;
    --font-mono: var(--font-code);
    --font-weight-bold: 700;
    --text-sm: 0.875rem;
    --radius-sm: 0.25rem; --radius-md: 3rem; --radius-lg: 4rem;
    --spacing: 2px;
  }`;
  const { tokens, notes } = importTokens(css);
  assert.equal(tokens.accent, '#2b7fff');
  assert.equal(tokens.surface, '#ffffff');
  assert.equal(tokens.background, '#f8fafc');
  assert.equal(tokens.text, '#0f172a');
  assert.equal(tokens.border, '#e0e3e7'); // #0f172a at 10% over the #f8fafc background
  assert.equal(tokens.bodyFont, 'Plus Jakarta Sans');
  assert.equal(tokens.headingFont, 'DM Serif Display');
  assert.equal(tokens.monoFont, undefined);
  assert.equal(tokens.radius, 40);
  assert.equal(tokens.spacing, 4);
  assert.ok(notes.some((n) => /radius: 40px .*clamped/.test(n)));
  assert.ok(notes.some((n) => /spacing: 4px .*clamped/.test(n)));
  assert.ok(notes.some((n) => /translucent, blended/.test(n)));
  assert.ok(notes.some((n) => /Could not resolve 1 reference: --font-mono/.test(n)));
  assertSafeTokens(tokens);
});

test('importTokens: dark-only themes are still used, and inline <style> blocks are read', () => {
  const dark = importTokens('.dark { --background: #0b0d12; --foreground: #e7e9ee; --primary: #8b93ff; }');
  assert.deepEqual(dark.tokens, { background: '#0b0d12', text: '#e7e9ee', accent: '#8b93ff' });
  const html = importTokens('<html><head><style>:root{--brand:#e11d48;--radius:4px}</style></head><body style="color:red"></body></html>');
  assert.equal(html.tokens.accent, '#e11d48');
  assert.equal(html.tokens.radius, 4);
});

test('importTokens: W3C design tokens with groups, $type inheritance, aliases and composite values', () => {
  const json = {
    color: {
      $type: 'color',
      blue: { 600: { $value: '#1456d8' }, 50: { $value: '#f5f8fc' } },
      brand: { primary: { $value: '{color.blue.600}' }, secondary: { $value: { colorSpace: 'srgb', components: [0.06, 0.55, 0.5] } } },
      bg: { default: { $value: '{color.blue.50}' } },
      text: { default: { $value: '#0b1b33' }, muted: { $value: '#4f5e77' }, missing: { $value: '{color.nope}' } },
      border: { default: { $value: 'rgba(11, 27, 51, 0.12)' } },
      feedback: { success: { $value: '#0f7a4f' }, warning: { $value: '#a65b00' }, danger: { $value: '#c8322b' } },
    },
    font: {
      family: { sans: { $type: 'fontFamily', $value: ['DM Sans', 'sans-serif'] }, mono: { $type: 'fontFamily', $value: 'Menlo, monospace' } },
    },
    typography: { heading: { $type: 'typography', $value: { fontFamily: '{font.family.serif}', fontSize: '32px' } }, title: { $type: 'typography', $value: { fontFamily: 'source serif 4', fontWeight: 600 } } },
    radius: { $type: 'dimension', sm: { $value: '4px' }, md: { $value: { value: 0.625, unit: 'rem' } }, full: { $value: '9999px' } },
    space: { $type: 'dimension', 1: { $value: '4px' }, 2: { $value: '8px' }, 3: { $value: '16px' }, 4: { $value: '24px' }, 5: { $value: '32px' } },
  };
  const { tokens, notes } = importTokens(JSON.stringify(json));
  assert.deepEqual(tokens, {
    background: '#f5f8fc', text: '#0b1b33', accent: '#1456d8', accent2: '#0f8c80', muted: '#4f5e77', border: '#d9dde4',
    success: '#0f7a4f', warning: '#a65b00', danger: '#c8322b', headingFont: 'Source Serif 4', bodyFont: 'DM Sans', monoFont: 'Menlo', radius: 10, spacing: 8,
  });
  assert.ok(notes.some((n) => /Read W3C design tokens/.test(n)));
  assert.ok(notes.some((n) => /monoFont: Menlo .*not bundled/.test(n)));
  assert.ok(notes.some((n) => /Could not resolve/.test(n)));
  assertSafeTokens(tokens);
});

test('importTokens: Style Dictionary and flat JSON', () => {
  const sd = { color: { base: { red: { value: '#cf2a2a', type: 'color' }, ink: { value: '#24152b' } }, brand: { primary: { value: '{color.base.red.value}' } }, background: { page: { value: '#fdf9fb' } } }, size: { radius: { base: { value: '16px' } }, spacing: { unit: { value: '0.5rem' } } } };
  const r = importTokens(JSON.stringify(sd));
  assert.equal(r.tokens.accent, '#cf2a2a');
  assert.equal(r.tokens.background, '#fdf9fb');
  assert.equal(r.tokens.radius, 16);
  assert.equal(r.tokens.spacing, 8);
  assert.ok(r.notes.some((n) => /Read Style Dictionary tokens/.test(n)));
  const flat = importTokens('{"primary": "#123456", "text": "#111111", "borderRadius": 6}');
  assert.deepEqual(flat.tokens, { text: '#111111', accent: '#123456', radius: 6 });
});

test('importTokens: Forma tokens.json and legacy design systems round-trip', () => {
  for (const p of PRESETS) {
    const { tokens } = importTokens(JSON.stringify(p.tokens, null, 2));
    for (const k of ['accent', 'accent2', 'background', 'surface', 'text', 'muted', 'border', 'success', 'warning', 'danger', 'headingFont', 'bodyFont', 'monoFont', 'radius', 'spacing', 'density', 'shadow', 'typeScale'])
      assert.deepEqual(tokens[k], p.tokens[k], `${p.id}.${k}`);
  }
  const legacy = importTokens(JSON.stringify({ designSystem: { name: 'Old', accent: '#6554C0', background: '#faf9f6', text: '#202333', font: 'Georgia', radius: 12, spacing: 8 } }));
  assert.deepEqual(legacy.tokens, { background: '#faf9f6', text: '#202333', accent: '#6554c0', bodyFont: 'Georgia', radius: 12, spacing: 8 });
});

const TAILWIND = `const colors = require('tailwindcss/colors')
const defaultTheme = require("tailwindcss/defaultTheme");
require('child_process').execSync('touch ${path.join(os.tmpdir(), 'forma-tokens-pwned').replace(/\\/g, '/')}');
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true },
    extend: {
      colors: {
        primary: colors.indigo,
        background: '#f8fafc', // page
        foreground: "hsl(222 47% 11%)",
        muted: { DEFAULT: '#f1f5f9', foreground: '#64748b' },
        border: colors.slate['200'],
        card: { DEFAULT: 'hsl(var(--card))' },
        'brand-accent': \`#ff5500\`,
        danger: colors.red[600],
        ...extraColors,
        get computed() { return '#000000' },
        __proto__: { polluted: '#ffffff' },
      },
      fontFamily: {
        sans: ['Inter', ...defaultTheme.fontFamily.sans],
        display: ['"Space Grotesk"', 'sans-serif'],
        mono: \`ui-monospace, \${fontVar}\`,
      },
      borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', DEFAULT: '0.625rem' },
      keyframes: { spin: { to: { transform: 'rotate(360deg)' } } },
    },
  },
  plugins: [require('tailwindcss-animate'), function ({ addUtilities }) { addUtilities({}) }],
} satisfies Config;`;

test('importTokens: Tailwind config parsed leniently without evaluation', () => {
  const marker = path.join(os.tmpdir(), 'forma-tokens-pwned');
  fs.rmSync(marker, { force: true });
  const { tokens, notes } = importTokens(TAILWIND);
  assert.deepEqual(tokens, {
    background: '#f8fafc', text: '#0f1729', accent: '#4f46e5', muted: '#64748b', border: '#e2e8f0', danger: '#dc2626',
    headingFont: 'Space Grotesk', bodyFont: 'Inter', radius: 10,
  });
  assert.equal(fs.existsSync(marker), false);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.ok(notes.some((n) => /Read Tailwind theme: colors, fontFamily, borderRadius/.test(n)));
  assert.ok(notes.some((n) => /accent: #4f46e5 from theme\.colors\.primary \(colors\.indigo\[600\]\)/.test(n)));
  assert.ok(notes.some((n) => /Could not resolve .*card/.test(n)));
  assert.ok(!notes.some((n) => /Read CSS/.test(n)));
  assertSafeTokens(tokens);
});

test('importTokens: Tailwind fragments, object-literal input and CSS variable references', () => {
  const frag = importTokens(`colors: { brand: { 500: '#ff5500', 600: '#e64d00', 50: '#fff7f2' } }, fontFamily: { body: 'IBM Plex Sans, sans-serif' }`);
  assert.deepEqual(frag.tokens, { accent: '#e64d00', bodyFont: 'IBM Plex Sans' });
  const literal = importTokens(`{ theme: { colors: { primary: '#0f62fe', }, borderRadius: { DEFAULT: '4px' } } }`);
  assert.deepEqual(literal.tokens, { accent: '#0f62fe', radius: 4 });
  const json5 = importTokens(`{ // tokens\n color: { primary: { value: '#0f62fe' } }, }`);
  assert.equal(json5.tokens.accent, '#0f62fe');
  const mixed = importTokens(`:root { --primary: 262 83% 58%; --radius: 0.5rem; }
module.exports = { theme: { extend: { colors: { primary: 'hsl(var(--primary) / <alpha-value>)' }, borderRadius: { lg: 'var(--radius)' } } } }`);
  assert.equal(mixed.tokens.accent, normalizeColor('hsl(262 83% 58%)'));
  assert.equal(mixed.tokens.radius, 8);
  const fn = importTokens('module.exports = { theme: ({ theme }) => ({ colors: { primary: theme("colors.blue.500") } }) }');
  assert.deepEqual(fn.tokens, {});
  assert.deepEqual(parseLiteral('{ a: 1, "b": [true, null, "x", -2.5], c: { d: \'e\' }, f: g.h(1), }'), Object.assign(Object.create(null), { a: 1, b: [true, null, 'x', -2.5], c: Object.assign(Object.create(null), { d: 'e' }), f: parseLiteral('{f: g.h(1)}').f }));
});

test('importTokens: fonts map case-insensitively to bundled families; unsafe or generic names are dropped', () => {
  const r = importTokens(':root { --font-heading: "ibm plex sans"; --font-body: InterVariable, sans-serif; --font-mono: "jetbrainsmono"; }');
  assert.deepEqual(r.tokens, { headingFont: 'IBM Plex Sans', bodyFont: 'Inter', monoFont: 'JetBrains Mono' });
  assert.ok(r.notes.every((n) => !/not bundled/.test(n)));
  assert.ok(Object.keys(FONTS).includes(r.tokens.headingFont));
  const sys = importTokens('body { font-family: system-ui, -apple-system, "Segoe UI Emoji", sans-serif; }');
  assert.equal(sys.tokens.bodyFont, undefined);
  const evil = importTokens(':root { --font-body: "x;}</style><script>alert(1)</script>", Arial; --font-heading: "a{b}"; --font-mono: "a\\"b"; }');
  assert.equal(evil.tokens.bodyFont, 'Arial');
  assert.equal(evil.tokens.headingFont, undefined);
  assert.equal(evil.tokens.monoFont, undefined);
  assert.ok(evil.notes.every((n) => !/<script|<\/style/.test(n)));
  const seg = importTokens('body { font-family: "Segoe UI Variable", Arial; }');
  assert.equal(seg.tokens.bodyFont, 'Segoe UI');
});

test('importTokens: validation and empty results', () => {
  assert.throws(() => importTokens(42), (e) => e.status === 400 && /as text/.test(e.message));
  assert.throws(() => importTokens('   '), (e) => e.status === 400);
  assert.throws(() => importTokens('a'.repeat(200 * 1024 + 1)), (e) => e.status === 400 && /200 KB/.test(e.message));
  const none = importTokens('just some prose without tokens');
  assert.deepEqual(none.tokens, {});
  assert.ok(none.notes.some((n) => /No colours, fonts, radius or spacing/.test(n)));
  const proto = importTokens('{"__proto__": {"accent": "#ff0000", "polluted": 1}, "constructor": {"prototype": {"polluted": 1}}}');
  assert.equal({}.polluted, undefined);
  assertSafeTokens(proto.tokens);
});

test('importTokens: hostile inputs stay fast (no regex backtracking, bounded var() expansion, deep nesting)', () => {
  const big = 190 * 1024;
  const inputs = [
    '/*'.repeat(big / 2),
    ' '.repeat(big) + 'x',
    '{'.repeat(big),
    '}'.repeat(big),
    '--a:' + ' '.repeat(big - 10) + '!x',
    'a{border-radius:' + ' '.repeat(big - 40) + '1}',
    '"'.repeat(big),
    '['.repeat(big / 2),
    'theme: ' + '{a:'.repeat(big / 4),
    'colors: {' + 'a: [['.repeat(big / 6),
    '['.repeat(5000) + ']'.repeat(5000),
    '{' + '"a":{'.repeat(9000) + '}'.repeat(9001),
    ':root{' + Array.from({ length: 30 }, (_, i) => `--v${i}: ${`var(--v${i + 1}) `.repeat(20)};`).join('') + '--v30: #fff; --primary: var(--v0); }',
    ':root{--primary: var(--primary); --bg: var(--fg); --fg: var(--bg);}',
    'a{color:rgb(' + '1,'.repeat(big / 3) + ')}',
    ':root{--font-body:' + "'".repeat(big - 30) + '}',
  ];
  for (const input of inputs) {
    const start = process.hrtime.bigint();
    const r = importTokens(input.slice(0, 200 * 1024));
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert.ok(ms < 1500, `${ms.toFixed(0)} ms for input starting ${JSON.stringify(input.slice(0, 20))}`);
    assertSafeTokens(r.tokens);
  }
});

test('extractSource: hostile text inputs stay fast', async () => {
  const inputs = [
    { name: 'a.csv', data: Buffer.from('"'.repeat(5 * 1024 * 1024)) },
    { name: 'a.csv', data: Buffer.from(','.repeat(5 * 1024 * 1024)) },
    { name: 'a.txt', data: Buffer.from(' '.repeat(5 * 1024 * 1024) + 'x') },
    { name: 'a.html', data: Buffer.from('<div>'.repeat(500000)) },
    { name: 'a.html', data: Buffer.from('<p style="' + ' '.repeat(2 * 1024 * 1024) + '">x</p>') },
    { name: 'a.json', data: Buffer.from('['.repeat(500000)) },
    { name: 'a.docx', data: wordZip('<w:p a="' + ' '.repeat(3 * 1024 * 1024) + '"><w:r><w:t>x</w:t></w:r></w:p>' + '<w:tbl>'.repeat(50000)) },
    { name: 'deep.docx', data: wordZip('<w:p><w:r><w:t>deep</w:t></w:r>'.repeat(400000)) },
    { name: 'stray.docx', data: wordZip('<w:tbl>'.repeat(300) + '</w:x>'.repeat(3000000) + '<w:p><w:r><w:t>end</w:t></w:r></w:p>') },
    { name: 'lt.docx', data: wordZip('< '.repeat(3000000) + '>' + '</ '.repeat(1000000) + '>' + '<a b="'.repeat(100000)) },
    { name: 'attrs.docx', data: wordZip('<w:p><w:pPr><w:pStyle ' + 'a'.repeat(4 * 1024 * 1024) + ' w:val="Heading1"/></w:pPr><w:r><w:t>h</w:t></w:r></w:p>') },
    { name: 'sld.pptx', data: buildZip([
      { name: 'ppt/presentation.xml', data: '<p:presentation xmlns:p="p"/>' },
      { name: 'ppt/slides/slide1.xml', data: '<p:sld xmlns:p="p" xmlns:a="a"><p:graphicFrame><a:tbl>' + '<a:tr><a:tc><a:txBody><a:p><a:r><a:t>c</a:t></a:r></a:p></a:txBody></a:tc></a:tr>'.repeat(300000) + '</a:tbl></p:graphicFrame>' + '<p:sp>'.repeat(200000) + '</p:sld>' },
    ]) },
    { name: 'ids.pptx', data: buildZip([
      { name: 'ppt/presentation.xml', data: '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst>' + '<p:sldId id="1" r:id="rId1"/>'.repeat(300000) + '</p:sldIdLst></p:presentation>' },
      { name: 'ppt/_rels/presentation.xml.rels', data: '<Relationships>' + Array.from({ length: 6000 }, (_, i) => `<Relationship Id="rId${i}" Type="x/slide" Target="slides/slide${i}.xml"/>`).join('') + '</Relationships>' },
      { name: 'ppt/slides/slide1.xml', data: '<p:sld xmlns:p="p" xmlns:a="a"><p:sp><p:txBody><a:p><a:r><a:t>one</a:t></a:r></a:p></p:txBody></p:sp></p:sld>' },
    ]) },
  ];
  for (const input of inputs) {
    const start = process.hrtime.bigint();
    try { await extractSource(input); } catch (e) { assert.equal(e.status, 400, e.stack); }
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (process.env.FORMA_TIMING) console.log(input.name, ms.toFixed(0));
    assert.ok(ms < 4000, `${ms.toFixed(0)} ms for ${input.name}`);
  }
});
