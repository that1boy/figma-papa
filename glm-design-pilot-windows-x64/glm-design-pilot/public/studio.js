'use strict';
// The design editor owns an explicit, undoable draft. Preview frames have an opaque origin and
// exchange a small allowlisted message protocol (lib/design-runtime.cjs); they never access app
// APIs. Every model- or user-supplied string passes through esc() before it becomes HTML, and
// colours only reach style attributes after hex6() has validated them.
window.FormaStudio = (() => {
  const copy = value => structuredClone(value);
  let draft = null, base = null, pid = null, rid = null, screen = 'home', selection = null, layers = [], dirty = false;
  let undo = [], redo = [], channel = '', request = 0, mode = 'preview', right = 'properties', saving = false;
  let notes = [];                 // pending revision notes ("GLM element edit: …"), sent with the next save
  let glm = null;                 // in-flight GLM element edit: { controller, screen, index, started, timer }
  let glmOpen = true, glmText = '', glmMessage = null;
  let reselect = null;            // { screen, index } to select again once the refreshed frame is ready
  let live = { tweaks: {}, tokens: {} }, posted = new Set(); // unapplied tweak values and the CSS variables sent for them
  let notesCache = [], screenAction = 'add', stylePreset = 'custom', storedCache = { html: null, nodes: [] }, inserted = null;
  const blankLive = () => ({ tweaks: {}, tokens: {} });
  const screens = () => draft.screens || [{ id: 'home', name: 'Home', html: draft.html }];
  const current = () => screens().find(s => s.id === screen) || screens()[0];

  // ---- icons (application-owned SVG; never model input) ----
  const ICON = {
    play: '<path d="M7 4.5v15l12-7.5z"/>',
    pointer: '<path d="M5 3.5 19 10l-6.2 1.8L10.5 18z"/><path d="m13 12 5 5"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    focus: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
    palette: '<circle cx="13.5" cy="6.5" r="1.2"/><circle cx="17.5" cy="10.5" r="1.2"/><circle cx="8.5" cy="7.5" r="1.2"/><circle cx="6.5" cy="12.5" r="1.2"/><path d="M12 2a10 10 0 0 0 0 20c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.29-.29-.44-.65-.44-1.12a1.64 1.64 0 0 1 1.67-1.67h2a5.56 5.56 0 0 0 5.55-5.55C21.97 6.01 17.46 2 12 2z"/>',
    sliders: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
    message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    branch: '<circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v2a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V9M12 12v3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    sparkles: '<path d="M10 15.5A2 2 0 0 0 8.5 14l-6.1-1.6a.5.5 0 0 1 0-1L8.5 10A2 2 0 0 0 10 8.5l1.6-6.1a.5.5 0 0 1 1 0L14 8.5a2 2 0 0 0 1.5 1.5l6.1 1.6a.5.5 0 0 1 0 1L15.5 14a2 2 0 0 0-1.5 1.5l-1.6 6.1a.5.5 0 0 1-1 0z"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    up: '<path d="m5 12 7-7 7 7M12 19V5"/>',
    down: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
    parent: '<path d="M14 9 9 4 4 9"/><path d="M20 20h-7a4 4 0 0 1-4-4V4"/>',
    copy: '<rect width="13" height="13" x="9" y="9" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    pencil: '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
    reset: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
    code: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M10 13l-2 2 2 2M14 17l2-2-2-2"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
    heading: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
    text: '<path d="M21 6H3M17 12H3M15 18H3"/>',
    button: '<rect x="3" y="8" width="18" height="8" rx="4"/><path d="M9 12h6"/>',
    buttons: '<rect x="2" y="8" width="9" height="8" rx="3"/><rect x="13" y="8" width="9" height="8" rx="3"/>',
    card: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 13h6M7 16h4"/>',
    stat: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
    table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
    field: '<rect x="3" y="8" width="18" height="9" rx="2"/><path d="M7 11v3M3 5h7"/>',
    form: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    tabs: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M10 3v6"/>',
    dialog: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 9h20M15 14h3"/>',
    empty: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    alert: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    chart: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
    dashboard: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
    phone: '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    arrow: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  };
  const icon = (name, cls = '') => `<svg class="st-icon${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON[name] || ''}</svg>`;

  // ---- tokens, presets and fonts (from /api/config; local fallbacks keep older servers usable) ----
  const NEUTRAL = { name: 'Neutral SaaS', preset: 'neutral', accent: '#4f46e5', accent2: '#0891b2', background: '#fafafa', surface: '#ffffff', text: '#18181b', muted: '#5f5f69', border: '#e4e4e7', success: '#15803d', warning: '#b45309', danger: '#dc2626', headingFont: 'Inter', bodyFont: 'Inter', monoFont: 'JetBrains Mono', font: 'Inter', radius: 8, spacing: 8, density: 'comfortable', shadow: 'soft', typeScale: 1.25 };
  const LEGACY_PRESETS = [
    { id: 'legacy-violet', name: 'Forma / Violet', tokens: { accent: '#6554c0', background: '#f6f7fb', surface: '#ffffff', text: '#202333', muted: '#667085', font: 'Segoe UI', radius: 12, spacing: 8 } },
    { id: 'legacy-ink', name: 'Ink / Editorial', tokens: { accent: '#204e45', background: '#f6f4ee', surface: '#ffffff', text: '#202821', muted: '#626d65', font: 'Georgia', radius: 4, spacing: 8 } },
    { id: 'legacy-blue', name: 'Blue / Product', tokens: { accent: '#2555cf', background: '#f3f6fc', surface: '#ffffff', text: '#16243b', muted: '#5d6d85', font: 'Segoe UI', radius: 10, spacing: 8 } },
    { id: 'legacy-slate', name: 'Slate / Dark', tokens: { accent: '#a9a2ff', background: '#14171f', surface: '#202530', text: '#f2f4f9', muted: '#a3adbf', font: 'Segoe UI', radius: 16, spacing: 8 } },
  ];
  const presets = () => (Array.isArray(state.config?.presets) && state.config.presets.length ? state.config.presets : LEGACY_PRESETS);
  // [category, heading weight, heading tracking em, system font] mirrors lib/presets.cjs FONTS.
  const FONT_META = { 'Inter': ['sans', 650, -0.022], 'Manrope': ['sans', 700, -0.02], 'Space Grotesk': ['display', 600, -0.025], 'IBM Plex Sans': ['sans', 600, -0.01], 'Source Serif 4': ['serif', 600, -0.01], 'Fraunces': ['serif', 600, -0.015], 'JetBrains Mono': ['mono', 600, -0.02], 'DM Sans': ['sans', 650, -0.02], 'Plus Jakarta Sans': ['sans', 700, -0.02], 'Outfit': ['display', 600, -0.015], 'DM Serif Display': ['serif', 400, -0.005], 'Arial': ['sans', 700, -0.01, true], 'Segoe UI': ['sans', 650, -0.01, true], 'Georgia': ['serif', 700, -0.005, true], 'Verdana': ['sans', 700, -0.01, true], 'Trebuchet MS': ['sans', 700, -0.01, true] };
  const fontList = () => (Array.isArray(state.config?.fonts) && state.config.fonts.length ? state.config.fonts : Object.keys(FONT_META)).filter(f => typeof f === 'string' && /^[A-Za-z][A-Za-z0-9 -]{0,40}$/.test(f));
  const FALLBACK = { sans: 'system-ui, sans-serif', display: 'system-ui, sans-serif', serif: 'Georgia, serif', mono: 'ui-monospace, monospace' };
  // The frame accepts token values that start with a letter, so names that need quotes follow a placeholder family.
  function fontStack(name) {
    const meta = FONT_META[name] || ['sans'], plain = name.split(' ').every(w => /^[A-Za-z][\w-]*$/.test(w));
    return `${plain ? name : `FormaPreview, '${name}'`}, ${FALLBACK[meta[0]] || FALLBACK.sans}`;
  }
  function fontOptions(selected, { mono = true } = {}) {
    const all = fontList().filter(f => mono || (FONT_META[f]?.[0] !== 'mono') || f === selected);
    const group = (label, list) => list.length ? `<optgroup label="${label}">${list.map(f => `<option value="${esc(f)}" ${f === selected ? 'selected' : ''}>${esc(f)}</option>`).join('')}</optgroup>` : '';
    return group('Bundled fonts', all.filter(f => !FONT_META[f]?.[3])) + group('System fonts', all.filter(f => FONT_META[f]?.[3]));
  }
  const DENSITY = { compact: [[32, 36, 40], 2, '0.875rem'], comfortable: [[36, 40, 44], 2.5, '0.9375rem'], spacious: [[36, 44, 48], 3, '1rem'] };
  const COLOR_KEYS = ['accent', 'accent2', 'background', 'surface', 'text', 'muted', 'border'], STATUS_KEYS = ['success', 'warning', 'danger'];
  const COLOR_LABELS = { accent: 'Accent', accent2: 'Second accent', background: 'Background', surface: 'Surface', text: 'Text', muted: 'Muted text', border: 'Border', success: 'Success', warning: 'Warning', danger: 'Danger' };
  const hex6 = v => { const m = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(String(v ?? '').trim()); if (!m) return null; const h = m[1].toLowerCase(); return '#' + (h.length === 3 ? [...h].map(c => c + c).join('') : h); };
  const lum = h => { const a = hex6(h).slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  // Same rule as lib/kit.cjs derive(): white, else the system's own dark ink, else black.
  function onAccent(accent, t) { const ink = [t.text, t.background].map(hex6).find(c => c && lum(c) < 0.05) || '#0b0b0f'; return ['#ffffff', ink].find(x => ratio(x, accent) >= 4.5) || '#000000'; }
  // The draft's design tokens. Legacy designs that only carry a theme use the default preset's structure,
  // matching normalizeTokens on the server; Save stays the authoritative validation.
  function tokens() {
    const base = presets().find(p => p.id === 'neutral')?.tokens || NEUTRAL, ds = draft.designSystem;
    const out = { ...NEUTRAL, ...base };
    const src = ds && typeof ds === 'object' ? ds : { accent: draft.theme?.accent, background: draft.theme?.background, text: draft.theme?.text };
    for (const [k, v] of Object.entries(src)) if (v != null && v !== '') out[k] = v;
    if (ds?.font && !ds.bodyFont) out.bodyFont = ds.font;
    if (ds?.font && !ds.headingFont) out.headingFont = ds.font;
    for (const k of [...COLOR_KEYS, ...STATUS_KEYS]) out[k] = hex6(out[k]) || NEUTRAL[k];
    return out;
  }

  // ---- chrome ----
  $('preview-panel').insertAdjacentHTML('afterbegin', `<div id="studio-bar" hidden>
    <div class="segmented" role="group" aria-label="Canvas mode"><button id="interact-mode" class="active" type="button" aria-pressed="true" title="Interact with the prototype">${icon('play')}<span>Interact</span></button><button id="design-mode" type="button" aria-pressed="false" title="Select and edit elements">${icon('pointer')}<span>Design</span></button></div>
    <span id="draft-status" role="status" data-state="saved">Saved revision</span>
    <div class="studio-bar-actions">
      <div class="bar-group"><button id="studio-undo" class="bar-icon" type="button" title="Undo (Ctrl+Z)" aria-label="Undo design change">${icon('undo')}</button><button id="studio-redo" class="bar-icon" type="button" title="Redo (Ctrl+Shift+Z)" aria-label="Redo design change">${icon('redo')}</button></div>
      <span class="bar-divider" aria-hidden="true"></span>
      <button id="studio-focus" class="bar-button" type="button" title="Give the canvas more room">${icon('focus')}<span class="bar-label">Focus</span></button>
      <button id="studio-style" class="bar-button" type="button" aria-pressed="false" title="Project styles and tokens">${icon('palette')}<span class="bar-label">Styles</span></button>
      <button id="studio-tweaks" class="bar-button" type="button" aria-pressed="false" title="Live tweaks">${icon('sliders')}<span class="bar-label">Tweaks</span></button>
      <button id="studio-notes" class="bar-button" type="button" aria-pressed="false" title="Revision feedback">${icon('message')}<span class="bar-label">Feedback</span></button>
      <span class="bar-divider" aria-hidden="true"></span>
      <button id="studio-copy" class="bar-button" type="button" title="Explore an independent copy">${icon('branch')}<span class="bar-label">Explore a copy</span></button>
      <button id="studio-save" class="st-btn st-btn-primary" type="button" title="Save design (Ctrl+S)">Save design</button>
    </div></div>`);
  const layout = document.createElement('div'); layout.id = 'design-layout';
  layout.innerHTML = '<aside id="screen-rail" hidden aria-label="Screens and layers"></aside><div id="canvas-center"></div><aside id="design-inspector" hidden aria-label="Design properties"></aside>';
  $('preview-panel').append(layout);
  $('canvas-center').append($('frame-wrap'), $('native-pages'));
  const device = document.createElement('div'); device.id = 'device-frame';
  const frameLabel = document.createElement('div'); frameLabel.id = 'frame-label'; frameLabel.setAttribute('aria-hidden', 'true');
  $('frame-wrap').append(device); device.append(frameLabel, $('preview-frame'));
  document.querySelector('.preview-controls').querySelector('div').insertAdjacentHTML('beforeend', '<button id="tablet-view" class="chip" hidden>Tablet</button><label id="custom-size" hidden><span class="sr-only">Preview width</span><input id="viewport-width" type="number" min="320" max="1920" step="1" value="1280" aria-label="Preview width"><span>px</span></label><select id="canvas-zoom" aria-label="Canvas zoom" hidden><option value="fit">Fit</option><option value="1">100%</option><option value="0.75">75%</option><option value="0.5">50%</option></select>');
  document.body.insertAdjacentHTML('beforeend', `<dialog id="screen-dialog" class="st-dialog"><form id="screen-form"><div class="dialog-heading"><h2 id="screen-dialog-title">New screen</h2><button type="button" class="icon-button" data-close="screen-dialog" aria-label="Close">×</button></div><label>Screen name<input id="screen-name" maxlength="80" required autocomplete="off"></label><button type="submit" class="primary">Save screen</button></form></dialog>`);

  // ---- draft state ----
  function isWeb() { return state.project?.kind === 'web' && !!state.revision; }
  function writable() { if (state.revision?.id !== state.project?.current_id) throw new Error('Restore this revision or explore a copy before editing.'); if (state.job) throw new Error('Wait for or cancel generation before editing.'); }
  function leave() { if (!dirty) return true; if (!confirm('Discard unsaved design changes? Save design first to keep them.')) return false; abortGLM(); draft = copy(base); undo = []; redo = []; notes = []; live = blankLive(); dirty = false; rid = null; return true; }
  const snapshot = () => ({ draft: copy(draft), notes: [...notes] });
  function restore(s) { draft = s.draft; notes = s.notes; inserted = null; if (!screens().some(s => s.id === screen)) screen = screens()[0].id; }
  function checkpoint() { writable(); undo.push(snapshot()); if (undo.length > 60) undo.shift(); redo = []; }
  function setHTML(html, id = screen) { if (draft.screens) { (draft.screens.find(s => s.id === id) || current()).html = html; draft.html = draft.screens[0].html; } else draft.html = html; }
  const parse = html => new DOMParser().parseFromString(html, 'text/html');
  function documentForScreen(id = screen) { return parse((screens().find(s => s.id === id) || current()).html); }
  function elementAt(doc, index = selection?.index) { return doc.body.querySelectorAll('*')[index]; }
  const hasLive = () => Object.keys(live.tweaks).length + Object.keys(live.tokens).length > 0;
  function updateStatus() {
    dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(base);
    const history = state.revision?.id !== state.project?.current_id;
    $('draft-status').textContent = saving ? 'Saving…' : dirty ? 'Unsaved changes' : history ? 'Viewing history' : 'Saved revision';
    $('draft-status').dataset.state = saving ? 'saving' : dirty ? 'dirty' : history ? 'history' : 'saved';
    $('draft-status').title = notes.length ? `${notes.length} GLM element edit${notes.length === 1 ? '' : 's'} will be noted on Save` : '';
    $('studio-save').disabled = !dirty || saving || !!state.job;
    $('studio-undo').disabled = !undo.length; $('studio-redo').disabled = !redo.length;
    markPanel();
  }
  function changed() { updateStatus(); drawRail(); if (right === 'tweaks' && !$('design-inspector').hidden) drawTweaks(); refresh().catch(e => toast(e.message)); }
  function post(type, data = {}) { $('preview-frame').contentWindow?.postMessage({ channel, type, ...data }, '*'); }
  function markPanel() {
    const open = !$('design-inspector').hidden;
    for (const [id, panel] of [['studio-style', 'styles'], ['studio-tweaks', 'tweaks'], ['studio-notes', 'notes']]) $(id).setAttribute('aria-pressed', String(open && right === panel));
    $('studio-tweaks').classList.toggle('has-pending', hasLive());
  }

  // ---- canvas ----
  function fit() {
    if (!isWeb()) return;
    const w = Math.max(320, Math.min(1920, Number($('viewport-width').value) || 1280));
    const available = Math.max(200, $('canvas-center').clientWidth - 48), selected = $('canvas-zoom').value;
    const scale = selected === 'fit' ? Math.min(1, available / w) : Number(selected);
    const frame = $('preview-frame'), height = Math.max(600, ($('canvas-center').clientHeight - 72) / scale);
    frame.style.width = w + 'px'; frame.style.height = height + 'px'; frame.style.transform = `scale(${scale})`;
    device.style.width = w * scale + 'px'; device.style.height = height * scale + 'px';
    const name = current()?.name || 'Screen', zoom = Math.round(scale * 100), kind = w <= 480 ? 'Mobile' : w <= 1024 ? 'Tablet' : 'Desktop';
    $('preview-caption').textContent = `${name} · ${w}px · ${zoom}%`; device.dataset.kind = kind.toLowerCase();
    frameLabel.innerHTML = `<strong>${esc(name)}</strong><span>${kind} · ${w}px · ${zoom}%</span>`;
  }
  const observer = new ResizeObserver(() => fit()); observer.observe($('canvas-center'));
  async function refresh() {
    if (!draft) return; const seq = ++request; channel = crypto.randomUUID(); selection = null; layers = [];
    const response = await api(`/projects/${pid}/preview-draft`, 'POST', { artifact: draft, channel, screen });
    if (seq !== request || !isWeb()) return;
    // Keep user-entered source in the draft; validation is authoritative at Save.
    $('preview-frame').removeAttribute('srcdoc'); $('preview-frame').src = response.url;
    fit(); if (right === 'properties') drawProperties();
  }
  function syncMode() { for (const [id, m] of [['interact-mode', 'preview'], ['design-mode', 'design']]) { $(id).classList.toggle('active', mode === m); $(id).setAttribute('aria-pressed', String(mode === m)); } }
  function render(p, r, native) {
    $('studio-bar').hidden = false; $('screen-rail').hidden = native;
    for (const id of ['desktop-view', 'mobile-view', 'tablet-view', 'custom-size', 'canvas-zoom']) $(id).hidden = native;
    $('native-view').textContent = native ? 'Canvas' : 'Rendered views';
    $('frame-wrap').hidden = native; $('native-pages').hidden = !native;
    $('frame-wrap').classList.remove('mobile'); $('frame-wrap').style.height = '';
    if (pid !== p.id || rid !== r.id) {
      abortGLM(); pid = p.id; rid = r.id; draft = copy(r.artifact); base = copy(draft); undo = []; redo = []; notes = []; dirty = false;
      live = blankLive(); posted = new Set(); reselect = null; inserted = null; glmMessage = null; glmText = '';
      screen = screens()[0].id; selection = null; mode = 'preview'; right = 'properties'; refresh().catch(e => toast(e.message));
    }
    $('design-inspector').hidden = native || (mode !== 'design' && right === 'properties');
    syncMode();
    if (native) { const render = r.metrics.render; $('native-pages').innerHTML = render?.screenshots ? `<p>${esc(render.basis)} · ${Number(render.screenshots) || 0} captured view(s)</p>${Array.from({ length: Number(render.screenshots) || 0 }, (_, i) => `<figure><img src="/api/projects/${esc(pid)}/screenshot?revision=${esc(rid)}&page=${i}" alt="${esc(render.views?.[i] || 'Rendered view ' + (i + 1))}"><figcaption>${esc(render.views?.[i] || 'Page ' + (i + 1))}</figcaption></figure>`).join('')}` : '<div class="check-card"><h3>No rendered views yet</h3><p>Open Checks and choose Render exports.</p></div>'; }
    drawRail(); updateStatus(); fit();
  }
  function hide() {
    ++request; abortGLM(); draft = null; pid = null; rid = null; dirty = false; notes = []; live = blankLive();
    $('studio-bar').hidden = true; $('screen-rail').hidden = true; $('design-inspector').hidden = true;
    for (const id of ['tablet-view', 'custom-size', 'canvas-zoom']) $(id).hidden = true;
    const f = $('preview-frame'); f.removeAttribute('srcdoc'); f.style.width = ''; f.style.height = ''; f.style.transform = ''; device.style.width = '100%'; device.style.height = '100%'; frameLabel.textContent = '';
    // Slide and document previews fill the canvas: the wrapper needs a definite height for device height:100%.
    $('frame-wrap').style.height = '100%';
  }

  // ---- rail: screens and layers ----
  // Layer indexes match DOMParser(stored screen HTML).body.querySelectorAll('*'), so stored nodes give better names.
  function storedNodes() { const html = current()?.html || ''; if (storedCache.html !== html) storedCache = { html, nodes: [...parse(html).body.querySelectorAll('*')] }; return storedCache.nodes; }
  function chartTitle(n) { try { return String(JSON.parse(n.getAttribute('data-chart') || '{}').title || ''); } catch { return ''; } }
  function describeLayer(l) {
    const n = storedNodes()[l.index], fallback = { name: String(l.text || l.tag || ''), kind: l.kind === 'icon' || l.kind === 'chart' ? l.kind : /^Icon · /.test(l.text) && l.tag === 'i' ? 'icon' : /^Chart · /.test(l.text) ? 'chart' : '' };
    if (!n || n.tagName.toLowerCase() !== l.tag) { if (fallback.kind) fallback.name = fallback.name.replace(/^(Icon|Chart) · /, ''); return fallback; }
    if (n.matches('i[data-icon]')) return { name: n.getAttribute('data-icon') || 'icon', kind: 'icon' };
    if (n.hasAttribute('data-chart')) return { name: chartTitle(n) || 'Untitled chart', kind: 'chart' };
    const text = (n.textContent || '').replace(/\s+/g, ' ').trim(), aria = n.getAttribute('aria-label');
    if (n.tagName === 'IMG') return { name: n.getAttribute('alt') || 'Image', kind: '' };
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(n.tagName)) return { name: aria || n.getAttribute('placeholder') || n.getAttribute('name') || n.getAttribute('type') || n.tagName.toLowerCase(), kind: '' };
    const leaf = ![...n.children].some(c => !/^(BR|I|SVG|SPAN|STRONG|EM|B|SMALL|CODE|KBD|MARK|TIME)$/.test(c.tagName));
    if (leaf && text) return { name: text, kind: '' };
    const cls = [...n.classList].find(c => !/[:[\]/]/.test(c) && !/^(flex|grid|gap|p[xytrbl]?|m[xytrbl]?|w|h|min|max|items|justify|space|col|row|text|font|bg|border|rounded|shadow|lg|md|sm|xl)(-|$)/.test(c));
    return { name: aria || (n.id ? '#' + n.id : '') || cls || [...n.classList][0] || text || n.tagName.toLowerCase(), kind: '' };
  }
  function drawRail() {
    if (!draft) return;
    let iconDepth = -1;
    const rows = layers.map(l => {
      const depth = Math.max(0, Math.min(8, Number(l.depth) || 0)), index = Number(l.index) | 0;
      // Generated children of an icon never get a row (the runtime skips them too).
      if (iconDepth >= 0 && depth > iconDepth) return ''; iconDepth = -1;
      const { name, kind } = describeLayer(l); if (kind === 'icon') iconDepth = depth;
      return `<button type="button" data-layer="${index}" class="layer-item ${selection?.index === index ? 'selected' : ''}" style="padding-left:${8 + depth * 10}px" title="${esc(name)}"><small>${esc(l.tag)}</small><span class="layer-name">${esc(name.slice(0, 80))}</span>${kind ? `<em class="layer-kind lk-${kind}">${kind === 'icon' ? 'Icon' : 'Chart'}</em>` : ''}</button>`;
    }).join('');
    const keep = { list: $('layer-list')?.scrollTop || 0, screens: document.querySelector('#screen-rail .rail-section')?.scrollTop || 0 };
    $('screen-rail').innerHTML = `<div class="rail-section"><div class="rail-heading"><strong>Screens <span class="rail-count">${screens().length}</span></strong><button id="add-screen" type="button" class="rail-icon" aria-label="Add screen" title="Add screen">${icon('plus')}</button></div>
      <div class="screen-list">${screens().map((s, i) => `<button type="button" class="screen-item ${screen === s.id ? 'selected' : ''}" data-screen="${esc(s.id)}" ${screen === s.id ? 'aria-current="true"' : ''}><span class="screen-number">${String(i + 1).padStart(2, '0')}</span><span class="screen-name">${esc(s.name)}</span></button>`).join('')}</div>
      <div class="screen-actions"><button id="rename-screen" type="button" title="Rename this screen">${icon('pencil')}<span>Rename</span></button><button id="duplicate-screen" type="button" title="Duplicate this screen">${icon('copy')}<span>Copy</span></button><button id="remove-screen" type="button" title="Remove this screen" ${screens().length < 2 ? 'disabled' : ''}>${icon('trash')}<span>Remove</span></button></div></div>
      <div class="rail-heading layers-heading"><strong>${icon('layers')}Layers</strong><small class="rail-count">${layers.length}</small></div>
      <div id="layer-list">${rows || '<p class="muted rail-hint">Select Design to edit an element on the canvas.</p>'}</div>`;
    const list = $('layer-list'), active = list.querySelector('.layer-item.selected');
    list.scrollTop = keep.list; document.querySelector('#screen-rail .rail-section').scrollTop = keep.screens;
    // Bring the selected layer into view inside the list only (scrollIntoView would also move the page).
    if (active && list.clientHeight) { const box = active.getBoundingClientRect(), outer = list.getBoundingClientRect(); if (box.top < outer.top || box.bottom > outer.bottom) list.scrollTop += box.top - outer.top - list.clientHeight / 2; }
  }

  // ---- element inspector ----
  const field = (label, id, value, type = 'text', extra = '') => `<label class="st-field" for="${id}"><span>${label}</span><input id="${id}" type="${type}" value="${esc(value ?? '')}" ${extra}></label>`;
  const colorField = (label, id, value, extra = '', shown = null) => `<label class="st-color" for="${id}"><input id="${id}" type="color" value="${esc(hex6(value) || '#000000')}" ${extra}><span class="st-color-text"><span>${label}</span><output data-hex-for="${id}">${esc(shown ?? (hex6(value) || '#000000').toUpperCase())}</output></span></label>`;
  const heading = (eyebrow, title, close = 'Close panel', extra = '') => `<div class="inspector-heading"><div class="inspector-title"><span class="insp-eyebrow">${eyebrow}</span><strong>${title}</strong></div><div class="inspector-tools">${extra}<button id="close-inspector" type="button" class="insp-icon" aria-label="${close}" title="${close}">${icon('x')}</button></div></div>`;
  const COMPONENTS = [['heading', 'Heading'], ['text', 'Text'], ['button', 'Button'], ['buttons', 'Button group'], ['card', 'Card'], ['stat', 'Stats'], ['table', 'Table'], ['field', 'Form field'], ['form', 'Form'], ['tabs', 'Tabs'], ['dialog', 'Dialog'], ['empty', 'Empty state'], ['alert', 'Alert'], ['chart', 'Chart']];
  const componentSection = () => `<section class="insp-section component-section"><h3 class="insp-title">Add a component</h3><p class="insp-help">Kit components go into the selected container, or at the end of this screen.</p><div class="component-grid">${COMPONENTS.map(([k, label]) => `<button type="button" data-component="${k}" title="Insert ${label.toLowerCase()}">${icon(k === 'buttons' ? 'buttons' : k)}<span>${label}</span></button>`).join('')}</div></section>`;
  function parentIndex() {
    if (!selection) return -1;
    const doc = documentForScreen(), el = elementAt(doc), parent = el?.parentElement;
    return parent && parent !== doc.body ? [...doc.body.querySelectorAll('*')].indexOf(parent) : -1;
  }
  function glmCard() {
    const running = !!glm, here = running && glm.screen === screen && glm.index === selection?.index, msg = glmMessage;
    const demo = state.config?.mode === 'demo';
    return `<section class="glm-card${running ? ' is-running' : ''}" aria-label="GLM element edit">
      <button id="revise-element" type="button" class="glm-toggle" aria-expanded="${glmOpen}" aria-controls="element-edit-form">${icon('sparkles', 'glm-mark')}<span>Ask GLM to refine this</span>${demo ? '<em class="glm-badge">Demo</em>' : ''}${icon('chevron', 'glm-chevron')}</button>
      <form id="element-edit-form" class="glm-form" ${glmOpen ? '' : 'hidden'}>
        <label class="sr-only" for="element-instruction">Instruction for GLM</label>
        <textarea id="element-instruction" rows="3" maxlength="4000" placeholder="Describe the change, e.g. “Turn this into a two-column card with an icon and a clearer call to action.”" ${running ? 'disabled' : ''}>${esc(glmText)}</textarea>
        ${running
          ? `<div class="glm-progress" role="status"><span class="st-spinner" aria-hidden="true"></span><span>GLM is editing ${here ? 'this element' : `an element on “${esc(screens().find(s => s.id === glm.screen)?.name || glm.screen)}”`}… <span id="element-edit-elapsed">${Math.round((Date.now() - glm.started) / 1000)}s</span></span><button id="element-edit-cancel" type="button" class="st-btn st-btn-sm">Cancel</button></div>`
          : `<div class="glm-actions"><kbd class="glm-kbd" title="Ctrl or Cmd + Enter">Ctrl ↵</kbd><button id="element-edit-submit" type="submit" class="st-btn st-btn-accent">${icon('sparkles')}Apply with GLM</button></div>`}
        <p id="element-edit-status" class="glm-status${msg ? ' tone-' + msg.tone : ''}" role="${msg?.tone === 'error' ? 'alert' : 'status'}">${msg ? esc(msg.text) : ''}</p>
        ${running || msg ? '' : '<p class="insp-help glm-help">Only this element changes. The result is an undoable draft edit; Save stays manual.</p>'}
      </form></section>`;
  }
  function drawProperties() {
    if (!draft) return; right = 'properties'; markPanel();
    const el = selection;
    if (!el) {
      $('design-inspector').innerHTML = `${heading('Design', 'Properties', 'Close properties')}<div class="inspector-empty"><span class="empty-tile">${icon('pointer')}</span><h3>Select something to refine.</h3><p>Click an element in Design mode, or choose it from Layers. Edit text, spacing, colour and navigation here, or ask GLM to rework it.</p></div>${glm ? `<div class="insp-section">${glmCard()}</div>` : ''}${componentSection()}`;
      return;
    }
    const kind = el.expanded === 'icon' || el.expanded === 'chart' ? el.expanded : '';
    const stored = elementAt(documentForScreen()), up = parentIndex();
    let chart = '';
    if (kind === 'chart') { const raw = stored?.getAttribute('data-chart') || ''; try { chart = JSON.stringify(JSON.parse(raw), null, 2); } catch { chart = raw; } }
    const title = `<code>${esc(el.tag)}</code>${kind ? `<em class="layer-kind lk-${kind}">${kind === 'icon' ? 'Icon' : 'Chart'}</em>` : ''}<span class="insp-snippet">${esc((kind === 'icon' ? stored?.getAttribute('data-icon') || '' : el.text).replace(/\s+/g, ' ').trim().slice(0, 48))}</span>`;
    const content = kind === 'icon'
      ? `${field('Icon name', 'element-icon', stored?.getAttribute('data-icon') || '', 'text', 'maxlength="60" autocomplete="off" spellcheck="false"')}<p class="insp-help">A Lucide icon name, such as search, bell or arrow-right.</p>`
      : kind === 'chart'
        ? `<label class="st-field" for="element-chart"><span>Chart data (JSON)</span><textarea id="element-chart" rows="9" spellcheck="false" class="mono">${esc(chart)}</textarea></label><p class="insp-help">type, title, labels, series [{name, values}] and unit. Label sample figures as sample data.</p>`
        : `<label class="st-field" for="element-text"><span>Text</span><textarea id="element-text" rows="3" maxlength="5000" ${el.leaf ? '' : 'disabled'}>${esc(el.text)}</textarea></label>${!el.leaf ? '<p class="insp-help">Select a text layer to edit its content without replacing child elements.</p>' : ''}`;
    $('design-inspector').innerHTML = `${heading('Element', title, 'Close properties', `<button id="select-parent" type="button" class="insp-icon" aria-label="Select parent element" title="Select parent" ${up < 0 ? 'disabled' : ''} data-parent="${up}">${icon('parent')}</button>`)}
      <div class="insp-section">${glmCard()}</div>
      <form id="property-form" class="insp-form">
        <section class="insp-section"><h3 class="insp-title">Content</h3>${content}${field('Accessible label', 'element-label', el.label, 'text', 'maxlength="200"')}</section>
        <section class="insp-section"><h3 class="insp-title">Appearance</h3><div class="property-grid">${colorField('Text color', 'element-color', toHex(el.styles.color))}${colorField('Background', 'element-background', toHex(el.styles.background), clear(el.styles.background) ? 'data-clear="true"' : '', clear(el.styles.background) ? 'None' : null)}</div><div class="property-grid">${field('Font size (px)', 'element-size', parseFloat(el.styles.fontSize), 'number', 'min="8" max="160"')}${field('Corner radius', 'element-radius', parseFloat(el.styles.borderRadius) || 0, 'number', 'min="0" max="160"')}</div></section>
        <section class="insp-section"><h3 class="insp-title">Layout</h3><div class="property-grid">${field('Padding (px)', 'element-padding', parseFloat(el.styles.padding) || 0, 'number', 'min="0" max="160"')}${field('Gap (px)', 'element-gap', parseFloat(el.styles.gap) || 0, 'number', 'min="0" max="160"')}</div><div class="property-grid"><label class="st-field" for="element-display"><span>Layout</span><select id="element-display">${['block', 'flex', 'grid', 'inline', 'inline-block', 'inline-flex', 'none'].map(d => `<option ${el.styles.display === d ? 'selected' : ''}>${d}</option>`).join('')}</select></label><label class="st-field" for="element-align"><span>Text alignment</span><select id="element-align">${['start', 'left', 'center', 'right'].map(d => `<option ${el.styles.textAlign === d ? 'selected' : ''}>${d}</option>`).join('')}</select></label></div></section>
        <section class="insp-section"><h3 class="insp-title">Interaction</h3><label class="st-field" for="element-link"><span>Link to screen</span><select id="element-link"><option value="">Keep current interaction</option>${screens().map(s => `<option value="${esc(s.id)}" ${el.action === 'navigate' && el.target === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label></section>
        <div class="insp-sticky"><button type="submit" class="st-btn st-btn-primary st-btn-block">Apply changes</button></div>
      </form>
      <section class="insp-section"><h3 class="insp-title">Arrange</h3><div class="element-actions"><button type="button" data-element-action="up">${icon('up')}Move up</button><button type="button" data-element-action="down">${icon('down')}Move down</button><button type="button" data-element-action="duplicate">${icon('copy')}Duplicate</button><button type="button" data-element-action="remove" class="is-danger">${icon('trash')}Remove</button></div><button id="comment-element" type="button" class="st-btn st-btn-block">${icon('message')}Comment on this element</button></section>
      ${componentSection()}`;
  }
  // Computed colours arrive as rgb(), oklab() or color(srgb …) (kit tints use color-mix); a 1×1 canvas resolves any of them.
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  function paint(value) {
    if (/^#[\da-f]{6}$/i.test(value || '')) return { hex: value.toLowerCase(), alpha: 255 };
    try { probe.clearRect(0, 0, 1, 1); probe.fillStyle = '#000'; probe.fillStyle = String(value || 'transparent'); probe.fillRect(0, 0, 1, 1); const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data; return { hex: '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''), alpha: a }; }
    catch { return { hex: '#ffffff', alpha: 0 }; }
  }
  const clear = value => paint(value).alpha === 0;
  function toHex(value) { const p = paint(value); return p.alpha === 0 ? '#ffffff' : p.hex; }
  function mutateElement(fn) { writable(); if (!selection) throw new Error('Select an element first.'); const doc = documentForScreen(), el = elementAt(doc); if (!el) throw new Error('Select the element again.'); checkpoint(); fn(el, doc); setHTML(doc.body.innerHTML); changed(); }
  function elementStyles(el, values) {
    let key = el.dataset.designId;
    if (!key || !/^f-[\da-f-]+$/.test(key)) { key = 'f-' + crypto.randomUUID(); el.dataset.designId = key; }
    const selector = '[data-design-id="' + key + '"]';
    const marker = selector + '{', from = draft.css.indexOf(marker), to = from < 0 ? -1 : draft.css.indexOf('}', from);
    const previous = {};
    if (from >= 0 && to >= 0) { for (const rule of draft.css.slice(from + marker.length, to).split(';')) { const colon = rule.indexOf(':'); if (colon > 0) previous[rule.slice(0, colon).trim()] = rule.slice(colon + 1).trim(); } draft.css = draft.css.slice(0, from) + draft.css.slice(to + 1); }
    draft.css += '\n' + marker + Object.entries({ ...previous, ...values }).map(([k, v]) => k + ':' + v).join(';') + '}';
  }
  function cloneElement(el) { const clone = el.cloneNode(true), all = [clone, ...clone.querySelectorAll('*')], ids = new Map(), suffix = '-' + crypto.randomUUID().slice(0, 8); for (const n of all) { if (n.dataset.designId) { const old = n.dataset.designId, newKey = 'f-' + crypto.randomUUID(), marker = '[data-design-id="' + old + '"]{', from = draft.css.indexOf(marker), to = from < 0 ? -1 : draft.css.indexOf('}', from); n.dataset.designId = newKey; if (to >= 0) draft.css += '\n[data-design-id="' + newKey + '"]{' + draft.css.slice(from + marker.length, to) + '}'; } if (n.id) { ids.set(n.id, n.id + suffix); n.id += suffix; } } for (const n of all) { for (const a of ['for', 'data-target', 'aria-controls', 'aria-describedby', 'aria-labelledby']) if (ids.has(n.getAttribute(a))) n.setAttribute(a, ids.get(n.getAttribute(a))); if (n.getAttribute('href')?.startsWith('#') && ids.has(n.getAttribute('href').slice(1))) n.setAttribute('href', '#' + ids.get(n.getAttribute('href').slice(1))); } return clone; }
  // Kit-based snippets: the kit and utility engine style them, so no component CSS is injected.
  function component(type) {
    const uid = 'c-' + crypto.randomUUID().slice(0, 8);
    const chart = JSON.stringify({ type: 'bar', title: 'Requests per month (sample data)', labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'], series: [{ name: 'Requests', values: [12, 18, 15, 22, 19, 26] }], unit: '' });
    const stat = (iconName, label, value, delta, tone) => `<div class="stat"><p class="stat-label"><i data-icon="${iconName}"></i>${label}</p><p class="stat-value">${value}</p><p class="stat-delta${tone ? ' ' + tone : ''}">${delta}</p></div>`;
    const row = (item, owner, status, tone, updated) => `<tr><td data-label="Item">${item}</td><td data-label="Owner">${owner}</td><td data-label="Status"><span class="badge badge-${tone}">${status}</span></td><td data-label="Updated" class="num">${updated}</td></tr>`;
    return {
      heading: '<h2>Section heading</h2>',
      text: '<p>Add the details your audience needs.</p>',
      button: '<button type="button" class="btn btn-primary">Button label</button>',
      buttons: '<div class="cluster"><button type="button" class="btn btn-primary">Primary action</button><button type="button" class="btn btn-secondary">Secondary action</button></div>',
      card: '<article class="card"><div class="card-header"><div><h2 class="card-title">Card title</h2><p class="card-description">One line of supporting detail</p></div></div><div class="card-body"><p>Describe one useful item or next step.</p></div></article>',
      stat: `<section class="grid gap-4 sm:grid-cols-3" aria-label="Key figures (sample data)">${stat('inbox', 'Open items', '24', '<i data-icon="trending-down"></i>3 fewer than last week', 'is-positive')}${stat('clock', 'Median wait', '1.4 days', 'Same as last week', '')}${stat('circle-check', 'Completed', '58', '<i data-icon="trending-up"></i>9 more than last week', 'is-positive')}</section>`,
      table: `<section class="card"><div class="card-header"><h2 class="card-title">Items</h2><span class="badge badge-neutral">Sample data</span></div><div class="table-wrap"><table><caption class="sr-only">Items (sample data)</caption><thead><tr><th scope="col">Item</th><th scope="col">Owner</th><th scope="col">Status</th><th scope="col" class="num">Updated</th></tr></thead><tbody>${row('Example item', 'Asha Kumar', 'In review', 'warning', 'Today')}${row('Second item', 'Leo Martin', 'Complete', 'success', 'Yesterday')}${row('Third item', 'Rosa Nunez', 'Open', 'info', 'Last week')}</tbody></table></div></section>`,
      field: `<div class="field"><label for="${uid}">Field label</label><input id="${uid}" name="${uid}" placeholder="Example value" aria-describedby="${uid}-help"><p class="help" id="${uid}-help">A short hint about what to enter.</p></div>`,
      form: `<form class="card"><div class="card-header"><h2 class="card-title">New request</h2></div><div class="card-body stack"><div class="field"><label for="${uid}">Request details</label><textarea id="${uid}" name="details" rows="3" required></textarea></div></div><div class="card-footer"><button type="submit" class="btn btn-primary">Save example request</button></div></form>`,
      tabs: `<section class="stack"><div class="tabs" role="tablist" aria-label="Details"><button class="tab" role="tab" aria-selected="true" data-action="tab" data-group="${uid}" data-target="${uid}-a">Overview</button><button class="tab" role="tab" aria-selected="false" data-action="tab" data-group="${uid}" data-target="${uid}-b">Activity</button></div><div id="${uid}-a" role="tabpanel" data-panel="${uid}"><p>Overview content.</p></div><div id="${uid}-b" role="tabpanel" data-panel="${uid}" hidden><p>No activity yet.</p></div></section>`,
      dialog: `<div><button type="button" class="btn btn-secondary" data-action="open" data-target="${uid}">Open details</button><dialog id="${uid}" aria-labelledby="${uid}-title"><h2 class="dialog-title" id="${uid}-title">Details</h2><p class="dialog-description">Add useful details here.</p><div class="dialog-footer"><button type="button" class="btn btn-secondary" data-action="close" data-target="${uid}">Close</button><button type="button" class="btn btn-primary" data-action="close" data-target="${uid}">Done</button></div></dialog></div>`,
      empty: '<div class="empty-state"><span class="icon-tile"><i data-icon="inbox"></i></span><h3>Nothing here yet</h3><p>Items you add will appear here.</p><button type="button" class="btn btn-secondary">Add the first item</button></div>',
      alert: '<div class="alert alert-info" role="status"><i data-icon="info"></i><div><p class="alert-title">Heads up</p><p>Explain what changed and what to do next.</p></div></div>',
      chart: `<figure class="chart" data-chart='${chart.replace(/'/g, '&#39;')}'></figure>`,
    }[type];
  }
  function modeTo(value) { mode = value; right = 'properties'; syncMode(); $('design-inspector').hidden = mode !== 'design'; post('mode', { designing: mode === 'design' }); if (mode === 'design') drawProperties(); markPanel(); fit(); }
  async function save() {
    writable(); if (!dirty || saving) return; saving = true; updateStatus();
    try {
      const note = notes.join('; ').slice(0, 300);
      await api(`/projects/${pid}/save`, 'POST', { baseId: rid, artifact: draft, ...(note ? { note } : {}) });
      dirty = false; notes = []; await openProject(pid); await loadProjects(); toast('Design saved as a new revision.');
    } finally { saving = false; updateStatus(); }
  }

  // ---- GLM element edit ----
  async function call(url, data, signal) {
    const res = await fetch('/api' + url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Request': '1' }, body: JSON.stringify(data), signal });
    let value = {}; try { value = await res.json(); } catch { /* non-JSON error page */ }
    if (!res.ok) { if (res.status === 401) { $('app').hidden = true; $('login').hidden = false; } const error = new Error(value.error || 'Request failed.'); error.status = res.status; throw error; }
    return value;
  }
  function abortGLM() { if (glm) { clearInterval(glm.timer); glm.controller.abort(); glm = null; } }
  function glmRedraw() { if (right === 'properties' && !$('design-inspector').hidden) drawProperties(); }
  async function glmEdit() {
    writable();
    if (glm) return;
    if (!selection) throw new Error('Select an element first.');
    const instruction = ($('element-instruction')?.value ?? glmText).trim();
    if (!instruction) { $('element-instruction')?.focus(); throw new Error('Describe the change you want GLM to make.'); }
    const target = { pid, rid, screen, index: selection.index };
    if (!(base.screens || [{ id: 'home' }]).some(s => s.id === target.screen)) throw new Error('Save design first: this screen is new in your draft, and GLM uses the saved revision as context.');
    const el = elementAt(documentForScreen(target.screen), target.index);
    if (!el) throw new Error('Select the element again.');
    const element = el.outerHTML;
    if (element.length > 20000) throw new Error('This element is larger than 20,000 characters. Select a smaller part of it for a GLM edit.');
    glmText = instruction; glmMessage = null;
    glm = { controller: new AbortController(), screen: target.screen, index: target.index, started: Date.now(), timer: setInterval(() => { const n = $('element-edit-elapsed'); if (n && glm) n.textContent = Math.round((Date.now() - glm.started) / 1000) + 's'; }, 1000) };
    const job = glm; glmRedraw();
    try {
      const out = await call(`/projects/${target.pid}/element-edit`, { revisionId: target.rid, screen: target.screen, element, instruction }, job.controller.signal);
      if (glm !== job || pid !== target.pid || rid !== target.rid || !draft) return;
      if (typeof out.html !== 'string' || !out.html.trim()) throw new Error('GLM returned no usable markup for this element. Nothing was changed.');
      const doc = documentForScreen(target.screen), node = elementAt(doc, target.index);
      if (!node || node.outerHTML !== element) throw new Error('The element changed while GLM was working, so the result was not applied. Select it and try again.');
      checkpoint();
      node.outerHTML = out.html;
      setHTML(doc.body.innerHTML, target.screen);
      if (typeof out.css === 'string' && out.css.trim()) draft.css = (draft.css ? draft.css + '\n' : '') + out.css.trim();
      notes.push(('GLM element edit: ' + instruction).slice(0, 300));
      glmText = '';
      glmMessage = { tone: 'success', text: out.notes ? 'Applied. GLM notes: ' + String(out.notes).slice(0, 400) : 'Applied to the draft. Undo to revert, or Save design to keep it.' };
      if (mode === 'design' && screen === target.screen) reselect = { screen: target.screen, index: target.index };
      clearInterval(job.timer); glm = null;
      changed();
      toast('GLM updated the element. Undo to revert, or Save design to keep it.');
    } catch (e) {
      if (glm !== job) return;
      glmMessage = e.name === 'AbortError' ? { tone: 'info', text: 'Cancelled. Nothing was changed.' } : { tone: e.status === 409 ? 'warning' : 'error', text: e.message };
      if (e.name !== 'AbortError') toast(e.message);
    } finally {
      if (glm === job) { clearInterval(job.timer); glm = null; }
      glmRedraw();
    }
  }

  // ---- tweaks: live token preview through {type:'tokens'} ----
  const CORE_VARS = { accent: '--accent', radius: '--radius', spacing: '--space', typeScale: '--type-scale' };
  const tweakList = () => (Array.isArray(draft?.tweaks) ? draft.tweaks : []).filter(t => t && typeof t.var === 'string' && /^--[a-z][a-z0-9-]{1,40}$/.test(t.var));
  function liveVars() {
    const L = live.tokens, t = { ...tokens(), ...L }, vars = {};
    if ('accent' in L) { vars['--accent'] = t.accent; vars['--on-accent'] = onAccent(t.accent, t); if (ratio(t.accent, t.surface) >= 3) vars['--chart-1'] = t.accent; }
    if ('radius' in L) vars['--radius'] = t.radius + 'px';
    if ('spacing' in L) vars['--space'] = t.spacing + 'px';
    if ('density' in L) {
      const [controls, pad, body] = DENSITY[t.density] || DENSITY.comfortable, spaceTweak = tweakList().find(x => x.var === '--space' && (x.unit ?? 'px') === 'px');
      const spacing = spaceTweak ? (live.tweaks['--space'] ?? spaceTweak.value) : t.spacing;
      Object.assign(vars, { '--pad': Math.round(spacing * pad * 100) / 100 + 'px', '--control-sm': controls[0] + 'px', '--control': controls[1] + 'px', '--control-lg': controls[2] + 'px', '--text-body': body });
    }
    if ('typeScale' in L) vars['--type-scale'] = String(t.typeScale);
    if ('headingFont' in L) { const m = FONT_META[t.headingFont] || ['sans', 650, -0.02]; Object.assign(vars, { '--font-heading': fontStack(t.headingFont), '--heading-weight': String(m[1]), '--heading-tracking': m[2] + 'em' }); }
    if ('bodyFont' in L) { vars['--font'] = fontStack(t.bodyFont); vars['--leading-normal'] = (FONT_META[t.bodyFont] || ['sans'])[0] === 'serif' ? '1.65' : '1.55'; }
    // Design tweaks win over tokens, as in the page CSS (tweak values come last).
    for (const [name, value] of Object.entries(live.tweaks)) { const tw = tweakList().find(x => x.var === name); if (tw) vars[name] = value + (tw.unit ?? 'px'); }
    return vars;
  }
  function pushVars() {
    const vars = liveVars(), out = { ...vars };
    for (const name of posted) if (!(name in vars)) out[name] = null;
    posted = new Set(Object.keys(vars));
    if (Object.keys(out).length) post('tokens', { vars: out });
    markPanel();
  }
  const fmt = (v, step) => { const d = String(step).includes('.') ? String(step).split('.')[1].length : 0; return Number(v).toFixed(Math.min(3, d)); };
  const fill = (v, min, max) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100 || 0)).toFixed(1) + '%';
  function slider(id, label, value, min, max, step, unit, data) {
    return `<div class="tweak-row"><div class="tweak-head"><label for="${id}">${esc(label)}</label><output id="${id}-value" for="${id}">${esc(fmt(value, step))}${esc(unit)}</output></div><input id="${id}" type="range" min="${esc(min)}" max="${esc(max)}" step="${esc(step)}" value="${esc(value)}" data-unit="${esc(unit)}" ${data} style="--fill:${fill(value, min, max)}"></div>`;
  }
  function drawTweaks() {
    if (!draft) return;
    right = 'tweaks'; $('design-inspector').hidden = false;
    const t = { ...tokens(), ...live.tokens }, list = tweakList(), covered = new Set(list.map(x => x.var));
    const usedFonts = new Set([tokens().headingFont, tokens().bodyFont, tokens().monoFont]);
    const knob = (key, html) => (covered.has(CORE_VARS[key]) ? `<p class="insp-help tweak-covered">${{ accent: 'Accent', radius: 'Corner radius', spacing: 'Spacing unit', typeScale: 'Type scale' }[key]} follows the design tweak above.</p>` : html);
    $('design-inspector').innerHTML = `${heading('Live', 'Tweaks', 'Close tweaks')}
      <div class="insp-section"><p class="insp-intro">Drag to preview on the canvas instantly. Nothing changes in the draft until you apply.</p></div>
      <section class="insp-section"><h3 class="insp-title">Design tweaks <span class="insp-count">${list.length}</span></h3>${list.length ? list.map((tw, i) => slider(`tweak-${i}`, tw.label || tw.var, live.tweaks[tw.var] ?? tw.value, tw.min, tw.max, tw.step, tw.unit ?? 'px', `data-tweak="${esc(tw.var)}"`)).join('') : '<p class="insp-help">This design has no model-defined tweaks. GLM adds them for details worth adjusting, such as a sidebar width or hero height.</p>'}</section>
      <section class="insp-section"><h3 class="insp-title">Tokens</h3>
        ${knob('accent', `<div class="tweak-row"><label class="st-color tweak-color" for="tweak-accent"><input id="tweak-accent" type="color" value="${esc(hex6(t.accent))}" data-token="accent"><span class="st-color-text"><span>Accent</span><output data-hex-for="tweak-accent">${esc(hex6(t.accent).toUpperCase())}</output></span></label></div>`)}
        ${knob('radius', slider('tweak-radius', 'Corner radius', t.radius, 0, 40, 1, 'px', 'data-token="radius"'))}
        ${knob('spacing', slider('tweak-spacing', 'Spacing unit', t.spacing, 4, 24, 1, 'px', 'data-token="spacing"'))}
        ${knob('typeScale', slider('tweak-type-scale', 'Type scale', t.typeScale, 1.1, 1.5, 0.01, '', 'data-token="typeScale"'))}
        <label class="st-field" for="tweak-density"><span>Density</span><select id="tweak-density" data-token="density">${['compact', 'comfortable', 'spacious'].map(d => `<option value="${d}" ${t.density === d ? 'selected' : ''}>${d[0].toUpperCase() + d.slice(1)}</option>`).join('')}</select></label>
        <div class="property-grid"><label class="st-field" for="tweak-heading-font"><span>Heading font</span><select id="tweak-heading-font" data-token="headingFont">${fontOptions(t.headingFont)}</select></label><label class="st-field" for="tweak-body-font"><span>Body font</span><select id="tweak-body-font" data-token="bodyFont">${fontOptions(t.bodyFont, { mono: false })}</select></label></div>
        <p class="insp-help" id="tweak-font-hint" ${[t.headingFont, t.bodyFont].some(f => !usedFonts.has(f) && !FONT_META[f]?.[3]) ? '' : 'hidden'}>New font files load when you apply; until then the canvas shows a fallback face.</p>
      </section>
      <div class="insp-sticky tweak-footer"><p id="tweaks-status" class="tweak-status" role="status" data-pending="${hasLive()}">${hasLive() ? 'Previewing unapplied tweaks' : 'Matches the draft'}</p><div class="tweak-buttons"><button id="tweaks-reset" type="button" class="st-btn" ${hasLive() ? '' : 'disabled'}>${icon('reset')}Reset</button><button id="tweaks-apply" type="button" class="st-btn st-btn-primary" ${hasLive() ? '' : 'disabled'}>Apply tweaks</button></div></div>`;
    markPanel(); fit();
  }
  function tweakInput(el) {
    const t = tokens();
    if (el.dataset.tweak) {
      const tw = tweakList().find(x => x.var === el.dataset.tweak); if (!tw) return;
      const v = Math.min(tw.max, Math.max(tw.min, Number(el.value)));
      if (v === tw.value) delete live.tweaks[tw.var]; else live.tweaks[tw.var] = v;
    } else {
      const key = el.dataset.token, v = el.type === 'range' ? Number(el.value) : el.value;
      if (key === 'accent' && !hex6(v)) return;
      if (key.endsWith('Font') && !fontList().includes(v)) return;
      if (String(v) === String(t[key])) delete live.tokens[key]; else live.tokens[key] = key === 'accent' ? hex6(v) : v;
    }
    if (el.type === 'range') { el.style.setProperty('--fill', fill(Number(el.value), Number(el.min), Number(el.max))); const out = $(el.id + '-value'); if (out) out.textContent = fmt(el.value, el.step) + (el.dataset.unit || ''); }
    const used = new Set([t.headingFont, t.bodyFont, t.monoFont]), now = { ...t, ...live.tokens };
    if ($('tweak-font-hint')) $('tweak-font-hint').hidden = ![now.headingFont, now.bodyFont].some(f => !used.has(f) && !FONT_META[f]?.[3]);
    pushVars();
    $('tweaks-status').textContent = hasLive() ? 'Previewing unapplied tweaks' : 'Matches the draft'; $('tweaks-status').dataset.pending = String(hasLive());
    $('tweaks-reset').disabled = $('tweaks-apply').disabled = !hasLive();
  }
  function applyTweaks() {
    writable(); if (!hasLive()) return;
    checkpoint();
    for (const [name, value] of Object.entries(live.tweaks)) { const tw = draft.tweaks?.find(x => x.var === name); if (tw) tw.value = Math.min(tw.max, Math.max(tw.min, Number(value))); }
    if (Object.keys(live.tokens).length) {
      const t = tokens(), next = { ...(draft.designSystem || { name: 'Project style', accent: t.accent, background: t.background, text: t.text, radius: t.radius, spacing: t.spacing, typeScale: t.typeScale }), ...live.tokens };
      if (live.tokens.bodyFont) next.font = live.tokens.bodyFont;
      draft.designSystem = next;
      draft.theme = { ...draft.theme, accent: hex6(next.accent) || draft.theme?.accent };
    }
    // The refreshed page embeds any newly used font files and carries the values itself.
    live = blankLive(); posted = new Set();
    changed();
    toast('Tweaks applied to the draft. Save design to keep this revision.');
  }
  function resetTweaks() { live = blankLive(); pushVars(); drawTweaks(); }

  // ---- styles panel ----
  const STYLE_KEYS = ['name', ...COLOR_KEYS, ...STATUS_KEYS, 'headingFont', 'bodyFont', 'monoFont', 'radius', 'spacing', 'density', 'shadow', 'typeScale'];
  function presetSwatch(p, i, selected) {
    const t = { ...NEUTRAL, ...p.tokens }, c = k => hex6(t[k]) || NEUTRAL[k];
    return `<button type="button" class="preset-swatch" data-preset-index="${i}" aria-pressed="${selected}" title="${esc(p.description || p.name)}"><span class="preset-chip" style="background:${c('background')};border-color:${c('border')}"><b style="background:${c('surface')};border-color:${c('border')}"><i style="background:${c('text')}"></i><i style="background:${c('muted')}"></i></b><span style="background:${c('accent')}"></span><span style="background:${c('accent2')}"></span></span><span class="preset-name">${esc(p.name)}</span></button>`;
  }
  async function drawStyles(keep) {
    right = 'styles'; $('design-inspector').hidden = false; markPanel();
    const kits = await api('/design-kits'); if (!isWeb() || right !== 'styles') return;
    const d = tokens(), list = presets(), same = p => p.id === d.preset && hex6(p.tokens.accent) === hex6(d.accent) && hex6(p.tokens.background) === hex6(d.background);
    stylePreset = list.some(same) ? d.preset : 'custom';
    const colors = keys => keys.map(k => colorField(COLOR_LABELS[k], 'style-' + k, d[k], `aria-label="${COLOR_LABELS[k]} colour"`)).join('');
    $('design-inspector').innerHTML = `${heading('Project', 'Styles', 'Close styles')}
      <div class="insp-section"><p class="insp-intro">Shared tokens keep new screens consistent. Existing styles that use these tokens update together.</p>
        <label class="st-field" for="style-preset"><span>Style preset</span><select id="style-preset"><option value="">Choose a style</option>${list.map((p, i) => `<option value="preset-${i}" data-preset-id="${esc(p.id)}">${esc(p.name)}</option>`).join('')}${kits.map(k => `<option value="kit-${esc(k.id)}">Saved: ${esc(k.name)}</option>`).join('')}</select></label>
        <div class="preset-grid" role="group" aria-label="Curated presets">${list.map((p, i) => presetSwatch(p, i, same(p))).join('')}</div></div>
      <form id="style-form" class="insp-form">
        <section class="insp-section">${field('Style name', 'style-name', d.name, 'text', 'maxlength="80"')}</section>
        <section class="insp-section"><h3 class="insp-title">Colour</h3><div class="color-grid">${colors(COLOR_KEYS)}</div><details class="st-details"><summary>Status colours</summary><div class="color-grid">${colors(STATUS_KEYS)}</div></details></section>
        <section class="insp-section"><h3 class="insp-title">Typography</h3><div class="property-grid"><label class="st-field" for="style-headingFont"><span>Heading font</span><select id="style-headingFont">${fontOptions(d.headingFont)}</select></label><label class="st-field" for="style-bodyFont"><span>Body font</span><select id="style-bodyFont">${fontOptions(d.bodyFont, { mono: false })}</select></label></div><div class="property-grid"><label class="st-field" for="style-monoFont"><span>Mono font</span><select id="style-monoFont">${fontOptions(d.monoFont)}</select></label>${field('Type scale', 'style-typeScale', d.typeScale, 'number', 'min="1.1" max="1.5" step="0.01"')}</div></section>
        <section class="insp-section"><h3 class="insp-title">Shape and space</h3><div class="property-grid">${field('Corner radius', 'style-radius', d.radius, 'number', 'min="0" max="40" step="1"')}${field('Spacing unit', 'style-spacing', d.spacing, 'number', 'min="4" max="24" step="1"')}</div><div class="property-grid"><label class="st-field" for="style-density"><span>Density</span><select id="style-density">${['compact', 'comfortable', 'spacious'].map(v => `<option value="${v}" ${d.density === v ? 'selected' : ''}>${v[0].toUpperCase() + v.slice(1)}</option>`).join('')}</select></label><label class="st-field" for="style-shadow"><span>Shadow</span><select id="style-shadow">${['none', 'soft', 'medium', 'crisp'].map(v => `<option value="${v}" ${d.shadow === v ? 'selected' : ''}>${v[0].toUpperCase() + v.slice(1)}</option>`).join('')}</select></label></div></section>
        <section class="insp-section"><h3 class="insp-title">Contrast</h3><div id="contrast-info" class="contrast-list" aria-live="polite"></div></section>
        <div class="insp-sticky"><button type="submit" class="st-btn st-btn-primary st-btn-block">Apply to design</button></div>
      </form>
      <section class="insp-section"><h3 class="insp-title">Import</h3><button id="import-tokens" type="button" class="st-btn st-btn-block" aria-expanded="false" aria-controls="tokens-import">${icon('code')}Import from CSS / tokens / Tailwind</button>
        <div id="tokens-import" class="tokens-import" hidden><label class="st-field" for="tokens-text"><span>Paste CSS variables, design-token JSON or a Tailwind theme</span><textarea id="tokens-text" rows="6" spellcheck="false" class="mono" placeholder=":root { --brand: #2563eb; --radius: 10px; font-family: Inter, sans-serif; }"></textarea></label>
          <div class="tokens-actions"><label class="st-btn file-button" for="tokens-file">${icon('upload')}Choose file<input id="tokens-file" type="file" accept=".css,.scss,.less,.json,.js,.cjs,.mjs,.ts,.txt,text/css,application/json,text/plain"></label><button id="tokens-submit" type="button" class="st-btn st-btn-primary">Read tokens</button></div>
          <div id="tokens-notes" class="tokens-notes" role="status"></div></div></section>
      <section class="insp-section"><h3 class="insp-title">Library</h3><button id="save-kit" type="button" class="st-btn st-btn-block">${icon('bookmark')}Save reusable style</button><button id="export-kit" type="button" class="st-btn st-btn-block">${icon('download')}Download style JSON</button><label class="style-import st-btn st-btn-block file-button" for="import-kit">${icon('upload')}Import style JSON<input id="import-kit" type="file" accept=".json,application/json"></label></section>`;
    $('style-preset').onchange = () => {
      const v = $('style-preset').value, p = v.startsWith('preset-') ? list[+v.slice(7)] : null, d = p ? { ...p.tokens, name: p.tokens.name || p.name, preset: p.id } : kits.find(k => 'kit-' + k.id === v)?.data;
      if (d) { fillStyle(d); stylePreset = p ? p.id : d.preset || 'custom'; markPreset(p?.id); }
    };
    $('style-form').oninput = e => { if (e.target.id !== 'style-name') { stylePreset = 'custom'; markPreset(null); } syncHex(); contrast(); };
    if (keep) fillStyle(keep);
    contrast(); fit();
  }
  function markPreset(id) { for (const b of document.querySelectorAll('.preset-swatch')) b.setAttribute('aria-pressed', String(!!id && presets()[+b.dataset.presetIndex]?.id === id)); }
  function syncHex() { for (const out of document.querySelectorAll('#design-inspector output[data-hex-for]')) { const input = $(out.dataset.hexFor); if (input && !(input.dataset.clear && input.value === toHex('transparent'))) out.textContent = input.value.toUpperCase(); } }
  function styleValue() {
    const v = k => $('style-' + k).value, out = { name: v('name').trim() || 'Project style', preset: stylePreset || 'custom' };
    for (const k of [...COLOR_KEYS, ...STATUS_KEYS]) out[k] = v(k);
    for (const k of ['headingFont', 'bodyFont', 'monoFont', 'density', 'shadow']) out[k] = v(k);
    out.font = out.bodyFont; out.radius = Number(v('radius')); out.spacing = Number(v('spacing')); out.typeScale = Number(v('typeScale'));
    return out;
  }
  function checkStyle(d) {
    if (!Number.isInteger(d.radius) || d.radius < 0 || d.radius > 40) throw new Error('Corner radius must be a whole number from 0 to 40.');
    if (!Number.isInteger(d.spacing) || d.spacing < 4 || d.spacing > 24) throw new Error('Spacing unit must be a whole number from 4 to 24.');
    if (!(d.typeScale >= 1.1 && d.typeScale <= 1.5)) throw new Error('Type scale must be between 1.1 and 1.5.');
    return d;
  }
  function fillStyle(d) {
    const src = { ...d };
    if (src.font && !src.bodyFont) src.bodyFont = src.font;
    if (src.font && !src.headingFont) src.headingFont = src.font;
    for (const k of STYLE_KEYS) {
      const node = $('style-' + k); if (!node || src[k] == null) continue;
      if (node.type === 'color') { const h = hex6(src[k]); if (h) node.value = h; }
      else if (node.tagName === 'SELECT') { if ([...node.options].some(o => o.value === String(src[k]))) node.value = String(src[k]); }
      else node.value = String(src[k]);
    }
    syncHex(); contrast();
  }
  function contrast() {
    const d = styleValue(), on = onAccent(d.accent, d);
    const rows = [['Text on background', d.text, d.background, 4.5], ['Muted on surface', d.muted, d.surface, 4.5], ['Label on accent', on, d.accent, 4.5], ['Accent on background', d.accent, d.background, 3]];
    $('contrast-info').innerHTML = rows.map(([label, fg, bg, min]) => {
      const f = hex6(fg), b = hex6(bg); if (!f || !b) return '';
      const r = ratio(f, b), ok = r >= min;
      return `<div class="contrast-row"><span class="contrast-chip" style="background:${b};color:${f}">Aa</span><span class="contrast-label">${label}</span><span class="contrast-ratio">${r.toFixed(2)}:1</span><span class="contrast-badge ${ok ? 'is-pass' : 'is-fail'}">${ok ? (min < 4.5 ? 'AA UI' : 'AA') : 'Low'}</span></div>`;
    }).join('') + '<p class="insp-help">Thresholds: 4.5:1 for text, 3:1 for large text and UI marks. Check other colour pairs separately.</p>';
  }
  async function importTokens() {
    const text = $('tokens-text').value;
    if (!text.trim()) { $('tokens-text').focus(); throw new Error('Paste CSS, design-token JSON or a Tailwind theme first, or choose a file.'); }
    if (new TextEncoder().encode(text).length > 200 * 1024) throw new Error('Token text must be under 200 KB.');
    $('tokens-submit').disabled = true;
    try {
      const out = await api('/design-tokens/import', 'POST', { text });
      if (right !== 'styles' || !$('style-form')) return;
      fillStyle(out.tokens); stylePreset = 'custom'; markPreset(null); $('style-preset').value = '';
      const list = (Array.isArray(out.notes) ? out.notes : []).slice(0, 12);
      $('tokens-notes').innerHTML = `<p class="tokens-done">${icon('sparkles')}Tokens filled in. Review them, then Apply to design.</p>${list.length ? `<ul>${list.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}`;
    } finally { if ($('tokens-submit')) $('tokens-submit').disabled = false; }
  }

  // ---- feedback panel ----
  async function drawNotes() {
    right = 'notes'; $('design-inspector').hidden = false; markPanel();
    const target = selection ? `${selection.tag} · ${selection.text.slice(0, 90)}` : '';
    const list = await api(`/projects/${pid}/notes?revision=${rid}`); if (!isWeb() || right !== 'notes') return;
    $('design-inspector').innerHTML = `${heading('Revision', 'Feedback', 'Close feedback')}
      <div class="insp-section"><p class="insp-intro">Notes belong to this saved revision.${dirty ? ' Save your design before adding feedback.' : ''}</p>
      <form id="note-form" class="note-form"><label class="st-field" for="note-target"><span>Location</span><input id="note-target" value="${esc(target)}" maxlength="160" placeholder="General feedback"></label><label class="st-field" for="note-text"><span>Feedback</span><textarea id="note-text" rows="4" maxlength="4000" required placeholder="What should change, and why?"></textarea></label><button class="st-btn st-btn-primary st-btn-block" ${dirty ? 'disabled' : ''}>Add feedback</button></form></div>
      <section class="insp-section"><h3 class="insp-title">On this revision <span class="insp-count">${list.length}</span></h3><div class="notes-list">${list.map(n => `<article class="design-note ${n.resolved ? 'resolved' : ''}"><small>${esc(n.screen)} / ${esc(n.target || 'General')}</small><p>${esc(n.text)}</p><div class="note-actions"><button type="button" data-resolve-note="${esc(n.id)}" data-resolved="${n.resolved ? '0' : '1'}">${n.resolved ? 'Reopen' : 'Resolve'}</button>${!n.resolved ? `<button type="button" data-use-note="${esc(n.id)}">Use in revision</button>` : ''}</div></article>`).join('') || '<p class="insp-help">No feedback on this revision yet.</p>'}</div></section>`;
    notesCache = list; fit();
  }
  function togglePanel(name, draw) {
    if (!$('design-inspector').hidden && right === name) { right = 'properties'; if (mode === 'design') drawProperties(); else $('design-inspector').hidden = true; markPanel(); fit(); return; }
    return draw();
  }

  // ---- screens ----
  function screenDialog(action) { writable(); screenAction = action; $('screen-dialog-title').textContent = action === 'rename' ? 'Rename screen' : 'New screen'; $('screen-name').value = action === 'rename' ? current().name : ''; $('screen-dialog').showModal(); }
  function ensureScreens() { if (!draft.screens) draft.screens = screens(); }
  function chooseScreen(value) { screen = value; selection = null; post('screen', { screen }); drawRail(); if (right === 'properties') drawProperties(); fit(); }

  // ---- frame messages ----
  const sameSelection = (a, b) => !!a && !!b && ['index', 'screen', 'tag', 'text', 'label', 'action', 'target', 'html', 'expanded', 'leaf'].every(k => a[k] === b[k]) && JSON.stringify(a.styles) === JSON.stringify(b.styles);
  addEventListener('message', e => {
    if (e.source !== $('preview-frame').contentWindow || e.data?.channel !== channel || !isWeb()) return;
    const m = e.data;
    if (m.type === 'ready') {
      post('mode', { designing: mode === 'design' });
      posted = new Set(); if (hasLive()) pushVars();
      if (reselect && mode === 'design' && reselect.screen === screen) post('select', { index: reselect.index, screen });
      reselect = null;
    }
    if (m.type === 'layers' && Array.isArray(m.layers) && m.layers.length <= 600) { layers = m.layers.filter(l => l && Number.isInteger(l.index) && typeof l.tag === 'string'); drawRail(); }
    if (m.type === 'screen' && screens().some(s => s.id === m.screen)) { screen = m.screen; selection = null; drawRail(); fit(); }
    if (m.type === 'selection' && Number.isInteger(m.index) && m.index >= 0 && m.index < 10000 && typeof m.text === 'string' && typeof m.tag === 'string' && m.styles && screens().some(s => s.id === m.screen)) {
      // A repeated report of the same element (re-selection after a refresh) keeps the inspector and any typed values.
      const same = sameSelection(selection, m) && right === 'properties' && !!$('property-form');
      selection = m; screen = m.screen; drawRail();
      if (mode === 'design' && !same) { right = 'properties'; drawProperties(); }
    }
  });

  // ---- controls ----
  $('interact-mode').onclick = () => modeTo('preview'); $('design-mode').onclick = () => modeTo('design');
  $('studio-save').onclick = safe(save);
  $('studio-undo').onclick = () => { if (!undo.length) return; redo.push(snapshot()); restore(undo.pop()); changed(); };
  $('studio-redo').onclick = () => { if (!redo.length) return; undo.push(snapshot()); restore(redo.pop()); changed(); };
  $('studio-style').onclick = safe(() => togglePanel('styles', drawStyles)); $('studio-notes').onclick = safe(() => togglePanel('notes', drawNotes));
  $('studio-tweaks').onclick = safe(() => togglePanel('tweaks', drawTweaks));
  $('studio-copy').onclick = safe(async () => { if (!leave()) return; const p = await api(`/projects/${pid}/duplicate`, 'POST', { revisionId: rid }); await loadProjects(); await openProject(p.id); toast('Independent exploration created from the saved revision.'); });
  for (const [id, width] of [['desktop-view', 1280], ['tablet-view', 768], ['mobile-view', 390]]) $(id).onclick = () => { if (!isWeb()) return; for (const n of ['desktop-view', 'tablet-view', 'mobile-view']) $(n).classList.toggle('active', n === id); $('viewport-width').value = width; fit(); };
  $('viewport-width').onchange = fit; $('canvas-zoom').onchange = fit;
  $('screen-form').onsubmit = safe(async e => {
    e.preventDefault(); checkpoint(); ensureScreens();
    const name = $('screen-name').value.trim() || 'Untitled screen';
    if (screenAction === 'rename') current().name = name;
    else { if (draft.screens.length >= 12) throw new Error('This project already has 12 screens.'); const id = 'screen-' + crypto.randomUUID().slice(0, 8); draft.screens.push({ id, name, html: `<main class="page"><div class="page-header"><div><h1>${esc(name)}</h1><p>Build this screen with components or ask GLM to design it.</p></div></div></main>` }); screen = id; }
    draft.html = draft.screens[0].html; $('screen-dialog').close(); changed();
  });
  document.addEventListener('submit', safe(async e => {
    if (e.target.id === 'property-form') {
      e.preventDefault(); const original = selection; if (!original) throw new Error('Select an element first.');
      const values = {}, mapping = { 'element-color': 'color', 'element-background': 'background-color', 'element-size': 'font-size', 'element-padding': 'padding', 'element-radius': 'border-radius', 'element-gap': 'gap', 'element-display': 'display', 'element-align': 'text-align' };
      for (const [id, prop] of Object.entries(mapping)) { const node = $(id); if (node.type === 'number') { const n = Number(node.value); if (!Number.isFinite(n) || n < 0 || n > 160) throw new Error('Use a number between 0 and 160.'); values[prop] = n + 'px'; } else values[prop] = node.value; }
      // Only changed properties are authored; untouched transparent backgrounds and
      // asymmetric spacing must not be flattened by the inspector's display defaults.
      const initial = { 'element-color': toHex(original.styles.color), 'element-background': toHex(original.styles.background), 'element-size': String(parseFloat(original.styles.fontSize)), 'element-padding': String(parseFloat(original.styles.padding) || 0), 'element-radius': String(parseFloat(original.styles.borderRadius) || 0), 'element-gap': String(parseFloat(original.styles.gap) || 0), 'element-display': original.styles.display, 'element-align': original.styles.textAlign };
      for (const [id, prop] of Object.entries(mapping)) if ($(id).value === initial[id]) delete values[prop];
      const text = $('element-text')?.value, label = $('element-label').value.trim(), link = $('element-link').value;
      const iconName = $('element-icon')?.value.trim(), chartText = $('element-chart')?.value;
      let chart = null;
      if (iconName != null && !/^[a-z0-9-]{1,60}$/.test(iconName)) throw new Error('Icon names use lowercase letters, numbers and hyphens, such as arrow-right.');
      if (chartText != null) { try { chart = JSON.stringify(JSON.parse(chartText)); } catch { throw new Error('Chart data must be valid JSON.'); } if (chart.length > 6000) throw new Error('Chart data must be under 6,000 characters.'); }
      mutateElement(el => {
        if (original.leaf && text != null) el.textContent = text;
        if (iconName) el.setAttribute('data-icon', iconName);
        if (chart && chart !== el.getAttribute('data-chart')) el.setAttribute('data-chart', chart);
        if (label) el.setAttribute('aria-label', label); else el.removeAttribute('aria-label');
        if (Object.keys(values).length) elementStyles(el, values);
        if (link) { if (!['BUTTON', 'A'].includes(el.tagName)) throw new Error('Choose a button or link to connect screens.'); el.dataset.action = 'navigate'; el.dataset.target = link; }
      });
      if (mode === 'design') reselect = { screen: original.screen, index: original.index };
    }
    if (e.target.id === 'element-edit-form') { e.preventDefault(); await glmEdit(); }
    if (e.target.id === 'style-form') {
      e.preventDefault(); writable(); const d = checkStyle(styleValue());
      const saved = await api(`/projects/${pid}/design-system`, 'POST', d);
      checkpoint(); draft.designSystem = saved && typeof saved === 'object' && saved.accent ? saved : d;
      draft.theme = { accent: draft.designSystem.accent, background: draft.designSystem.background, text: draft.designSystem.text };
      live = blankLive(); posted = new Set(); changed(); toast('Style applied to the draft and future generations. Save design to keep this revision.');
    }
    if (e.target.id === 'note-form') { e.preventDefault(); if (dirty) throw new Error('Save design before adding feedback.'); await api(`/projects/${pid}/notes`, 'POST', { revisionId: rid, screen, target: $('note-target').value, text: $('note-text').value }); await drawNotes(); }
  }));
  document.addEventListener('click', safe(async e => {
    if (!isWeb()) return;
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.screen) chooseScreen(b.dataset.screen);
    if (b.dataset.layer != null) { modeTo('design'); post('select', { index: Number(b.dataset.layer) }); }
    if (b.id === 'studio-focus') { document.body.classList.toggle('canvas-focus'); const on = document.body.classList.contains('canvas-focus'); b.querySelector('.bar-label').textContent = on ? 'Show brief' : 'Focus'; b.setAttribute('aria-pressed', String(on)); fit(); }
    if (b.id === 'add-screen') screenDialog('add'); if (b.id === 'rename-screen') screenDialog('rename');
    if (b.id === 'duplicate-screen') { if (screens().length >= 12) throw new Error('A project can contain up to 12 screens.'); checkpoint(); ensureScreens(); const s = copy(current()); s.id = 'screen-' + crypto.randomUUID().slice(0, 8); s.name = (s.name + ' copy').slice(0, 80); draft.screens.push(s); screen = s.id; changed(); }
    if (b.id === 'remove-screen' && screens().length > 1) { if (!confirm('Remove this screen from the draft? You can undo this change.')) return; checkpoint(); draft.screens = screens().filter(s => s.id !== screen); screen = draft.screens[0].id; draft.html = draft.screens[0].html; changed(); }
    if (b.id === 'close-inspector') { right = 'properties'; modeTo('preview'); }
    if (b.id === 'select-parent' && Number(b.dataset.parent) >= 0) post('select', { index: Number(b.dataset.parent), screen });
    if (b.dataset.elementAction) mutateElement(el => { const act = b.dataset.elementAction; if (act === 'up' && el.previousElementSibling) el.previousElementSibling.before(el); if (act === 'down' && el.nextElementSibling) el.nextElementSibling.after(el); if (act === 'remove') el.remove(); if (act === 'duplicate') el.after(cloneElement(el)); });
    if (b.dataset.component) {
      const html = component(b.dataset.component); if (!html) return;
      checkpoint(); const doc = documentForScreen(), selected = selection ? elementAt(doc) : null;
      // A component that was just inserted (and so is selected) gets the next one as a sibling, not a child.
      const follow = selected && inserted && inserted.screen === screen && inserted.index === selection.index;
      const container = selected && !follow && ['MAIN', 'SECTION', 'ARTICLE', 'ASIDE', 'DIV', 'FOOTER', 'HEADER', 'NAV', 'FORM'].includes(selected.tagName) && !selected.matches('.stat,.alert,.empty-state,.chart,.field,.cluster') ? selected : doc.body.querySelector('main') || doc.body;
      let added;
      if (follow) { selected.insertAdjacentHTML('afterend', html); added = selected.nextElementSibling; } else { container.insertAdjacentHTML('beforeend', html); added = container.lastElementChild; }
      const index = [...doc.body.querySelectorAll('*')].indexOf(added);
      setHTML(doc.body.innerHTML); inserted = index >= 0 ? { screen, index } : null; if (mode === 'design' && inserted) reselect = { ...inserted }; changed();
    }
    if (b.id === 'comment-element') await drawNotes();
    if (b.id === 'revise-element') { glmOpen = !glmOpen; b.setAttribute('aria-expanded', String(glmOpen)); $('element-edit-form').hidden = !glmOpen; if (glmOpen) $('element-instruction')?.focus(); }
    if (b.id === 'element-edit-cancel') { abortGLM(); glmMessage = { tone: 'info', text: 'Cancelled. Nothing was changed.' }; glmRedraw(); }
    if (b.id === 'tweaks-apply') applyTweaks();
    if (b.id === 'tweaks-reset') resetTweaks();
    if (b.dataset.presetIndex != null) { const i = Number(b.dataset.presetIndex), p = presets()[i]; if (!p) return; $('style-preset').value = 'preset-' + i; fillStyle({ ...p.tokens, name: p.tokens.name || p.name }); stylePreset = p.id; markPreset(p.id); }
    if (b.id === 'import-tokens') { const open = b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', String(open)); $('tokens-import').hidden = !open; if (open) $('tokens-text').focus(); }
    if (b.id === 'tokens-submit') await importTokens();
    if (b.id === 'save-kit') { const keep = styleValue(); await api('/design-kits', 'POST', checkStyle(keep)); toast('Reusable style saved to this workspace.'); await drawStyles(keep); }
    if (b.id === 'export-kit') download('forma-style.json', JSON.stringify(styleValue(), null, 2), 'application/json');
    if (b.dataset.resolveNote) { await api(`/projects/${pid}/notes/${b.dataset.resolveNote}`, 'PATCH', { resolved: b.dataset.resolved === '1' }); await drawNotes(); }
    if (b.dataset.useNote) { if (dirty) throw new Error('Save design before requesting a model revision.'); const n = notesCache.find(n => n.id === b.dataset.useNote); $('prompt').value = `Apply this feedback on screen ${n.screen}, element ${n.target || 'general'}: ${n.text}\nPreserve unrelated screens, facts and styling.`; $('prompt').focus(); }
  }));
  document.addEventListener('input', e => {
    if (!isWeb() || !e.target.closest('#design-inspector')) return;
    if (e.target.id === 'element-instruction') glmText = e.target.value;
    if (e.target.dataset.tweak || e.target.dataset.token) { tweakInput(e.target); syncHex(); }
    if (e.target.matches('#property-form input[type=color]')) syncHex();
  });
  document.addEventListener('change', safe(async e => {
    if (e.target.id === 'tokens-file') {
      const file = e.target.files[0]; if (!file) return; e.target.value = '';
      if (file.size > 200 * 1024) throw new Error('Token files must be under 200 KB.');
      $('tokens-text').value = await file.text(); await importTokens();
    }
    if (e.target.id !== 'import-kit') return;
    const file = e.target.files[0]; if (!file) return; if (file.size > 20000) throw new Error('Style JSON must be under 20 KB.');
    let d; try { d = JSON.parse(await file.text()); } catch { throw new Error('This style file is not valid JSON.'); }
    await api('/design-kits', 'POST', d); await drawStyles(); fillStyle(d); toast('Style imported. Apply it to this design when ready.');
  }));
  function download(name, text, type) { const u = URL.createObjectURL(new Blob([text], { type })), a = document.createElement('a'); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 5000); }
  addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('keydown', e => {
    if (!isWeb()) return;
    if (e.target.id === 'element-instruction' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('element-edit-form').requestSubmit(); return; }
    if (e.target.matches('input,textarea,select,[contenteditable="true"]')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); $(e.shiftKey ? 'studio-redo' : 'studio-undo').click(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); $('studio-save').click(); }
    if (e.key === 'Escape' && !document.querySelector('dialog[open]')) modeTo('preview');
  });
  async function loadStarters() {
    const items = await api('/starters'); let host = $('starter-gallery');
    if (!host) { host = document.createElement('section'); host.id = 'starter-gallery'; document.querySelector('.format-cards').after(host); }
    host.innerHTML = `<div class="starter-heading"><h2>Start with a working flow</h2><span>Curated layouts · no model call</span></div><div class="starter-grid">${items.map((s, i) => `<button type="button" data-starter="${esc(s.id)}" class="starter-card"><span class="starter-symbol">${icon(['dashboard', 'phone', 'globe'][i] || 'layers')}</span><div><strong>${esc(s.title)}</strong><p>${esc(s.description)}</p><small>${Number(s.screenCount) || 0} connected screens</small></div><span class="starter-arrow">${icon('arrow')}</span></button>`).join('')}</div>`;
    host.onclick = safe(async e => { const b = e.target.closest('[data-starter]'); if (!b) return; b.disabled = true; try { const p = await api('/starters/' + b.dataset.starter, 'POST', {}); await loadProjects(); await openProject(p.id); toast('Curated layout opened. Use Design to edit, or ask GLM to adapt it to your brief.'); } finally { b.disabled = false; } });
  }
  return { render, hide, leave, loadStarters, isDirty: () => dirty, save, fit, guard: () => { if (dirty) throw new Error('Save design or undo your draft changes before generating or exporting.'); } };
})();
