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
  job: null,
  editor: null,
  poll: null,
  native: false,
};
let toastTimer;
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
  const value = await res.json();
  if (!res.ok) {
    if (res.status === 401 && url !== '/login') {
      $('app').hidden = true;
      $('login').hidden = false;
    }
    throw new Error(value.error || 'Request failed.');
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
async function boot() {
  state.config = await api('/config');
  $('login').hidden = true;
  $('app').hidden = false;
  const demo = state.config.mode === 'demo';
  $('mode-badge').textContent = demo ? 'Demo fixtures · no AI' : state.config.model;
  $('mode-badge').classList.toggle('live', !demo);
  $('model-label').textContent = demo ? 'Demonstration mode' : 'Internal GLM endpoint';
  $('mode-description').textContent = demo
    ? 'Fixed samples for testing the app.'
    : 'Your configured model, inside your network.';
  $('composer-hint').textContent = demo
    ? 'Demo mode loads fixed content. Revision prompts are not interpreted.'
    : 'Your brief and references are sent to the internal model.';
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
            `<button class="project-card" data-project="${p.id}"><span class="type">${names[p.kind]}</span><h3>${esc(p.title)}</h3><small>${p.revisionCount} revision${p.revisionCount === 1 ? '' : 's'} · ${date(p.updated)}</small></button>`,
        )
        .join('')
    : `<div class="empty-projects"><span>▦</span><p><strong>${q ? 'No matching projects' : 'A fresh workspace'}</strong><br>${q ? 'Try a different name.' : 'Choose a format above to make your first project.'}</p></div>`;
  $('recent-projects').innerHTML = state.projects.length
    ? state.projects
        .slice(0, 9)
        .map(
          (p) =>
            `<button class="recent-item" data-project="${p.id}" title="${esc(p.title)}">${esc(p.title)}</button>`,
        )
        .join('')
    : '<p class="recent-empty">Your projects will<br>appear here.</p>';
}
function show(view) {
  if(view !== 'workspace' && !leaveSource()) return;
  if(view !== 'workspace' && window.FormaStudio && !window.FormaStudio.leave()) return;
  document.body.classList.toggle('in-workspace', view === 'workspace');
  for (const id of ['library', 'workspace', 'evaluation']) $(id).hidden = id !== view;
  $('nav-projects').classList.toggle('active', view !== 'evaluation');
  $('nav-evaluation').classList.toggle('active', view === 'evaluation');
  if (view === 'library') $('breadcrumbs').innerHTML = 'Workspace <span>/</span> Projects';
  if (view === 'evaluation') $('breadcrumbs').innerHTML = 'Workspace <span>/</span> Evaluation';
}
function openCreate(kind = 'web') {
  state.refs = [];
  $('create-kind').value = kind;
  $('create-title').value = '';
  $('create-images').value = '';
  $('image-list').innerHTML = '';
  $('create-dialog').showModal();
  setTimeout(() => $('create-title').focus(), 50);
}
async function openProject(pid) {
  if(!leaveSource()) return;
  if(window.FormaStudio && !window.FormaStudio.leave()) return;
  clearTimeout(state.poll);
  state.job = null;
  state.project = await api('/projects/' + pid);
  state.revision = state.project.current;
  state.tab = 'preview';
  state.native = false;
  state.editor = null;
  show('workspace');
  drawWorkspace();
  const active = state.project.jobs.find((j) => ['queued', 'running'].includes(j.status));
  if (active) trackJob(active.id);
}
function drawWorkspace() {
  const p = state.project,
    r = state.revision;
  $('project-title').textContent = p.title;
  $('project-kind').textContent = names[p.kind] + (r?.metrics.mode === 'import' ? ' · Imported · no model' : '');
  $('composer-hint').textContent = state.config.mode === 'demo'
    ? (r?.metrics.mode === 'import'
      ? 'Use Edit to change imported work. Demo revisions load fixed samples and do not interpret prompts.'
      : 'Demo mode loads fixed content. Revision prompts are not interpreted.')
    : 'Your brief and references are sent to the configured model.';
  $('breadcrumbs').innerHTML = `Projects <span>/</span> ${esc(p.title)}`;
  $('prompt').placeholder = r
    ? 'Describe the changes to this version…'
    : 'Describe the audience, purpose, required content, and constraints…';
  const revisions = [...p.revisions].reverse();
  $('chat-history').innerHTML = revisions.length
    ? revisions
        .map(
          (v, i) =>
            `<div class="chat-message user"><small>${v.origin === 'template' ? 'CURATED STARTER' : v.origin === 'copy' ? 'EXPLORATION COPY' : v.origin === 'manual' ? 'MANUAL EDIT' : v.origin === 'restore' ? 'RESTORE' : v.origin === 'import' ? 'IMPORTED BRIEF' : 'YOUR BRIEF'}</small>${esc(v.prompt)}</div><div class="chat-message assistant"><small>${v.metrics.mode === 'template' ? 'CURATED LAYOUT · NO MODEL' : v.metrics.mode === 'copy' ? 'COPIED DESIGN · NO MODEL' : v.metrics.mode === 'demo' ? 'FIXED DEMONSTRATION' : v.metrics.mode === 'import' ? 'IMPORTED ARTIFACT' : 'REVISION ' + (i + 1)}</small>${v.metrics.mode === 'demo' ? 'Sample content loaded. Connect GLM to interpret your brief.' : v.metrics.mode === 'import' ? 'Ready to edit and export. Imported work is excluded from GLM summaries.' : 'A saved revision is ready to inspect.'}<div class="message-meta">${v.metrics.durationSeconds || 0}s · ${v.metrics.modelCalls || 0} model calls</div></div>`,
        )
        .join('')
    : `<div class="chat-message assistant"><small>START HERE</small>Describe the work you need.<br><br>For a useful evaluation, include the facts the output must preserve and how you will use the exported result.${p.references.length ? `<br><br>${p.references.length} reference image(s) attached.` : ''}</div>`;
  $('chat-history').scrollTop = $('chat-history').scrollHeight;
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
  updateBusy(null);
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
  else if (a.kind === 'slides')
    html += a.slides
      .map(
        (s, i) =>
          `<section class="edit-block"><h3>SLIDE ${i + 1} / ${s.layout.toUpperCase()}</h3>${inputField('Title', s.title, `slides.${i}.title`)}${inputField('Subtitle', s.subtitle, `slides.${i}.subtitle`)}${inputField('Body', s.body, `slides.${i}.body`, true)}${inputField('Bullets — one per line', s.bullets.join('\n'), `slides.${i}.bullets`, true)}${s.columns.map((c, j) => inputField(`Column ${j + 1} heading`, c.heading, `slides.${i}.columns.${j}.heading`) + inputField(`Column ${j + 1} body`, c.body, `slides.${i}.columns.${j}.body`, true) + inputField(`Column ${j + 1} bullets`, c.bullets.join('\n'), `slides.${i}.columns.${j}.bullets`, true)).join('')}${s.table ? inputField('Table JSON', JSON.stringify(s.table, null, 2), `slides.${i}.table`, true, true) : ''}${inputField('Speaker notes', s.notes, `slides.${i}.notes`, true)}</section>`,
      )
      .join('');
  else
    html +=
      inputField('Subtitle', a.subtitle, 'subtitle') +
      a.blocks
        .map(
          (b, i) =>
            `<section class="edit-block"><h3>BLOCK ${i + 1} / ${b.type.toUpperCase()}</h3>${b.type === 'bullets' ? inputField('Items — one per line', b.items.join('\n'), `blocks.${i}.items`, true) : b.type === 'table' ? inputField('Table JSON', JSON.stringify(b.table, null, 2), `blocks.${i}.table`, true, true) : inputField(b.type === 'image' ? 'Image caption' : 'Text', b.text, `blocks.${i}.text`, b.type !== 'heading')}</section>`,
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
      : key === 'table'
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
      .map(
        (r, i) =>
          `<article class="history-item"><h3>Revision ${state.project.revisions.length - i} ${r.id === state.project.current_id ? '<span class="badge">Current</span>' : ''} ${r.id === state.revision.id ? '<span class="badge">Viewing</span>' : ''}</h3><small class="muted">${date(r.created)} · ${r.origin}</small><p>${esc(r.prompt)}</p><div class="actions"><button class="secondary" data-view-revision="${r.id}">View revision</button><button class="text-button" data-restore="${r.id}">Restore as new version</button></div></article>`,
      )
      .join('');
}
function drawChecks() {
  const m = state.revision.metrics;
  const responsive = m.render?.screenMetrics;
  const responsiveChecks = responsive?.length ? `<div class="check-card"><h3>Responsive screen checks</h3><p>Each saved screen is measured at 1280, 768 and 390 pixels. These checks do not cover every interaction state or certify accessibility.</p><div class="responsive-checks"><table><thead><tr><th>Screen</th><th>Desktop</th><th>Tablet</th><th>Mobile</th></tr></thead><tbody>${responsive.map(s => `<tr><th scope="row">${esc(s.name)}</th>${['desktop','tablet','mobile'].map(view => { const x=s[view]; if(!x)return '<td>Not checked</td>'; const issues=[x.overflow&&'Horizontal overflow',x.missingLabels&&`${x.missingLabels} table labels missing`,x.unnamedControls&&`${x.unnamedControls} unnamed controls`,x.brokenTargets&&`${x.brokenTargets} missing interaction targets`,x.inactiveButtons&&`${x.inactiveButtons} buttons without an action`,x.duplicateIds&&`${x.duplicateIds} duplicate IDs`].filter(Boolean); return `<td>${issues.length?issues.map(esc).join('<br>'):'No automated issues'}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div></div>` : '';
  const reviewCoverage = m.review?.scope === 'content-only'
    ? 'Content checked against the brief. Visual layout was not inspected.'
    : `${m.review?.pagesReviewed || 0} of ${m.review?.pageCount || 0} captured pages/views reviewed.`;
  $('checks-panel').innerHTML =
    `<div class="panel-intro"><h2>Evidence, with its limits.</h2><p>Model review can miss mistakes. Open the export and check facts and functionality yourself.</p></div><div class="metric-grid"><div><strong>${m.durationSeconds ?? '—'}<small>s</small></strong><span>Generation elapsed</span></div><div><strong>${m.modelCalls || 0}</strong><span>Model calls</span></div><div><strong>${m.outputTokens || 0}</strong><span>Reported output tokens</span></div></div><div class="check-card"><h3>Rendering</h3><p>${m.render ? esc(m.render.basis) + ' · ' + m.render.pageCount + ' page(s)/view(s)' : 'No successful render is recorded for this revision.'}</p><button class="secondary" id="render-now">Render exports</button></div><div class="check-card"><h3>Model quality review</h3><p>${m.review ? `${esc(m.review.summary)}<br>${reviewCoverage} ${m.review.refined ? 'One correction pass applied; the final result has not been independently approved.' : ''}` : m.mode === 'demo' ? 'Not run. Demo fixtures do not use a model.' : 'Not run or unavailable.'}</p>${m.review?.issues?.length ? '<ul>' + m.review.issues.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ul>' : ''}</div><div class="check-card"><h3>Items to inspect</h3><ul>${(m.warnings?.length ? m.warnings : ['No automated warning was recorded. This does not certify correctness.']).map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`;
  $('checks-panel').insertAdjacentHTML('beforeend',responsiveChecks);
  $('render-now').onclick = safe(async () => {
    $('render-now').disabled = true;
    try {
      toast('Rendering the saved artifact…');
      await api(`/projects/${state.project.id}/render`, 'POST', { revisionId: state.revision.id });
      state.revision = await api(`/projects/${state.project.id}/revisions/${state.revision.id}`);
      drawChecks();
      drawPreview();
      toast('Rendered export is ready.');
    } finally {
      if ($('render-now')) $('render-now').disabled = false;
    }
  });
}
function updateBusy(job) {
  const busy = job && ['queued', 'running'].includes(job.status);
  $('job-status').hidden = !busy;
  $('generate-button').disabled = !!busy || (state.config.mode === 'demo' && ['template','copy','import'].includes(state.revision?.metrics.mode));
  $('save-edit').disabled = !!busy;
  $('generate-button').innerHTML = (state.revision ? 'Revise' : 'Generate') + ' <span>↑</span>';
  if (state.config.mode === 'demo' && ['template','copy','import'].includes(state.revision?.metrics.mode)) $('composer-hint').textContent='Edit this design with the canvas controls. Connect GLM to adapt it using a brief.';
  if (busy) $('job-stage').textContent = job.stage;
}
async function trackJob(jid) {
  state.job = jid;
  clearTimeout(state.poll);
  try {
    const j = await api('/jobs/' + jid);
    if (!state.project || j.project_id !== state.project.id) return;
    updateBusy(j);
    if (['queued', 'running'].includes(j.status)) {
      state.poll = setTimeout(() => trackJob(jid), 1200);
      return;
    }
    state.job = null;
    await loadProjects();
    if (j.status === 'complete') {
      state.project = await api('/projects/' + j.project_id);
      state.revision = state.project.current;
      state.tab = 'preview';
      drawWorkspace();
      toast('Revision saved. Inspect the result and record your evaluation.');
    } else {
      if (!$('prompt').value) $('prompt').value = j.prompt;
      toast(j.error || j.stage);
    }
  } catch (e) {
    toast(e.message);
    state.poll = setTimeout(() => trackJob(jid), 3000);
  }
}
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
            `<tr><td>${esc(e.title)}<small>${names[e.kind]} · ${e.revisionId.slice(0, 8)} · ${date(e.created)}</small></td><td>${esc(e.mode)}</td><td>${e.quality}/5</td><td>${e.accepted ? 'Yes' : 'No'}${e.criticalErrors ? ' · critical errors' : ''}</td><td>${saving(e) === null ? '—' : Math.round(saving(e)) + '%'}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="5" class="muted">No evaluations yet. Create an artifact, inspect its export, then choose Evaluate.</td></tr>';
}
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
  clearTimeout(state.poll);
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
    try { artifact = JSON.parse((await file.text()).replace(/^\uFEFF/, '')); }
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
    const view = e.target.closest('[data-view-revision]');
    if (view) {
      if(window.FormaStudio && !window.FormaStudio.leave()) return;
      state.revision = await api(
        `/projects/${state.project.id}/revisions/${view.dataset.viewRevision}`,
      );
      state.native = false;
      drawPreview();
      setTab('preview');
      toast('Viewing a saved revision. Restore it before making changes.');
    }
    const restore = e.target.closest('[data-restore]');
    if (restore) {
      if(window.FormaStudio && !window.FormaStudio.leave()) return;
      await api(`/projects/${state.project.id}/restore`, 'POST', {
        revisionId: restore.dataset.restore,
      });
      await openProject(state.project.id);
      toast('Restored as a new revision.');
    }
  }),
);
$('create-images').onchange = safe(async () => {
  const files = [...$('create-images').files];
  if (files.length > 2) throw new Error('Choose up to two reference images.');
  state.refs = [];
  for (const file of files) {
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 12000000)
      throw new Error('Use PNG or JPEG images under 12 MB.');
    const bitmap = await createImageBitmap(file);
    const ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * ratio);
    canvas.height = Math.round(bitmap.height * ratio);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const data = canvas.toDataURL('image/jpeg', 0.88);
    if (data.length > 4200000)
      throw new Error('An image is too large after resizing. Choose a smaller reference.');
    state.refs.push({ name: file.name, data });
  }
  $('image-list').innerHTML = state.refs
    .map((r) => `<img src="${r.data}" alt="${esc(r.name)}">`)
    .join('');
});
$('create-form').onsubmit = safe(async (e) => {
  e.preventDefault();
  const button = e.submitter;
  button.disabled = true;
  try {
    const p = await api('/projects', 'POST', {
      kind: $('create-kind').value,
      title: $('create-title').value,
      brand: $('create-brand').value,
      references: state.refs,
    });
    $('create-dialog').close();
    await loadProjects();
    await openProject(p.id);
    $('prompt').focus();
  } finally {
    button.disabled = false;
  }
});
$('generate-form').onsubmit = safe(async (e) => {
  e.preventDefault();
  if(sourceDirty()) throw new Error('Save your source edits before generating.');
  window.FormaStudio?.guard();
  if (state.revision && state.revision.id !== state.project.current_id)
    throw new Error('Restore this historical revision before revising it.');
  $('generate-button').disabled = true;
  try {
    const job = await api(`/projects/${state.project.id}/generate`, 'POST', {
      prompt: $('prompt').value,
      review: $('review-checkbox').checked,
    });
    $('prompt').value = '';
    trackJob(job.id);
  } catch (err) {
    $('generate-button').disabled = false;
    throw err;
  }
});
$('cancel-job').onclick = safe(async () => {
  if (state.job) await api('/jobs/' + state.job + '/cancel', 'POST', {});
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
