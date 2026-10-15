'use strict';
// Only this application-owned script executes inside design previews and HTML exports.
// Model-produced scripts, network requests and inline event handlers remain forbidden.
// Both functions are injected through Function.prototype.toString: they must stay
// self-contained (no module-scope references) and must never contain a closing script tag.
function prototypeRuntime() {
  const screens = [...document.querySelectorAll('[data-forma-screen]')];
  const active = () => screens.find(s => !s.hidden) || document.body;
  const target = (id, from) => [...(from?.closest('[data-forma-screen]') || active()).querySelectorAll('[id]')].find(n => n.id === id);
  function navigate(id, focus = true) {
    const screen = screens.find(s => s.dataset.formaScreen === id);
    if (!screen) return false;
    screens.forEach(s => { s.hidden = s !== screen; });
    scrollTo(0, 0);
    if (focus) {
      const first = screen.querySelector('h1,h2,main');
      // The temporary tabindex only exists while the heading holds focus (stored markup stays unchanged).
      if (first) { if (!first.hasAttribute('tabindex')) { first.setAttribute('tabindex', '-1'); first.formaTabindex = true; first.addEventListener('blur', () => { first.removeAttribute('tabindex'); delete first.formaTabindex; }, { once: true }); } first.focus({ preventScroll: true }); }
    }
    dispatchEvent(new CustomEvent('forma:screen', { detail: id }));
    return true;
  }
  window.formaNavigate = navigate;
  // A navigate click also sets the hash: the resulting hashchange must not switch (and announce) twice.
  const hashScreen = () => { const id = location.hash.replace(/^#screen=/, ''); return screens.length && active().dataset?.formaScreen === id ? true : navigate(id, false); };
  addEventListener('hashchange', hashScreen);
  if (screens.length) { if (!hashScreen()) navigate(screens[0].dataset.formaScreen, false); }
  document.querySelectorAll('dialog').forEach(dialog => {
    // Every dialog has an exit even when the model forgot to generate one.
    if (!dialog.querySelector('[data-action="close"]')) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Close';
      button.setAttribute('aria-label', 'Close dialog'); button.dataset.formaRuntime = 'true';
      button.addEventListener('click', () => dialog.close()); dialog.prepend(button);
    }
    dialog.addEventListener('click', e => { if (e.target === dialog) { const b = dialog.getBoundingClientRect(); if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) dialog.close(); } });
  });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-action]'); if (!b) return;
    if (b.dataset.action === 'navigate') { e.preventDefault(); if (navigate(b.dataset.target)) location.hash = 'screen=' + b.dataset.target; return; }
    const t = target(b.dataset.target, b); if (!t) return;
    switch (b.dataset.action) {
      case 'toggle': e.preventDefault(); t.hidden = !t.hidden; b.setAttribute('aria-expanded', String(!t.hidden)); break;
      case 'tab':
        e.preventDefault(); active().querySelectorAll('[data-panel]').forEach(p => { if (p.dataset.panel === b.dataset.group) p.hidden = p !== t; });
        active().querySelectorAll('[data-action="tab"]').forEach(p => { if (p.dataset.group === b.dataset.group) p.setAttribute('aria-selected', String(p === b)); }); break;
      case 'open': e.preventDefault(); if (t.tagName === 'DIALOG' && !t.open) t.showModal(); break;
      case 'close': e.preventDefault(); if (t.tagName === 'DIALOG') t.close(); break;
    }
  });
  document.addEventListener('input', e => {
    if (e.target.dataset?.action !== 'filter') return;
    const t = target(e.target.dataset.target, e.target); if (!t) return;
    let visible = 0; t.querySelectorAll('[data-row]').forEach(r => { r.hidden = !r.textContent.toLowerCase().includes(e.target.value.toLowerCase()); if (!r.hidden) visible++; });
    // A paragraph is not valid inside a table: the empty-result message follows the whole table.
    const host = /^(TBODY|THEAD|TFOOT|TR)$/.test(t.tagName) ? t.closest('table') || t : t;
    let message = host.nextElementSibling;
    if (!message?.hasAttribute('data-forma-filter-status')) { message = document.createElement('p'); message.setAttribute('data-forma-filter-status', ''); message.dataset.formaRuntime = 'true'; message.setAttribute('role', 'status'); host.after(message); }
    message.hidden = !!visible;
    message.textContent = visible ? '' : 'No matching results. Try another search.';
  });
  document.addEventListener('submit', e => { e.preventDefault(); let m = e.target.querySelector('[role="status"]'); if (!m) { m = document.createElement('p'); m.setAttribute('role', 'status'); m.dataset.formaRuntime = 'true'; e.target.append(m); } m.textContent = 'Saved in this preview only. No request has been sent.'; });
}
function inspectorRuntime(channel, initialScreen) {
  let designing = false, selected = null;
  const roots = [...document.querySelectorAll('[data-forma-screen]')];
  const root = () => roots.find(n => !n.hidden) || document.body;
  // Element indexes must match DOMParser(stored screen HTML).body.querySelectorAll('*'). Runtime
  // nodes and the generated subtrees of expanded markup (icon SVG, chart drawing) are not stored;
  // a chart host's own authored children are, so they still count.
  const generated = n => {
    if (n.closest('[data-forma-runtime],[data-forma-generated]')) return true;
    const host = n.parentElement?.closest('[data-forma-expanded]');
    return !!host && host.getAttribute('data-forma-expanded') !== 'chart';
  };
  const nodes = () => [...root().querySelectorAll('*')].filter(n => n.tagName !== 'SCRIPT' && n.tagName !== 'STYLE' && !generated(n));
  const hostOf = n => { while (n && n.nodeType === 1 && generated(n)) n = n.parentElement; return n; };
  const send = (type, data = {}) => parent.postMessage({ channel, type, ...data }, '*');
  const kind = n => n.getAttribute('data-forma-expanded') || '';
  const chartTitle = n => { try { return String(JSON.parse(n.getAttribute('data-chart') || '{}').title || ''); } catch { return ''; } };
  // Compact stored form of an expanded host: its recorded source, otherwise rebuilt.
  function compact(n) {
    const source = n.getAttribute('data-forma-source');
    if (source) return source;
    if (kind(n) === 'icon') {
      const i = document.createElement('i');
      for (const k of ['data-icon', 'class', 'id', 'aria-label', 'title']) { const v = n.getAttribute(k); if (v != null) i.setAttribute(k, v); }
      return i.outerHTML;
    }
    const c = n.cloneNode(true); c.querySelectorAll('[data-forma-generated],[data-forma-runtime]').forEach(x => x.remove());
    c.removeAttribute('data-forma-expanded'); c.removeAttribute('data-forma-source');
    return c.outerHTML;
  }
  // Stored-equivalent outer HTML: no runtime nodes, compact icons and charts, reference placeholders,
  // and none of the inspector outline or runtime focus attributes.
  function storedHTML(node) {
    if (kind(node)) return compact(node);
    const clone = node.cloneNode(true), from = [node, ...node.querySelectorAll('*')], to = [clone, ...clone.querySelectorAll('*')], drop = [], swap = [];
    from.forEach((o, i) => {
      const c = to[i];
      if (o === selected) { c.style.outline = ''; c.style.outlineOffset = ''; if (!c.getAttribute('style')) c.removeAttribute('style'); }
      if (o.formaTabindex) c.removeAttribute('tabindex');
      if (c.hasAttribute('data-forma-reference')) { c.setAttribute('src', '{{reference:' + c.getAttribute('data-forma-reference') + '}}'); c.removeAttribute('data-forma-reference'); }
      if (o !== node && o.matches('[data-forma-runtime],[data-forma-generated]')) drop.push(c);
      else if (o !== node && kind(o)) swap.push([c, compact(o)]);
    });
    drop.forEach(c => c.remove());
    swap.forEach(([c, html]) => { const t = document.createElement('template'); t.innerHTML = html; c.replaceWith(t.content); });
    return clone.outerHTML;
  }
  function outline(node) { if (selected) { selected.style.outline = ''; selected.style.outlineOffset = ''; if (!selected.getAttribute('style')) selected.removeAttribute('style'); } selected = node; if (node) { node.style.outline = '2px solid #635bff'; node.style.outlineOffset = '2px'; } }
  function select(node, reveal = false) {
    const all = nodes(), index = all.indexOf(node); if (index < 0) return;
    outline(node); const s = getComputedStyle(node), k = kind(node);
    let html = storedHTML(node); const truncated = html.length > 20000; if (truncated) html = '';
    if (reveal) node.scrollIntoView({ block: 'nearest' });
    send('selection', { index, screen: root().dataset.formaScreen || 'home', tag: k === 'icon' ? 'i' : node.tagName.toLowerCase(),
      text: k === 'icon' ? '' : k === 'chart' ? chartTitle(node) : (node.innerText ?? node.textContent).slice(0, 5000), leaf: !k && [...node.children].every(n => n.tagName === 'BR'),
      styles: { color: s.color, background: s.backgroundColor, fontSize: s.fontSize, padding: s.padding, gap: s.gap, borderRadius: s.borderRadius, display: s.display, textAlign: s.textAlign },
      label: node.getAttribute('aria-label') || '', action: node.dataset?.action || '', target: node.dataset?.target || '', expanded: k, html, htmlTruncated: truncated });
  }
  const layerText = n => kind(n) === 'icon' ? 'Icon · ' + (n.getAttribute('data-icon') || '') : kind(n) === 'chart' ? 'Chart · ' + (chartTitle(n) || 'untitled') : (n.getAttribute('aria-label') || n.textContent || n.tagName).trim();
  function describe() {
    const all = nodes(), top = root();
    send('layers', { screen: top.dataset.formaScreen || 'home', layers: all.slice(0, 600).map((n, index) => ({ index, tag: kind(n) === 'icon' ? 'i' : n.tagName.toLowerCase(), text: layerText(n).slice(0, 65),
      depth: Math.min(8, (() => { let d = 0, p = n.parentElement; while (p && p !== top) { d++; p = p.parentElement; } return d; })()) })) });
  }
  // Live token preview from the parent: custom properties only, with plain values.
  const TOKEN_NAME = /^--[a-z0-9-]{1,62}$/, TOKEN_VALUE = /^(#[0-9a-fA-F]{3,8}|-?\d+(\.\d+)?(px|rem|em|%|vh|vw)?|[A-Za-z][A-Za-z0-9 ,'-]{0,80})$/;
  function tokens(vars) {
    if (!vars || typeof vars !== 'object' || Array.isArray(vars)) return;
    for (const [name, value] of Object.entries(vars).slice(0, 200)) {
      if (!TOKEN_NAME.test(name)) continue;
      if (value === null) { document.documentElement.style.removeProperty(name); continue; }
      const v = typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' ? value.trim() : '';
      if (TOKEN_VALUE.test(v)) document.documentElement.style.setProperty(name, v);
    }
  }
  addEventListener('message', e => {
    if (e.source !== parent || e.data?.channel !== channel) return;
    if (e.data.type === 'mode') { designing = !!e.data.designing; outline(null); document.documentElement.style.cursor = designing ? 'crosshair' : ''; }
    if (e.data.type === 'select' && Number.isInteger(e.data.index)) {
      if (typeof e.data.screen === 'string' && e.data.screen !== root().dataset.formaScreen) window.formaNavigate?.(e.data.screen, false);
      select(nodes()[e.data.index], true);
    }
    if (e.data.type === 'screen' && typeof e.data.screen === 'string') window.formaNavigate?.(e.data.screen, false);
    if (e.data.type === 'tokens') tokens(e.data.vars);
  });
  document.addEventListener('click', e => { if (!designing) return; e.preventDefault(); e.stopImmediatePropagation(); const n = hostOf(e.target); if (n) select(n); }, true);
  addEventListener('forma:screen', () => { outline(null); describe(); send('screen', { screen: root().dataset.formaScreen }); });
  if (initialScreen) window.formaNavigate?.(initialScreen, false);
  describe(); send('ready');
}
// JSON in a script body: "<" is escaped so no value can close the script element.
const literal = (v) => JSON.stringify(v ?? null).replace(/[<\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
module.exports = { INTERACTIONS: `(${prototypeRuntime.toString()})();`, inspectorScript: (channel, screen) => `(${inspectorRuntime.toString()})(${literal(channel)},${literal(screen)});` };
