'use strict';
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { setTimeout: sleep } = require('node:timers/promises');
const { body, send } = require('./lib/http.cjs');
const S = require('./lib/schema.cjs');
const { prepareImport } = require('./lib/import.cjs');
const M = require('./lib/model.cjs');
const L = require('./lib/llm.cjs');
const { initializeHistory, briefHistory, manualPrompt } = require('./lib/history.cjs');
const { demo } = require('./lib/demo.cjs');
const { pageHTML, CSP, warnings } = require('./lib/presentation.cjs');
const { exportPPTX, exportDOCX } = require('./lib/exports.cjs');
const { initializeStudio, projectStyle, projectSources, insertSource, insertProject, insertStyle, extractSources, studioRoute, tx: transaction, MAX_SOURCES } = require('./lib/studio-routes.cjs');
const { handoff } = require('./lib/handoff.cjs');
const { staticLint, mergeFindings, scoreFindings } = require('./lib/lint.cjs');
const { PRESETS, FONTS, preset } = require('./lib/presets.cjs');
const VERSION = '0.3.0';
const cfg = M.configFromEnv();
// The 0.3 GLM settings (section 1). model.configFromEnv may already include them.
if (!cfg.effort) L.extendConfig(cfg);
const dataDir = path.resolve(process.env.DATA_DIR || './data');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(dataDir, 'renders'), { recursive: true });
const password = process.env.APP_PASSWORD || '';
if (password.length < 12)
  throw new Error('Set APP_PASSWORD to a pilot password of at least 12 characters.');
if (cfg.mode === 'glm' && password === 'local-pilot-change-me')
  throw new Error('Change the example APP_PASSWORD before enabling GLM mode.');
const secret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const passwordHash = crypto.scryptSync(password, 'design-pilot-login-v1', 32);
if (cfg.mode === 'glm' && process.env.SESSION_SECRET?.startsWith('replace-'))
  throw new Error('Replace the example SESSION_SECRET before enabling GLM mode.');
const maxJobs = Number(process.env.MAX_CONCURRENT_JOBS || 2),
  maxQueue = Number(process.env.MAX_QUEUED_JOBS || 20);
if (
  !Number.isInteger(maxJobs) ||
  maxJobs < 1 ||
  maxJobs > 8 ||
  !Number.isInteger(maxQueue) ||
  maxQueue < 1 ||
  maxQueue > 100
)
  throw new Error('Pilot concurrency must be 1-8; queue length 1-100.');
const db = new DatabaseSync(path.join(dataDir, 'studio.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,brand TEXT NOT NULL,refs TEXT NOT NULL,current_id TEXT,created TEXT NOT NULL,updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),artifact TEXT NOT NULL,prompt TEXT NOT NULL,origin TEXT NOT NULL,metrics TEXT NOT NULL,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),prompt TEXT NOT NULL,review INTEGER NOT NULL,base_id TEXT,status TEXT NOT NULL,stage TEXT NOT NULL,error TEXT,result_id TEXT,created TEXT NOT NULL,updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS evaluations(id TEXT PRIMARY KEY,revision_id TEXT NOT NULL REFERENCES revisions(id),data TEXT NOT NULL,created TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS revisions_project ON revisions(project_id); CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);`);
// 0.3 job columns, added in place so 0.2 databases keep their rows.
function addColumns(table, columns) {
  const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  const missing = columns.filter(([name]) => !have.has(name));
  if (!missing.length) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [name, definition] of missing) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
addColumns('jobs', [
  ['kind', "TEXT NOT NULL DEFAULT 'generate'"],
  ['options', "TEXT NOT NULL DEFAULT '{}'"],
  ['progress', "TEXT NOT NULL DEFAULT '{}'"],
  ['result_ids', "TEXT NOT NULL DEFAULT '[]'"],
]);
initializeHistory(db);
initializeStudio(db);
db.prepare(
  "UPDATE jobs SET status='failed',stage='Interrupted by application restart',error='This job did not finish before the application restarted. Submit it again.',updated=? WHERE status IN ('queued','running')",
).run(new Date().toISOString());
const now = () => new Date().toISOString(),
  id = () => crypto.randomUUID();
const tx = (fn) => transaction(db, fn);
const parse = (text, fallback) => {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
};
const jobView = (j) =>
  j && { ...j, kind: j.kind || 'generate', options: parse(j.options, {}), progress: parse(j.progress, {}), result_ids: parse(j.result_ids, []) };
function project(pid) {
  const p = db.prepare('SELECT * FROM projects WHERE id=?').get(pid);
  if (!p) throw Object.assign(new Error('Project not found.'), { status: 404 });
  return { ...p, references: JSON.parse(p.refs), designSystem: projectStyle(db,p.id) };
}
function revision(rid, pid) {
  const r = db.prepare('SELECT * FROM revisions WHERE id=? AND project_id=?').get(rid, pid);
  if (!r) throw Object.assign(new Error('Revision not found.'), { status: 404 });
  return { ...r, artifact: JSON.parse(r.artifact), metrics: JSON.parse(r.metrics) };
}
function busy(pid) {
  return !!db
    .prepare("SELECT id FROM jobs WHERE project_id=? AND status IN ('queued','running')")
    .get(pid);
}
function assertIdle(pid) {
  if (busy(pid))
    throw Object.assign(
      new Error('Wait for or cancel the active generation before changing this project.'),
      { status: 409 },
    );
}
// Transactionally insert revisions. The first entry advances the current revision
// unless advance is false (directions keep their siblings off the current branch).
function commitMany(p, entries) {
  const t = Date.now();
  return tx(() => {
    const rids = entries.map((e, i) => {
      const rid = e.rid || id();
      db.prepare(
        'INSERT INTO revisions(id,project_id,artifact,prompt,origin,metrics,created,parent_id) VALUES(?,?,?,?,?,?,?,?)',
      ).run(rid, p.id, JSON.stringify(e.a), e.prompt, e.origin, JSON.stringify(e.metrics), new Date(t - i).toISOString(), e.parentId || null);
      return rid;
    });
    if (entries[0].advance !== false)
      db.prepare('UPDATE projects SET current_id=?,title=?,updated=? WHERE id=?').run(rids[0], entries[0].a.title, new Date(t).toISOString(), p.id);
    return rids;
  });
}
function commit(p, a, prompt, origin, metrics, rid = id(), parentId = p.current_id) {
  return commitMany(p, [{ a, prompt, origin, metrics, rid, parentId }])[0];
}
function updateJob(jid, status, stage, error = null, result = null, resultIds = null) {
  const phase = { complete: 'complete', failed: 'failed', cancelled: 'cancelled' }[status];
  db.prepare(
    `UPDATE jobs SET status=?,stage=?,error=?,result_id=?,updated=?${phase ? ',progress=?' : ''}${resultIds ? ',result_ids=?' : ''} WHERE id=?`,
  ).run(
    status,
    stage,
    error,
    result,
    now(),
    ...(phase ? [JSON.stringify({ phase, label: stage })] : []),
    ...(resultIds ? [JSON.stringify(resultIds)] : []),
    jid,
  );
}
// The renderer accepts two concurrent renders and answers 429 beyond that; queue here.
const RENDER_SLOTS = 2,
  renderWaiters = [];
let rendering = 0;
function renderSlot(signal) {
  if (signal?.aborted) return Promise.reject(new Error('Cancelled.'));
  if (rendering < RENDER_SLOTS) return (rendering++, Promise.resolve());
  return new Promise((resolve, reject) => {
    const abort = () => (renderWaiters.splice(renderWaiters.indexOf(waiter) >>> 0, 1), reject(new Error('Cancelled.')));
    const waiter = () => (signal?.removeEventListener('abort', abort), resolve());
    renderWaiters.push(waiter);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
function releaseRender() {
  const next = renderWaiters.shift();
  if (next) next();
  else rendering--;
}
async function renderArtifact(a, refs, signal) {
  if (!process.env.RENDER_URL || !process.env.RENDER_TOKEN)
    throw new Error('Renderer is not configured.');
  let route = '/render',
    payload = { html: pageHTML(a, refs) };
  if (a.kind !== 'web') {
    route = '/office';
    payload = {
      extension: a.kind === 'slides' ? 'pptx' : 'docx',
      file: (await (a.kind === 'slides' ? exportPPTX(a, refs) : exportDOCX(a, refs))).toString(
        'base64',
      ),
    };
  }
  const json = JSON.stringify(payload);
  await renderSlot(signal);
  try {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(process.env.RENDER_URL.replace(/\/$/, '') + route, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RENDER_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: json,
        signal: AbortSignal.any([signal, AbortSignal.timeout(165000)]),
        redirect: 'error',
      });
      // Busy (another process shares the renderer): retry once after a short pause.
      if (response.status === 429 && !attempt) {
        await response.body?.cancel().catch(() => {});
        await sleep(1500, null, { signal });
        continue;
      }
      if (!response.ok) throw new Error('Rendering service unavailable.');
      const result = await response.json();
      if (
        !Array.isArray(result.screenshots) ||
        !result.screenshots.length ||
        typeof result.pdf !== 'string'
      )
        throw new Error('Invalid renderer response.');
      return result;
    }
  } finally {
    releaseRender();
  }
}
async function saveRender(rid, render) {
  const dir = path.join(dataDir, 'renders'),
    own = new RegExp(`^${rid}-\\d+\\.png$`);
  // A re-render can produce fewer views: never serve a stale screenshot from an earlier render.
  for (const name of await fsp.readdir(dir)) if (own.test(name)) await fsp.rm(path.join(dir, name), { force: true });
  await fsp.writeFile(path.join(dir, rid + '.pdf'), Buffer.from(render.pdf, 'base64'));
  await Promise.all(
    render.screenshots.map((s, i) =>
      fsp.writeFile(path.join(dir, `${rid}-${i}.png`), Buffer.from(s, 'base64')),
    ),
  );
}
const LINT_WARNING = 'Design lint found';
// Static findings plus the renderer's page findings, errors first, capped for storage.
function applyLint(metrics, a, render) {
  let all = [];
  try {
    all = mergeFindings(staticLint(a), render?.metrics?.lint || []);
  } catch (e) {
    console.error('Lint failed:', e.message);
  }
  metrics.lint = all.slice(0, 200);
  metrics.lintScore = scoreFindings(all);
  metrics.warnings = (metrics.warnings || []).filter((w) => !w.startsWith(LINT_WARNING));
  const errors = all.filter((f) => f.severity === 'error');
  if (errors.length)
    metrics.warnings.push(
      `${LINT_WARNING} ${errors.length} error${errors.length === 1 ? '' : 's'} (${[...new Set(errors.map((f) => f.rule))].slice(0, 5).join(', ')}). Inspect the lint findings before handoff.`,
    );
}
function renderSummary(render) {
  const { lint, ...rest } = render.metrics || {};
  return {
    pageCount: render.pageCount,
    screenshots: render.screenshots.length,
    basis: render.basis,
    views: render.views || [],
    ...rest,
  };
}
function renderWarnings(metrics, render) {
  metrics.warnings = metrics.warnings.filter((w) => !w.startsWith('Rendering unavailable'));
  metrics.render = renderSummary(render);
  if (render.metrics?.horizontalOverflow)
    metrics.warnings.push('The browser detected horizontal overflow.');
  if (render.metrics?.mobileHorizontalOverflow)
    metrics.warnings.push('The mobile browser detected horizontal overflow at 390 px.');
  if (render.metrics?.mobileMissingLabels)
    metrics.warnings.push('The mobile table hides column headers and has cells without visible field labels.');
  if (render.metrics?.tabletHorizontalOverflow) metrics.warnings.push('The tablet browser detected horizontal overflow at 768 px.');
  if (render.metrics?.unnamedControls) metrics.warnings.push(`${render.metrics.unnamedControls} visible controls may lack accessible names.`);
  if (render.metrics?.brokenTargets) metrics.warnings.push(`${render.metrics.brokenTargets} prototype interactions reference a missing target.`);
  if (render.metrics?.inactiveButtons) metrics.warnings.push(`${render.metrics.inactiveButtons} buttons have no supported prototype action. Check whether these controls should work.`);
  if (render.metrics?.duplicateIds) metrics.warnings.push('Duplicate HTML IDs were found within a screen. Check labels and interaction targets.');
}
const RENDER_UNAVAILABLE =
  'Rendering unavailable. Browser preview is available, but native export layout and visual review remain unverified.';
const DEMO_WARNING =
  'Fixed demo content. Prompts and images are not interpreted in demo mode; no GLM quality claim can be made.';
// Final checks shared by single generations and every direction.
function finish(metrics, a, p, render, start) {
  metrics.warnings.push(...warnings(a, p.references));
  if (render) renderWarnings(metrics, render);
  applyLint(metrics, a, render);
  metrics.calls = Array.isArray(metrics.calls) ? metrics.calls.slice(0, 100) : [];
  metrics.reasoningTokens ||= 0;
  metrics.pipeline ??= cfg.mode === 'glm' ? { mode: p.kind === 'web' ? cfg.pipeline : 'single' } : null;
  metrics.durationSeconds = Math.round((Date.now() - start) / 1000);
}
async function tryRender(a, p, signal, metrics) {
  try {
    return await renderArtifact(a, p.references, signal);
  } catch (e) {
    if (signal.aborted) throw e;
    if (!metrics.warnings.includes(RENDER_UNAVAILABLE)) metrics.warnings.push(RENDER_UNAVAILABLE);
    return null;
  }
}
// GLM element edits and directions: model.cjs wrappers (positional signal, metrics, onStage),
// or the pipeline's ctx form when an older model.cjs lacks them.
const glmPipeline = () => require('./lib/pipeline.cjs');
const glmEditElement = (p, a, request, signal, metrics) =>
  M.editElement ? M.editElement(cfg, p, a, request, signal, metrics) : glmPipeline().editElement(cfg, p, a, request, { signal, metrics });
// Accepts {results: [{name, artifact, pipeline}], failed}, [{name, artifact}] or artifact[].
async function glmDirections(p, prompt, count, signal, metrics, onStage) {
  const out = await (M.directions
    ? M.directions(cfg, p, prompt, count, signal, metrics, onStage)
    : glmPipeline().directions(cfg, p, prompt, count, { signal, metrics, onStage }));
  const list = Array.isArray(out) ? out : out?.results || [];
  return {
    results: list
      .map((r, i) =>
        r?.artifact
          ? { name: String(r.name || `Direction ${i + 1}`).slice(0, 80), artifact: r.artifact, pipeline: r.pipeline || null }
          : r?.kind
            ? { name: `Direction ${i + 1}`, artifact: r, pipeline: null }
            : null,
      )
      .filter(Boolean),
    failed: Array.isArray(out?.failed) ? out.failed.map((x) => String(x?.message || x).slice(0, 300)) : [],
  };
}
// Demo directions: the fixed demo restyled with distinct curated presets, clearly labelled.
const DEMO_PRESETS = ['neutral', 'bold', 'enterprise', 'editorial'];
function demoDirections(count) {
  return DEMO_PRESETS.slice(0, count).map((key, i) => {
    const look = preset(key) || PRESETS[i],
      a = demo('web'),
      ds = S.designSystem({ ...look.tokens });
    return {
      name: `Demo direction ${i + 1}: ${look.name}`,
      artifact: S.artifact(
        {
          ...a,
          title: `${a.title} (demo direction ${i + 1}: ${look.name})`,
          summary: `Fixed demonstration content restyled with the ${look.name} preset. Not generated from your brief.`,
          theme: { accent: ds.accent, background: ds.background, text: ds.text },
          designSystem: ds,
        },
        'web',
      ),
    };
  });
}
let running = 0;
const controllers = new Map();
async function runJob(job) {
  const controller = new AbortController();
  controllers.set(job.id, controller);
  const signal = controller.signal,
    start = Date.now();
  const metrics = {
    mode: cfg.mode,
    model: cfg.mode === 'glm' ? cfg.model : null,
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    calls: [],
    warnings: [],
    review: null,
    render: null,
  };
  // Progress is written at most once per second, and always when the phase changes. An update
  // inside the second is kept and written when it ends, so the newest state (e.g. "Built 3 of 3
  // screens") is never lost to the throttle.
  let phase = null,
    written = 0,
    pending = null,
    timer = null;
  const write = (progress) => {
    written = Date.now();
    db.prepare("UPDATE jobs SET stage=?,progress=?,updated=? WHERE id=? AND status='running'").run(
      progress.label,
      JSON.stringify(progress),
      now(),
      job.id,
    );
  };
  const flush = () => {
    timer = null;
    const p = pending;
    pending = null;
    if (!p || signal.aborted) return;
    try {
      write(p);
    } catch (e) {
      console.error('Progress update failed:', e.message);
    }
  };
  const stage = (s, label, extra) => {
    if (signal.aborted) throw new Error('Cancelled.');
    const info = extra && typeof extra === 'object' ? extra : {};
    const chars = /([\d.]+)k characters/.exec(label || '')?.[1];
    const progress = {
      phase: s,
      label: label || s,
      done: Number.isFinite(info.done) ? info.done : null,
      total: Number.isFinite(info.total) ? info.total : null,
      chars: Number.isFinite(info.chars) ? info.chars : chars ? Math.round(Number(chars) * 1000) : null,
      calls: metrics.modelCalls || 0,
    };
    const wait = 1000 - (Date.now() - written);
    if (s === phase && wait > 0) {
      pending = progress;
      timer ??= setTimeout(flush, wait);
      return;
    }
    phase = s;
    pending = null;
    clearTimeout(timer);
    timer = null;
    write(progress);
  };
  try {
    const p = project(job.project_id),
      current = job.base_id ? revision(job.base_id, p.id).artifact : null;
    p.history = briefHistory(db, p.id, job.base_id);
    p.sources = projectSources(db, p.id, true).map((s) => ({ name: s.name, text: s.text }));
    metrics.sourceBriefCount = p.history.briefs.length;
    if (p.sources.length) metrics.sourceDocuments = p.sources.length;
    if (p.history.omitted) metrics.warnings.push(`${p.history.omitted} older revision briefs exceeded the context limit. The original brief and latest instructions were retained; inspect factual continuity.`);
    if (job.kind === 'directions') return await runDirections(job, p, metrics, stage, signal, start);
    stage(
      'generating',
      cfg.mode === 'demo' ? 'Loading fixed demonstration' : 'Generating with GLM',
    );
    let a;
    if (cfg.mode === 'demo') {
      await sleep(400, null, { signal }).catch(() => {});
      a = S.artifact(demo(p.kind, current), p.kind);
      metrics.warnings.push(DEMO_WARNING);
    } else a = await M.generate(cfg, p, job.prompt, current, signal, metrics, stage);
    stage('rendering', 'Rendering the artifact');
    let render = await tryRender(a, p, signal, metrics);
    if (job.review && cfg.mode === 'glm') {
      stage('reviewing', render ? 'Checking content and rendered output' : 'Checking content against the brief');
      try {
        metrics.review = await M.critique(cfg, p, job.prompt, a, render, signal, metrics, current);
        if (metrics.review.issues.length) {
          stage('refining', 'Applying one quality correction pass');
          const refined = await M.generate(
            cfg,
            p,
            `Current user request: ${job.prompt}\nCorrect these review findings only when supported by the supplied briefs. Findings are reviewer suggestions, not new source facts. Preserve unaffected facts, unknowns, structure and styling: ${JSON.stringify(metrics.review.issues)}`,
            a,
            signal,
            metrics,
            stage,
          );
          let refinedRender;
          try {
            refinedRender = await renderArtifact(refined, p.references, signal);
          } catch (e) {
            if (signal.aborted || render) throw e;
          }
          a = refined;
          render = refinedRender;
          metrics.review.refined = true;
          metrics.warnings.push(
            'One quality correction pass completed. The corrected result still needs human review.',
          );
        }
      } catch (e) {
        if (signal.aborted) throw e;
        metrics.warnings.push(
          'Quality review or correction could not finish. The previous generated artifact was retained.',
        );
      }
    }
    if (signal.aborted) throw new Error('Cancelled.');
    finish(metrics, a, p, render, start);
    const rid = id();
    if (render) await saveRender(rid, render);
    if (signal.aborted) throw new Error('Cancelled.');
    commit(p, a, job.prompt, cfg.mode, metrics, rid, job.base_id);
    updateJob(job.id, 'complete', 'Ready for your review', null, rid, [rid]);
  } catch (e) {
    const cancelled = signal.aborted;
    updateJob(
      job.id,
      cancelled ? 'cancelled' : 'failed',
      cancelled ? 'Cancelled' : 'Generation failed',
      cancelled ? 'Cancelled by user.' : e.message,
    );
  } finally {
    clearTimeout(timer);
    controllers.delete(job.id);
    running--;
    setImmediate(pump);
  }
}
// 2–4 variants of a new web design. Every success is rendered (one at a time), linted and
// committed with parent_id = base; only the first advances the project's current revision.
async function runDirections(job, p, metrics, stage, signal, start) {
  const count = Math.max(2, Math.min(4, Number(parse(job.options, {}).count) || 3));
  stage('generating', cfg.mode === 'demo' ? `Loading ${count} demonstration directions` : `Generating ${count} directions with GLM`, { done: 0, total: count });
  let results, failed = [];
  if (cfg.mode === 'demo') {
    await sleep(400, null, { signal }).catch(() => {});
    results = demoDirections(count);
  } else ({ results, failed } = await glmDirections(p, job.prompt, count, signal, metrics, stage));
  if (signal.aborted) throw new Error('Cancelled.');
  // Model-derived artifacts are validated again here; one invalid direction does not sink the rest.
  results = results.flatMap((r) => {
    try {
      return [{ ...r, artifact: S.artifact(r.artifact, 'web') }];
    } catch (e) {
      failed.push(`${r.name}: ${e.message}`);
      return [];
    }
  });
  if (!results.length) throw new Error(failed[0] || 'GLM returned no usable direction.');
  const shared = { ...metrics, warnings: [...metrics.warnings] };
  if (cfg.mode === 'demo') shared.warnings.push(DEMO_WARNING);
  if (failed.length) shared.warnings.push(`${failed.length} of ${count} directions failed and were not saved: ${failed[0]}`);
  const entries = [];
  for (const [index, r] of results.entries()) {
    stage('rendering', `Rendering direction ${index + 1} of ${results.length}`, { done: index, total: results.length });
    const a = r.artifact,
      m = structuredClone({ ...shared, review: null, render: null });
    const render = await tryRender(a, p, signal, m);
    finish(m, a, p, render, start);
    m.pipeline = r.pipeline ? { ...r.pipeline, direction: r.name } : m.pipeline && { ...m.pipeline, direction: r.name };
    m.direction = { name: r.name, index, jobId: job.id, total: results.length };
    const rid = id();
    if (render) await saveRender(rid, render);
    entries.push({ a, prompt: job.prompt, origin: cfg.mode, metrics: m, rid, parentId: job.base_id });
  }
  if (signal.aborted) throw new Error('Cancelled.');
  const rids = commitMany(p, entries);
  updateJob(job.id, 'complete', `${rids.length} directions ready for your review`, null, rids[0], rids);
}
function pump() {
  while (running < maxJobs) {
    const job = db
      .prepare("SELECT * FROM jobs WHERE status='queued' ORDER BY created LIMIT 1")
      .get();
    if (!job) break;
    running++;
    db.prepare("UPDATE jobs SET status='running',stage='Starting',progress=?,updated=? WHERE id=?").run(
      JSON.stringify({ phase: 'starting', label: 'Starting', done: null, total: null, chars: null, calls: 0 }),
      now(),
      job.id,
    );
    // runJob handles its own failures; this only guards against a failing status update.
    runJob(job).catch((e) => console.error('Job runner failed:', e.message));
  }
}
function sessionToken() {
  const value = Buffer.from(
    JSON.stringify({ expires: Date.now() + 12 * 3600000, nonce: id() }),
  ).toString('base64url');
  return value + '.' + crypto.createHmac('sha256', secret).update(value).digest('base64url');
}
function signedIn(req) {
  try {
    const cookie = req.headers.cookie
      ?.split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith('studio_session='))
      ?.slice(15);
    if (!cookie) return false;
    const [v, s] = cookie.split('.');
    const expected = crypto.createHmac('sha256', secret).update(v).digest();
    const actual = Buffer.from(s, 'base64url');
    return (
      actual.length === expected.length &&
      crypto.timingSafeEqual(actual, expected) &&
      JSON.parse(Buffer.from(v, 'base64url')).expires > Date.now()
    );
  } catch {
    return false;
  }
}
const loginAttempts = new Map();
function mutateGuard(req) {
  if (req.headers['x-studio-request'] !== '1')
    throw Object.assign(new Error('Missing request header.'), { status: 403 });
  if (req.headers.origin) {
    let host = null;
    try {
      host = new URL(req.headers.origin).host; // "null" (sandboxed or file pages) does not parse
    } catch {}
    if (host !== req.headers.host)
      throw Object.assign(new Error('Cross-origin request denied.'), { status: 403 });
  }
}
const secureCookie = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
const appCSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'),
      parts = url.pathname.split('/').filter(Boolean);
    if (url.pathname === '/healthz') return send(res, 200, { ok: true });
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) mutateGuard(req);
    if (url.pathname === '/api/login' && req.method === 'POST') {
      const key = req.socket.remoteAddress,
        entry = loginAttempts.get(key) || { count: 0, until: Date.now() + 300000 };
      if (Date.now() > entry.until) {
        entry.count = 0;
        entry.until = Date.now() + 300000;
      }
      if (entry.count >= 8)
        return send(res, 429, { error: 'Too many login attempts. Try again in five minutes.' });
      const input = await body(req, 10000);
      const entered = S.str(input.password, 'Password', 500);
      const hash = crypto.scryptSync(entered, 'design-pilot-login-v1', 32);
      if (!crypto.timingSafeEqual(hash, passwordHash)) {
        entry.count++;
        loginAttempts.set(key, entry);
        return send(res, 401, { error: 'Incorrect pilot password.' });
      }
      loginAttempts.delete(key);
      return send(res, 200, { ok: true }, undefined, {
        'Set-Cookie': `studio_session=${sessionToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secureCookie}`,
      });
    }
    if (url.pathname === '/api/logout' && req.method === 'POST')
      return send(res, 200, { ok: true }, undefined, {
        'Set-Cookie': `studio_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie}`,
      });
    if (parts[0] === 'api') {
      if (!signedIn(req)) return send(res, 401, { error: 'Sign in to the pilot workspace.' });
      if(await studioRoute(req,res,url,{db,id,now,project,revision,assertIdle})) return;
      if (url.pathname === '/api/config') {
        const supported = cfg.mode === 'glm' ? L.visionSupported(cfg) : false;
        return send(res, 200, {
          mode: cfg.mode,
          model: cfg.model,
          maxJobs,
          renderConfigured: !!process.env.RENDER_URL,
          version: VERSION,
          // Effective image handling: 'auto' becomes 'off' once the endpoint has rejected images.
          vision: cfg.mode !== 'glm' || cfg.vision === 'off' || (cfg.vision === 'auto' && supported === false) ? 'off' : cfg.vision,
          visionSupported: supported,
          pipeline: cfg.pipeline,
          maxReferences: S.MAX_REFERENCES,
          maxSources: MAX_SOURCES,
          presets: PRESETS.map(({ id, name, description, mood, tokens }) => ({ id, name, description, mood, tokens })),
          fonts: Object.keys(FONTS),
        });
      }
      if (url.pathname === '/api/model/test' && req.method === 'POST') {
        if (cfg.mode === 'demo')
          return send(res, 200, {
            message: 'Demo mode: no model is connected. Set MODEL_MODE=glm in .env and restart.',
          });
        if (running)
          return send(res, 409, {
            error: 'Wait for active generation jobs before testing the model.',
          });
        const m = { modelCalls: 0, inputTokens: 0, outputTokens: 0 };
        await M.completion(
          { ...cfg, maxTokens: 2048 },
          [{ role: 'user', content: 'Reply with the word connected.' }],
          new AbortController().signal,
          m,
        );
        return send(res, 200, {
          message:
            'Text completion succeeded. Image input and artifact quality still need a real generation test.',
          ...m,
        });
      }
      if (url.pathname === '/api/projects' && req.method === 'GET')
        return send(
          res,
          200,
          db
            .prepare(
              'SELECT p.id,p.kind,p.title,p.current_id,p.created,p.updated,(SELECT COUNT(*) FROM revisions r WHERE r.project_id=p.id) AS revisionCount FROM projects p ORDER BY updated DESC',
            )
            .all(),
        );
      if (url.pathname === '/api/projects' && req.method === 'POST') {
        // Six reference images (≤ 4.2 MB each as data URLs) plus source documents.
        const input = await body(req, 45000000);
        if (!S.KINDS.includes(input.kind)) S.fail('Unknown project type.');
        const refs = S.references(input.references);
        const title = S.str(input.title || 'Untitled project', 'Title', 140, true),
          brand = S.str(input.brand || '', 'Brand guidance', 12000);
        let style = null;
        if (input.preset != null && input.preset !== '') {
          const look = preset(S.str(input.preset, 'Preset', 40));
          if (!look) S.fail('Unknown design preset.');
          style = S.designSystem({ ...look.tokens, preset: look.id });
        }
        const sources = await extractSources(input.sources);
        const pid = id(),
          date = now();
        tx(() => {
          insertProject(db, { id: pid, kind: input.kind, title, brand, refs: JSON.stringify(refs), current_id: null, created: date, updated: date });
          for (const s of sources) insertSource(db, id(), pid, s, date);
          if (style) insertStyle(db, pid, style);
        });
        return send(res, 201, { id: pid });
      }
      if (url.pathname === '/api/import' && req.method === 'POST') {
        const { artifact: a, references, sourceBrief } = prepareImport(await body(req));
        const pid = id(), rid = id(), date = now();
        const metrics = {
          mode: 'import', durationSeconds: 0, modelCalls: 0, inputTokens: 0, outputTokens: 0,
          warnings: ['Imported artifact: source and model quality are unverified.', ...warnings(a, references)],
        };
        // The file supplies content only. IDs, provenance and metrics are owned by Forma.
        tx(() => {
          insertProject(db, { id: pid, kind: a.kind, title: a.title, brand: '', refs: JSON.stringify(references), current_id: rid, created: date, updated: date });
          db.prepare('INSERT INTO revisions(id,project_id,artifact,prompt,origin,metrics,created,parent_id) VALUES(?,?,?,?,?,?,?,?)')
            .run(rid, pid, JSON.stringify(a), sourceBrief, 'import', JSON.stringify(metrics), date, null);
        });
        return send(res, 201, { id: pid });
      }
      if (parts[1] === 'projects' && parts[2]) {
        const p = project(parts[2]);
        if (parts.length === 3 && req.method === 'GET')
          return send(res, 200, {
            ...p,
            refs: undefined,
            // Full lint findings and per-call metrics stay on GET .../revisions/:rid and current.
            revisions: db
              .prepare(
                'SELECT id,parent_id,prompt,origin,metrics,created FROM revisions WHERE project_id=? ORDER BY created DESC',
              )
              .all(p.id)
              .map((r) => ({ ...r, metrics: { ...JSON.parse(r.metrics), lint: undefined, calls: undefined } })),
            current: p.current_id ? revision(p.current_id, p.id) : null,
            jobs: db
              .prepare('SELECT * FROM jobs WHERE project_id=? ORDER BY created DESC LIMIT 15')
              .all(p.id)
              .map(jobView),
            sources: projectSources(db, p.id).map(({ created, ...s }) => s),
          });
        if (parts[3] === 'generate' && req.method === 'POST') {
          assertIdle(p.id);
          const queueFull = () =>
            db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','running')").get().n >= maxQueue + maxJobs;
          if (queueFull())
            return send(res, 429, {
              error: 'The pilot queue is full. Try again after a job completes.',
            });
          const input = await body(req, 1000000),
            prompt = S.str(input.prompt, 'Brief', 24000, true),
            jid = id(),
            date = now();
          let kind = 'generate',
            options = {};
          if (input.directions != null) {
            if (!Number.isInteger(input.directions) || input.directions < 2 || input.directions > 4)
              S.fail('Directions must be a whole number from 2 to 4.');
            if (p.kind !== 'web') S.fail('Directions are available for web prototypes only.');
            kind = 'directions';
            options = { count: input.directions };
          }
          // Re-check inside the write transaction: two requests can both pass the check above while reading bodies.
          tx(() => {
            assertIdle(p.id);
            if (queueFull())
              throw Object.assign(new Error('The pilot queue is full. Try again after a job completes.'), { status: 429 });
            db.prepare(
              'INSERT INTO jobs(id,project_id,prompt,review,base_id,status,stage,error,result_id,created,updated,kind,options,progress,result_ids) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            ).run(
              jid,
              p.id,
              prompt,
              input.review === false || kind === 'directions' ? 0 : 1,
              db.prepare('SELECT current_id FROM projects WHERE id=?').get(p.id).current_id,
              'queued',
              'Waiting for a worker',
              null,
              null,
              date,
              date,
              kind,
              JSON.stringify(options),
              JSON.stringify({ phase: 'queued', label: 'Waiting for a worker', done: null, total: null, chars: null, calls: 0 }),
              '[]',
            );
          });
          pump();
          return send(res, 202, { id: jid, kind });
        }
        if (parts[3] === 'element-edit' && req.method === 'POST') {
          if (cfg.mode === 'demo')
            return send(res, 409, {
              error: 'GLM element edits need MODEL_MODE=glm. Demo mode does not call a model; edit the element with the inspector instead.',
            });
          assertIdle(p.id);
          // A synchronous model call takes a worker slot, so jobs and element edits share MAX_CONCURRENT_JOBS.
          if (running >= maxJobs)
            return send(res, 429, {
              error: 'All generation workers are busy. Try the element edit again when a job finishes.',
            });
          running++;
          const controller = new AbortController();
          res.on('close', () => {
            if (!res.writableEnded) controller.abort(); // the client disconnected
          });
          try {
            const input = await body(req, 100000),
              r = revision(S.str(input.revisionId, 'Revision', 100, true), p.id);
            if (r.artifact.kind !== 'web') S.fail('Element edits are available for web prototypes only.');
            const screen = S.str(input.screen, 'Screen', 48, true);
            if (!S.webScreens(r.artifact).some((s) => s.id === screen)) S.fail('Element screen is not in this revision.');
            const element = S.str(input.element, 'Element HTML', 20000, true),
              instruction = S.str(input.instruction, 'Instruction', 4000, true);
            p.history = briefHistory(db, p.id, r.id);
            p.sources = projectSources(db, p.id, true).map((s) => ({ name: s.name, text: s.text }));
            const metrics = { mode: cfg.mode, model: cfg.model, modelCalls: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
              start = Date.now();
            const out = await glmEditElement(p, r.artifact, { screen, element, instruction }, controller.signal, metrics);
            if (controller.signal.aborted) return;
            if (typeof out?.html !== 'string' || !out.html.trim())
              throw new Error('GLM did not return the edited element in the expected format.');
            // Already sanitized by the pipeline; checked again because model output is untrusted.
            return send(res, 200, {
              html: S.safeHTML(out.html),
              css: S.safeCSS(typeof out.css === 'string' ? out.css : ''),
              notes: String(out.notes || '').slice(0, 3000),
              metrics: {
                modelCalls: metrics.modelCalls,
                inputTokens: metrics.inputTokens,
                outputTokens: metrics.outputTokens,
                reasoningTokens: metrics.reasoningTokens || 0,
                durationSeconds: Math.round((Date.now() - start) / 1000),
              },
            });
          } catch (e) {
            if (controller.signal.aborted) return;
            throw e;
          } finally {
            running--;
            setImmediate(pump);
          }
        }
        if (parts[3] === 'revisions' && parts[4] && req.method === 'GET')
          return send(res, 200, revision(parts[4], p.id));
        if (parts[3] === 'save' && req.method === 'POST') {
          assertIdle(p.id);
          const input = await body(req, 1000000);
          if (input.baseId !== p.current_id)
            return send(res, 409, {
              error: 'The project changed. Reload the latest revision before saving.',
            });
          const a = S.artifact(input.artifact, p.kind);
          const note = S.str(input.note || '', 'Note', 300).trim();
          // mode keeps the base revision's mode: evaluations attribute cleaned-up output to its
          // source and demo-mode controls depend on it. manual marks who made this revision.
          const inherited = p.current_id ? revision(p.current_id, p.id).metrics.mode : 'manual';
          const rid = commit(p, a, manualPrompt(note), 'manual', {
            mode: inherited,
            manual: true,
            ...(note ? { note } : {}),
            warnings: [
              'Manual edit: native rendering and visual review have not been rerun.',
              ...warnings(a, p.references),
            ],
            durationSeconds: 0,
            modelCalls: 0,
          });
          return send(res, 201, { id: rid });
        }
        if (parts[3] === 'restore' && req.method === 'POST') {
          assertIdle(p.id);
          const input = await body(req, 10000),
            r = revision(input.revisionId, p.id);
          const rid = commit(p, r.artifact, `Restored revision ${r.id}`, 'restore', {
            ...r.metrics,
            direction: undefined,
            manual: undefined,
            note: undefined,
            render: null,
            warnings: ['Restored content. Render again to regenerate native previews.'],
          }, id(), r.id);
          return send(res, 201, { id: rid });
        }
        if (['preview', 'export', 'screenshot'].includes(parts[3])) {
          const r = revision(url.searchParams.get('revision') || p.current_id, p.id);
          if (parts[3] === 'preview')
            return send(res, 200, pageHTML(r.artifact, p.references), 'text/html; charset=utf-8', {
              'Content-Security-Policy': CSP + '; sandbox allow-scripts allow-forms',
              'X-Frame-Options': 'SAMEORIGIN',
            });
          if (parts[3] === 'screenshot') {
            const i = Number(url.searchParams.get('page') || 0);
            if (!Number.isInteger(i) || i < 0 || i > 63) S.fail('Invalid page.');
            const file = path.join(dataDir, 'renders', `${r.id}-${i}.png`);
            if (!fs.existsSync(file))
              return send(res, 404, { error: 'No rendered screenshot is available.' });
            return send(res, 200, await fsp.readFile(file), 'image/png');
          }
          const format = url.searchParams.get('format') || 'json';
          let bytes, type;
          if (format === 'json') {
            bytes = JSON.stringify(r.artifact, null, 2);
            type = 'application/octet-stream';
          } else if (format === 'html') {
            bytes = pageHTML(r.artifact, p.references);
            type = 'text/html; charset=utf-8';
          } else if (format === 'zip' && p.kind === 'web') {
            bytes=handoff(p,r,db.prepare('SELECT * FROM design_notes WHERE revision_id=? ORDER BY created').all(r.id),briefHistory(db,p.id,r.id));
            type='application/zip';
          } else if (format === 'pptx' && p.kind === 'slides') {
            bytes = await exportPPTX(r.artifact, p.references);
            type = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
          } else if (format === 'docx' && p.kind === 'document') {
            bytes = await exportDOCX(r.artifact, p.references);
            type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          } else if (format === 'pdf') {
            const file = path.join(dataDir, 'renders', r.id + '.pdf');
            if (!fs.existsSync(file))
              return send(res, 409, {
                error:
                  'PDF is unavailable until rendering succeeds. Use Render exports and try again.',
              });
            bytes = await fsp.readFile(file);
            type = 'application/pdf';
          } else S.fail('This export format is not available for this project.');
          return send(res, 200, bytes, type, {
            'Content-Disposition': `attachment; filename="design-${p.kind}.${format}"`,
          });
        }
        if (parts[3] === 'render' && req.method === 'POST') {
          assertIdle(p.id);
          const input = await body(req, 10000),
            r = revision(input.revisionId || p.current_id, p.id);
          const render = await renderArtifact(
            r.artifact,
            p.references,
            new AbortController().signal,
          );
          await saveRender(r.id, render);
          r.metrics.render = renderSummary(render);
          r.metrics.warnings = (r.metrics.warnings || []).filter(
            (w) => !w.startsWith('Rendering unavailable') && !w.startsWith('Manual edit:'),
          );
          applyLint(r.metrics, r.artifact, render);
          db.prepare('UPDATE revisions SET metrics=? WHERE id=?').run(
            JSON.stringify(r.metrics),
            r.id,
          );
          return send(res, 200, { ok: true });
        }
        if (parts[3] === 'evaluate' && req.method === 'POST') {
          const input = await body(req, 30000),
            r = revision(input.revisionId || p.current_id, p.id);
          for (const k of ['baselineMinutes', 'workMinutes', 'cleanupMinutes'])
            if (
              typeof input[k] !== 'number' ||
              !Number.isFinite(input[k]) ||
              input[k] < 0 ||
              input[k] > 100000
            )
              S.fail(`${k} must be a nonnegative number.`);
          if (!Number.isInteger(input.quality) || input.quality < 1 || input.quality > 5)
            S.fail('Quality must be 1 to 5.');
          if (typeof input.accepted !== 'boolean' || typeof input.criticalErrors !== 'boolean')
            S.fail('Acceptance and critical-errors fields must be booleans.');
          if (input.accepted && input.criticalErrors)
            S.fail('An artifact with critical errors cannot be marked accepted.');
          const value = {
            ...input,
            revisionId: r.id,
            notes: S.str(input.notes || '', 'Notes', 5000),
            mode: r.metrics.mode,
            kind: p.kind,
            title: p.title,
          };
          db.prepare('INSERT INTO evaluations(id,revision_id,data,created) VALUES(?,?,?,?)').run(
            id(),
            r.id,
            JSON.stringify(value),
            now(),
          );
          return send(res, 201, { ok: true });
        }
      }
      if (parts[1] === 'jobs' && parts[2]) {
        const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(parts[2]);
        if (!job) return send(res, 404, { error: 'Job not found.' });
        if (parts[3] === 'cancel' && req.method === 'POST') {
          if (job.status === 'queued')
            updateJob(job.id, 'cancelled', 'Cancelled', 'Cancelled by user.');
          else if (job.status === 'running') controllers.get(job.id)?.abort();
          return send(res, 200, { ok: true });
        }
        if (req.method === 'GET') return send(res, 200, jobView(job));
      }
      if (url.pathname === '/api/evaluations' && req.method === 'GET')
        return send(
          res,
          200,
          db
            .prepare('SELECT * FROM evaluations ORDER BY created DESC')
            .all()
            .map((e) => ({ ...JSON.parse(e.data), id: e.id, created: e.created })),
        );
      if (url.pathname === '/api/evaluations.csv' && req.method === 'GET') {
        const rows = db.prepare('SELECT * FROM evaluations ORDER BY created DESC').all();
        const keys = [
          'created',
          'title',
          'kind',
          'mode',
          'revisionId',
          'quality',
          'accepted',
          'criticalErrors',
          'baselineMinutes',
          'workMinutes',
          'cleanupMinutes',
          'notes',
        ];
        const cell = (v) =>
          '"' +
          String(v ?? '')
            .replace(/^[=+@\-\t\r]/, "'$&")
            .replace(/"/g, '""') +
          '"';
        const csv = [
          keys.join(','),
          ...rows.map((r) => {
            const d = { ...JSON.parse(r.data), created: r.created };
            return keys.map((k) => cell(d[k])).join(',');
          }),
        ].join('\r\n');
        return send(res, 200, csv, 'text/csv; charset=utf-8', {
          'Content-Disposition': 'attachment; filename="pilot-evaluations.csv"',
        });
      }
      return send(res, 404, { error: 'API route not found.' });
    }
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed.' });
    const file = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/studio.js':'studio.js', '/studio.css':'studio.css' }[
      url.pathname
    ];
    if (!file) return send(res, 404, { error: 'Not found.' });
    return send(
      res,
      200,
      await fsp.readFile(path.join(__dirname, 'public', file)),
      mime[path.extname(file)],
      {
        'Content-Security-Policy': appCSP,
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
      },
    );
  } catch (e) {
    if (!res.headersSent)
      send(res, e.status || 500, {
        error: e.status
          ? e.message
          : e.message?.startsWith('GLM') || e.message?.startsWith('Cannot reach')
            ? e.message
            : 'The operation could not finish. Check the app and renderer logs.',
      });
    if (!e.status) console.error('Request failed:', e.message);
  }
});
server.requestTimeout = 180000;
server.listen(Number(process.env.PORT || 8080), process.env.HOST || '127.0.0.1', () =>
  console.log(
    `Design Pilot listening on ${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 8080} (${cfg.mode})`,
  ),
);
process.on('SIGTERM', () => {
  for (const c of controllers.values()) c.abort();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  // Keep-alive and in-flight requests (element edits) would otherwise hold the process open.
  server.closeIdleConnections();
  setTimeout(() => server.closeAllConnections(), 1000).unref();
});
