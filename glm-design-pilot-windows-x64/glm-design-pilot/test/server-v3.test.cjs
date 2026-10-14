'use strict';
// Server API additions from ENGINE-SPEC section 9: migrations, config, sources, presets,
// progress, directions, element edits, save notes, token import, lint metrics and fixes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const JSZip = require('jszip');
const { start, stop, client, waitJob } = require('./helpers.cjs');
const { demo } = require('../lib/demo.cjs');
const S = require('../lib/schema.cjs');
const { staticLint } = require('../lib/lint.cjs');

const PASSWORD = 'test-pilot-password';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfZkAAAAASUVORK5CYII=';
const shot = png.split(',')[1];
const b64 = (s) => Buffer.from(s).toString('base64');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (name) => fs.mkdtemp(path.join(os.tmpdir(), name));
async function until(check, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await delay(20);
  }
  throw new Error('Timed out waiting for a condition.');
}
function request(url, route, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url + route, { method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
const demoEnv = (dir, extra = {}) => ({ APP_PASSWORD: PASSWORD, MODEL_MODE: 'demo', DATA_DIR: dir, RENDER_URL: '', HOST: '127.0.0.1', ...extra });

test('a 0.2 database migrates in place: job columns, sources table, named inserts', async (t) => {
  const dir = await tmp('forma-v3-migrate-');
  let app;
  t.after(async () => {
    await stop(app);
    await fs.rm(dir, { recursive: true, force: true });
  });
  const db = new DatabaseSync(path.join(dir, 'studio.sqlite'));
  db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,brand TEXT NOT NULL,refs TEXT NOT NULL,current_id TEXT,created TEXT NOT NULL,updated TEXT NOT NULL);
    CREATE TABLE revisions(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),artifact TEXT NOT NULL,prompt TEXT NOT NULL,origin TEXT NOT NULL,metrics TEXT NOT NULL,created TEXT NOT NULL,parent_id TEXT);
    CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),prompt TEXT NOT NULL,review INTEGER NOT NULL,base_id TEXT,status TEXT NOT NULL,stage TEXT NOT NULL,error TEXT,result_id TEXT,created TEXT NOT NULL,updated TEXT NOT NULL);
    CREATE TABLE evaluations(id TEXT PRIMARY KEY,revision_id TEXT NOT NULL REFERENCES revisions(id),data TEXT NOT NULL,created TEXT NOT NULL);
    CREATE TABLE project_styles(project_id TEXT PRIMARY KEY REFERENCES projects(id),data TEXT NOT NULL);
    CREATE TABLE design_kits(id TEXT PRIMARY KEY,name TEXT NOT NULL,data TEXT NOT NULL,updated TEXT NOT NULL);
    CREATE TABLE design_notes(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),revision_id TEXT NOT NULL REFERENCES revisions(id),screen TEXT NOT NULL,target TEXT NOT NULL,text TEXT NOT NULL,resolved INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL);`);
  const date = '2026-01-01T00:00:00.000Z';
  db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?,?,?)').run('p-old', 'web', 'Old project', '', '[]', 'r-old', date, date);
  db.prepare('INSERT INTO revisions VALUES(?,?,?,?,?,?,?,?)').run('r-old', 'p-old', JSON.stringify(S.artifact(demo('web'))), 'Original 0.2 brief', 'demo', JSON.stringify({ mode: 'demo', warnings: [] }), date, null);
  db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('j-old', 'p-old', 'Original 0.2 brief', 1, null, 'complete', 'Ready for your review', null, 'r-old', date, date);
  db.prepare('INSERT INTO project_styles VALUES(?,?)').run('p-old', JSON.stringify({ name: 'Old style', accent: '#123abc', background: '#ffffff', text: '#111111', surface: '#ffffff', muted: '#555555', font: 'Arial', radius: 8, spacing: 8 }));
  db.close();

  app = await start('server.cjs', demoEnv(dir));
  let api = await client(app.url);
  const old = (await api('/projects/p-old')).data;
  assert.deepEqual(old.sources, []);
  assert.equal(old.current.prompt, 'Original 0.2 brief');
  assert.equal(old.designSystem.accent, '#123abc');
  assert.equal(old.designSystem.bodyFont, 'Arial', 'legacy styles gain 0.3 token fields');
  assert.deepEqual(
    (({ kind, options, progress, result_ids }) => ({ kind, options, progress, result_ids }))((await api('/jobs/j-old')).data),
    { kind: 'generate', options: {}, progress: {}, result_ids: [] },
  );
  assert.equal(old.jobs[0].kind, 'generate');
  // Every INSERT names its columns, so the widened jobs table and the new sources table accept rows.
  const j = await api('/projects/p-old/generate', 'POST', { prompt: 'Revise the old project.' });
  assert.equal(j.status, 202);
  const done = await waitJob(api, j.data.id);
  assert.equal(done.status, 'complete', done.error);
  assert.deepEqual(done.result_ids, [done.result_id]);
  assert.equal(done.progress.phase, 'complete');
  assert.equal((await api('/projects/p-old/sources', 'POST', { name: 'facts.txt', data: b64('Owner: Asha.') })).status, 201);
  assert.equal((await api('/projects/p-old/evaluate', 'POST', { revisionId: done.result_id, quality: 3, accepted: false, criticalErrors: false, baselineMinutes: 1, workMinutes: 1, cleanupMinutes: 1 })).status, 201);
  assert.equal((await api('/projects/p-old/notes', 'POST', { revisionId: done.result_id, screen: '', target: 'h1', text: 'Check.' })).status, 201);
  assert.equal((await api('/design-kits', 'POST', { name: 'Kit', accent: '#123ABC' })).status, 201);
  await stop(app);

  const check = new DatabaseSync(path.join(dir, 'studio.sqlite'));
  const columns = check.prepare('PRAGMA table_info(jobs)').all().map((c) => c.name);
  for (const c of ['kind', 'options', 'progress', 'result_ids']) assert.ok(columns.includes(c), c);
  assert.deepEqual(check.prepare('PRAGMA table_info(project_sources)').all().map((c) => c.name), ['id', 'project_id', 'name', 'kind', 'text', 'chars', 'summary', 'truncated', 'created']);
  assert.equal(check.prepare("SELECT kind FROM jobs WHERE id='j-old'").get().kind, 'generate');
  check.close();
  app = await start('server.cjs', demoEnv(dir)); // the migration is idempotent
  api = await client(app.url);
  assert.equal((await api('/projects/p-old')).data.sources.length, 1);
});

test('config, sources, presets, progress, directions, save notes and token import (demo mode)', async (t) => {
  const dir = await tmp('forma-v3-demo-');
  let app;
  t.after(async () => {
    await stop(app);
    await fs.rm(dir, { recursive: true, force: true });
  });
  app = await start('server.cjs', demoEnv(dir));
  const api = await client(app.url);

  const config = (await api('/config')).data;
  assert.equal(config.version, '0.3.0');
  assert.equal(config.maxReferences, 6);
  assert.equal(config.maxSources, 6);
  assert.equal(config.vision, 'off');
  assert.equal(config.pipeline, 'staged');
  assert.ok(config.presets.length >= 8);
  for (const p of config.presets) for (const k of ['id', 'name', 'description', 'mood', 'tokens']) assert.ok(p[k], `${p.id}.${k}`);
  assert.ok(config.fonts.includes('Inter') && config.fonts.includes('Segoe UI'));

  // Origin: null (sandboxed frames, file pages) is a denied cross-origin request, not a server error.
  const nullOrigin = await request(app.url, '/api/projects', { method: 'POST', headers: { 'X-Studio-Request': '1', Origin: 'null', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(nullOrigin.status, 403);
  assert.match(nullOrigin.data, /Cross-origin/);

  // Project creation: six references, source documents, preset seeding.
  const refs = Array.from({ length: 6 }, (_, i) => ({ name: `ref-${i}.png`, data: png }));
  const created = await api('/projects', 'POST', {
    kind: 'web',
    title: 'Sources',
    references: refs,
    preset: 'editorial',
    sources: [
      { name: 'brief.md', data: b64('# Service desk\nOwner: Asha. Deadline unspecified.') },
      { name: 'teams.csv', data: 'data:text/csv;base64,' + b64('Team,Open\nOps,12\nIT,7\n') },
    ],
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const pid = created.data.id;
  let p = (await api('/projects/' + pid)).data;
  assert.equal(p.references.length, 6);
  assert.equal(p.designSystem.preset, 'editorial');
  assert.equal(p.designSystem.headingFont, 'Fraunces');
  assert.deepEqual(p.sources.map((s) => [s.name, s.kind]), [['brief.md', 'md'], ['teams.csv', 'csv']]);
  for (const s of p.sources) {
    assert.deepEqual(Object.keys(s).sort(), ['chars', 'id', 'kind', 'name', 'summary', 'truncated']);
    assert.equal(s.truncated, false);
    assert.ok(s.chars > 0 && s.summary);
  }
  assert.doesNotMatch(JSON.stringify(p), /Deadline unspecified/, 'source text never leaves the server');
  assert.equal((await api('/projects', 'POST', { kind: 'web', references: [...refs, refs[0]] })).status, 400);
  assert.equal((await api('/projects', 'POST', { kind: 'web', preset: 'no-such-preset' })).status, 400);
  assert.equal((await api('/projects', 'POST', { kind: 'web', sources: Array(7).fill({ name: 'a.txt', data: b64('x') }) })).status, 400);
  const broken = await api('/projects', 'POST', { kind: 'web', sources: [{ name: 'broken.docx', data: b64('not a zip file') }] });
  assert.equal(broken.status, 400);
  assert.match(broken.data.error, /broken\.docx/);
  assert.equal((await api('/projects')).data.length, 1, 'failed creations insert nothing');

  // Source routes.
  const added = await api(`/projects/${pid}/sources`, 'POST', { name: 'notes.txt', data: b64('Escalate to the duty manager.') });
  assert.equal(added.status, 201);
  assert.ok(added.data.id && added.data.summary);
  assert.equal((await api(`/projects/${pid}/sources`)).data.length, 3);
  for (let i = 0; i < 3; i++) assert.equal((await api(`/projects/${pid}/sources`, 'POST', { name: `n${i}.txt`, data: b64('More facts ' + i) })).status, 201);
  const seventh = await api(`/projects/${pid}/sources`, 'POST', { name: 'too-many.txt', data: b64('x') });
  assert.equal(seventh.status, 400);
  assert.match(seventh.data.error, /at most 6/);
  assert.equal((await api(`/projects/${pid}/sources/${added.data.id}`, 'DELETE')).status, 200);
  assert.equal((await api(`/projects/${pid}/sources/${added.data.id}`, 'DELETE')).status, 404);
  assert.equal((await api(`/projects/${pid}/sources`, 'POST', { name: 'image.png', data: shot })).status, 400);
  p = (await api('/projects/' + pid)).data;
  assert.equal(p.sources.length, 5);

  // Progress JSON is persisted while the job runs and finishes as "complete".
  const seen = new Set();
  const job = (await api(`/projects/${pid}/generate`, 'POST', { prompt: 'Create the service desk.' })).data;
  let done;
  for (;;) {
    done = (await api('/jobs/' + job.id)).data;
    if (done.progress?.phase) seen.add(done.progress.phase + ':' + done.progress.label);
    if (!['queued', 'running'].includes(done.status)) break;
    await delay(25);
  }
  assert.equal(done.status, 'complete', done.error);
  assert.ok(seen.has('generating:Loading fixed demonstration'), [...seen].join(' | '));
  assert.deepEqual(done.progress, { phase: 'complete', label: 'Ready for your review' });
  assert.equal(typeof done.options, 'object');
  const first = (await api('/projects/' + pid)).data.current;
  assert.equal(first.metrics.sourceDocuments, 5);
  assert.ok(Array.isArray(first.metrics.lint));
  assert.equal(typeof first.metrics.lintScore.score, 'number');
  assert.deepEqual(first.metrics.calls, []);
  assert.equal(first.metrics.reasoningTokens, 0);
  assert.equal(first.metrics.pipeline, null);

  // Enqueue race: concurrent requests cannot create two active jobs for one project.
  const burst = await Promise.all(Array.from({ length: 5 }, () => api(`/projects/${pid}/generate`, 'POST', { prompt: 'Again.' })));
  assert.deepEqual(burst.map((r) => r.status).sort(), [202, 409, 409, 409, 409]);
  await waitJob(api, burst.find((r) => r.status === 202).data.id);
  const base = (await api('/projects/' + pid)).data.current_id;

  // Directions (demo mode): distinct presets, first becomes current, siblings share the base.
  assert.equal((await api(`/projects/${pid}/generate`, 'POST', { prompt: 'x', directions: 5 })).status, 400);
  assert.equal((await api(`/projects/${pid}/generate`, 'POST', { prompt: 'x', directions: 1 })).status, 400);
  const slides = (await api('/projects', 'POST', { kind: 'slides' })).data;
  assert.equal((await api(`/projects/${slides.id}/generate`, 'POST', { prompt: 'x', directions: 2 })).status, 400);
  const dj = await api(`/projects/${pid}/generate`, 'POST', { prompt: 'Explore three directions.', directions: 3 });
  assert.equal(dj.status, 202);
  assert.equal(dj.data.kind, 'directions');
  const dDone = await waitJob(api, dj.data.id);
  assert.equal(dDone.status, 'complete', dDone.error);
  assert.equal(dDone.kind, 'directions');
  assert.deepEqual(dDone.options, { count: 3 });
  assert.equal(dDone.result_ids.length, 3);
  assert.equal(dDone.result_id, dDone.result_ids[0]);
  p = (await api('/projects/' + pid)).data;
  assert.equal(p.current_id, dDone.result_ids[0], 'the first direction becomes current');
  const variants = await Promise.all(dDone.result_ids.map(async (rid) => (await api(`/projects/${pid}/revisions/${rid}`)).data));
  variants.forEach((v, i) => {
    assert.equal(v.parent_id, base);
    assert.deepEqual(v.metrics.direction, { name: v.metrics.direction.name, index: i, jobId: dj.data.id, total: 3 });
    assert.match(v.metrics.direction.name, /^Demo direction/);
    assert.match(v.artifact.title, /demo direction/);
    assert.ok(v.metrics.warnings.some((w) => w.startsWith('Fixed demo content')));
    assert.equal(v.metrics.mode, 'demo');
  });
  assert.equal(new Set(variants.map((v) => v.artifact.designSystem.preset)).size, 3);
  assert.equal(new Set(variants.map((v) => v.artifact.title)).size, 3);
  assert.ok(p.revisions.some((r) => r.id === dDone.result_ids[2] && r.parent_id === base));
  assert.ok(p.revisions.every((r) => r.metrics.lint === undefined), 'the revision list omits full lint findings');
  // A second directions job branches from the new current revision and leaves earlier siblings alone.
  const d2 = await waitJob(api, (await api(`/projects/${pid}/generate`, 'POST', { prompt: 'Two more.', directions: 2 })).data.id);
  assert.equal(d2.result_ids.length, 2);
  assert.equal((await api(`/projects/${pid}/revisions/${d2.result_ids[1]}`)).data.parent_id, dDone.result_ids[0]);
  assert.equal((await api('/projects/' + pid)).data.current_id, d2.result_ids[0]);

  // Element edits need GLM.
  const edit = await api(`/projects/${pid}/element-edit`, 'POST', { revisionId: d2.result_ids[0], screen: 'home', element: '<h1>x</h1>', instruction: 'Bigger' });
  assert.equal(edit.status, 409);
  assert.match(edit.data.error, /MODEL_MODE=glm/);

  // Save notes are kept in the revision prompt, metrics and brief history.
  const current = (await api('/projects/' + pid)).data.current;
  const changed = structuredClone(current.artifact);
  changed.title = 'Edited with a note';
  assert.equal((await api(`/projects/${pid}/save`, 'POST', { baseId: current.id, artifact: changed, note: 'x'.repeat(301) })).status, 400);
  const note = 'GLM element edit: make the hero heading shorter';
  const saved = await api(`/projects/${pid}/save`, 'POST', { baseId: current.id, artifact: changed, note });
  assert.equal(saved.status, 201);
  const manual = (await api(`/projects/${pid}/revisions/${saved.data.id}`)).data;
  assert.ok(manual.prompt.startsWith(note));
  assert.equal(manual.origin, 'manual');
  assert.equal(manual.metrics.note, note);
  assert.equal(manual.metrics.manual, true);
  assert.equal(manual.metrics.mode, 'demo', 'evaluations keep attributing manual cleanup to the base mode');
  const readme = await (await JSZip.loadAsync((await api(`/projects/${pid}/export?format=zip`)).data)).file('README.md').async('string');
  assert.match(readme, /User edit note: GLM element edit: make the hero heading shorter/);

  // Duplicate copies source documents.
  const copy = (await api(`/projects/${pid}/duplicate`, 'POST', {})).data;
  const copied = (await api('/projects/' + copy.id)).data;
  assert.deepEqual(copied.sources.map((s) => s.name), p.sources.map((s) => s.name));
  assert.ok(copied.sources.every((s) => !p.sources.some((o) => o.id === s.id)));
  assert.equal((await api(`/projects/${copy.id}/sources/${copied.sources[0].id}`, 'DELETE')).status, 200);
  assert.equal((await api('/projects/' + pid)).data.sources.length, 5, 'copies are independent');

  // Design token import.
  const imported = await api('/design-tokens/import', 'POST', { text: ':root{--color-primary:#0f62fe;--color-background:#ffffff;--color-text:#161616;--radius:6px} body{font-family:Inter,sans-serif}' });
  assert.equal(imported.status, 200);
  assert.equal(imported.data.tokens.accent, '#0f62fe');
  assert.equal(imported.data.tokens.bodyFont, 'Inter');
  assert.equal(imported.data.tokens.radius, 6);
  assert.equal(imported.data.tokens.name, 'Imported tokens');
  assert.ok(imported.data.tokens.border && imported.data.tokens.typeScale, 'normalized to a full token set');
  assert.ok(imported.data.notes.some((n) => /accent/.test(n)));
  assert.deepEqual(S.designSystem(imported.data.tokens), imported.data.tokens);
  assert.equal((await api('/design-tokens/import', 'POST', { text: 'a'.repeat(210 * 1024) })).status, 400);
  assert.equal((await api('/design-tokens/import', 'POST', { text: 42 })).status, 400);
});

test('renders are limited to two at a time, retried once on 429, and stale screenshots are removed', async (t) => {
  const dir = await tmp('forma-v3-render-');
  let app,
    inflight = 0,
    peak = 0,
    renders = 0,
    shots = 3;
  const renderer = http.createServer(async (req, res) => {
    for await (const _ of req);
    res.setHeader('Content-Type', 'application/json');
    if (++renders === 1) {
      res.statusCode = 429;
      return res.end('{"error":"Renderer is busy; try again."}');
    }
    inflight++;
    peak = Math.max(peak, inflight);
    await delay(250);
    inflight--;
    res.end(
      JSON.stringify({
        screenshots: Array(shots).fill(shot),
        pdf: b64('%PDF-1.4 mock'),
        pageCount: shots,
        basis: 'test renderer',
        metrics: { lint: [{ rule: 'contrast', severity: 'error', screen: 'home', viewport: 'mobile', target: 'p.note', message: 'Text contrast 2.1:1 is below 4.5:1.' }], lintScore: { score: 88, counts: { error: 1, warning: 0, info: 0 } } },
      }),
    );
  });
  await new Promise((r) => renderer.listen(0, '127.0.0.1', r));
  t.after(async () => {
    await stop(app);
    renderer.closeAllConnections();
    await new Promise((r) => renderer.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  });
  app = await start('server.cjs', demoEnv(dir, { MAX_CONCURRENT_JOBS: '4', RENDER_URL: `http://127.0.0.1:${renderer.address().port}`, RENDER_TOKEN: 'test-render-token-12345' }));
  const api = await client(app.url);
  const ids = [];
  for (let i = 0; i < 4; i++) ids.push((await api('/projects', 'POST', { kind: 'web', title: 'R' + i })).data.id);
  const jobs = await Promise.all(ids.map(async (pid) => (await api(`/projects/${pid}/generate`, 'POST', { prompt: 'Go.' })).data.id));
  for (const jid of jobs) assert.equal((await waitJob(api, jid)).status, 'complete');
  assert.ok(peak <= 2, `peak concurrent renders ${peak}`);
  assert.equal(renders, 5, 'one 429 retried plus four renders');
  for (const pid of ids) {
    const m = (await api('/projects/' + pid)).data.current.metrics;
    assert.ok(m.render, 'the 429 render was retried');
    assert.equal(m.render.lint, undefined, 'page findings move to metrics.lint');
    assert.equal(m.lint[0].rule, 'contrast');
    assert.equal(m.lintScore.counts.error, 1);
    assert.ok(m.warnings.some((w) => /^Design lint found 1 error \(contrast\)/.test(w)), m.warnings.join(' | '));
    assert.ok(!m.warnings.some((w) => w.startsWith('Rendering unavailable')));
  }
  const pid = ids[0],
    rid = (await api('/projects/' + pid)).data.current_id;
  assert.equal((await api(`/projects/${pid}/screenshot?page=2`)).status, 200);
  shots = 1;
  assert.equal((await api(`/projects/${pid}/render`, 'POST', { revisionId: rid })).status, 200);
  assert.equal((await api(`/projects/${pid}/screenshot?page=0`)).status, 200);
  assert.equal((await api(`/projects/${pid}/screenshot?page=2`)).status, 404, 'stale screenshots are removed before re-render');
  const after = (await api('/projects/' + pid)).data.current.metrics;
  assert.equal(after.render.screenshots, 1);
  assert.equal(after.warnings.filter((w) => w.startsWith('Design lint found')).length, 1);
});

test('GLM mode: lint metrics, directions, element edits (sanitized, saturated, aborted) and shutdown', async (t) => {
  const dir = await tmp('forma-v3-glm-');
  let app,
    reply = 'artifact',
    hold = null;
  const calls = [],
    closed = [];
  const artifact = demo('web');
  artifact.title = 'From the mock model';
  artifact.html = artifact.html.replace('<h1>', '<p>Lorem ipsum dolor sit amet.</p><h1>');
  const mock = http.createServer(async (req, res) => {
    let raw = '';
    for await (const b of req) raw += b;
    if (req.url === '/render') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(
        JSON.stringify({
          screenshots: [shot],
          pdf: b64('%PDF-1.4 mock'),
          pageCount: 1,
          basis: 'test renderer',
          metrics: { lint: [{ rule: 'tap-target', severity: 'error', screen: null, viewport: 'mobile', target: 'button.x', message: 'Tap target 20 × 20 px is below 24 px.' }] },
        }),
      );
    }
    const call = { body: JSON.parse(raw), text: raw };
    calls.push(call);
    res.on('close', () => !res.writableFinished && closed.push(call));
    if (hold) await hold;
    if (res.destroyed) return;
    const content = reply === 'element' ? '<forma-element><h1 class="text-3xl" onclick="steal()">Shorter <em>title</em><script>bad()</script></h1></forma-element><forma-css mode="append">.text-3xl{letter-spacing:-.02em}</forma-css>Notes outside tags.' : JSON.stringify(artifact);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 5 } } }));
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${mock.address().port}`;
  t.after(async () => {
    await stop(app);
    mock.closeAllConnections();
    await new Promise((r) => mock.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  });
  app = await start('server.cjs', {
    APP_PASSWORD: PASSWORD,
    MODEL_MODE: 'glm',
    DATA_DIR: dir,
    GLM_BASE_URL: base + '/v1',
    GLM_RETRIES: '0',
    MAX_CONCURRENT_JOBS: '1',
    RENDER_URL: base,
    RENDER_TOKEN: 'test-render-token-12345',
  });
  const api = await client(app.url);
  const config = (await api('/config')).data;
  assert.equal(config.vision, 'auto');
  assert.equal(config.visionSupported, null);

  const pid = (await api('/projects', 'POST', { kind: 'web', title: 'GLM', sources: [{ name: 'facts.md', data: b64('Owner: Asha. Escalation route unspecified.') }] })).data.id;
  const j = await waitJob(api, (await api(`/projects/${pid}/generate`, 'POST', { prompt: 'Build it.', review: false })).data.id);
  assert.equal(j.status, 'complete', j.error);
  const r = (await api('/projects/' + pid)).data.current;
  assert.equal(r.artifact.title, 'From the mock model');
  const expected = staticLint(r.artifact).map((f) => f.rule);
  assert.ok(expected.includes('placeholder-copy'));
  assert.equal(r.metrics.lint[0].rule, 'tap-target', 'errors first');
  for (const rule of expected) assert.ok(r.metrics.lint.some((f) => f.rule === rule), rule);
  assert.ok(r.metrics.lintScore.score < 100);
  assert.equal(r.metrics.lintScore.counts.error, 1);
  assert.ok(r.metrics.warnings.some((w) => w.startsWith('Design lint found 1 error (tap-target)')));
  assert.ok(Array.isArray(r.metrics.calls));
  assert.equal(typeof r.metrics.reasoningTokens, 'number');
  assert.equal(typeof r.metrics.pipeline?.mode, 'string');
  assert.equal(r.metrics.render.lint, undefined);
  assert.ok(r.metrics.modelCalls >= 1);

  // Directions in GLM mode go through the pipeline.
  const dj = await waitJob(api, (await api(`/projects/${pid}/generate`, 'POST', { prompt: 'Explore.', directions: 2 })).data.id);
  assert.equal(dj.status, 'complete', dj.error);
  assert.equal(dj.result_ids.length, 2);
  const sibling = (await api(`/projects/${pid}/revisions/${dj.result_ids[1]}`)).data;
  assert.equal(sibling.parent_id, r.id);
  assert.equal(sibling.origin, 'glm');
  assert.equal(typeof sibling.metrics.direction.name, 'string');
  assert.equal((await api('/projects/' + pid)).data.current_id, dj.result_ids[0]);

  // Element edit: sanitized replacement, with briefs and source documents in the request.
  reply = 'element';
  const rid = dj.result_ids[0],
    element = { revisionId: rid, screen: 'home', element: '<h1>A little less admin.</h1>', instruction: 'Make it shorter.' };
  calls.length = 0;
  const edited = await api(`/projects/${pid}/element-edit`, 'POST', element);
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.html, '<h1 class="text-3xl">Shorter <em>title</em></h1>');
  assert.match(edited.data.css, /letter-spacing/);
  assert.match(edited.data.notes, /Notes outside tags/);
  assert.equal(edited.data.metrics.modelCalls, 1);
  assert.match(calls[0].text, /Escalation route unspecified/);
  assert.match(calls[0].text, /Make it shorter/);
  assert.match(calls[0].text, /A little less admin/);
  assert.equal((await api(`/projects/${pid}/element-edit`, 'POST', { ...element, screen: 'missing' })).status, 400);
  assert.equal((await api(`/projects/${pid}/element-edit`, 'POST', { ...element, element: 'x'.repeat(20001) })).status, 400);
  assert.equal((await api(`/projects/${pid}/element-edit`, 'POST', { ...element, instruction: 'x'.repeat(4001) })).status, 400);
  assert.equal((await api(`/projects/${pid}/element-edit`, 'POST', { ...element, revisionId: 'missing' })).status, 404);

  // Saturated: the edit holds the only worker slot, so a second edit gets 429.
  let release;
  hold = new Promise((resolve) => (release = resolve));
  calls.length = 0;
  const pending = api(`/projects/${pid}/element-edit`, 'POST', element);
  await until(() => calls.length === 1);
  const busy = await api(`/projects/${pid}/element-edit`, 'POST', element);
  assert.equal(busy.status, 429);
  assert.match(busy.data.error, /busy/);
  release();
  hold = null;
  assert.equal((await pending).status, 200);

  // A client disconnect aborts the model call and frees the slot.
  hold = new Promise(() => {});
  calls.length = 0;
  const controller = new AbortController();
  const login = await fetch(app.url + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Request': '1' }, body: JSON.stringify({ password: PASSWORD }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const aborted = fetch(app.url + `/api/projects/${pid}/element-edit`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Studio-Request': '1' },
    body: JSON.stringify(element),
    signal: controller.signal,
  }).catch((e) => e);
  await until(() => calls.length === 1);
  controller.abort();
  await aborted;
  await until(() => closed.length === 1);
  assert.equal(closed[0], calls[0], 'the upstream GLM request was aborted');
  hold = null;
  await until(async () => (await api(`/projects/${pid}/element-edit`, 'POST', element)).status === 200, 5000);

  // An active job blocks element edits on its project.
  hold = new Promise((resolve) => (release = resolve));
  reply = 'artifact';
  calls.length = 0;
  const active = (await api(`/projects/${pid}/generate`, 'POST', { prompt: 'Hold.', review: false })).data.id;
  await until(() => calls.length === 1);
  assert.equal((await api(`/projects/${pid}/element-edit`, 'POST', element)).status, 409);
  release();
  hold = null;
  assert.equal((await waitJob(api, active)).status, 'complete');

  // SIGTERM closes in-flight connections instead of waiting for the model.
  reply = 'element';
  hold = new Promise(() => {});
  calls.length = 0;
  const inflight = api(`/projects/${pid}/element-edit`, 'POST', element).catch((e) => e);
  await until(() => calls.length === 1);
  const t0 = Date.now();
  await stop(app);
  assert.ok(Date.now() - t0 < 5000, `shutdown took ${Date.now() - t0} ms`);
  await inflight;
  hold = null;
});
