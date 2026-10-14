'use strict';

// Inches in a 16:9 slide. The HTML preview uses the same geometry at 90 px/in.
function slideLayout(s) {
  const cover = s.layout === 'cover';
  const title = { x: 0.7, y: cover ? 1.35 : 0.95, w: 11.9, h: cover ? 1.65 : 1.05, fontSize: cover ? 40 : 30 };
  const subtitle = { x: 0.7, y: title.y + title.h + 0.14, w: 11.9, h: 0.65, fontSize: 20 };
  const top = s.subtitle ? subtitle.y + subtitle.h + 0.24 : title.y + title.h + 0.24;
  return { title, subtitle, content: { x: 0.7, y: top, w: 11.9, h: 6.65 - top }, cover };
}

function bodyHeight(text, width, fontSize = 20) {
  const chars = Math.max(10, Math.floor(width * 72 / (fontSize * 0.52)));
  const lines = String(text).split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / chars)), 0);
  return lines * fontSize * 1.25 / 72 + 0.08;
}

module.exports = { slideLayout, bodyHeight };
