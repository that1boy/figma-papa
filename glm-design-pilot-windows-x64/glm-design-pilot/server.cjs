'use strict';
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { body, send } = require('./lib/http.cjs');
const S = require('./lib/schema.cjs');
const { prepareImport } = require('./lib/import.cjs');
const M = require('./lib/model.cjs');
const { initializeHistory, briefHistory } = require('./lib/history.cjs');
const { demo } = require('./lib/demo.cjs');
const { pageHTML, CSP, warnings } = require('./lib/presentation.cjs');
const { exportPPTX, exportDOCX } = require('./lib/exports.cjs');
const { initializeStudio, projectStyle, studioRoute } = require('./lib/studio-routes.cjs');
const { handoff } = require('./lib/handoff.cjs');
const cfg = M.configFromEnv();
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
initializeHistory(db);
initializeStudio(db);
db.prepare(
  "UPDATE jobs SET status='failed',stage='Interrupted by application restart',error='This job did not finish before the application restarted. Submit it again.',updated=? WHERE status IN ('queued','running')",
).run(new Date().toISOString());
const now = () => new Date().toISOString(),
  id = () => crypto.randomUUID();
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
// Transactionally insert the artifact and advance the current revision.
function commit(p, a, prompt, origin, metrics, rid = id(), parentId = p.current_id) {
  const date = now();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      'INSERT INTO revisions(id,project_id,artifact,prompt,origin,metrics,created,parent_id) VALUES(?,?,?,?,?,?,?,?)',
    ).run(rid, p.id, JSON.stringify(a), prompt, origin, JSON.stringify(metrics), date, parentId || null);
    db.prepare('UPDATE projects SET current_id=?,title=?,updated=? WHERE id=?').run(
      rid,
      a.title,
      date,
      p.id,
    );
    db.exec('COMMIT');
    return rid;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
function updateJob(jid, status, stage, error = null, result = null) {
  db.prepare('UPDATE jobs SET status=?,stage=?,error=?,result_id=?,updated=? WHERE id=?').run(
    status,
    stage,
    error,
    result,
    now(),
    jid,
  );
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
  const response = await fetch(process.env.RENDER_URL.replace(/\/$/, '') + route, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RENDER_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.any([signal, AbortSignal.timeout(165000)]),
    redirect: 'error',
  });
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
async function saveRender(rid, render) {
  await fsp.writeFile(
    path.join(dataDir, 'renders', rid + '.pdf'),
    Buffer.from(render.pdf, 'base64'),
  );
  await Promise.all(
    render.screenshots.map((s, i) =>
      fsp.writeFile(path.join(dataDir, 'renders', `${rid}-${i}.png`), Buffer.from(s, 'base64')),
    ),
  );
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
    warnings: [],
    review: null,
    render: null,
  };
  const stage = (s, label) => {
    if (signal.aborted) throw new Error('Cancelled.');
    updateJob(job.id, 'running', label || s);
  };
  try {
    const p = project(job.project_id),
      current = job.base_id ? revision(job.base_id, p.id).artifact : null;
    p.history = briefHistory(db, p.id, job.base_id);
    metrics.sourceBriefCount = p.history.briefs.length;
    if (p.history.omitted) metrics.warnings.push(`${p.history.omitted} older revision briefs exceeded the context limit. The original brief and latest instructions were retained; inspect factual continuity.`);
    stage(
      'generating',
      cfg.mode === 'demo' ? 'Loading fixed demonstration' : 'Generating with GLM',
    );
    let a;
    if (cfg.mode === 'demo') {
      await new Promise((r) => setTimeout(r, 400));
      a = S.artifact(demo(p.kind, current), p.kind);
      metrics.warnings.push(
        'Fixed demo content. Prompts and images are not interpreted in demo mode; no GLM quality claim can be made.',
      );
    } else a = await M.generate(cfg, p, job.prompt, current, signal, metrics, stage);
    stage('rendering', 'Rendering the artifact');
    let render;
    try {
      render = await renderArtifact(a, p.references, signal);
    } catch (e) {
      if (signal.aborted) throw e;
      metrics.warnings.push(
        'Rendering unavailable. Browser preview is available, but native export layout and visual review remain unverified.',
      );
    }
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
    metrics.warnings.push(...warnings(a, p.references));
    if (render) {
      metrics.warnings = metrics.warnings.filter((w) => !w.startsWith('Rendering unavailable'));
      metrics.render = {
        pageCount: render.pageCount,
        screenshots: render.screenshots.length,
        basis: render.basis,
        views: render.views || [],
        ...render.metrics,
      };
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
    metrics.durationSeconds = Math.round((Date.now() - start) / 1000);
    const rid = id();
    if (render) await saveRender(rid, render);
    if (signal.aborted) throw new Error('Cancelled.');
    commit(p, a, job.prompt, cfg.mode, metrics, rid);
    updateJob(job.id, 'complete', 'Ready for your review', null, rid);
  } catch (e) {
    const cancelled = signal.aborted;
    updateJob(
      job.id,
      cancelled ? 'cancelled' : 'failed',
      cancelled ? 'Cancelled' : 'Generation failed',
      cancelled ? 'Cancelled by user.' : e.message,
    );
  } finally {
    controllers.delete(job.id);
    running--;
    setImmediate(pump);
  }
}
function pump() {
  while (running < maxJobs) {
    const job = db
      .prepare("SELECT * FROM jobs WHERE status='queued' ORDER BY created LIMIT 1")
      .get();
    if (!job) break;
    running++;
    updateJob(job.id, 'running', 'Starting');
    runJob(job);
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
  if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)
    throw Object.assign(new Error('Cross-origin request denied.'), { status: 403 });
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
      if (url.pathname === '/api/config')
        return send(res, 200, {
          mode: cfg.mode,
          model: cfg.model,
          maxJobs,
          renderConfigured: !!process.env.RENDER_URL,
          version: require('./package.json').version,
        });
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
        const input = await body(req);
        if (!S.KINDS.includes(input.kind)) S.fail('Unknown project type.');
        const refs = S.references(input.references);
        const pid = id(),
          date = now();
        db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?,?,?)').run(
          pid,
          input.kind,
          S.str(input.title || 'Untitled project', 'Title', 140, true),
          S.str(input.brand || '', 'Brand guidance', 12000),
          JSON.stringify(refs),
          null,
          date,
          date,
        );
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
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?,?,?)').run(
            pid, a.kind, a.title, '', JSON.stringify(references), rid, date, date,
          );
          db.prepare('INSERT INTO revisions(id,project_id,artifact,prompt,origin,metrics,created,parent_id) VALUES(?,?,?,?,?,?,?,?)')
            .run(rid, pid, JSON.stringify(a), sourceBrief, 'import', JSON.stringify(metrics), date, null);
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        return send(res, 201, { id: pid });
      }
      if (parts[1] === 'projects' && parts[2]) {
        const p = project(parts[2]);
        if (parts.length === 3 && req.method === 'GET')
          return send(res, 200, {
            ...p,
            refs: undefined,
            revisions: db
              .prepare(
                'SELECT id,prompt,origin,metrics,created FROM revisions WHERE project_id=? ORDER BY created DESC',
              )
              .all(p.id)
              .map((r) => ({ ...r, metrics: JSON.parse(r.metrics) })),
            current: p.current_id ? revision(p.current_id, p.id) : null,
            jobs: db
              .prepare('SELECT * FROM jobs WHERE project_id=? ORDER BY created DESC LIMIT 15')
              .all(p.id),
          });
        if (parts[3] === 'generate' && req.method === 'POST') {
          assertIdle(p.id);
          if (
            db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','running')").get()
              .n >=
            maxQueue + maxJobs
          )
            return send(res, 429, {
              error: 'The pilot queue is full. Try again after a job completes.',
            });
          const input = await body(req, 1000000),
            prompt = S.str(input.prompt, 'Brief', 24000, true),
            jid = id(),
            date = now();
          db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
            jid,
            p.id,
            prompt,
            input.review === false ? 0 : 1,
            p.current_id,
            'queued',
            'Waiting for a worker',
            null,
            null,
            date,
            date,
          );
          pump();
          return send(res, 202, { id: jid });
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
          const inherited = p.current_id ? revision(p.current_id, p.id).metrics.mode : 'manual';
          const rid = commit(p, a, 'Manual edit', 'manual', {
            mode: inherited,
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
          r.metrics.render = {
            pageCount: render.pageCount,
            screenshots: render.screenshots.length,
            basis: render.basis,
            views: render.views || [],
            ...render.metrics,
          };
          r.metrics.warnings = (r.metrics.warnings || []).filter(
            (w) => !w.startsWith('Rendering unavailable') && !w.startsWith('Manual edit:'),
          );
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
          db.prepare('INSERT INTO evaluations VALUES(?,?,?,?)').run(
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
        if (req.method === 'GET') return send(res, 200, job);
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
});
