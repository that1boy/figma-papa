'use strict';
const pptxgen = require('pptxgenjs');
const docx = require('docx');
function imageDimensions(data) {
  const b = Buffer.from(data.split(',')[1], 'base64');
  if (b[0] === 137) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  let i = 2;
  while (i + 8 < b.length) {
    if (b[i] !== 255) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    i += 2;
    if (marker === 216 || marker === 217) continue;
    const n = b.readUInt16BE(i);
    if (n < 2) break;
    if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker))
      return { height: b.readUInt16BE(i + 3), width: b.readUInt16BE(i + 5) };
    i += n;
  }
  return { width: 800, height: 500 };
}
async function exportPPTX(a, refs = []) {
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Design Pilot';
  pptx.subject = a.summary;
  pptx.title = a.title;
  pptx.company = 'Internal pilot';
  pptx.lang = 'en-US';
  pptx.theme = { headFontFace: 'Arial', bodyFontFace: 'Arial', lang: 'en-US' };
  const accent = a.theme.accent.slice(1),
    text = a.theme.text.slice(1);
  for (const [index, s] of a.slides.entries()) {
    const slide = pptx.addSlide();
    slide.background = { color: a.theme.background.slice(1) };
    const add = (value, opts) =>
      slide.addText(value, {
        fontFace: 'Arial',
        fontSize: 20,
        color: text,
        margin: 0,
        breakLine: false,
        fit: 'shrink',
        ...opts,
      });
    add(a.title, {
      x: 0.7,
      y: 0.35,
      w: 11.9,
      h: 0.25,
      fontSize: 11,
      color: accent,
      charSpacing: 1.5,
    });
    const cover = s.layout === 'cover';
    add(s.title, {
      x: 0.7,
      y: cover ? 2 : 1,
      w: 11.8,
      h: cover ? 1.8 : 1.2,
      fontSize: cover ? 42 : 32,
      bold: true,
      valign: 'mid',
    });
    if (s.subtitle)
      add(s.subtitle, {
        x: 0.7,
        y: cover ? 4.05 : 2.22,
        w: 11.5,
        h: 0.7,
        fontSize: 22,
        color: '666674',
      });
    if (s.layout === 'two-column') {
      s.columns.forEach((c, j) => {
        const x = 0.7 + j * 6.05;
        add(c.heading, { x, y: 2.65, w: 5.5, h: 0.5, fontSize: 24, color: accent, bold: true });
        let y = 3.35;
        if (c.body) {
          add(c.body, { x, y, w: 5.5, h: 1.2, fontSize: 19 });
          y += 1.4;
        }
        if (c.bullets.length)
          add(
            c.bullets.map((t) => ({
              text: t,
              options: { bullet: { indent: 18 }, breakLine: true },
            })),
            { x, y, w: 5.5, h: 6.8 - y, fontSize: 18, paraSpaceAfterPt: 12 },
          );
      });
    } else if (s.layout === 'table') {
      slide.addTable(
        [
          s.table.headers.map((text) => ({
            text,
            options: { bold: true, color: 'FFFFFF', fill: accent },
          })),
          ...s.table.rows,
        ],
        {
          x: 0.7,
          y: 2.65,
          w: 11.9,
          h: 3.7,
          fontFace: 'Arial',
          fontSize: 15,
          color: text,
          border: { type: 'solid', pt: 0.5, color: 'DDDDE3' },
          margin: 0.12,
          fill: 'FFFFFF',
          rowH: 0.4,
          autoPage: false,
        },
      );
    } else if (s.layout === 'image') {
      const ref = refs[s.imageIndex];
      if (ref) {
        const d = imageDimensions(ref.data);
        const factor = Math.min(6 / d.width, 3.8 / d.height);
        slide.addImage({
          data: ref.data,
          x: 0.7,
          y: 2.6,
          w: d.width * factor,
          h: d.height * factor,
        });
      }
      if (s.body) add(s.body, { x: 7.25, y: 2.7, w: 5.2, h: 3.9, fontSize: 22 });
    } else {
      let y = cover ? 5 : 2.7;
      if (s.body) {
        add(s.body, { x: 0.7, y, w: 11.5, h: cover ? 1 : 1.4, fontSize: cover ? 23 : 20 });
        y += 1.65;
      }
      if (s.bullets.length)
        add(
          s.bullets.map((t) => ({ text: t, options: { bullet: { indent: 21 }, breakLine: true } })),
          { x: 0.85, y, w: 11.2, h: Math.max(1, 6.7 - y), fontSize: 22, paraSpaceAfterPt: 15 },
        );
    }
    add(String(index + 1).padStart(2, '0'), {
      x: 0.7,
      y: 7,
      w: 1,
      h: 0.2,
      fontSize: 10,
      color: '777777',
    });
    if (s.notes) slide.addNotes(s.notes);
  }
  return Buffer.from(await pptx.write({ outputType: 'nodebuffer' }));
}
async function exportDOCX(a, refs = []) {
  const {
    Document,
    Paragraph,
    TextRun,
    Table,
    TableRow,
    TableCell,
    WidthType,
    HeadingLevel,
    Packer,
    ImageRun,
  } = docx;
  const children = [
    new Paragraph({ text: a.title, heading: HeadingLevel.TITLE }),
    ...(a.subtitle ? [new Paragraph({ text: a.subtitle, style: 'Subtitle' })] : []),
  ];
  for (const b of a.blocks) {
    if (b.type === 'heading')
      children.push(new Paragraph({ text: b.text, heading: HeadingLevel.HEADING_1 }));
    else if (b.type === 'paragraph')
      children.push(
        new Paragraph({ children: [new TextRun(b.text)], spacing: { after: 180, line: 300 } }),
      );
    else if (b.type === 'bullets')
      children.push(
        ...b.items.map(
          (text) => new Paragraph({ text, bullet: { level: 0 }, spacing: { after: 120 } }),
        ),
      );
    else if (b.type === 'table')
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [b.table.headers, ...b.table.rows].map(
            (row, i) =>
              new TableRow({
                tableHeader: i === 0,
                cantSplit: true,
                children: row.map(
                  (text) =>
                    new TableCell({
                      shading: i === 0 ? { fill: a.theme.accent.slice(1) } : undefined,
                      margins: { top: 100, bottom: 100, left: 110, right: 110 },
                      children: [
                        new Paragraph({
                          children: [
                            new TextRun({
                              text,
                              bold: i === 0,
                              color: i === 0 ? 'FFFFFF' : a.theme.text.slice(1),
                              size: 21,
                            }),
                          ],
                        }),
                      ],
                    }),
                ),
              }),
          ),
        }),
      );
    else if (b.type === 'image' && refs[b.imageIndex]) {
      const data = refs[b.imageIndex].data,
        d = imageDimensions(data),
        factor = Math.min(540 / d.width, 430 / d.height);
      children.push(
        new Paragraph({
          children: [
            new ImageRun({
              data: Buffer.from(data.split(',')[1], 'base64'),
              type: data.startsWith('data:image/png') ? 'png' : 'jpg',
              transformation: {
                width: Math.round(d.width * factor),
                height: Math.round(d.height * factor),
              },
              altText: {
                title: b.text || 'Reference image',
                description: b.text || refs[b.imageIndex].name,
                name: 'Reference image',
              },
            }),
          ],
        }),
      );
      if (b.text) children.push(new Paragraph({ text: b.text, style: 'Caption' }));
    }
  }
  const document = new Document({
    creator: 'Design Pilot',
    title: a.title,
    description: a.summary,
    styles: {
      default: {
        document: {
          run: { font: 'Arial', size: 23, color: a.theme.text.slice(1) },
          paragraph: { spacing: { after: 150, line: 300 } },
        },
      },
      paragraphStyles: [
        {
          id: 'Title',
          name: 'Title',
          basedOn: 'Normal',
          next: 'Normal',
          run: { font: 'Arial', size: 56, bold: true, color: '111111' },
          paragraph: { spacing: { after: 240 } },
        },
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: 'Arial', size: 30, bold: true, color: a.theme.accent.slice(1) },
          paragraph: { spacing: { before: 260, after: 140 }, keepNext: true },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
          },
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(document);
}
module.exports = { exportPPTX, exportDOCX, imageDimensions };
