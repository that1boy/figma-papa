'use strict';
const $ = (id) => document.getElementById(id),
  esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
const names = { web: 'UI / UX design', slides: 'Presentation', document: 'Document' };
const state = {
  config: null,
  projects: [],
  project: null,
  revision: null,
  tab: 'preview',
  refs: [],
  createSources: [],
  createPreset: '',
  createBusy: 0,
  job: null,
  jobView: null,
  live: { job: null, step: -1, detail: '' },
  editor: null,
  poll: null,
  pollSeq: 0,
  native: false,
  directions: 1,
  lintAll: false,
  sourcesOpen: new Set(),
  sourceBusy: false,
  dirCache: new Map(),
};
let toastTimer;

// ---- small helpers ------------------------------------------------------------
// Static, trusted SVG paths (Lucide-style, 24px grid). Never built from data.
const ICONS = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  type: '<path d="M4 7V5h16v2M9 19h6M12 5v14"/>',
  bulb: '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V16h8v-1.3A7 7 0 0 0 12 2z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  retry: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 17v4M17 19h4"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  screen: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  web: '<rect x="2" y="4" width="20" height="15" rx="2"/><path d="M2 9h20M6 6.5h.01M9 6.5h.01"/>',
  slides: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M12 16v4M8 20h8M7 9h6M7 12h4"/>',
  document: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
};
const icon = (name, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
const plural = (n, word, many = word + 's') => `${n} ${n === 1 ? word : many}`;
const num = (n) => {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e4) return Math.round(n / 1e3) + 'k';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(n));
};
const secs = (s) => {
  s = Math.max(0, Math.round(Number(s) || 0));
  return s < 60 ? s + 's' : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};
const clock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const tone = (score) => (score >= 90 ? 'good' : score >= 70 ? 'fair' : 'poor');
const human = (rule) => String(rule || 'other').replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const hex = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : null);
const imageURL = (d) => (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(d || '') ? d : '');
const active = (j) => !!j && ['queued', 'running'].includes(j.status);
const demoMode = () => state.config?.mode === 'demo';
const presetName = (id) => state.config?.presets?.find((p) => p.id === id)?.name || id;
const SOURCE_EXT = ['docx', 'pptx', 'xlsx', 'csv', 'tsv', 'txt', 'md', 'json', 'html', 'htm'];
const SOURCE_MAX_BYTES = 15 * 1024 * 1024;
const SUGGESTIONS = [
  ['Make it denser', 'Make the layout denser: tighter spacing, smaller gaps between sections and more information above the fold. Keep body text at 14px or larger.'],
  ['Add an empty state', 'Add a helpful empty state wherever a list, table or search can be empty: an icon, one sentence explaining why it is empty, and a clear primary action.'],
  ['Improve mobile layout', 'Improve the mobile layout at 390px: stack columns, keep tap targets at least 44px, avoid horizontal scrolling and keep the main navigation reachable.'],
  ['Use a bolder hero', 'Use a bolder hero or page header: larger display type, stronger use of the accent colour and one clear primary call to action.'],
];

function sourceDirty() {
  if(state.tab !== 'edit' || !state.editor || !state.revision) return false;
  try { return JSON.stringify(collectEditor()) !== JSON.stringify(state.revision.artifact) || $('artifact-json').value !== JSON.stringify(state.editor,null,2); }
  catch { return true; }
}
function leaveSource() {
  if(!sourceDirty()) return true;
  if(!confirm('Discard unsaved source edits? Save a new revision first to keep them.')) return false;
  state.editor=null;
  return true;
}
addEventListener('beforeunload', e=>{if(sourceDirty()){e.preventDefault();e.returnValue='';}});
function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), 6500);
}
async function api(url, method = 'GET', data) {
  const res = await fetch('/api' + url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Studio-Request': '1' },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
  });
  let value = {};
  try {
    value = await res.json();
  } catch {
    if (res.ok) throw new Error('The server returned an unreadable response.');
  }
  if (!res.ok) {
    if (res.status === 401 && url !== '/login') {
      stopPolling();
      $('app').hidden = true;
      $('login').hidden = false;
    }
    throw Object.assign(new Error(value.error || (res.status === 413 ? 'The upload is too large.' : 'Request failed.')), { status: res.status });
  }
  return value;
}
function safe(fn) {
  return async (e) => {
    try {
      await fn(e);
    } catch (err) {
      toast(err.message);
    }
  };
}
function date(s) {
  return new Date(s).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---- boot and library -----------------------------------------------------------
async function boot() {
  state.config = await api('/config');
  $('login').hidden = true;
  $('app').hidden = false;
  const demo = demoMode(), c = state.config;
  $('mode-badge').textContent = demo ? 'Demo fixtures · no AI' : c.model;
  $('mode-badge').classList.toggle('live', !demo);
  $('model-label').textContent = demo ? 'Demonstration mode' : 'Internal GLM endpoint';
  $('mode-description').textContent = demo
    ? 'Fixed samples for testing the app.'
    : `${c.model} · vision ${c.vision || 'auto'} · ${c.pipeline || 'staged'} pipeline. Your configured model, inside your network.`;
  $('model-pill').textContent = demo ? 'Demo fixtures · no model' : `${c.model} · vision ${c.vision || 'auto'}`;
  $('model-pill').title = demo
    ? 'MODEL_MODE=demo: prompts and images are not interpreted.'
    : c.vision === 'off'
      ? c.visionSupported === false
        ? 'The endpoint rejected image input, so references and screenshots are not sent.'
        : 'GLM_VISION=off: references and screenshots are not sent; review relies on lint findings.'
      : `GLM_VISION=${c.vision}: references and rendered screenshots are sent to the model.`;
  $('composer-hint').textContent = demo
    ? 'Demo mode loads fixed content. Revision prompts are not interpreted.'
    : 'Your brief and references are sent to the internal model.';
  document.querySelectorAll('.format-icon').forEach((el) => {
    el.innerHTML = icon(el.classList.contains('kind-slides') ? 'slides' : el.classList.contains('kind-document') ? 'document' : 'web');
  });
  document.querySelector('.upload-image').innerHTML = icon('image');
  document.querySelector('.upload-doc').innerHTML = icon('file');
  $('suggestions').innerHTML = SUGGESTIONS.map(
    ([label], i) => `<button type="button" class="suggestion" data-suggestion="${i}">${esc(label)}</button>`,
  ).join('');
  await loadProjects();
  await window.FormaStudio?.loadStarters();
  show('library');
}
async function loadProjects() {
  state.projects = await api('/projects');
  drawProjects();
}
function drawProjects() {
  $('project-count').textContent = state.projects.length;
  const q = $('project-search').value.toLowerCase(),
    items = state.projects.filter((p) => p.title.toLowerCase().includes(q));
  $('project-grid').innerHTML = items.length
    ? items
        .map(
          (p) =>
            `<button class="project-card" data-project="${esc(p.id)}"><span class="project-icon kind-${esc(p.kind)}" aria-hidden="true">${icon(names[p.kind] ? p.kind : 'file')}</span><span class="project-body"><span class="type">${esc(names[p.kind] || p.kind)}</span><strong class="project-title">${esc(p.title)}</strong><small>${p.revisionCount} revision${p.revisionCount === 1 ? '' : 's'} · ${date(p.updated)}</small></span><span class="project-arrow" aria-hidden="true">${icon('arrow')}</span></button>`,
        )
        .join('')
    : `<div class="empty-projects"><span aria-hidden="true">▦</span><p><strong>${q ? 'No matching projects' : 'A fresh workspace'}</strong><br>${q ? 'Try a different name.' : 'Choose a format above to make your first project.'}</p></div>`;
  $('recent-projects').innerHTML = state.projects.length
    ? state.projects
        .slice(0, 9)
        .map(
          (p) =>
            `<button class="recent-item" data-project="${esc(p.id)}" title="${esc(p.title)}">${esc(p.title)}</button>`,
        )
        .join('')
    : '<p class="recent-empty">Your projects will<br>appear here.</p>';
}
function stopPolling() {
  clearTimeout(state.poll);
  state.poll = null;
  state.pollSeq++;
}
function show(view) {
  if(view !== 'workspace' && !leaveSource()) return;
  if(view !== 'workspace' && window.FormaStudio && !window.FormaStudio.leave()) return;
  if (view !== 'workspace') {
    // Polling belongs to the open workspace; reopening the project resumes it.
    stopPolling();
    state.job = null;
    state.jobView = null;
  }
  document.body.classList.toggle('in-workspace', view === 'workspace');
  for (const id of ['library', 'workspace', 'evaluation']) $(id).hidden = id !== view;
  $('nav-projects').classList.toggle('active', view !== 'evaluation');
  $('nav-evaluation').classList.toggle('active', view === 'evaluation');
  if (view === 'library') $('breadcrumbs').innerHTML = 'Workspace <span>/</span> Projects';
  if (view === 'evaluation') $('breadcrumbs').innerHTML = 'Workspace <span>/</span> Evaluation';
}

// ---- create dialog ----------------------------------------------------------------
function createError(message) {
  $('create-error').textContent = message || '';
}
function createBusy(delta) {
  state.createBusy = Math.max(0, state.createBusy + delta);
  $('create-submit').disabled = state.createBusy > 0;
}
function setCreateKind(kind) {
  if (!names[kind]) kind = 'web';
  $('create-kind').value = kind;
  document.querySelectorAll('[name="create-kind-choice"]').forEach((r) => (r.checked = r.value === kind));
}
function openCreate(kind = 'web') {
  state.refs = [];
  state.createSources = [];
  state.createPreset = '';
  setCreateKind(kind);
  $('create-title').value = '';
  // Reset the guidance to the shipped default instead of keeping the previous project's text.
  $('create-brand').value = $('create-brand').defaultValue;
  $('create-images').value = '';
  $('create-sources').value = '';
  createError('');
  drawPresetGrid();
  drawReferenceZone();
  drawCreateSources();
  $('create-dialog').showModal();
  setTimeout(() => $('create-title').focus(), 50);
}
function drawPresetGrid() {
  const presets = state.config?.presets || [];
  const card = (id, title, sub, preview, tip = '') =>
    `<label class="look-card" data-preset="${esc(id)}"${tip ? ` title="${esc(tip)}"` : ''}><input type="radio" name="create-preset" value="${esc(id)}" ${state.createPreset === id ? 'checked' : ''}>${preview}<span class="look-text"><strong>${esc(title)}</strong><small>${esc(sub)}</small></span></label>`;
  $('look-grid').innerHTML = [
    card('', 'Auto', demoMode() ? 'Default styling' : 'Let GLM choose', `<span class="look-preview auto" aria-hidden="true">${icon('sparkle')}</span>`, 'Auto (let GLM choose a preset for the brief)'),
    ...presets.map((p) => {
      const t = p.tokens || {}, [accent, bg, surface, text] = ['accent', 'background', 'surface', 'text'].map((k) => hex(t[k]) || '#cccccc');
      const preview = `<span class="look-preview" style="background:${bg}" aria-hidden="true"><span style="background:${surface}"><b style="background:${accent}"></b><i style="background:${text}"></i></span></span>`;
      return card(p.id, p.name, t.headingFont || t.bodyFont || '', preview, p.description);
    }),
  ].join('');
}
function drawReferenceZone() {
  const c = state.config || {}, max = c.maxReferences || 6;
  const off = c.mode === 'glm' && c.vision === 'off';
  $('create-images').disabled = off || state.refs.length >= max;
  $('reference-zone').classList.toggle('is-disabled', off);
  $('reference-caption').textContent = `PNG, JPEG or WebP · up to ${max}`;
  $('reference-note').textContent = off
    ? c.visionSupported === false
      ? 'Image input is off: this endpoint rejected images earlier, so references would not reach the model.'
      : 'Image input is off for this model (GLM_VISION=off), so references would not reach the model.'
    : c.mode === 'demo'
      ? 'Demo mode stores references for previews and exports but does not interpret them.'
      : `Resized to 1600 px JPEG before upload. ${state.refs.length} of ${max} attached.`;
  $('image-list').innerHTML = state.refs
    .map(
      (r, i) =>
        `<figure class="ref-thumb"><img src="${imageURL(r.data)}" alt="${esc(r.name)}"><button type="button" class="thumb-remove" data-remove-ref="${i}" aria-label="Remove ${esc(r.name)}">${icon('x')}</button></figure>`,
    )
    .join('');
}
function drawCreateSources() {
  const max = state.config?.maxSources || 6;
  $('create-sources').disabled = state.createSources.length >= max;
  $('source-caption').textContent = `DOCX, PPTX, XLSX, CSV, TXT, MD, JSON, HTML · ${state.createSources.length}/${max}`;
  $('create-source-list').innerHTML = state.createSources
    .map(
      (s, i) =>
        `<li><span class="file-kind">${esc((/\.([a-z0-9]+)$/i.exec(s.name)?.[1] || '').toUpperCase())}</span><span class="file-name" title="${esc(s.name)}">${esc(s.name)}</span><small>${num(s.size)} B</small><button type="button" class="thumb-remove" data-remove-create-source="${i}" aria-label="Remove ${esc(s.name)}">${icon('x')}</button></li>`,
    )
    .join('');
}
function checkSourceFile(f) {
  const ext = /\.([a-z0-9]+)$/i.exec(f.name)?.[1]?.toLowerCase();
  if (!SOURCE_EXT.includes(ext))
    throw new Error(`“${f.name}” is not a supported source. Use DOCX, PPTX, XLSX, CSV, TSV, TXT, MD, JSON or HTML.`);
  if (!f.size) throw new Error(`“${f.name}” is empty.`);
  if (f.size > SOURCE_MAX_BYTES) throw new Error(`“${f.name}” is larger than 15 MB.`);
}
function base64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new Error(`“${file.name}” could not be read.`));
    reader.readAsDataURL(file);
  });
}
async function toJPEG(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`“${file.name}” could not be decoded as an image.`);
  }
  const ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
  canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const data = canvas.toDataURL('image/jpeg', 0.88);
  if (data.length > 4200000) throw new Error(`“${file.name}” is too large after resizing. Choose a smaller reference.`);
  return data;
}

// ---- workspace ----------------------------------------------------------------------
async function openProject(pid) {
  if(!leaveSource()) return;
  if(window.FormaStudio && !window.FormaStudio.leave()) return;
  stopPolling();
  state.job = null;
  state.jobView = null;
  const project = await api('/projects/' + pid);
  if (state.project?.id !== project.id) {
    state.directions = 1;
    state.lintAll = false;
  }
  state.project = project;
  state.revision = state.project.current;
  state.tab = 'preview';
  state.native = false;
  state.editor = null;
  const running = state.project.jobs.find((j) => active(j));
  if (running) {
    state.job = running.id;
    state.jobView = running;
  }
  show('workspace');
  drawWorkspace();
  if (running) trackJob(running.id);
}
function lockedDemo() {
  return demoMode() && ['template', 'copy', 'import'].includes(state.revision?.metrics.mode);
}
function drawWorkspace() {
  const p = state.project,
    r = state.revision;
  $('project-title').textContent = p.title;
  $('project-kind').textContent = names[p.kind] + (r?.metrics.mode === 'import' ? ' · Imported · no model' : '');
  $('breadcrumbs').innerHTML = `Projects <span>/</span> ${esc(p.title)}`;
  drawSources();
  drawChat();
  drawComposer();
  $('empty-artifact').hidden = !!r;
  for (const id of ['evaluate-button', 'export-button', 'export-format']) $(id).disabled = !r;
  $('export-format').innerHTML = (
    p.kind === 'web'
      ? ['html', 'zip', 'json', 'pdf']
      : p.kind === 'slides'
        ? ['pptx', 'pdf', 'json', 'html']
        : ['docx', 'pdf', 'json', 'html']
  )
    .map((f) => `<option value="${f}">${f.toUpperCase()}</option>`)
    .join('');
  if (r) drawPreview();
  setTab(state.tab);
  updateBusy(state.jobView);
}
function drawComposer() {
  const p = state.project, r = state.revision, web = p.kind === 'web', demo = demoMode();
  if (!web) state.directions = 1;
  $('directions-control').hidden = !web;
  document.querySelectorAll('[data-directions]').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.directions) === state.directions)));
  const exploring = state.directions > 1;
  $('review-checkbox').disabled = exploring;
  $('review-checkbox').closest('label').classList.toggle('is-disabled', exploring);
  $('review-checkbox').closest('label').title = exploring ? 'Directions are not reviewed. Review runs when you revise the chosen direction.' : '';
  $('suggestions').hidden = !(web && r && !lockedDemo());
  $('prompt').placeholder = exploring
    ? `Describe the product once; GLM explores ${state.directions} distinct directions…`
    : r
      ? 'Describe the changes to this version…'
      : 'Describe the audience, purpose, required content, and constraints…';
  const sources = p.sources?.length || 0;
  $('composer-hint').textContent = demo
    ? r?.metrics.mode === 'import'
      ? 'Use Edit to change imported work. Demo revisions load fixed samples and do not interpret prompts.'
      : exploring
        ? 'Demo directions restyle fixed sample content with curated presets.'
        : 'Demo mode loads fixed content. Revision prompts are not interpreted.'
    : exploring
      ? `Each direction is a complete new design built in parallel${r ? ' beside the current version' : ''}. Review is skipped.`
      : `Your brief${sources ? `, ${plural(sources, 'source document')}` : ''} and references are sent to the configured model.`;
}
function drawSources() {
  const p = state.project, list = p.sources || [], refs = p.references || [], max = state.config.maxSources || 6;
  const busy = active(state.jobView) || state.sourceBusy;
  const counts = [list.length && plural(list.length, 'doc'), refs.length && plural(refs.length, 'image')].filter(Boolean);
  $('sources-count').textContent = counts.length ? counts.join(' · ') : 'None yet';
  const open = state.sourcesOpen.has(p.id);
  $('sources-toggle').setAttribute('aria-expanded', String(open));
  $('sources-body').hidden = !open;
  $('sources-list').innerHTML = list.length
    ? list
        .map(
          (s) =>
            `<li class="source-item"><span class="source-kind">${esc(String(s.kind || 'file').toUpperCase())}</span><span class="source-text"><strong title="${esc(s.name)}">${esc(s.name)}</strong><small>${esc(s.summary || `${num(s.chars)} characters`)}${s.truncated ? ' · truncated' : ''}</small></span><button type="button" class="icon-button sm" data-remove-source="${esc(s.id)}" aria-label="Remove ${esc(s.name)}" title="Remove" ${busy ? 'disabled' : ''}>${icon('x')}</button></li>`,
        )
        .join('')
    : '<li class="source-empty">Add briefs, data or notes. GLM reads their text as source facts for every generation in this project.</li>';
  const key = p.id + ':' + refs.length;
  if ($('reference-strip').dataset.key !== key) {
    $('reference-strip').dataset.key = key;
    $('reference-strip').innerHTML = refs.length
      ? `<small>Reference images · set at creation</small><div>${refs.map((r) => `<img src="${imageURL(r.data)}" alt="${esc(r.name)}" title="${esc(r.name)}">`).join('')}</div>`
      : '';
  }
  $('add-source').disabled = busy || list.length >= max;
  $('sources-hint').textContent = state.sourceBusy
    ? 'Reading documents…'
    : active(state.jobView)
      ? 'Sources are locked while GLM is working.'
      : list.length >= max
        ? `Limit of ${max} reached. Remove one to add another.`
        : `${max - list.length} of ${max} slots free · 15 MB each`;
}

// ---- conversation -------------------------------------------------------------------
const USER_LABEL = { template: 'CURATED STARTER', copy: 'EXPLORATION COPY', manual: 'MANUAL EDIT', restore: 'RESTORE', import: 'IMPORTED BRIEF' };
function userTurn(label, text) {
  const long = String(text || '').length > 320 || String(text || '').split('\n').length > 7;
  return `<div class="turn user"><div class="bubble${long ? ' clampable' : ''}"><small class="turn-label">${label}</small><div class="turn-text">${esc(text)}</div>${long ? '<button type="button" class="text-button expand" data-expand>Show more</button>' : ''}</div></div>`;
}
function assistantTurn({ label, cls = '', badges = '', body = '', extra = '', actions = '', avatar = 'f' }) {
  return `<div class="turn assistant ${cls}"><div class="turn-head"><span class="turn-avatar" aria-hidden="true">${avatar}</span><small class="turn-label">${label}</small><span class="turn-badges">${badges}</span></div>${body ? `<div class="turn-body">${body}</div>` : ''}${extra}${actions ? `<div class="turn-actions">${actions}</div>` : ''}</div>`;
}
function revisionBadges(v) {
  const p = state.project, out = [];
  if (v.id === p.current_id) out.push('<span class="badge">Current</span>');
  if (v.id === state.revision?.id && v.id !== p.current_id) out.push('<span class="badge viewing">Viewing</span>');
  return out.join('');
}
function changedSummary(changed) {
  if (!Array.isArray(changed)) return 'the whole design';
  const screens = changed.filter((c) => c !== 'tokens' && !String(c).startsWith('-'));
  const removed = changed.filter((c) => String(c).startsWith('-')).map((c) => String(c).slice(1));
  const parts = [];
  if (screens.length) parts.push(`${plural(screens.length, 'screen')} (${screens.slice(0, 4).join(', ')}${screens.length > 4 ? ', …' : ''})`);
  if (removed.length) parts.push(`removed ${removed.join(', ')}`);
  if (changed.includes('tokens')) parts.push('the design tokens');
  return parts.join(', ') || 'no screens';
}
function pipelineSummary(v) {
  const m = v.metrics || {}, pl = m.pipeline || {}, refined = m.review?.refined;
  const preset = pl.preset ? ` with the ${presetName(pl.preset)} preset` : '';
  if (pl.mode === 'staged')
    return `Planned the flow, then built ${plural(pl.screens || 1, 'screen')} in parallel${preset}${pl.direction ? ` (${pl.direction})` : ''}.${refined ? ' One correction pass followed the review.' : ''}`;
  if (pl.mode === 'revision') {
    const c = changedSummary(pl.changed);
    if (refined && !v.parent_id) return `Built a new design, then a correction pass updated ${c}.`;
    if (refined) return `Revised the design; the review's correction pass updated ${c}. Untouched screens were kept as they were.`;
    return `Updated ${c}. Untouched screens were kept as they were.`;
  }
  if (pl.mode === 'single') return `Generated the ${names[state.project.kind] || 'artifact'} in one structured call.${refined ? ' One correction pass followed the review.' : ''}`;
  return 'A saved revision is ready to inspect.';
}
function statsRow(m) {
  const calls = Number(m.modelCalls) || 0;
  if (!calls) return `<div class="turn-stats"><span class="stat-chip">${icon('check')}No model calls</span>${m.durationSeconds ? `<span class="stat-chip" title="Elapsed">${icon('clock')}${secs(m.durationSeconds)}</span>` : ''}</div>`;
  const chips = [
    [icon('clock') + secs(m.durationSeconds), 'Generation time'],
    [icon('zap') + plural(calls, 'call'), 'Model calls'],
  ];
  if (m.outputTokens) chips.push([`${icon('type')}${num(m.outputTokens)} out`, 'Reported output tokens']);
  if (m.reasoningTokens) chips.push([`${icon('bulb')}${num(m.reasoningTokens)} reasoning`, 'Reported reasoning tokens']);
  return `<div class="turn-stats">${chips.map(([h, t]) => `<span class="stat-chip" title="${t}">${h}</span>`).join('')}</div>`;
}
function qualityRow(v) {
  const m = v.metrics || {}, parts = [], ls = m.lintScore;
  if (ls && Number.isFinite(ls.score)) {
    const c = ls.counts || {};
    const detail = c.error ? plural(c.error, 'error') : c.warning ? plural(c.warning, 'warning') : 'clean';
    parts.push(`<button type="button" class="lint-pill tone-${tone(ls.score)}" data-open-checks="${esc(v.id)}" data-anchor="lint-card" aria-label="Design lint ${ls.score} of 100, ${detail}. Open in Checks">Lint <b>${ls.score}</b><span>${detail}</span></button>`);
  }
  const w = (m.warnings || []).length;
  if (w) parts.push(`<button type="button" class="inspect-pill" data-open-checks="${esc(v.id)}" data-anchor="warnings-card">${icon('alert')}${plural(w, 'item')} to inspect</button>`);
  return parts.length ? `<div class="turn-quality">${parts.join('')}</div>` : '';
}
function reviewBlock(m) {
  const r = m.review;
  if (!r) return '';
  const n = r.issues?.length || 0;
  const meta = [r.refined ? 'one correction pass' : '', n ? plural(n, 'issue') : 'no issues', r.scope === 'content-only' ? 'content only' : ''].filter(Boolean).join(' · ');
  return `<div class="turn-review"><small>Review · ${meta}</small><p>${esc(r.summary || 'No summary returned.')}</p></div>`;
}
function revisionTurn(v, n, number) {
  const m = v.metrics || {};
  const note = typeof m.note === 'string' ? m.note : '';
  let label, body, userText = v.prompt;
  if (v.origin === 'manual') {
    const glmEdit = /^GLM element edit/i.test(note);
    label = glmEdit ? `REVISION ${n} · GLM ELEMENT EDIT` : `REVISION ${n} · SAVED EDIT`;
    body = glmEdit ? `${esc(note)}<br><span class="muted">Applied to one element; other markup is unchanged.</span>` : note ? `Saved with the note “${esc(note)}”.` : 'Your edits were saved as a new revision. Rendering and review were not rerun.';
    userText = note || 'Edited the design directly.';
  } else if (v.origin === 'restore') {
    const source = /^Restored revision (.+)$/.exec(v.prompt || '')?.[1];
    const ref = number.get(source) ? `revision ${number.get(source)}` : 'an earlier revision';
    label = `REVISION ${n} · RESTORED`;
    body = `Restored ${ref} as the current version. No model was called.`;
    userText = `Restore ${ref}.`;
  } else {
    label = m.mode === 'template' ? 'CURATED LAYOUT · NO MODEL' : m.mode === 'copy' ? 'COPIED DESIGN · NO MODEL' : m.mode === 'demo' ? 'FIXED DEMONSTRATION' : m.mode === 'import' ? 'IMPORTED ARTIFACT' : 'REVISION ' + n;
    body = m.mode === 'template'
      ? 'Curated starter loaded. Edit it on the canvas, or connect GLM to adapt it to your brief.'
      : m.mode === 'copy'
        ? 'An independent copy of the selected revision. No model was called.'
        : m.mode === 'demo'
          ? 'Sample content loaded. Connect GLM to interpret your brief.'
          : m.mode === 'import'
            ? 'Ready to edit and export. Imported work is excluded from GLM summaries.'
            : esc(pipelineSummary(v));
  }
  const viewing = v.id === state.revision?.id;
  return (
    userTurn(USER_LABEL[v.origin] || 'YOUR BRIEF', userText) +
    assistantTurn({
      label,
      badges: revisionBadges(v),
      body,
      extra: statsRow(m) + qualityRow(v) + reviewBlock(m),
      actions: viewing ? '' : `<button type="button" class="text-button" data-view-revision="${esc(v.id)}">${icon('eye')}View this version</button>`,
      cls: viewing ? 'is-viewing' : '',
    })
  );
}
function directionsTurn(g, number) {
  const list = [...g.list].sort((a, b) => (a.metrics.direction?.index ?? 0) - (b.metrics.direction?.index ?? 0));
  const first = list[0], m = first.metrics || {}, demo = m.mode === 'demo';
  const nums = list.map((v) => number.get(v.id)).sort((a, b) => a - b);
  const total = Number(m.direction?.total) || list.length;
  const rows = list
    .map((v, i) => {
      const d = v.metrics.direction || {}, ls = v.metrics.lintScore, viewing = v.id === state.revision?.id;
      const preset = v.metrics.pipeline?.preset;
      return `<li class="direction-row${viewing ? ' is-viewing' : ''}"><span class="direction-index">${i + 1}</span><span class="direction-row-text"><strong>${esc(d.name || `Direction ${i + 1}`)}</strong>${preset ? `<small>${esc(presetName(preset))}</small>` : ''}</span>${ls ? `<span class="mini-score tone-${tone(ls.score)}" title="Design lint">${ls.score}</span>` : ''}${revisionBadges(v)}${viewing ? '' : `<button type="button" class="text-button" data-view-revision="${esc(v.id)}">View</button>`}</li>`;
    })
    .join('');
  const failed = (m.warnings || []).find((w) => /directions failed/.test(w));
  return (
    userTurn(`YOUR BRIEF · ${list.length} DIRECTIONS`, first.prompt) +
    assistantTurn({
      label: demo ? `FIXED DEMONSTRATION · ${list.length} DIRECTIONS` : `${list.length} DIRECTIONS · REVISIONS ${nums[0]}–${nums.at(-1)}`,
      avatar: icon('layers'),
      body: `${demo ? 'Restyled the fixed sample with curated presets' : `Explored ${plural(total, 'direction')} in parallel`}. Compare them above the preview, then keep one with “Use this direction”.${failed ? `<br><span class="muted">${esc(failed)}</span>` : ''}`,
      extra: `<ol class="direction-rows">${rows}</ol>${statsRow(m)}`,
    })
  );
}
function errorTurn(j) {
  const cancelled = j.status === 'cancelled';
  const count = j.kind === 'directions' ? Number(j.options?.count) || 0 : 0;
  return (
    userTurn(count ? `YOUR BRIEF · ${count} DIRECTIONS` : 'YOUR BRIEF', j.prompt) +
    assistantTurn({
      label: cancelled ? 'CANCELLED' : 'GENERATION FAILED',
      cls: 'is-failed',
      avatar: icon(cancelled ? 'x' : 'alert'),
      badges: `<span class="turn-time">${esc(date(j.updated || j.created))}</span>`,
      body: esc(cancelled ? 'Cancelled before a revision was saved.' : j.error || j.stage || 'Generation failed.'),
      actions: `<button type="button" class="secondary sm" data-retry-job="${esc(j.id)}" ${active(state.jobView) ? 'disabled' : ''}>${icon('retry')}Retry</button>`,
    })
  );
}
function startTurn() {
  const p = state.project, sources = p.sources || [];
  const list = sources.length
    ? `<ul class="start-sources">${sources.map((s) => `<li>${icon('file')}<span><strong>${esc(s.name)}</strong><small>${esc(s.summary || '')}${s.truncated ? ' · truncated' : ''}</small></span></li>`).join('')}</ul>`
    : '';
  return assistantTurn({
    label: 'START HERE',
    cls: 'start',
    body: `Describe the work you need.<br><br>For a useful evaluation, include the facts the output must preserve and how you will use the exported result.${p.references.length ? `<br><br>${p.references.length} reference image(s) attached.` : ''}${sources.length ? `<br><br>Read ${plural(sources.length, 'source document')}. GLM uses their text as facts:` : ''}`,
    extra: list,
  });
}
function chatItems() {
  const p = state.project, all = [...p.revisions].reverse();
  const number = new Map(all.map((v, i) => [v.id, i + 1]));
  const items = [], groups = new Map();
  for (const v of all) {
    const jid = v.metrics?.direction?.jobId;
    if (jid) {
      let g = groups.get(jid);
      if (!g) {
        g = { type: 'directions', list: [], time: v.created };
        groups.set(jid, g);
        items.push(g);
      }
      g.list.push(v);
      if (v.created < g.time) g.time = v.created;
    } else items.push({ type: 'revision', v, time: v.created });
  }
  for (const j of p.jobs || []) if (['failed', 'cancelled'].includes(j.status)) items.push({ type: 'error', j, time: j.created });
  items.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  return { items, number };
}
function drawChat() {
  const p = state.project, host = $('chat-history');
  const { items, number } = chatItems();
  host.innerHTML =
    (p.revisions.length ? '' : startTurn()) +
    items
      .map((it) => (it.type === 'revision' ? revisionTurn(it.v, number.get(it.v.id), number) : it.type === 'directions' ? directionsTurn(it, number) : errorTurn(it.j)))
      .join('');
  state.live.html = null;
  if (active(state.jobView)) drawLive(state.jobView, true);
  host.scrollTop = host.scrollHeight;
}

// ---- live progress -----------------------------------------------------------------
function jobSteps(j) {
  const p = state.project;
  if (demoMode()) return j.kind === 'directions' ? [['build', `Restyle ${Number(j.options?.count) || ''} directions`], ['render', 'Render and lint']] : [['build', 'Load sample content'], ['render', 'Render and lint']];
  if (j.kind === 'directions') return [['build', `Plan and build ${Number(j.options?.count) || ''} directions`], ['render', 'Render and lint']];
  const steps = [];
  if (p.kind === 'web' && state.config.pipeline !== 'single') {
    if (j.base_id) steps.push(['build', 'Revise changed screens']);
    else steps.push(['plan', 'Plan'], ['build', 'Build screens']);
  } else steps.push(['build', 'Generate']);
  steps.push(['render', 'Render and lint']);
  if (j.review) steps.push(['review', 'Review'], ['refine', 'Refine if needed']);
  return steps;
}
function phaseKey(j) {
  const pr = j.progress || {}, label = pr.label || j.stage || '';
  if (['generating', 'repairing'].includes(pr.phase)) return /Planning/i.test(label) ? 'plan' : 'build';
  return { rendering: 'render', reviewing: 'review', refining: 'refine' }[pr.phase] || null;
}
function drawLive(j, force = false) {
  const host = $('chat-history');
  if (!host) return;
  let wrap = $('live-turn');
  const created = !wrap || wrap.dataset.job !== j.id;
  if (created) {
    wrap?.remove();
    const count = j.kind === 'directions' ? Number(j.options?.count) || 0 : 0;
    host.insertAdjacentHTML(
      'beforeend',
      `<div id="live-turn" class="live-wrap">${userTurn(count ? `YOUR BRIEF · ${count} DIRECTIONS` : 'YOUR BRIEF', j.prompt)}<div class="turn assistant live"><div class="turn-head"><span class="turn-avatar is-live" aria-hidden="true"><span class="pulse"></span></span><small class="turn-label" id="live-title"></small><span class="turn-badges"><span class="turn-time" id="live-elapsed"></span></span></div><p id="live-label" class="live-label" aria-live="polite"></p><ol id="live-steps" class="stepper"></ol><div id="live-meta" class="live-meta"></div></div></div>`,
    );
    wrap = $('live-turn');
    wrap.dataset.job = j.id;
  }
  const near = host.scrollHeight - host.scrollTop - host.clientHeight < 120;
  if (state.live.job !== j.id) state.live = { job: j.id, step: -1, detail: '', renderDetail: '' };
  const pr = j.progress || {}, steps = jobSteps(j), key = phaseKey(j);
  let index = key ? steps.findIndex((s) => s[0] === key) : -1;
  if (index < 0 && key === 'plan') index = steps.findIndex((s) => s[0] === 'build');
  if (index < 0 && key) index = steps.length - 1;
  // Progress never moves backwards (a refine pass reports "generating" again).
  state.live.step = Math.max(state.live.step, index);
  const label = String(pr.label || j.stage || '').replace(/\s*·\s*[\d.]+k characters$/, '');
  const built = /Built (\d+) of (\d+) screens/.exec(label);
  if (built) state.live.detail = `${built[1]}/${built[2]}`;
  if (pr.phase === 'rendering' && Number.isFinite(pr.total) && pr.total > 1) state.live.renderDetail = `${pr.done || 0}/${pr.total} done`;
  const cur = state.live.step;
  const html = steps
    .map(([k, name], i) => {
      const status = cur < 0 ? 'todo' : i < cur ? 'done' : i === cur ? 'active' : 'todo';
      const detail = k === 'build' ? state.live.detail : k === 'render' ? state.live.renderDetail : '';
      return `<li class="step ${status}"><span class="step-dot">${status === 'done' ? icon('check') : ''}</span><span class="step-name">${esc(name)}${detail ? ` <em>${esc(detail)}</em>` : ''}</span></li>`;
    })
    .join('');
  if (force || state.live.html !== html) {
    $('live-steps').innerHTML = html;
    state.live.html = html;
  }
  const queued = j.status === 'queued' || pr.phase === 'queued';
  $('live-title').textContent = queued ? 'QUEUED' : demoMode() ? 'LOADING DEMONSTRATION' : j.kind === 'directions' ? `EXPLORING ${Number(j.options?.count) || ''} DIRECTIONS` : 'GLM IS WORKING';
  const shown = queued ? 'Waiting for a free worker…' : label || 'Starting…';
  if ($('live-label').textContent !== shown) $('live-label').textContent = shown;
  const started = Date.parse(j.created);
  $('live-elapsed').textContent = Number.isFinite(started) ? clock(Date.now() - started) : '';
  const meta = [];
  if (pr.chars) meta.push(`${num(pr.chars)} characters streamed`);
  if (pr.calls) meta.push(plural(pr.calls, 'model call'));
  $('live-meta').textContent = meta.join(' · ');
  if (created || near) host.scrollTop = host.scrollHeight;
}

// ---- directions picker ------------------------------------------------------------
function directionSet() {
  const p = state.project;
  if (!p || p.kind !== 'web') return [];
  const family = (jid) => p.revisions.filter((v) => v.metrics?.direction?.jobId === jid).sort((a, b) => (a.metrics.direction.index ?? 0) - (b.metrics.direction.index ?? 0));
  const jid = state.revision?.metrics?.direction?.jobId || p.current?.metrics?.direction?.jobId;
  if (jid) return family(jid);
  const latest = (p.jobs || []).find((j) => j.status === 'complete');
  if (latest?.result_ids?.length > 1) return latest.result_ids.map((id) => p.revisions.find((v) => v.id === id)).filter(Boolean);
  return [];
}
function directionCard(v, i, chosen) {
  const m = v.metrics || {}, d = m.direction || {}, ls = m.lintScore, ds = state.dirCache.get(v.id);
  const viewing = v.id === state.revision?.id, current = chosen.has(v.id);
  const presetId = m.pipeline?.preset || ds?.preset;
  const swatches = ds ? ['accent', 'background', 'surface', 'text'].map((k) => hex(ds[k])).filter(Boolean).map((c) => `<i style="background:${c}"></i>`).join('') : '';
  const shot = !!m.render?.screenshots;
  const thumb = shot
    ? `<img src="/api/projects/${esc(state.project.id)}/screenshot?revision=${esc(v.id)}&amp;page=0" alt="" loading="lazy">`
    : ds
      ? `<span class="thumb-palette" style="background:${hex(ds.background) || '#ffffff'}"><span style="background:${hex(ds.surface) || '#ffffff'}"><b style="background:${hex(ds.accent) || '#5b4fd6'}"></b><i style="background:${hex(ds.text) || '#1c1b20'}"></i><i style="background:${hex(ds.text) || '#1c1b20'}"></i></span></span>`
      : `<span class="thumb-fallback">${icon('screen')}</span>`;
  const name = d.name || `Direction ${i + 1}`;
  return `<article class="direction-card${viewing ? ' is-viewing' : ''}${current ? ' is-current' : ''}"><button type="button" class="direction-main" data-direction-view="${esc(v.id)}" aria-pressed="${viewing}" title="View ${esc(name)}"><span class="direction-thumb">${thumb}</span><span class="direction-info"><strong>${esc(name)}</strong><small>${presetId ? esc(presetName(presetId)) : 'Preset not recorded'}${ls ? ` · Lint ${ls.score}` : ''}</small>${shot && swatches ? `<span class="swatches" aria-hidden="true">${swatches}</span>` : ''}</span></button><div class="direction-foot">${current ? '<span class="badge">Current</span>' : ''}${viewing ? '<span class="badge viewing">Viewing</span>' : ''}${current ? '' : `<button type="button" class="text-button" data-direction-use="${esc(v.id)}">Use this direction</button>`}</div></article>`;
}
function drawDirections() {
  const host = $('directions-strip'), set = state.revision && state.tab === 'preview' ? directionSet() : [];
  host.hidden = set.length < 2;
  if (host.hidden) {
    host.innerHTML = '';
    return;
  }
  const p = state.project, chosen = new Set([p.current_id]);
  if (p.current?.origin === 'restore' && p.current.parent_id) chosen.add(p.current.parent_id);
  host.innerHTML = `<div class="directions-head"><span class="directions-title">${icon('layers')}Directions</span><small>Compare the variants, then keep one. Each is a saved revision.</small></div><div class="direction-cards">${set.map((v, i) => directionCard(v, i, chosen)).join('')}</div>`;
  const missing = set.filter((v) => !state.dirCache.has(v.id));
  if (!missing.length) return;
  for (const v of missing) state.dirCache.set(v.id, null);
  Promise.all(
    missing.map(async (v) => {
      try {
        const r = await api(`/projects/${p.id}/revisions/${v.id}`);
        state.dirCache.set(v.id, r.artifact?.designSystem || r.artifact?.theme || null);
      } catch {}
    }),
  ).then(() => state.project?.id === p.id && drawDirections());
}
async function viewRevision(rid, tab = 'preview') {
  if (!leaveSource()) return false;
  if (window.FormaStudio && !window.FormaStudio.leave()) return false;
  const p = state.project;
  state.revision = rid === p.current_id && p.current ? p.current : await api(`/projects/${p.id}/revisions/${rid}`);
  state.native = false;
  drawPreview();
  setTab(tab);
  drawChat();
  drawComposer();
  updateBusy(state.jobView);
  if (rid !== p.current_id)
    toast(state.revision.metrics?.direction ? 'Viewing a direction. Choose “Use this direction” to continue from it.' : 'Viewing a saved revision. Restore it before making changes.');
  return true;
}
async function openChecks(rid, anchor) {
  if (rid !== state.revision?.id) {
    if (!(await viewRevision(rid, 'checks'))) return;
  } else setTab('checks');
  if (state.tab === 'checks') $(anchor)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function drawPreview() {
  const p = state.project,
    r = state.revision;
  $('project-kind').textContent = names[p.kind] + (r.metrics.mode === 'import' ? ' · Imported · no model' : '');
  if(p.kind === 'web' && window.FormaStudio) { window.FormaStudio.render(p,r,state.native); return; }
  window.FormaStudio?.hide();
  $('preview-frame').src = `/api/projects/${p.id}/preview?revision=${r.id}`;
  $('desktop-view').hidden = p.kind !== 'web';
  $('mobile-view').hidden = p.kind !== 'web';
  $('preview-caption').textContent =
    p.kind === 'web'
      ? 'Local interactions · no connected backend'
      : 'HTML layout preview · inspect the rendered export too';
  $('native-view').textContent = state.native ? 'HTML preview' : 'Rendered export';
  $('frame-wrap').hidden = state.native;
  $('native-pages').hidden = !state.native;
  const render = r.metrics.render;
  $('native-pages').innerHTML = render?.screenshots
    ? `<p class="small muted">${esc(render.basis)} · ${render.screenshots} captured page(s)</p>${Array.from({ length: render.screenshots }, (_, i) => `<img src="/api/projects/${p.id}/screenshot?revision=${r.id}&page=${i}" alt="Rendered page ${i + 1}">`).join('')}`
    : '<div class="check-card"><h3>No rendered export yet</h3><p>Open Checks and choose Render exports. The renderer needs Chromium, LibreOffice, and Poppler, supplied in its Docker image.</p></div>';
}
function setTab(tab) {
  if(sourceDirty()) { toast('Save your source edits before changing panels.'); return; }
  if(tab !== state.tab && window.FormaStudio?.isDirty()) { toast('Save design or undo your changes before changing panels.'); return; }
  state.tab = tab;
  document
    .querySelectorAll('.tab')
    .forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  for (const t of ['preview', 'edit', 'history', 'checks'])
    $(t + '-panel').hidden = t !== tab || !state.revision;
  drawDirections();
  if (!state.revision) return;
  if (tab === 'edit') drawEditor();
  if (tab === 'history') drawHistory();
  if (tab === 'checks') drawChecks();
}
function inputField(label, value, path, multiline = false, code = false) {
  return `<label>${esc(label)}${multiline ? `<textarea data-field="${path}" rows="${code ? 12 : 3}" ${code ? 'class="code-editor" spellcheck="false"' : ''}>${esc(value)}</textarea>` : `<input data-field="${path}" value="${esc(value)}">`}</label>`;
}
function drawEditor(value = state.revision.artifact) {
  const a = structuredClone(value);
  state.editor = a;
  let html =
    inputField('Title', a.title, 'title') + inputField('Summary', a.summary, 'summary', true);
  if (a.kind === 'web')
    html +=
      (a.screens ? a.screens.map((s,i)=>`<section class="edit-block"><h3>${esc(s.name)}</h3>${inputField('Screen name',s.name,`screens.${i}.name`)}${inputField('HTML body',s.html,`screens.${i}.html`,true,true)}</section>`).join('') : inputField('HTML body', a.html, 'html', true, true)) +
      inputField('CSS', a.css, 'css', true, true);
  else if (a.kind === 'slides') {
    // Slides v2 layouts edit only the fields they show; object lists are edited as JSON.
    const json = (label, value, path) => inputField(label, JSON.stringify(value, null, 2), path, true, true);
    const v2 = {
      section: (s, i) => inputField('Body', s.body, `slides.${i}.body`, true),
      quote: (s, i) => inputField('Quote', s.quote, `slides.${i}.quote`, true) + inputField('Attribution', s.attribution, `slides.${i}.attribution`),
      stats: (s, i) => inputField('Intro (optional)', s.body, `slides.${i}.body`, true) + json('Stats JSON — 2 to 4 {value, label, detail}', s.stats, `slides.${i}.stats`),
      timeline: (s, i) => inputField('Intro (optional)', s.body, `slides.${i}.body`, true) + json('Steps JSON — 3 to 6 {label, title, detail}', s.steps, `slides.${i}.steps`),
      cards: (s, i) => inputField('Intro (optional)', s.body, `slides.${i}.body`, true) + json('Cards JSON — 3 to 4 {title, body, icon}', s.cards, `slides.${i}.cards`),
      chart: (s, i) => inputField('Takeaway (optional)', s.body, `slides.${i}.body`, true) + json('Chart JSON', s.chart, `slides.${i}.chart`),
      agenda: (s, i) => inputField('Intro (optional)', s.body, `slides.${i}.body`, true) + inputField('Agenda items — one per line', s.bullets.join('\n'), `slides.${i}.bullets`, true),
    };
    html += a.slides
      .map(
        (s, i) => v2[s.layout]
          ? `<section class="edit-block"><h3>SLIDE ${i + 1} / ${esc(String(s.layout).toUpperCase())}</h3>${inputField('Title', s.title, `slides.${i}.title`)}${inputField('Subtitle', s.subtitle, `slides.${i}.subtitle`)}${v2[s.layout](s, i)}${inputField('Speaker notes', s.notes, `slides.${i}.notes`, true)}</section>`
          : `<section class="edit-block"><h3>SLIDE ${i + 1} / ${esc(String(s.layout).toUpperCase())}</h3>${inputField('Title', s.title, `slides.${i}.title`)}${inputField('Subtitle', s.subtitle, `slides.${i}.subtitle`)}${inputField('Body', s.body, `slides.${i}.body`, true)}${inputField('Bullets — one per line', s.bullets.join('\n'), `slides.${i}.bullets`, true)}${s.columns.map((c, j) => inputField(`Column ${j + 1} heading`, c.heading, `slides.${i}.columns.${j}.heading`) + inputField(`Column ${j + 1} body`, c.body, `slides.${i}.columns.${j}.body`, true) + inputField(`Column ${j + 1} bullets`, c.bullets.join('\n'), `slides.${i}.columns.${j}.bullets`, true)).join('')}${s.table ? inputField('Table JSON', JSON.stringify(s.table, null, 2), `slides.${i}.table`, true, true) : ''}${inputField('Speaker notes', s.notes, `slides.${i}.notes`, true)}</section>`,
      )
      .join('');
  } else
    html +=
      inputField('Subtitle', a.subtitle, 'subtitle') +
      a.blocks
        .map(
          (b, i) =>
            `<section class="edit-block"><h3>BLOCK ${i + 1} / ${esc(String(b.type).toUpperCase())}</h3>${b.type === 'bullets' ? inputField('Items — one per line', b.items.join('\n'), `blocks.${i}.items`, true) : b.type === 'table' ? inputField('Table JSON', JSON.stringify(b.table, null, 2), `blocks.${i}.table`, true, true) : inputField(b.type === 'image' ? 'Image caption' : 'Text', b.text, `blocks.${i}.text`, b.type !== 'heading')}</section>`,
        )
        .join('');
  $('edit-fields').innerHTML = html;
  $('artifact-json').value = JSON.stringify(a, null, 2);
}
function collectEditor() {
  const a = structuredClone(state.editor);
  document.querySelectorAll('[data-field]').forEach((el) => {
    const parts = el.dataset.field.split('.'),
      key = parts.pop();
    let node = a;
    for (const p of parts) node = node[p];
    node[key] = ['bullets', 'items'].includes(key)
      ? el.value.split('\n').filter((x) => x.trim())
      : ['table', 'stats', 'steps', 'cards', 'chart'].includes(key)
        ? JSON.parse(el.value)
        : el.value;
  });
  if(a.screens) a.html=a.screens[0].html;
  return a;
}
function drawHistory() {
  $('history-panel').innerHTML =
    '<div class="panel-intro"><h2>Every version, kept.</h2><p>Inspect any revision or restore it as a new current version.</p></div>' +
    state.project.revisions
      .map((r, i) => {
        const m = r.metrics || {}, extra = [m.direction?.name && `Direction: ${m.direction.name}`, m.lintScore && `Lint ${m.lintScore.score}`].filter(Boolean).map(esc).join(' · ');
        return `<article class="history-item"><h3>Revision ${state.project.revisions.length - i} ${r.id === state.project.current_id ? '<span class="badge">Current</span>' : ''} ${r.id === state.revision.id ? '<span class="badge viewing">Viewing</span>' : ''}</h3><small class="muted">${date(r.created)} · ${esc(r.origin)}${extra ? ' · ' + extra : ''}</small><p>${esc(r.prompt)}</p><div class="actions"><button class="secondary" data-view-revision="${esc(r.id)}">View revision</button><button class="text-button" data-restore="${esc(r.id)}">Restore as new version</button></div></article>`;
      })
      .join('');
}

// ---- checks ----------------------------------------------------------------------------
const SEVERITY = { error: 0, warning: 1, info: 2 };
const LINT_CAP = 12;
function lintCard(m) {
  const ls = m.lintScore, lint = Array.isArray(m.lint) ? m.lint : [];
  if (!ls || !Number.isFinite(ls.score))
    return '<div class="check-card" id="lint-card"><h3>Design lint</h3><p>No lint result is recorded for this revision. Choose Render exports to run the static and in-browser design checks.</p></div>';
  const c = ls.counts || {};
  const groups = new Map();
  for (const f of lint) {
    const key = String(f.rule || 'other');
    if (!groups.has(key)) groups.set(key, { rule: key, sev: f.severity, items: [] });
    const g = groups.get(key);
    g.items.push(f);
    if ((SEVERITY[f.severity] ?? 3) < (SEVERITY[g.sev] ?? 3)) g.sev = f.severity;
  }
  const sorted = [...groups.values()].sort((a, b) => (SEVERITY[a.sev] ?? 3) - (SEVERITY[b.sev] ?? 3) || b.items.length - a.items.length);
  let shown = 0;
  const body = sorted
    .map((g) => {
      const room = state.lintAll ? g.items.length : Math.max(0, LINT_CAP - shown);
      const items = g.items.slice(0, room);
      shown += items.length;
      const sev = ['error', 'warning', 'info'].includes(g.sev) ? g.sev : 'info';
      const head = `<header title="Rule: ${esc(g.rule)}"><span class="sev-dot" aria-hidden="true"></span><strong>${esc(human(g.rule))}</strong><span class="sev-tag">${sev}</span><span class="lint-count" aria-label="${plural(g.items.length, 'finding')}">${g.items.length}</span></header>`;
      if (!items.length) return `<section class="lint-group sev-${sev} collapsed">${head}</section>`;
      return `<section class="lint-group sev-${sev}">${head}<ul>${items
        .map(
          (f) =>
            `<li><p>${esc(f.message)}</p>${f.screen || f.viewport || f.target ? `<div class="lint-meta">${f.screen ? `<span>${icon('screen')}${esc(f.screen)}</span>` : ''}${f.viewport ? `<span>${esc(f.viewport)}</span>` : ''}${f.target ? `<code title="${esc(f.target)}">${esc(f.target)}</code>` : ''}</div>` : ''}</li>`,
        )
        .join('')}${items.length < g.items.length ? `<li class="lint-more">${g.items.length - items.length} more in this rule</li>` : ''}</ul></section>`;
    })
    .join('');
  const toggle = lint.length > LINT_CAP ? `<button type="button" class="secondary sm" id="lint-toggle">${state.lintAll ? 'Show fewer findings' : `Show all ${lint.length} findings`}</button>` : '';
  return `<div class="check-card lint-card" id="lint-card"><div class="lint-head"><div class="score tone-${tone(ls.score)}"><strong>${ls.score}</strong><small>/100</small></div><div><h3>Design lint</h3><p>Deterministic checks: contrast, overflow, tap targets, labels, links, unknown classes and icons. Errors are listed first.</p><div class="sev-counts"><span class="sev-error">${plural(c.error || 0, 'error')}</span><span class="sev-warning">${plural(c.warning || 0, 'warning')}</span><span class="sev-info">${c.info || 0} info</span></div></div></div>${lint.length ? `<div class="lint-groups">${body}</div>` : '<p class="lint-clean">No findings. This does not certify accessibility or correctness.</p>'}${toggle}${lint.length >= 200 ? '<p class="small muted">Stored findings are capped at 200; the score counts all of them.</p>' : ''}</div>`;
}
function callsCard(m) {
  const calls = Array.isArray(m.calls) ? m.calls : [];
  if (!calls.length) return m.modelCalls ? `<div class="check-card" id="calls-card"><h3>Model calls</h3><p>${plural(m.modelCalls, 'call')} recorded without per-call details.</p></div>` : '';
  const sum = (k) => calls.reduce((n, c) => n + (Number(c[k]) || 0), 0);
  const dropped = sum('imagesDropped');
  const cell = (v) => `<td>${num(v)}</td>`;
  return `<div class="check-card" id="calls-card"><h3>Model calls</h3><p>Each request the pipeline sent to ${esc(m.model || 'the model')}, in order. Token counts are as reported by the endpoint.</p>${dropped ? `<p class="callout warning">${icon('alert')}The endpoint rejected image input; review ran text-only. ${plural(dropped, 'image')} dropped.</p>` : ''}<div class="table-scroll"><table class="calls-table"><thead><tr><th scope="col">Stage</th><th scope="col">Duration</th><th scope="col">Input</th><th scope="col">Output</th><th scope="col">Reasoning</th><th scope="col">Retries</th><th scope="col">Images dropped</th></tr></thead><tbody>${calls
    .map(
      (c) =>
        `<tr${c.error ? ' class="has-error"' : ''}><th scope="row">${esc(c.stage || 'call')}${c.error ? ` <small>${esc(c.error)}</small>` : ''}</th><td>${((Number(c.ms) || 0) / 1000).toFixed(1)}s</td>${cell(c.inputTokens)}${cell(c.outputTokens)}${cell(c.reasoningTokens)}<td>${Number(c.retries) || 0}</td><td>${Number(c.imagesDropped) || 0}</td></tr>`,
    )
    .join('')}</tbody><tfoot><tr><th scope="row">Total · ${calls.length}</th><td>${(sum('ms') / 1000).toFixed(1)}s</td>${cell(sum('inputTokens'))}${cell(sum('outputTokens'))}${cell(sum('reasoningTokens'))}<td>${sum('retries')}</td><td>${dropped}</td></tr></tfoot></table></div></div>`;
}
function drawChecks() {
  const m = state.revision.metrics;
  const responsive = m.render?.screenMetrics;
  const responsiveChecks = responsive?.length ? `<div class="check-card"><h3>Responsive screen checks</h3><p>Each saved screen is measured at 1280, 768 and 390 pixels. These checks do not cover every interaction state or certify accessibility.</p><div class="responsive-checks"><table><thead><tr><th>Screen</th><th>Desktop</th><th>Tablet</th><th>Mobile</th></tr></thead><tbody>${responsive.map(s => `<tr><th scope="row">${esc(s.name)}</th>${['desktop','tablet','mobile'].map(view => { const x=s[view]; if(!x)return '<td>Not checked</td>'; const issues=[x.overflow&&'Horizontal overflow',x.missingLabels&&`${x.missingLabels} table labels missing`,x.unnamedControls&&`${x.unnamedControls} unnamed controls`,x.brokenTargets&&`${x.brokenTargets} missing interaction targets`,x.inactiveButtons&&`${x.inactiveButtons} buttons without an action`,x.duplicateIds&&`${x.duplicateIds} duplicate IDs`].filter(Boolean); return `<td>${issues.length?issues.map(esc).join('<br>'):'No automated issues'}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div></div>` : '';
  const reviewCoverage = m.review?.scope === 'content-only'
    ? 'Content checked against the brief. Visual layout was not inspected.'
    : `${m.review?.pagesReviewed || 0} of ${m.review?.pageCount || 0} captured pages/views reviewed.`;
  const dropped = (Array.isArray(m.calls) ? m.calls : []).reduce((n, c) => n + (Number(c.imagesDropped) || 0), 0);
  const visual = m.review?.visual === 'disabled'
    ? 'Image input is disabled for this model (GLM_VISION=off): the review used lint findings and content only.'
    : dropped || m.review?.visual === 'unavailable'
      ? 'The endpoint rejected image input; review ran text-only.'
      : '';
  const pl = m.pipeline;
  const pipeline = pl?.mode
    ? `<p class="pipeline-line">${icon('layers')}<span>Pipeline: ${esc(pl.mode)}${pl.screens ? ` · ${plural(pl.screens, 'screen')}` : ''}${pl.preset ? ` · ${esc(presetName(pl.preset))} preset` : ''}${pl.direction ? ` · ${esc(pl.direction)}` : ''}${Array.isArray(pl.changed) ? ` · changed ${esc(changedSummary(pl.changed))}` : ''}${m.model ? ` · ${esc(m.model)}` : ''}</span></p>`
    : '';
  const ls = m.lintScore;
  $('checks-panel').innerHTML =
    `<div class="panel-intro"><h2>Evidence, with its limits.</h2><p>Model review can miss mistakes. Open the export and check facts and functionality yourself.</p></div><div class="metric-grid"><div><strong>${m.durationSeconds ?? '—'}<small>s</small></strong><span>Generation elapsed</span></div><div><strong>${m.modelCalls || 0}</strong><span>Model calls</span></div><div><strong>${m.outputTokens || 0}</strong><span>Reported output tokens</span></div><div><strong>${m.reasoningTokens || 0}</strong><span>Reasoning tokens</span></div><div><strong class="${ls ? 'tone-' + tone(ls.score) : ''}">${ls ? ls.score : '—'}<small>${ls ? '/100' : ''}</small></strong><span>Design lint</span></div></div>${pipeline}${lintCard(m)}<div class="check-card"><h3>Rendering</h3><p>${m.render ? esc(m.render.basis) + ' · ' + m.render.pageCount + ' page(s)/view(s)' : 'No successful render is recorded for this revision.'}</p><button class="secondary" id="render-now">Render exports</button></div><div class="check-card"><h3>Model quality review</h3><p>${m.review ? `${esc(m.review.summary)}<br>${reviewCoverage} ${m.review.refined ? 'One correction pass applied; the final result has not been independently approved.' : ''}` : m.mode === 'demo' ? 'Not run. Demo fixtures do not use a model.' : 'Not run or unavailable.'}</p>${visual ? `<p class="callout warning">${icon('alert')}${esc(visual)}</p>` : ''}${m.review?.issues?.length ? '<ul>' + m.review.issues.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ul>' : ''}</div>${callsCard(m)}<div class="check-card" id="warnings-card"><h3>Items to inspect</h3><ul>${(m.warnings?.length ? m.warnings : ['No automated warning was recorded. This does not certify correctness.']).map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`;
  $('checks-panel').insertAdjacentHTML('beforeend',responsiveChecks);
  if ($('lint-toggle'))
    $('lint-toggle').onclick = () => {
      state.lintAll = !state.lintAll;
      drawChecks();
      $('lint-card')?.scrollIntoView({ block: 'start' });
    };
  $('render-now').onclick = safe(async () => {
    $('render-now').disabled = true;
    try {
      toast('Rendering the saved artifact…');
      await api(`/projects/${state.project.id}/render`, 'POST', { revisionId: state.revision.id });
      state.revision = await api(`/projects/${state.project.id}/revisions/${state.revision.id}`);
      if (state.revision.id === state.project.current_id) state.project.current = state.revision;
      drawChecks();
      drawPreview();
      toast('Rendered export is ready.');
    } finally {
      if ($('render-now')) $('render-now').disabled = false;
    }
  });
}

// ---- jobs ------------------------------------------------------------------------------
function updateBusy(job) {
  const busy = active(job);
  $('job-status').hidden = !busy;
  $('generate-button').disabled = busy || lockedDemo();
  $('save-edit').disabled = busy;
  $('generate-button').innerHTML = (state.directions > 1 ? `Explore ${state.directions}` : state.revision ? 'Revise' : 'Generate') + ' <span>↑</span>';
  document.querySelectorAll('[data-directions]').forEach((b) => (b.disabled = busy || lockedDemo()));
  document.querySelectorAll('[data-retry-job]').forEach((b) => (b.disabled = busy));
  if (lockedDemo()) $('composer-hint').textContent='Edit this design with the canvas controls. Connect GLM to adapt it using a brief.';
  if (busy) $('job-stage').textContent = String(job.progress?.label || job.stage || '').replace(/\s*·\s*[\d.]+k characters$/, '');
  if (state.project && state.lastBusy !== busy) drawSources();
  state.lastBusy = busy;
}
async function trackJob(jid) {
  state.job = jid;
  clearTimeout(state.poll);
  const seq = ++state.pollSeq;
  try {
    const j = await api('/jobs/' + jid);
    if (seq !== state.pollSeq || !state.project || j.project_id !== state.project.id || $('workspace').hidden) return;
    if (active(j)) {
      state.jobView = j;
      updateBusy(j);
      drawLive(j);
      state.poll = setTimeout(() => trackJob(jid), 800);
      return;
    }
    state.job = null;
    state.jobView = null;
    await loadProjects();
    const project = await api('/projects/' + j.project_id);
    if (seq !== state.pollSeq || state.project?.id !== project.id) return;
    state.project = project;
    if (j.status === 'complete') {
      state.revision = state.project.current;
      state.tab = 'preview';
      drawWorkspace();
      toast(j.kind === 'directions' ? `${plural(j.result_ids?.length || 0, 'direction')} ready. Compare them above the preview.` : 'Revision saved. Inspect the result and record your evaluation.');
    } else {
      if (state.revision?.id === state.project.current_id) state.revision = state.project.current;
      drawWorkspace();
      if (!$('prompt').value) $('prompt').value = j.prompt;
      toast(j.error || j.stage);
    }
  } catch (e) {
    if (seq !== state.pollSeq) return;
    if (e.status === 401 || e.status === 404) {
      state.job = null;
      state.jobView = null;
      return;
    }
    toast(e.message);
    state.poll = setTimeout(() => trackJob(jid), 3000);
  }
}
async function submitGeneration({ prompt, review, directions }) {
  if(sourceDirty()) throw new Error('Save your source edits before generating.');
  window.FormaStudio?.guard();
  if (state.job) throw new Error('Wait for the active generation to finish or cancel it.');
  if (state.revision && state.revision.id !== state.project.current_id)
    throw new Error(state.revision.metrics?.direction ? 'Choose “Use this direction” before revising it.' : 'Restore this historical revision before revising it.');
  if (!String(prompt || '').trim()) throw new Error('Describe what you need first.');
  const body = { prompt, review: !!review };
  if (directions > 1) body.directions = directions;
  $('generate-button').disabled = true;
  try {
    const job = await api(`/projects/${state.project.id}/generate`, 'POST', body);
    $('prompt').value = '';
    autosize();
    state.job = job.id;
    // Give the live turn room, and go back to a single design for the follow-up revision.
    state.sourcesOpen.delete(state.project.id);
    state.directions = 1;
    drawSources();
    drawComposer();
    trackJob(job.id);
  } catch (err) {
    $('generate-button').disabled = lockedDemo();
    throw err;
  }
}
function autosize() {
  const t = $('prompt');
  t.style.height = 'auto';
  t.style.height = Math.min(260, Math.max(76, t.scrollHeight + 2)) + 'px';
}

// ---- evaluation ---------------------------------------------------------------------------
function median(values) {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y);
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
}
function saving(e) {
  return e.baselineMinutes > 0
    ? (1 - (e.workMinutes + e.cleanupMinutes) / e.baselineMinutes) * 100
    : null;
}
async function showEvaluation() {
  const all = await api('/evaluations');
  show('evaluation');
  // A repeat rating of the same revision replaces the earlier one in summary statistics only.
  const latest = [...new Map([...all].reverse().map((e) => [e.revisionId, e])).values()].filter(
    (e) => e.mode === 'glm',
  );
  $('evaluation-summary').innerHTML = Object.entries(names)
    .map(([kind, name]) => {
      const rows = latest.filter((e) => e.kind === kind),
        accepted = rows.filter((e) => e.accepted && !e.criticalErrors).length,
        time = median(rows.map(saving).filter((v) => v !== null));
      return `<div class="eval-card"><h3>${name}</h3><strong>${rows.length ? Math.round((accepted / rows.length) * 100) + '%' : '—'}</strong><p>${accepted} of ${rows.length} GLM revisions accepted</p><p>${time === null ? 'No timing evidence yet' : Math.round(time) + '% median time saved'}</p></div>`;
    })
    .join('');
  $('evaluation-rows').innerHTML = all.length
    ? all
        .map(
          (e) =>
            `<tr><td>${esc(e.title)}<small>${esc(names[e.kind] || e.kind)} · ${esc(String(e.revisionId).slice(0, 8))} · ${date(e.created)}</small></td><td>${esc(e.mode)}</td><td>${Number(e.quality)}/5</td><td>${e.accepted ? 'Yes' : 'No'}${e.criticalErrors ? ' · critical errors' : ''}</td><td>${saving(e) === null ? '—' : Math.round(saving(e)) + '%'}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="5" class="muted">No evaluations yet. Create an artifact, inspect its export, then choose Evaluate.</td></tr>';
}

// ---- event wiring -------------------------------------------------------------------------
$('login-form').onsubmit = async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  try {
    await api('/login', 'POST', { password: $('password').value });
    $('password').value = '';
    await boot();
  } catch (err) {
    $('login-error').textContent = err.message;
  }
};
$('logout').onclick = safe(async () => {
  if(!leaveSource()) return;
  if(window.FormaStudio && !window.FormaStudio.leave()) return;
  await api('/logout', 'POST', {});
  stopPolling();
  state.job = null;
  state.jobView = null;
  $('app').hidden = true;
  $('login').hidden = false;
});
$('brand-home').onclick = safe(async (e) => {
  e.preventDefault();
  await loadProjects();
  show('library');
});
$('nav-projects').onclick = safe(async () => {
  await loadProjects();
  show('library');
});
$('nav-evaluation').onclick = safe(showEvaluation);
$('new-project').onclick = () => openCreate();
$('import-project').onclick = () => {
  $('import-form').reset();
  $('import-error').textContent = '';
  $('import-dialog').showModal();
};
$('import-file').onchange = () => { $('import-error').textContent = ''; };
$('import-form').onsubmit = async (e) => {
  e.preventDefault();
  $('import-error').textContent = '';
  $('import-submit').disabled = true;
  try {
    const file = $('import-file').files[0];
    if (!file || file.size > 1000000) throw new Error('Choose a Forma JSON file up to 1 MB.');
    let artifact;
    try { artifact = JSON.parse((await file.text()).replace(/^﻿/, '')); }
    catch { throw new Error('This file is not valid JSON. Choose a Forma JSON export.'); }
    const references = [];
    for (let index = 0; index < 2; index++) {
      const image = $('import-image-' + index).files[0];
      if (!image) continue;
      if (index !== references.length) throw new Error('Attach image 1 before image 2 to preserve the original slots.');
      if (!['image/png', 'image/jpeg'].includes(image.type) || image.size > 3000000)
        throw new Error('Use PNG or JPEG reference images up to 3 MB each.');
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('The reference image could not be read.'));
        reader.readAsDataURL(image);
      });
      references.push({ name: image.name, data });
    }
    const project = await api('/import', 'POST', { artifact, references, sourceBrief: $('import-brief').value });
    $('import-dialog').close();
    await loadProjects();
    await openProject(project.id);
    toast('Imported as a new project. No model was called.');
  } catch (error) {
    if ($('import-dialog').open) $('import-error').textContent = error.message;
    else toast(error.message);
  } finally {
    $('import-submit').disabled = false;
  }
};
$('project-search').oninput = drawProjects;
document.addEventListener(
  'click',
  safe(async (e) => {
    const create = e.target.closest('[data-create]');
    if (create) openCreate(create.dataset.create);
    const close = e.target.closest('[data-close]');
    if (close) $(close.dataset.close).close();
    const card = e.target.closest('[data-project]');
    if (card) await openProject(card.dataset.project);
    const tab = e.target.closest('[data-tab]');
    if (tab) setTab(tab.dataset.tab);
    const view = e.target.closest('[data-view-revision],[data-direction-view]');
    if (view) await viewRevision(view.dataset.viewRevision || view.dataset.directionView);
    const restore = e.target.closest('[data-restore],[data-direction-use]');
    if (restore) {
      if(!leaveSource()) return;
      if(window.FormaStudio && !window.FormaStudio.leave()) return;
      await api(`/projects/${state.project.id}/restore`, 'POST', {
        revisionId: restore.dataset.restore || restore.dataset.directionUse,
      });
      await openProject(state.project.id);
      toast(restore.dataset.directionUse ? 'Direction kept as the current version. Revise it from here.' : 'Restored as a new revision.');
    }
    const checks = e.target.closest('[data-open-checks]');
    if (checks) await openChecks(checks.dataset.openChecks, checks.dataset.anchor || 'lint-card');
    const retry = e.target.closest('[data-retry-job]');
    if (retry) {
      const j = state.project?.jobs?.find((x) => x.id === retry.dataset.retryJob);
      if (j) await submitGeneration({ prompt: j.prompt, review: !!j.review, directions: j.kind === 'directions' ? Number(j.options?.count) || 2 : 1 });
    }
    const expand = e.target.closest('[data-expand]');
    if (expand) {
      const open = expand.parentElement.classList.toggle('expanded');
      expand.textContent = open ? 'Show less' : 'Show more';
    }
    const suggestion = e.target.closest('[data-suggestion]');
    if (suggestion) {
      const text = SUGGESTIONS[Number(suggestion.dataset.suggestion)]?.[1] || '';
      const t = $('prompt');
      t.value = t.value.trim() ? `${t.value.trim()}\n${text}` : text;
      autosize();
      t.focus();
      t.setSelectionRange(t.value.length, t.value.length);
    }
    const dir = e.target.closest('[data-directions]');
    if (dir && !dir.disabled) {
      state.directions = Number(dir.dataset.directions) || 1;
      drawComposer();
      updateBusy(state.jobView);
    }
    const removeSource = e.target.closest('[data-remove-source]');
    if (removeSource && state.project) {
      const s = state.project.sources?.find((x) => x.id === removeSource.dataset.removeSource);
      if (!s || !confirm(`Remove “${s.name}” from this project’s sources? Future generations will no longer read it.`)) return;
      const pid = state.project.id;
      await api(`/projects/${pid}/sources/${s.id}`, 'DELETE');
      if (state.project?.id !== pid) return;
      state.project.sources = (await api(`/projects/${pid}/sources`)).map(({ created, ...x }) => x);
      drawSources();
      drawComposer();
      toast(`Removed ${s.name}.`);
    }
    const removeRef = e.target.closest('[data-remove-ref]');
    if (removeRef) {
      state.refs.splice(Number(removeRef.dataset.removeRef), 1);
      drawReferenceZone();
    }
    const removeCreateSource = e.target.closest('[data-remove-create-source]');
    if (removeCreateSource) {
      state.createSources.splice(Number(removeCreateSource.dataset.removeCreateSource), 1);
      drawCreateSources();
    }
  }),
);
$('sources-toggle').onclick = () => {
  const p = state.project;
  if (!p) return;
  if (state.sourcesOpen.has(p.id)) state.sourcesOpen.delete(p.id);
  else state.sourcesOpen.add(p.id);
  drawSources();
};
$('add-source').onclick = () => $('source-upload').click();
$('source-upload').onchange = safe(async () => {
  const input = $('source-upload'), files = [...input.files], pid = state.project?.id;
  input.value = '';
  if (!files.length || !pid) return;
  const max = state.config.maxSources || 6, room = max - (state.project.sources?.length || 0);
  if (files.length > room) throw new Error(`This project can hold ${max} source documents; ${room} slot${room === 1 ? '' : 's'} left.`);
  for (const f of files) checkSourceFile(f);
  state.sourceBusy = true;
  drawSources();
  const added = [], failed = [];
  try {
    for (const f of files) {
      try {
        const r = await api(`/projects/${pid}/sources`, 'POST', { name: f.name, data: await base64(f) });
        added.push(`${r.name || f.name} (${r.summary})`);
      } catch (err) {
        failed.push(`${f.name}: ${err.message}`);
      }
    }
  } finally {
    state.sourceBusy = false;
  }
  if (state.project?.id === pid) {
    state.project.sources = (await api(`/projects/${pid}/sources`)).map(({ created, ...x }) => x);
    state.sourcesOpen.add(pid);
    drawSources();
    drawComposer();
    if (!state.project.revisions.length) drawChat();
  }
  toast([added.length && `Read ${added.join('; ')}.`, failed.length && `Not added: ${failed.join('; ')}`].filter(Boolean).join(' '));
});
document.addEventListener('change', (e) => {
  if (e.target.name === 'create-kind-choice') setCreateKind(e.target.value);
  if (e.target.name === 'create-preset') state.createPreset = e.target.value;
});
// Keyboard and automation can still drive the underlying select.
$('create-kind').onchange = () => setCreateKind($('create-kind').value);
$('create-images').onchange = async () => {
  const input = $('create-images'), files = [...input.files], max = state.config.maxReferences || 6;
  input.value = '';
  createError('');
  if (!files.length) return;
  if (state.refs.length + files.length > max) {
    createError(`Choose up to ${max} reference images (${max - state.refs.length} more).`);
    return;
  }
  createBusy(1);
  try {
    // All or nothing: a file that fails leaves the earlier selection untouched.
    const next = [];
    for (const file of files) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 12000000)
        throw new Error(`“${file.name}” is not a PNG, JPEG or WebP image under 12 MB.`);
      next.push({ name: file.name.slice(-150), data: await toJPEG(file) });
    }
    state.refs.push(...next);
  } catch (err) {
    createError(err.message);
  } finally {
    createBusy(-1);
    drawReferenceZone();
  }
};
$('create-sources').onchange = async () => {
  const input = $('create-sources'), files = [...input.files], max = state.config.maxSources || 6;
  input.value = '';
  createError('');
  if (!files.length) return;
  createBusy(1);
  try {
    if (state.createSources.length + files.length > max) throw new Error(`Attach up to ${max} source documents (${max - state.createSources.length} more).`);
    const next = [];
    for (const f of files) {
      checkSourceFile(f);
      next.push({ name: f.name, size: f.size, data: await base64(f) });
    }
    state.createSources.push(...next);
  } catch (err) {
    createError(err.message);
  } finally {
    createBusy(-1);
    drawCreateSources();
  }
};
$('create-form').onsubmit = async (e) => {
  e.preventDefault();
  if (state.createBusy) return createError('Wait for the attached files to finish loading.');
  const button = $('create-submit');
  button.disabled = true;
  createError('');
  try {
    const payload = {
      kind: $('create-kind').value,
      title: $('create-title').value,
      brand: $('create-brand').value,
      references: state.refs.map(({ name, data }) => ({ name, data })),
    };
    if (state.createPreset) payload.preset = state.createPreset;
    const sources = state.createSources.map(({ name, data }) => ({ name, data }));
    // The create request is capped at 45 MB; larger source sets upload one file at a time.
    const size = JSON.stringify(payload).length + sources.reduce((n, s) => n + s.data.length + s.name.length + 40, 0);
    let later = [];
    if (sources.length && size < 40000000) payload.sources = sources;
    else later = sources;
    const p = await api('/projects', 'POST', payload);
    const failed = [];
    for (const s of later) {
      try {
        await api(`/projects/${p.id}/sources`, 'POST', s);
      } catch (err) {
        failed.push(`${s.name}: ${err.message}`);
      }
    }
    $('create-dialog').close();
    if (sources.length) state.sourcesOpen.add(p.id);
    await loadProjects();
    await openProject(p.id);
    $('prompt').focus();
    const read = state.project?.sources || [];
    if (read.length || failed.length)
      toast([read.length && `Read ${plural(read.length, 'source document')}: ${read.map((s) => `${s.name} (${s.summary})`).join('; ')}.`, failed.length && `Not added: ${failed.join('; ')}`].filter(Boolean).join(' '));
  } catch (err) {
    if ($('create-dialog').open) createError(err.message);
    else toast(err.message);
  } finally {
    button.disabled = state.createBusy > 0;
  }
};
$('generate-form').onsubmit = safe(async (e) => {
  e.preventDefault();
  if ($('generate-button').disabled) return;
  await submitGeneration({ prompt: $('prompt').value, review: $('review-checkbox').checked, directions: state.project.kind === 'web' ? state.directions : 1 });
});
$('prompt').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
    e.preventDefault();
    if (!$('generate-button').disabled) $('generate-form').requestSubmit();
  }
});
$('prompt').addEventListener('input', autosize);
$('cancel-job').onclick = safe(async () => {
  if (state.job) await api('/jobs/' + state.job + '/cancel', 'POST', {});
  toast('Cancelling…');
});
$('export-button').onclick = safe(async () => {
  if (!state.revision) return;
  if(sourceDirty()) throw new Error('Save your source edits before exporting.');
  window.FormaStudio?.guard();
  const format = $('export-format').value;
  const res = await fetch(
    `/api/projects/${state.project.id}/export?revision=${state.revision.id}&format=${format}`,
  );
  if (!res.ok) throw new Error((await res.json()).error);
  const url = URL.createObjectURL(await res.blob()),
    a = document.createElement('a');
  a.href = url;
  a.download = `design-${state.project.kind}.${format}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});
$('desktop-view').onclick = () => {
  $('frame-wrap').classList.remove('mobile');
  $('desktop-view').classList.add('active');
  $('mobile-view').classList.remove('active');
};
$('mobile-view').onclick = () => {
  $('frame-wrap').classList.add('mobile');
  $('mobile-view').classList.add('active');
  $('desktop-view').classList.remove('active');
};
$('native-view').onclick = () => {
  state.native = !state.native;
  drawPreview();
};
$('apply-json').onclick = safe(async () => {
  drawEditor(JSON.parse($('artifact-json').value));
  toast('Loaded into the editor. Save a new revision to apply.');
});
$('save-edit').onclick = safe(async () => {
  if($('artifact-json').value !== JSON.stringify(state.editor,null,2)) throw new Error('Apply your JSON changes to the editor before saving.');
  await api(`/projects/${state.project.id}/save`, 'POST', {
    baseId: state.revision.id,
    artifact: collectEditor(),
  });
  state.editor=null;
  await openProject(state.project.id);
  await loadProjects();
  toast('Manual edit saved as a new revision.');
});
$('evaluate-button').onclick = () => {
  $('evaluate-form').reset();
  $('work-minutes').value = state.revision.metrics.durationSeconds
    ? Math.ceil(state.revision.metrics.durationSeconds / 6) / 10
    : '';
  $('evaluate-dialog').showModal();
};
$('evaluate-form').onsubmit = safe(async (e) => {
  e.preventDefault();
  await api(`/projects/${state.project.id}/evaluate`, 'POST', {
    revisionId: state.revision.id,
    quality: Number($('quality').value),
    baselineMinutes: Number($('baseline-minutes').value),
    workMinutes: Number($('work-minutes').value),
    cleanupMinutes: Number($('cleanup-minutes').value),
    criticalErrors: $('critical-errors').checked,
    accepted: $('accepted').checked,
    notes: $('evaluation-notes').value,
  });
  $('evaluate-dialog').close();
  toast('Evaluation recorded. Demo and imported results stay separate from GLM results.');
});
$('test-connection').onclick = safe(async () => {
  $('test-connection').disabled = true;
  try {
    toast('Checking the configured model…');
    const r = await api('/model/test', 'POST', {});
    toast(r.message);
  } finally {
    $('test-connection').disabled = false;
  }
});
addEventListener('DOMContentLoaded', () => boot().catch(() => {}), { once: true });
