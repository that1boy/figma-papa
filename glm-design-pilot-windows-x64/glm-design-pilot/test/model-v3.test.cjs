'use strict';
// GLM-5.3-Flash adapter (lib/model.cjs) end to end against a scripted mock GLM
// endpoint, plus the prompt contract: everything the prompts promise exists in
// the kit, utilities, icons, charts and runtime.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const M = require('../lib/model.cjs');
const L = require('../lib/llm.cjs');
const P = require('../lib/prompts.cjs');
const S = require('../lib/schema.cjs');
const lint = require('../lib/lint.cjs');
const K = require('../lib/kit.cjs');
const U = require('../lib/utilities.cjs');
const I = require('../lib/icons.cjs');
const C = require('../lib/charts.cjs');
const runtime = require('../lib/design-runtime.cjs');

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfZkAAAAASUVORK5CYII=';
const ref = (name) => ({ name, data: `data:image/png;base64,${png}` });
const system = (body) => body.messages[0].content;
const userText = (body) => {
  const c = body.messages[1].content;
  return typeof c === 'string' ? c : c.filter((x) => x.type === 'text').map((x) => x.text).join('\n');
};
const images = (body) => body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((p) => p.type === 'image_url');

// Scripted OpenAI-compatible endpoint. reply(body, n) returns the assistant
// text, or { status, body } for an HTTP error. stream: answer as SSE chunks
// with a reasoning delta, the way vLLM streams GLM.
async function mockGLM(reply, { stream = false } = {}) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const b of req) raw += b;
    const body = JSON.parse(raw);
    calls.push(body);
    const out = await reply(body, calls.length);
    if (out && typeof out === 'object') {
      res.writeHead(out.status, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(out.body || { error: { message: 'error' } }));
    }
    const usage = { prompt_tokens: 100, completion_tokens: 50, completion_tokens_details: { reasoning_tokens: 20 } };
    if (!stream || !body.stream) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ choices: [{ index: 0, finish_reason: 'stop', message: { content: out } }], usage }));
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    res.write(': keep-alive\n\n');
    send({ choices: [{ index: 0, delta: { reasoning_content: 'Thinking about the layout.' } }] });
    for (let i = 0; i < out.length; i += 700) send({ choices: [{ index: 0, delta: { content: out.slice(i, i + 700) } }] });
    send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    send({ choices: [], usage });
    res.end('data: [DONE]\n\n');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    base: `http://127.0.0.1:${server.address().port}/v1`,
    calls,
    close: () => new Promise((r) => (server.closeAllConnections(), server.close(r))),
  };
}
const configure = (m, env = {}) => M.configFromEnv({ MODEL_MODE: 'glm', GLM_BASE_URL: m.base, GLM_RETRIES: '0', ...env });
const metrics = () => ({ modelCalls: 0, inputTokens: 0, outputTokens: 0 });
const signal = () => new AbortController().signal;

// ---- golden staged generation -------------------------------------------------

const BRIEF = 'Design an access-request tracker for IT. Overview: 18 pending, 42 approved, 2 overdue; pending requests by team: Finance 7, Sales 6, People 5. A request list and a new-request form.';
const PLAN = {
  title: 'Access requests',
  summary: 'IT tracks, filters and files access requests.',
  direction: 'Calm product UI, compact tables',
  preset: 'neutral',
  tokens: { accent: '#0f766e' },
  screens: [
    { id: 'overview', name: 'Overview', purpose: 'See pending work', layout: 'app-shell; stats; chart card', sections: ['18 pending, 42 approved, 2 overdue', 'Pending by team chart'], links: ['requests', 'new-request'] },
    { id: 'requests', name: 'Requests', purpose: 'Find a request', layout: 'app-shell; filterable table', links: ['overview'] },
    { id: 'new-request', name: 'New request', purpose: 'File a request', layout: 'app-shell; form card', links: ['overview'] },
  ],
  facts: ['18 pending', '42 approved', '2 overdue'],
  tweaks: [
    { var: '--sidebar-width', label: 'Sidebar width', min: 200, max: 320, step: 4, unit: 'px', value: 248 },
    { var: '--chart-height', label: 'Chart height', min: 160, max: 360, step: 10, unit: 'px', value: 240 },
    { var: '--never-used', label: 'Unused', min: 0, max: 10, step: 1, unit: 'px', value: 4 },
  ],
};
const nav = (active) =>
  `<aside class="sidebar"><div class="brand"><span class="brand-mark"><i data-icon="key"></i></span>Access</div><nav class="nav" aria-label="Main">${[
    ['overview', 'Overview', 'layout-dashboard'],
    ['requests', 'Requests', 'inbox'],
    ['new-request', 'New request', 'plus'],
  ]
    .map(([id, name, icon]) => `<button class="nav-item${id === active ? ' is-active" aria-current="page' : ''}" data-action="navigate" data-target="${id}"><i data-icon="${icon}"></i>${name}</button>`)
    .join('')}</nav></aside>`;
const SCREENS = {
  overview: `<div class="app-shell">${nav('overview')}<main class="page"><div class="page-header"><div><h1>Access requests</h1><p>Pending work across teams.</p></div><button class="btn btn-primary" data-action="navigate" data-target="new-request"><i data-icon="plus"></i>New request</button></div>
<section class="grid gap-4 sm:grid-cols-3" aria-label="Key figures"><div class="stat"><p class="stat-label"><i data-icon="clock"></i>Pending</p><p class="stat-value tabular-nums">18</p></div><div class="stat"><p class="stat-label"><i data-icon="circle-check"></i>Approved</p><p class="stat-value tabular-nums">42</p></div><div class="stat"><p class="stat-label"><i data-icon="triangle-alert"></i>Overdue</p><p class="stat-value tabular-nums">2</p><p class="stat-delta is-negative">Needs attention</p></div></section>
<section class="card chart-card"><div class="card-header"><h2 class="card-title">Pending by team</h2><span class="badge badge-neutral">This week</span></div><div class="card-body"><figure class="chart" data-chart='{"type":"bar","title":"Pending requests by team","labels":["Finance","Sales","People"],"series":[{"name":"Pending","values":[7,6,5]}]}'></figure></div></section></main></div>`,
  requests: `<div class="app-shell">${nav('requests')}<main class="page"><div class="page-header"><h1>Requests</h1><div class="input-icon w-full max-w-xs"><i data-icon="search"></i><input type="search" aria-label="Filter requests" data-action="filter" data-target="rows"></div></div><section class="card"><table><thead><tr><th scope="col">Request</th><th scope="col">Team</th><th scope="col">Status</th></tr></thead><tbody id="rows"><tr data-row><td data-label="Request">Payroll export access</td><td data-label="Team">Finance</td><td data-label="Status"><span class="badge badge-warning">Pending</span></td></tr><tr data-row><td data-label="Request">CRM admin role</td><td data-label="Team">Sales</td><td data-label="Status"><span class="badge badge-danger">Overdue</span></td></tr></tbody></table></section></main></div>`,
  'new-request': `<div class="app-shell">${nav('new-request')}<main class="page"><div class="page-header"><h1>New request</h1></div><form class="card card-body stack max-w-xl"><div class="field"><label for="system">System</label><input id="system" name="system" type="text" required></div><div class="field"><label for="team">Team</label><select id="team" name="team"><option>Finance</option><option>Sales</option><option>People</option></select></div><div class="cluster"><button type="submit" class="btn btn-primary">Submit request</button><button type="button" class="btn btn-ghost" data-action="navigate" data-target="overview">Cancel</button></div></form></main></div>`,
};
const isPlan = (body) => system(body) === P.PLAN_SYSTEM;
const screenOf = (body) => userText(body).match(/Build screen "([^"]+)"/)?.[1];

test('golden: staged web generation with kit, utilities, icons, a chart and tweaks assembles a valid, lint-clean artifact', async (t) => {
  const m = await mockGLM((body) => {
    if (isPlan(body)) return 'Plan below.\n```json\n' + JSON.stringify(PLAN) + '\n```';
    const id = screenOf(body);
    const css = id === 'overview' ? '<forma-css>\n.chart-card .chart{min-height:var(--chart-height)}\n</forma-css>\n' : '';
    return `${css}<forma-screen id="${id}" name="${id}">\n${SCREENS[id]}\n</forma-screen>`;
  }, { stream: true });
  t.after(m.close);
  const cfg = configure(m);
  assert.equal(cfg.pipeline, 'staged');
  assert.equal(cfg.stream, true);
  const mx = metrics(), stages = [];
  const project = { kind: 'web', brand: 'Teal accent, calm', references: [ref('sketch.png')], history: { briefs: [], omitted: 0 }, sources: [{ name: 'policy.md', text: 'Overdue means older than 5 business days.' }], designSystem: null };
  const a = await M.generate(cfg, project, BRIEF, null, signal(), mx, (s, label) => stages.push(label));

  // Calls: plan (JSON, sees the reference), first screen, then the other two.
  assert.equal(m.calls.length, 4);
  assert.ok(isPlan(m.calls[0]));
  assert.equal(images(m.calls[0]).length, 1);
  assert.ok(m.calls.every((c) => c.stream === true));
  for (const c of m.calls.slice(1)) assert.equal(system(c), P.BUILD_SYSTEM, 'build system prompt is a fixed, cacheable string');
  for (const c of m.calls) {
    assert.doesNotMatch(system(c), /Teal accent|policy\.md/, 'project data stays out of system prompts');
    assert.match(userText(c), /Project brand guidance: Teal accent/);
    assert.match(userText(c), /Source document "policy\.md"/);
  }
  assert.match(userText(m.calls[1]), /--chart-height/, 'first build is told to use the plan tweaks');
  assert.deepEqual(mx.calls.map((c) => c.stage), ['plan', 'build', 'build', 'build']);
  assert.equal(mx.modelCalls, 4);
  assert.equal(mx.reasoningTokens, 80);
  assert.equal(mx.pipeline.mode, 'staged');
  assert.ok(stages.some((s) => /Planning/.test(s)));

  // The artifact validates and round-trips unchanged.
  assert.deepEqual(S.artifact(structuredClone(a), 'web'), a);
  assert.deepEqual(a.screens.map((s) => s.id), ['overview', 'requests', 'new-request']);
  assert.equal(a.designSystem.preset, 'neutral');
  assert.equal(a.designSystem.accent, '#0f766e');
  assert.equal(a.theme.accent, '#0f766e');
  assert.deepEqual(a.tweaks.map((x) => x.var), ['--sidebar-width', '--chart-height'], 'unused tweak dropped, kit and CSS tweaks kept');
  assert.match(a.css, /var\(--chart-height\)/);
  assert.match(a.screens[0].html, /<i data-icon="clock"><\/i>/, 'stored artifacts keep the compact icon form');
  assert.match(a.screens[0].html, /data-chart=/);

  // Deterministic lint finds nothing wrong.
  const findings = lint.staticLint(a);
  assert.deepEqual(findings.filter((f) => f.severity === 'error'), [], lint.findingsPrompt(findings));

  // Page assembly (lib/presentation.cjs): kit tokens, generated utilities, expanded icons and charts.
  const { pageHTML } = require('../lib/presentation.cjs');
  const page = pageHTML(a);
  assert.ok(page.includes('--accent-soft'), 'kit tokens inlined');
  assert.match(page, /\.sm\\:grid-cols-3/, 'generated utility CSS for the classes used');
  assert.match(page, /<svg[^>]*data-forma-expanded="icon"/, 'icons expanded to inline SVG');
  assert.match(page, /data-forma-expanded="chart"/, 'chart figure expanded');
  assert.match(page, /<svg[^>]*role="img"/, 'chart SVG');
  assert.match(page, /--chart-height:\s*240px/, 'tweak defaults reach the page');
  assert.doesNotMatch(page, /<i data-icon/, 'no unexpanded icons left');
});

test('single-call web mode teaches the kit, keeps brand guidance out of the system prompt and repairs once', async (t) => {
  const answer = {
    kind: 'web',
    title: 'Access',
    summary: '',
    theme: { accent: '#0f766e', background: '#ffffff', text: '#111111' },
    css: '',
    screens: [{ id: 'home', name: 'Home', html: SCREENS.requests.replace(/data-target="(overview|new-request)"/g, 'data-target="home"') }],
  };
  const m = await mockGLM((body, n) => (n === 1 ? 'Sorry, no JSON here.' : JSON.stringify(answer)));
  t.after(m.close);
  const cfg = configure(m, { GLM_PIPELINE: 'single', GLM_JSON_MODE: 'true' });
  const mx = metrics();
  const a = await M.generate(cfg, { kind: 'web', brand: 'Teal accent', references: [], history: { briefs: [], omitted: 0 } }, 'Requests list', null, signal(), mx, () => {});
  assert.equal(a.title, 'Access');
  assert.equal(m.calls.length, 2);
  const sys = system(m.calls[0]);
  assert.equal(sys, M.systemPrompt('web'));
  assert.equal(M.systemPrompt('web', 'Any brand'), sys, 'brand parameter is accepted and ignored');
  assert.doesNotMatch(sys, /Teal accent|Do not output JavaScript, inline styles, SVG/);
  for (const piece of ['btn-primary', 'data-icon', 'data-chart', 'app-shell', 'Tailwind', 'data-action="navigate"']) assert.ok(sys.includes(piece), piece);
  assert.match(userText(m.calls[0]), /Project brand guidance: Teal accent/);
  assert.equal(m.calls[0].response_format.type, 'json_object');
  // The 0.2 repair message, byte for byte (including its double full stop).
  assert.equal(m.calls[1].messages.at(-1).content, 'The output failed validation: The model did not return valid JSON.. Return the complete corrected JSON object. Keep the intended design and facts.');
  assert.equal(m.calls[1].messages.at(-2).content, 'Sorry, no JSON here.');
  assert.deepEqual(mx.calls.map((c) => c.stage), ['build', 'repair']);
  assert.equal(mx.pipeline.mode, 'single');
});

test('documents and slides keep the one-call JSON path even when the pipeline is staged', async (t) => {
  const doc = { kind: 'document', title: 'Access policy', theme: { accent: '#275DAD', background: '#ffffff', text: '#202333' }, blocks: [{ type: 'paragraph', text: 'Overdue means older than 5 business days.' }] };
  const m = await mockGLM(() => '<think>check facts</think>' + JSON.stringify(doc));
  t.after(m.close);
  const cfg = configure(m);
  const a = await M.generate(cfg, { kind: 'document', references: [], sources: [{ name: 'p.txt', text: 'Overdue: 5 days' }] }, 'Write it', null, signal(), metrics(), () => {});
  assert.equal(a.blocks[0].text, doc.blocks[0].text);
  assert.equal(m.calls.length, 1);
  assert.match(system(m.calls[0]), /^You create useful, editable internal document artifacts/);
  assert.match(userText(m.calls[0]), /Source document "p\.txt"/);
});

// ---- critique -------------------------------------------------------------------

const BROKEN = {
  kind: 'web',
  title: 'Broken',
  summary: '',
  theme: { accent: '#0f766e', background: '#ffffff', text: '#111111' },
  css: '',
  screens: [
    { id: 'home', name: 'Home', html: '<main class="page"><h1>Home</h1><button class="btn" data-action="navigate" data-target="settings">Settings</button><input type="text" name="q"></main>' },
    { id: 'about', name: 'About', html: '<main class="page"><h1>About</h1><button class="btn" data-action="navigate" data-target="home">Back</button></main>' },
  ],
  html: '',
};
BROKEN.html = BROKEN.screens[0].html;
const reviewReply = (issues = ['The heading does not name the brief\'s product.']) => JSON.stringify({ issues, summary: 'Checked.' });

test('critique merges deterministic lint errors and, with vision off, reviews text only', async (t) => {
  const m = await mockGLM(() => reviewReply());
  t.after(m.close);
  const cfg = configure(m, { GLM_VISION: 'off' });
  const mx = metrics();
  const render = {
    screenshots: [png, png],
    views: ['Home desktop', 'Home mobile'],
    pageCount: 2,
    metrics: {
      horizontalOverflow: false,
      screenMetrics: [{ desktop: { height: 900, bulky: 'x'.repeat(5000) } }],
      lint: [{ rule: 'contrast', severity: 'error', screen: 'home', viewport: 'mobile', target: 'p.lead', message: 'Text contrast 2.1:1 is below 4.5:1.' }],
      lintScore: { score: 80, counts: { error: 1, warning: 0, info: 0 } },
    },
  };
  const review = await M.critique(cfg, { references: [ref('r.png')] }, 'Review', BROKEN, render, signal(), mx);
  assert.equal(m.calls.length, 1);
  assert.equal(images(m.calls[0]).length, 0, 'no screenshots or references when vision is off');
  assert.match(system(m.calls[0]), /^You check artifacts/);
  const text = userText(m.calls[0]);
  assert.match(text, /Screenshots are not available/);
  assert.match(text, /Lint findings \(\d+ errors/);
  assert.match(text, /nav-target/);
  assert.match(text, /"horizontalOverflow":false/);
  assert.doesNotMatch(text, /screenMetrics|bulky|lintScore":\{"score":80,"counts":\{"error":1,"warning":0,"info":0\}\},"lint"/);
  assert.doesNotMatch(text, /"lint":\[/, 'page lint is summarised, not embedded as JSON');
  assert.equal(review.issues[0], "The heading does not name the brief's product.");
  assert.ok(review.issues.some((s) => /^Lint: Navigation target "settings" is not a screen/.test(s)), review.issues.join('\n'));
  assert.ok(review.issues.some((s) => /^Lint: Text contrast 2\.1:1/.test(s) && /mobile/.test(s)));
  assert.ok(review.issues.some((s) => /^Lint: Input type="text" name="q" has no label/.test(s)));
  assert.ok(review.issues.filter((s) => s.startsWith('Lint:')).length <= 8);
  assert.equal(review.scope, 'content-only');
  assert.equal(review.pagesReviewed, 0);
  assert.equal(review.pageCount, 2);
  assert.equal(review.visual, 'disabled');
  assert.ok(review.lint.error >= 3 && review.lint.merged >= 3, JSON.stringify(review.lint));
  assert.deepEqual(mx.calls.map((c) => c.stage), ['review']);
  assert.equal(m.calls[0].reasoning_effort, 'low');
});

test('critique caps screenshots plus references at GLM_MAX_IMAGES per call', async (t) => {
  const m = await mockGLM(() => reviewReply([]));
  t.after(m.close);
  const shots = (n) => ({ screenshots: Array(n).fill(png), views: Array.from({ length: n }, (_, i) => `View ${i}`), pageCount: n, metrics: {} });
  const starter = structuredClone(BROKEN);
  starter.screens[0].html = '<main class="page"><h1>Home</h1><button class="btn" data-action="navigate" data-target="about">About</button></main>';
  starter.html = starter.screens[0].html;

  let review = await M.critique(configure(m, { GLM_MAX_IMAGES: '6' }), { references: [ref('a.png'), ref('b.png')] }, 'Review', starter, shots(9), signal(), metrics());
  assert.deepEqual(m.calls.map((c) => images(c).length), [6, 6, 3]);
  assert.deepEqual(m.calls[0].messages[1].content.map((p) => p.type), ['text', 'image_url', 'image_url', 'image_url', 'image_url', 'text', 'image_url', 'text', 'image_url'], 'screenshots first, then labelled references');
  assert.match(userText(m.calls[2]), /View 8/);
  assert.equal(review.pagesReviewed, 9);
  assert.equal(review.scope, 'content-and-visual');
  assert.equal(review.batches, 3);
  assert.deepEqual(review.issues, []);

  m.calls.length = 0;
  review = await M.critique(configure(m, { GLM_MAX_IMAGES: '2' }), { references: [ref('a.png')] }, 'Review', starter, shots(5), signal(), metrics());
  assert.deepEqual(m.calls.map((c) => images(c).length), [2, 2, 1], 'screenshots first; no room left for the reference');
  assert.equal(review.referencesOmitted, 1);
  assert.equal(review.pagesReviewed, 5);

  m.calls.length = 0;
  review = await M.critique(configure(m, { GLM_MAX_IMAGES: '0' }), { references: [] }, 'Review', starter, shots(3), signal(), metrics());
  assert.deepEqual(m.calls.map((c) => images(c).length), [0]);
  assert.equal(review.scope, 'content-only');
});

test('critique reports content-only scope when the endpoint rejects images (vision auto fallback)', async (t) => {
  const m = await mockGLM((body) => (images(body).length ? { status: 400, body: { error: { message: 'image input not supported' } } } : reviewReply()));
  t.after(m.close);
  const cfg = configure(m);
  const render = { screenshots: Array(9).fill(png), views: [], pageCount: 9, metrics: {} };
  const review = await M.critique(cfg, { references: [] }, 'Review', BROKEN, render, signal(), metrics());
  assert.deepEqual(m.calls.map((c) => images(c).length), [4, 0], 'one image-free retry, then no further batches');
  assert.equal(review.pagesReviewed, 0);
  assert.equal(review.scope, 'content-only');
  assert.equal(review.visual, 'unavailable');
  assert.ok(review.issues.some((s) => s.startsWith('Lint:')));
  assert.equal(L.visionSupported(cfg), false);
  m.calls.length = 0;
  await M.critique(cfg, { references: [] }, 'Review', BROKEN, render, signal(), metrics());
  assert.deepEqual(m.calls.map((c) => images(c).length), [0], 'a known text-only endpoint gets a single text review');
});

test('critique keeps working when the reviewer returns more than 12 issues and rejects malformed answers', async (t) => {
  let answer = JSON.stringify({ issues: Array.from({ length: 15 }, (_, i) => `Issue ${i}`), summary: 's' });
  const m = await mockGLM(() => answer);
  t.after(m.close);
  const ok = structuredClone(BROKEN);
  ok.screens[0].html = '<main class="page"><h1>Home</h1><button class="btn" data-action="navigate" data-target="about">About</button></main>';
  const review = await M.critique(configure(m), { references: [] }, 'Review', ok, null, signal(), metrics());
  assert.equal(review.issues.length, 12);
  assert.equal(review.scope, 'content-only');
  answer = JSON.stringify({ issues: [1, 2] });
  await assert.rejects(M.critique(configure(m), { references: [] }, 'Review', ok, null, signal(), metrics()), /Invalid visual-review response/);
});

// ---- 0.2 shims and wrappers -------------------------------------------------------

test('completion() is a thin llm.chat shim that keeps the 0.2 request body and records stage test', async (t) => {
  const m = await mockGLM(() => 'connected');
  t.after(m.close);
  const cfg = configure(m, { GLM_REASONING_EFFORT: 'max', GLM_JSON_MODE: 'true', GLM_STREAM: 'false' });
  const mx = metrics();
  assert.equal(await M.completion({ ...cfg, maxTokens: 2048 }, [{ role: 'user', content: 'Reply with the word connected.' }], signal(), mx), 'connected');
  const body = m.calls[0];
  assert.equal(body.reasoning_effort, 'max');
  assert.equal(body.max_tokens, 2048);
  assert.equal(body.response_format.type, 'json_object');
  assert.equal(body.stream, false);
  assert.deepEqual(body.messages, [{ role: 'user', content: 'Reply with the word connected.' }]);
  assert.equal(mx.modelCalls, 1);
  assert.equal(mx.calls[0].stage, 'test');
  await M.completion(cfg, [{ role: 'user', content: 'x' }], signal(), mx, 'review');
  assert.equal(m.calls[1].reasoning_effort, 'low', 'other stages use their configured effort');
  assert.equal(mx.calls[1].stage, 'review');
});

test('configFromEnv returns the extended llm configuration and keeps 0.2 validation messages', () => {
  const cfg = M.configFromEnv({ MODEL_MODE: 'glm', GLM_BASE_URL: 'http://model/v1', GLM_VISION: 'off', GLM_MAX_IMAGES: '3', GLM_PIPELINE: 'single' });
  assert.equal(cfg.vision, 'off');
  assert.equal(cfg.maxImages, 3);
  assert.equal(cfg.pipeline, 'single');
  assert.equal(cfg.effort.review, 'low');
  assert.equal(M.configFromEnv({}).mode, 'demo');
  assert.throws(() => M.configFromEnv({ MODEL_MODE: 'glm', GLM_BASE_URL: 'http://model/v1', GLM_VISION: 'maybe' }), /GLM_VISION must be auto, on, or off/);
  assert.throws(() => M.configFromEnv({ MODEL_MODE: 'glm', GLM_BASE_URL: 'http://model/v1', GLM_REASONING_EFFORT: 'medium' }), { message: 'GLM_REASONING_EFFORT must be low, high, or max.' });
});

test('editElement and directions are exposed for the server as positional wrappers', async (t) => {
  const current = { kind: 'web', title: 'Desk', summary: '', theme: { accent: '#0f766e', background: '#ffffff', text: '#111111' }, css: '', screens: [{ id: 'home', name: 'Home', html: SCREENS.requests }], html: SCREENS.requests };
  const m = await mockGLM((body) => {
    if (system(body).includes('ELEMENT EDIT MODE')) return '<forma-element><h1 class="text-3xl">All requests</h1></forma-element>';
    if (isPlan(body)) return JSON.stringify({ ...PLAN, title: 'Direction ' + userText(body).match(/Direction ([A-D])/)[1], preset: userText(body).match(/Suggested preset: ([a-z]+)/)[1], screens: [PLAN.screens[1]] });
    return `<forma-screen id="requests">${SCREENS.requests.replace(/data-target="(overview|new-request)"/g, 'data-target="requests"')}</forma-screen>`;
  });
  t.after(m.close);
  const cfg = configure(m);
  const mx = metrics();
  const edit = await M.editElement(cfg, { kind: 'web', references: [] }, current, { screen: 'home', element: '<h1>Requests</h1>', instruction: 'Clearer heading' }, signal(), mx);
  assert.deepEqual(edit, { html: '<h1 class="text-3xl">All requests</h1>', css: '', notes: '' });
  assert.equal(mx.calls[0].stage, 'edit');
  const labels = [];
  const out = await M.directions(cfg, { kind: 'web', references: [], designSystem: null }, 'Explore', 2, signal(), mx, (s, label) => labels.push(label));
  assert.deepEqual(out.results.map((r) => r.artifact.title).sort(), ['Direction A', 'Direction B']);
  assert.deepEqual(out.results.map((r) => r.pipeline.preset).sort(), ['bold', 'neutral']);
  assert.equal(mx.pipeline.mode, 'directions');
  assert.ok(labels.some((l) => /^Clear and calm: /.test(l)));
  // The spec's ctx-object form works too (server.cjs calls it that way).
  const viaCtx = await M.editElement(cfg, { kind: 'web', references: [] }, current, { screen: 'home', element: '<h1>Requests</h1>', instruction: 'x' }, { signal: signal(), metrics: mx });
  assert.equal(viaCtx.html, edit.html);
  const viaCtx2 = await M.directions(cfg, { kind: 'web', references: [] }, 'Explore', 2, { signal: signal(), metrics: mx, onStage: () => {} });
  assert.equal(viaCtx2.results.length, 2);
  assert.equal(mx.calls.filter((c) => c.stage === 'edit').length, 2);
});

// ---- prompt contract ----------------------------------------------------------------

test('prompts only promise classes, icons, chart types, actions and tokens that exist', () => {
  const kit = new Set(K.KIT_CLASSES);
  const blocks = L.parseBlocks(P.EXAMPLE);
  const own = new Set([...String(blocks.css).matchAll(/\.([a-z][\w-]*)/g)].map((x) => x[1]));
  const classes = [...U.collectClasses(`${P.BUILD_SYSTEM}\n${P.PLAN_SYSTEM}\n${M.systemPrompt('web').replace(/\\"/g, '"')}\n${P.REVISE_SYSTEM}`)].filter((c) => !kit.has(c) && !own.has(c));
  assert.deepEqual(U.classifyClasses(classes).unknown, [], 'every class in the prompts is a kit class or a supported utility');
  const mentioned = ['btn-primary', 'btn-secondary', 'btn-ghost', 'app-shell', 'sidebar', 'topbar', 'page', 'page-header', 'card-title', 'num', 'is-active', 'icon-tile', 'chart', 'tab', 'tabs-pill', 'hero', 'badge-success'];
  for (const c of mentioned) assert.ok(kit.has(c), `kit class ${c}`);
  // Class names the kit reference names in prose (not only in class="" examples), including
  // "badge-success|warning|danger" shorthand, are kit classes or supported utilities.
  const prose = K.KIT_REFERENCE.replace(/<[^>]*>/g, ' ').replace(/--[a-z0-9-]+/g, ' ');
  const shorthand = [...prose.matchAll(/\b([a-z]+-)([a-z]+(?:\|[a-z-]+)+)/g)].flatMap((m) => m[2].split('|').map((s) => (s.startsWith(m[1]) ? s : m[1] + s)));
  const words = new Set(['hand-written', 'max-width', 'auto-fit', 'pre-styled', 'long-form', 'right-aligned', 'right-aligns', 'aria-label', 'data-label', 'data-chart', 'aria-selected', 'aria-current', 'aria-pressed']);
  const named = [...new Set([...prose.split(/[\s·|,;:()+>…=.]+/).filter((w) => /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(w)), ...shorthand])].filter((w) => !kit.has(w) && !words.has(w));
  assert.deepEqual(U.classifyClasses(named).unknown, [], 'every class the kit reference names exists');
  assert.deepEqual(U.classifyClasses(['text-muted', 'tabular-nums', 'bg-surface', 'bg-accent-soft', 'text-accent-strong', 'size-4', 'size-5', 'min-w-0', 'sm:grid-cols-2', 'md:grid-cols-3', 'lg:grid-cols-4']).unknown, []);

  const names = new Set(I.iconNames());
  const icons = [...P.BUILD_SYSTEM.matchAll(/data-icon="([^"]+)"/g)].map((x) => x[1]).filter((n) => n !== 'name');
  for (const n of [...icons, ...I.ICON_PROMPT_NAMES]) assert.ok(names.has(n), `icon ${n}`);

  const types = P.CHARTS.match(/Types: ([^.]+)\./)[1].split(', ');
  assert.deepEqual(types, C.CHART_TYPES);
  for (const spec of [...P.BUILD_SYSTEM.matchAll(/data-chart='([^']+)'/g)].map((x) => x[1])) assert.doesNotThrow(() => C.validateChart(spec), spec);

  const source = runtime.INTERACTIONS;
  const actions = new Set([...`${P.BUILD_SYSTEM}${M.systemPrompt('web')}`.matchAll(/data-action="([a-z]+)"/g)].map((x) => x[1]));
  assert.deepEqual([...actions].sort(), ['close', 'filter', 'navigate', 'open', 'tab', 'toggle']);
  for (const a of actions) assert.ok(source.includes(`'${a}'`), `runtime implements ${a}`);

  const vars = new Set(Object.keys(K.tokenVars(K.normalizeTokens({}))));
  const kitCSS = K.kitCSS({});
  // Plan-specific tweak examples and generic placeholders in the reference text.
  const examples = ['--aside-width', '--hero-min-height', '--name', '--header-h', '--token'];
  for (const v of new Set([...`${P.BUILD_SYSTEM}${P.PLAN_SYSTEM}`.matchAll(/var\((--[a-z0-9-]+)\)|(--[a-z][a-z0-9-]+)/g)].map((x) => x[1] || x[2])))
    if (!examples.includes(v)) assert.ok(vars.has(v) || kitCSS.includes(`var(${v}`), `token ${v}`);
  for (const v of ['--sidebar-width', '--container', '--page-max', '--grid-min']) assert.ok(kitCSS.includes(`var(${v}`), `kit reads ${v}`);
});

test('the exemplar answer is lint-clean and system prompts stay within budget', () => {
  const blocks = L.parseBlocks(P.EXAMPLE);
  assert.equal(blocks.screens.length, 1);
  assert.equal(blocks.notes, '');
  const stub = (id) => ({ id, name: id, html: `<main><h1>${id}</h1><button data-action="navigate" data-target="requests">Requests</button></main>` });
  const a = S.artifact({ kind: 'web', title: 'Example', css: blocks.css, screens: [{ id: 'requests', name: 'Requests', html: blocks.screens[0].html }, stub('overview'), stub('request-detail')] }, 'web');
  assert.deepEqual(lint.staticLint(a), [], lint.findingsPrompt(lint.staticLint(a)));
  assert.doesNotThrow(() => S.safeCSS(blocks.css));
  const tokens = (s) => Math.round(s.length / 3.5);
  assert.ok(tokens(P.BUILD_SYSTEM) < 9000, `BUILD_SYSTEM ~${tokens(P.BUILD_SYSTEM)} tokens`);
  assert.ok(tokens(P.PLAN_SYSTEM) < 2500, `PLAN_SYSTEM ~${tokens(P.PLAN_SYSTEM)} tokens`);
  assert.ok(tokens(M.systemPrompt('web')) < 7000, `single-call web prompt ~${tokens(M.systemPrompt('web'))} tokens`);
  for (const s of [P.REVISE_SYSTEM, P.ELEMENT_SYSTEM]) assert.ok(s.startsWith(P.BUILD_SYSTEM), 'revise/element prompts share the build prefix for caching');
  assert.ok(P.REVIEW_SYSTEM.startsWith('You check artifacts'));
  // The parse-able plan example in PLAN_SYSTEM is valid JSON that normalizes cleanly.
  const plan = L.extractJSON(P.PLAN_SYSTEM.slice(P.PLAN_SYSTEM.indexOf('{"title"')));
  assert.equal(require('../lib/pipeline.cjs').normalizePlan(plan, 'x').screens[0].id, 'overview');
});
