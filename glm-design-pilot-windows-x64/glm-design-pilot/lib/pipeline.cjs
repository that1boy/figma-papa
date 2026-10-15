'use strict';
// Staged web generation for a fast, smaller model: plan as JSON, build each
// screen as raw HTML in tagged blocks (first screen sequentially, the rest in
// parallel), revise by returning changed screens only, and edit single elements.
const S = require('./schema.cjs');
const L = require('./llm.cjs');
const P = require('./prompts.cjs');
const { normalizeTokens } = require('./kit.cjs');
const { PRESETS, DEFAULT_PRESET, preset } = require('./presets.cjs');

function pool(limit) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= limit || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };
  return (fn) => new Promise((resolve, reject) => (queue.push({ fn, resolve, reject }), next()));
}

const text = (x, max) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
const texts = (x, n, max) => (Array.isArray(x) ? x.filter((v) => typeof v === 'string' && v.trim()).slice(0, n).map((v) => v.trim().slice(0, max)) : []);

function screenId(value, i, used) {
  let id = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 44);
  if (!/^[a-z]/.test(id)) id = id ? `s-${id}`.slice(0, 44) : `screen-${i + 1}`;
  let unique = id;
  for (let n = 2; used.has(unique); n++) unique = `${id}-${n}`;
  used.add(unique);
  return unique;
}

const UNITS = ['px', 'rem', 'em', '%', 'vh', 'vw', ''];
function normalizeTweaks(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list
    .filter((t) => t && typeof t === 'object' && /^--[a-z][a-z0-9-]{1,40}$/.test(t.var) && !seen.has(t.var) && seen.add(t.var))
    .map((t) => {
      const min = Number(t.min), max = Number(t.max), step = Number(t.step) || 1;
      if (![min, max, step].every(Number.isFinite) || min >= max || step <= 0) return null;
      const value = Math.min(max, Math.max(min, Number.isFinite(Number(t.value)) ? Number(t.value) : min));
      return { var: t.var, label: text(t.label, 40) || t.var.slice(2), min, max, step, unit: UNITS.includes(t.unit) ? t.unit : 'px', value };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function normalizePlan(raw, prompt) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The design plan must be a JSON object.');
  const used = new Set();
  // A terse plan may list screens as plain names.
  const source = Array.isArray(raw.screens)
    ? raw.screens.map((s) => (typeof s === 'string' && s.trim() ? { name: s } : s)).filter((s) => s && typeof s === 'object' && !Array.isArray(s)).slice(0, 12)
    : [];
  const screens = source.map((s, i) => ({
    id: screenId(s.id || s.name, i, used),
    name: text(s.name, 80) || `Screen ${i + 1}`,
    purpose: text(s.purpose, 500),
    layout: text(s.layout, 800),
    sections: texts(s.sections, 14, 400),
    states: texts(s.states, 6, 80),
    links: texts(s.links, 12, 48),
  }));
  if (!screens.length) screens.push({ id: 'home', name: 'Home', purpose: String(prompt).slice(0, 500), layout: '', sections: [], states: [], links: [] });
  return {
    title: text(raw.title, 140) || 'Untitled design',
    summary: text(raw.summary, 1200),
    direction: text(raw.direction, 600),
    preset: text(raw.preset, 40),
    tokens: raw.tokens && typeof raw.tokens === 'object' && !Array.isArray(raw.tokens) ? raw.tokens : {},
    screens,
    facts: texts(raw.facts, 60, 500),
    tweaks: normalizeTweaks(raw.tweaks),
  };
}

// Model CSS is untrusted; drop forbidden constructs deterministically instead
// of spending a model call on a repair. safeCSS still validates the result.
function cleanCSS(css) {
  let out = String(css || '')
    .replace(/^```[a-z]*\s*|```\s*$/gim, '')
    .replace(/\/\*[\s\S]*?(?:\*\/|$)/g, '')
    .replace(/@import[^;{}]*;?/gi, '')
    .replace(/@font-face\s*\{[^}]*\}/gi, '')
    .replace(/[^;{}]*(?:\burl\s*\(|\bexpression\s*\(|-moz-binding)[^;{}]*;?/gi, '')
    .replace(/[\\<]/g, '')
    .trim();
  if (out.length > 60000) out = out.slice(0, out.lastIndexOf('}', 60000) + 1);
  return out;
}

const ALLOWED_TOKENS = ['accent', 'accent2', 'background', 'surface', 'text', 'muted', 'border', 'success', 'warning', 'danger', 'headingFont', 'bodyFont', 'monoFont', 'radius', 'spacing', 'density', 'shadow', 'typeScale'];
const pickTokens = (t) => {
  const out = {};
  if (t && typeof t === 'object' && !Array.isArray(t)) for (const k of ALLOWED_TOKENS) if (t[k] != null) out[k] = t[k];
  return out;
};
// Token objects from the model pass through normalizeTokens, the only gate to CSS.
// A project design system wins; explicit plan tokens (a requested style change)
// still override it. Otherwise the plan's preset (or the default) plus overrides.
function designFor(project, plan) {
  const overrides = pickTokens(plan.tokens);
  if (project.designSystem) return normalizeTokens({ ...project.designSystem, ...overrides });
  const base = preset(plan.preset) || preset(DEFAULT_PRESET) || PRESETS[0];
  return normalizeTokens({ ...base.tokens, ...overrides, name: base.name, preset: base.id });
}
// Revision token changes: {"preset": id} restarts from that preset, "tokens" override.
function revisedDesign(current, project, meta) {
  const overrides = pickTokens(meta.tokens);
  const named = typeof meta.preset === 'string' ? preset(meta.preset) : null;
  if (!named && !Object.keys(overrides).length) return null;
  const base = named ? { ...named.tokens } : current.designSystem || project?.designSystem || { ...current.theme };
  return normalizeTokens({ ...base, ...overrides });
}
// Layout variables the kit stylesheet reads, so tweaks on them work without model CSS.
const KIT_TWEAKS = new Set(['--sidebar-width', '--topbar-height', '--container', '--page-max', '--grid-min']);
// A tweak whose variable nothing reads would be a dead slider: keep used ones only.
function usedTweaks(list, css, screens) {
  const text = `${css}\n${screens.map((s) => s.html).join('\n')}`;
  return list.filter((t) => KIT_TWEAKS.has(t.var) || text.includes(`var(${t.var}`));
}

function referenceParts(project, cfg, max = cfg.maxImages ?? 8) {
  return (project.references || []).slice(0, max).map((ref) => ({ type: 'image_url', image_url: { url: ref.data } }));
}
const user = (body, images = []) => [{ type: 'text', text: body }, ...images];

function looksLikeArtifact(v) {
  return v && typeof v === 'object' && v.kind === 'web' && (typeof v.html === 'string' || Array.isArray(v.screens));
}
function validateFull(value, current, project) {
  if (current) {
    value.theme = { ...current.theme, ...value.theme };
    if (current.designSystem && !value.designSystem) value.designSystem = current.designSystem;
    if (current.tweaks && !value.tweaks) value.tweaks = current.tweaks;
  } else if (project?.designSystem && !value.designSystem) value.designSystem = project.designSystem;
  return S.artifact(value, 'web');
}

function context(cfg, ctx) {
  const limit = ctx.limit || pool(Math.max(1, Math.min(8, cfg.parallel || 3)));
  let last = 0;
  // extra: { done, total } screen counts or { chars } streamed so far (server progress JSON).
  const progress = (label, force, extra) => {
    const t = Date.now();
    if (!force && t - last < 1000) return;
    last = t;
    ctx.onStage?.('generating', label, extra);
  };
  async function call(stage, system, content, extra = [], label = '', json = stage === 'plan') {
    const messages = [{ role: 'system', content: system }, { role: 'user', content }, ...extra];
    const result = await limit(() =>
      L.chat(cfg, messages, {
        signal: ctx.signal,
        metrics: ctx.metrics,
        stage,
        json,
        onDelta: label
          ? (d) => {
              const chars = (d.contentChars || 0) + (d.reasoningChars || 0);
              progress(`${label} · ${Math.round(chars / 100) / 10}k characters`, false, { chars });
            }
          : undefined,
      }),
    );
    return { text: result.text, messages };
  }
  return { ...ctx, limit, call, progress };
}

async function plan(cfg, project, prompt, c, hint) {
  c.progress('Planning the design', true);
  const content = user(P.planUser(project, prompt, hint), referenceParts(project, cfg));
  let { text: raw } = await c.call('plan', P.PLAN_SYSTEM, content, [], 'Planning the design');
  let value;
  try {
    value = L.extractJSON(raw);
  } catch (e) {
    c.onStage?.('repairing', 'Repairing the output structure');
    ({ text: raw } = await c.call(
      'repair',
      P.PLAN_SYSTEM,
      content,
      [
        { role: 'assistant', content: raw },
        { role: 'user', content: `The output failed validation: ${e.message}. Return the complete corrected JSON object.` },
      ],
      '',
      true,
    ));
    value = L.extractJSON(raw);
  }
  // A model may skip the plan and answer with a complete artifact. Accept it
  // when it validates; nothing is lost and one call is saved.
  if (looksLikeArtifact(value)) return { artifact: validateFull(value, null, project) };
  return { plan: normalizePlan(value, prompt) };
}

function pickScreen(blocks, id) {
  return blocks.screens.find((s) => s.id === id) || (blocks.screens.length === 1 ? blocks.screens[0] : null);
}

async function buildScreen(cfg, project, prompt, thePlan, screen, ds, c, sharedCSS, shell) {
  const first = sharedCSS == null;
  const label = first ? `Building ${screen.name} and shared styles` : `Building ${screen.name}`;
  c.progress(label, true);
  const content = user(
    P.buildUser({ project, prompt, plan: thePlan, screen, ds, sharedCSS, shell }),
    first ? referenceParts(project, cfg) : [],
  );
  let { text: raw } = await c.call('build', P.BUILD_SYSTEM, content, [], label);
  let blocks = L.parseBlocks(raw);
  let found = pickScreen(blocks, screen.id);
  let problem = !found ? `Your answer did not contain a <forma-screen id="${screen.id}"> block.` : '';
  if (found && S.safeHTML(found.html).length < 10) problem = 'The screen HTML was empty after removing forbidden markup (scripts, styles, event handlers).';
  if (problem) {
    c.onStage?.('repairing', `Repairing ${screen.name}`);
    ({ text: raw } = await c.call('repair', P.BUILD_SYSTEM, content, [
      { role: 'assistant', content: raw },
      { role: 'user', content: `${problem} Return the complete <forma-screen id="${screen.id}" name="${screen.name}"> block${first ? ' and the <forma-css> block' : ''} using only the tagged format.` },
    ]));
    blocks = L.parseBlocks(raw);
    found = pickScreen(blocks, screen.id);
    if (!found || S.safeHTML(found.html).length < 10)
      throw new Error(`GLM did not return the "${screen.name}" screen in the expected format.`);
  }
  return { id: screen.id, name: screen.name, html: found.html, css: blocks.css == null ? null : cleanCSS(blocks.css), cssMode: blocks.cssMode, notes: blocks.notes };
}

async function createWeb(cfg, project, prompt, ctx, direction = null) {
  // One failed screen fails the design: stop its siblings instead of letting
  // them keep the model busy.
  const stop = new AbortController();
  const c = context(cfg, { ...ctx, signal: ctx.signal ? AbortSignal.any([ctx.signal, stop.signal]) : stop.signal });
  const planned = await plan(cfg, project, prompt, c, direction?.hint);
  if (planned.artifact) {
    report(ctx, { mode: 'staged', screens: planned.artifact.screens?.length || 1, preset: planned.artifact.designSystem?.preset || null, direction: direction?.name || null, plan: null });
    return planned.artifact;
  }
  const thePlan = planned.plan;
  const ds = designFor(project, thePlan);
  const [first, ...rest] = thePlan.screens;
  const head = await buildScreen(cfg, project, prompt, thePlan, first, ds, c, null, null);
  let css = head.css || '';
  let done = 1;
  let built;
  try {
    built = await Promise.all(
      rest.map((screen) =>
        buildScreen(cfg, project, prompt, thePlan, screen, ds, c, css, head.html).then((s) => {
          c.progress(`Built ${++done} of ${thePlan.screens.length} screens`, true, { done, total: thePlan.screens.length });
          return s;
        }),
      ),
    );
  } catch (e) {
    stop.abort();
    throw e;
  }
  // Later screens only add rules: a "replace" from one screen must not drop the shared CSS.
  for (const s of built) if (s.css) css = `${css}\n${s.css}`;
  const screens = [head, ...built].map(({ id, name, html }) => ({ id, name, html }));
  css = cleanCSS(css);
  const artifact = S.artifact(
    {
      kind: 'web',
      title: thePlan.title,
      summary: thePlan.summary,
      theme: { accent: ds.accent, background: ds.background, text: ds.text },
      designSystem: ds,
      css,
      screens,
      html: screens[0].html,
      tweaks: usedTweaks(thePlan.tweaks, css, screens),
    },
    'web',
  );
  report(ctx, { mode: 'staged', screens: screens.length, preset: ds.preset, direction: direction?.name || null, plan: { direction: thePlan.direction, facts: thePlan.facts.length } });
  return artifact;
}
function report(ctx, info) {
  if (ctx.metrics) ctx.metrics.pipeline = info;
  ctx.onPipeline?.(info);
}

function applyRevision(current, raw, project = null) {
  const blocks = L.parseBlocks(raw);
  if (!blocks.screens.length && !blocks.removed.length && blocks.css == null && !blocks.meta) {
    let value = null;
    try {
      value = L.extractJSON(raw);
    } catch {}
    if (!looksLikeArtifact(value)) throw new Error('No <forma-screen>, <forma-css>, <forma-remove> or <forma-meta> blocks were returned.');
    return { artifact: validateFull(value, current, project), changed: 'all' };
  }
  const screens = (current.screens || [{ id: 'home', name: 'Home', html: current.html }]).map((s) => ({ ...s }));
  const used = new Set(screens.map((s) => s.id));
  const changed = [];
  for (const id of blocks.removed) {
    const i = screens.findIndex((s) => s.id === id);
    if (i >= 0) screens.splice(i, 1), changed.push(`-${id}`);
  }
  for (const s of blocks.screens) {
    // A block without an id that repeats an existing screen name updates that screen.
    const i = screens.findIndex((x) => (s.id ? x.id === s.id : s.name && x.name === s.name));
    if (i >= 0) {
      screens[i] = { id: screens[i].id, name: s.name || screens[i].name, html: s.html };
      changed.push(screens[i].id);
    } else {
      const id = screenId(s.id || s.name, screens.length, used);
      screens.push({ id, name: text(s.name, 80) || s.id || 'New screen', html: s.html });
      changed.push(id);
    }
  }
  if (!screens.length) throw new Error('A revision cannot remove every screen.');
  let css = current.css || '';
  if (blocks.css != null) css = blocks.cssMode === 'replace' ? cleanCSS(blocks.css) : `${css}\n${cleanCSS(blocks.css)}`.trim();
  const meta = blocks.meta && typeof blocks.meta === 'object' ? blocks.meta : {};
  const ds = revisedDesign(current, project, meta);
  if (ds) changed.push('tokens');
  const artifact = S.artifact(
    {
      ...current,
      ...(ds ? { designSystem: ds, theme: { ...current.theme, accent: ds.accent, background: ds.background, text: ds.text } } : {}),
      title: text(meta.title, 140) || current.title,
      summary: typeof meta.summary === 'string' ? meta.summary.slice(0, 1200) : current.summary,
      css,
      screens,
      html: screens[0].html,
      tweaks: Array.isArray(meta.tweaks) ? normalizeTweaks(meta.tweaks) : current.tweaks,
    },
    'web',
  );
  return { artifact, changed };
}

async function reviseWeb(cfg, project, prompt, current, ctx) {
  const c = context(cfg, ctx);
  c.progress('Revising the design', true);
  const content = user(P.reviseUser({ project, prompt, current, ds: current.designSystem || project.designSystem }), referenceParts(project, cfg));
  let { text: raw } = await c.call('build', P.REVISE_SYSTEM, content, [], 'Revising the design');
  let result;
  try {
    result = applyRevision(current, raw, project);
  } catch (e) {
    c.onStage?.('repairing', 'Repairing the output structure');
    ({ text: raw } = await c.call('repair', P.REVISE_SYSTEM, content, [
      { role: 'assistant', content: raw },
      { role: 'user', content: `The output failed validation: ${e.message}. Return the changed <forma-screen> blocks (complete HTML for each), plus <forma-css> or <forma-remove> blocks if needed.` },
    ]));
    result = applyRevision(current, raw, project);
  }
  if (ctx.metrics) {
    const info = { mode: 'revision', changed: result.changed };
    // A review correction runs as a revision inside the same job: keep the
    // original build summary and record the correction beside it.
    if (ctx.metrics.pipeline?.mode) ctx.metrics.pipeline = { ...ctx.metrics.pipeline, correction: info };
    else ctx.metrics.pipeline = info;
  }
  return result.artifact;
}

async function generate(cfg, project, prompt, current, ctx) {
  return current ? reviseWeb(cfg, project, prompt, current, ctx) : createWeb(cfg, project, prompt, ctx);
}

// element: the selected element's stored outer HTML (`html` is accepted as an alias).
async function editElement(cfg, project, artifact, { screen, element, html: stored, instruction }, ctx) {
  if (typeof element !== 'string') element = stored;
  if (typeof element !== 'string' || !element.trim()) throw new Error('Select an element to edit.');
  const c = context(cfg, ctx);
  const content = user(P.elementUser({ project, artifact, screen, element, instruction }));
  let { text: raw } = await c.call('edit', P.ELEMENT_SYSTEM, content);
  let blocks = L.parseBlocks(raw);
  if (!blocks.element) {
    ({ text: raw } = await c.call('repair', P.ELEMENT_SYSTEM, content, [
      { role: 'assistant', content: raw },
      { role: 'user', content: 'Your answer did not contain a <forma-element> block. Return the complete replacement element inside <forma-element>…</forma-element>.' },
    ]));
    blocks = L.parseBlocks(raw);
    if (!blocks.element) throw new Error('GLM did not return the edited element in the expected format.');
  }
  const html = S.safeHTML(blocks.element);
  if (!html.trim()) throw new Error('GLM returned an element that was empty after removing forbidden markup.');
  const css = blocks.css ? S.safeCSS(cleanCSS(blocks.css)) : '';
  return { html, css, notes: blocks.notes || '' };
}

function presetFor(direction, i) {
  const words = direction.moods || [];
  return PRESETS.find((p) => (p.mood || []).some((m) => words.includes(m))) || PRESETS[i % PRESETS.length];
}

async function directions(cfg, project, prompt, count, ctx) {
  const picks = P.DIRECTIONS.slice(0, Math.max(2, Math.min(P.DIRECTIONS.length, count || 3)));
  const limit = pool(Math.max(1, Math.min(8, cfg.parallel || 3)));
  const infos = [];
  const settled = await Promise.allSettled(
    picks.map((d, i) => {
      const suggested = project.designSystem ? '' : ` Suggested preset: ${presetFor(d, i).id}.`;
      const sub = { ...ctx, limit, onPipeline: (info) => (infos[i] = info), onStage: (s, label) => ctx.onStage?.(s, `${d.name}: ${label}`) };
      return createWeb(cfg, project, prompt, sub, { ...d, hint: d.hint + suggested });
    }),
  );
  if (ctx.signal?.aborted) throw new Error('Cancelled.');
  const results = settled.map((r, i) => (r.status === 'fulfilled' ? { name: picks[i].name, index: i, artifact: r.value, pipeline: infos[i] || null } : null)).filter(Boolean);
  if (ctx.metrics) ctx.metrics.pipeline = { mode: 'directions', directions: results.map((r) => r.name), failed: settled.length - results.length };
  if (!results.length) throw settled[0].reason;
  return { results, failed: settled.filter((r) => r.status === 'rejected').map((r) => r.reason?.message || String(r.reason)) };
}

module.exports = { generate, createWeb, reviseWeb, editElement, directions, applyRevision, normalizePlan, normalizeTweaks, cleanCSS, pool, screenId, designFor, usedTweaks };
