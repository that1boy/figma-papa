'use strict';
const escape = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const INTERACTIONS = `document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;const t=document.getElementById(b.dataset.target);if(!t)return;switch(b.dataset.action){case'toggle':t.hidden=!t.hidden;b.setAttribute('aria-expanded',String(!t.hidden));break;case'tab':document.querySelectorAll('[data-panel]').forEach(p=>{if(p.dataset.panel===b.dataset.group)p.hidden=p!==t});document.querySelectorAll('[data-action="tab"]').forEach(p=>{if(p.dataset.group===b.dataset.group)p.setAttribute('aria-selected',String(p===b))});break;case'open':if(t.tagName==='DIALOG')t.showModal();break;case'close':if(t.tagName==='DIALOG')t.close();break}});document.addEventListener('input',e=>{if(e.target.dataset.action!=='filter')return;const t=document.getElementById(e.target.dataset.target);if(t)t.querySelectorAll('[data-row]').forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(e.target.value.toLowerCase()))});document.addEventListener('submit',e=>{e.preventDefault();let m=e.target.querySelector('[role="status"]');if(!m){m=document.createElement('p');m.setAttribute('role','status');e.target.append(m)}m.textContent='Saved in this preview only. No request has been sent.'});`;
const CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; font-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
function tableHTML(t) {
  return t
    ? `<table><thead><tr>${t.headers.map((h) => `<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map((r) => `<tr>${r.map((c) => `<td>${escape(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    : '';
}
function list(items) {
  return items?.length ? `<ul>${items.map((i) => `<li>${escape(i)}</li>`).join('')}</ul>` : '';
}
function picture(index, refs, caption = '') {
  const ref = refs[index];
  return ref
    ? `<figure><img src="${ref.data}" alt="${escape(caption || ref.name)}">${caption ? `<figcaption>${escape(caption)}</figcaption>` : ''}</figure>`
    : '';
}
function pageHTML(a, refs = [], page = null) {
  let body, css;
  if (a.kind === 'web') {
    body = a.html.replace(/\{\{reference:([01])\}\}/g, (_, n) => refs[Number(n)]?.data || '');
    css = a.css;
  } else {
    css = `*{box-sizing:border-box}body{margin:0;background:#eeedf1;color:${a.theme.text};font-family:Arial,sans-serif}h1,h2,p{margin-top:0}h1{font-size:42px;line-height:1.15;letter-spacing:-1px}h2{font-size:24px}p,li{font-size:20px;line-height:1.55}li{margin-bottom:14px}ul{padding-left:25px}table{width:100%;border-collapse:collapse;font-size:17px;text-align:left}th{background:${a.theme.accent};color:white}td,th{padding:14px;border-bottom:1px solid #dedde3}figure{margin:0}img{max-width:100%;max-height:360px;object-fit:contain}figcaption{font-size:13px;color:#777}.slide{width:1200px;height:675px;background:${a.theme.background};padding:55px 65px;margin:24px auto;position:relative;overflow:hidden}.slide.cover{display:flex;flex-direction:column;justify-content:center}.slide.cover h1{font-size:62px;max-width:900px}.slide .kicker{color:${a.theme.accent};font-size:13px;text-transform:uppercase;letter-spacing:2px;margin-bottom:18px}.slide .subtitle{color:#737180;font-size:24px;max-width:850px}.slide .number{position:absolute;bottom:22px;left:65px;font-size:12px;color:#888}.columns{display:grid;grid-template-columns:1fr 1fr;gap:60px}.columns h2{color:${a.theme.accent}}.image-layout{display:grid;grid-template-columns:1fr 1fr;gap:40px}.document{max-width:850px;margin:30px auto;background:white;padding:75px 80px;min-height:1100px}.document h1{font-size:36px;color:#111}.document h2{font-size:21px;margin-top:30px}.document p,.document li{font-size:16px;line-height:1.65}.document table{font-size:14px}.document .subtitle{color:#666;font-size:17px;margin-bottom:35px}@media print{body{background:white}.slide{margin:0;page-break-after:always}.document{margin:0;padding:0;min-height:0;max-width:none}h2{break-after:avoid}tr,figure{break-inside:avoid}}`;
    if (a.kind === 'slides') {
      const slides = page === null ? a.slides : [a.slides[page]].filter(Boolean);
      body = slides
        .map(
          (s, i) =>
            `<section class="slide ${s.layout === 'cover' ? 'cover' : ''}"><div class="kicker">${escape(a.title)}</div><h1>${escape(s.title)}</h1>${s.subtitle ? `<p class="subtitle">${escape(s.subtitle)}</p>` : ''}${s.layout === 'two-column' ? `<div class="columns">${s.columns.map((c) => `<div><h2>${escape(c.heading)}</h2><p>${escape(c.body)}</p>${list(c.bullets)}</div>`).join('')}</div>` : s.layout === 'image' ? `<div class="image-layout">${picture(s.imageIndex, refs)}<p>${escape(s.body)}</p></div>` : `${s.body ? `<p>${escape(s.body)}</p>` : ''}${list(s.bullets)}${tableHTML(s.table)}`}<span class="number">${String((page ?? i) + 1).padStart(2, '0')}</span></section>`,
        )
        .join('');
    } else
      body = `<article class="document"><h1>${escape(a.title)}</h1><p class="subtitle">${escape(a.subtitle)}</p>${a.blocks.map((b) => (b.type === 'heading' ? `<h2>${escape(b.text)}</h2>` : b.type === 'paragraph' ? `<p>${escape(b.text).replace(/\n/g, '<br>')}</p>` : b.type === 'bullets' ? list(b.items) : b.type === 'table' ? tableHTML(b.table) : picture(b.imageIndex, refs, b.text))).join('')}</article>`;
  }
  const scale =
    a.kind === 'slides'
      ? `function fitSlides(){document.querySelectorAll('.slide').forEach(s=>s.style.zoom=Math.min(1,(innerWidth-30)/1200))}fitSlides();addEventListener('resize',fitSlides);`
      : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${CSP}"><title>${escape(a.title)}</title><style>${css}\n[hidden]{display:none!important}img{max-width:100%}</style></head><body>${body}<script>${INTERACTIONS}${scale}</script></body></html>`;
}
function warnings(a, refs) {
  const w = [];
  if (a.kind === 'web' && /\{\{reference:([01])\}\}/.test(a.html))
    for (const m of a.html.matchAll(/\{\{reference:([01])\}\}/g))
      if (!refs[Number(m[1])]) w.push('A referenced image is missing.');
  if (a.kind === 'slides')
    for (const [i, s] of a.slides.entries()) {
      if (s.title.length > 75 || s.body.length + s.bullets.join('').length > 650)
        w.push(`Slide ${i + 1} has dense content; inspect the native export.`);
      if (s.imageIndex != null && !refs[s.imageIndex])
        w.push(`Slide ${i + 1} references a missing image.`);
    }
  if (a.kind === 'document')
    for (const b of a.blocks)
      if (b.imageIndex != null && !refs[b.imageIndex]) w.push('A document image is missing.');
  return [...new Set(w)];
}
module.exports = { pageHTML, escape, CSP, warnings, INTERACTIONS };
