'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const M = require('../lib/model.cjs');
const L = require('../lib/llm.cjs');
const pipeline = require('../lib/pipeline.cjs');

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfZkAAAAASUVORK5CYII=';

// A scripted OpenAI-compatible endpoint. `reply(body, calls)` returns the
// assistant content for each request; requests are recorded with timings.
async function mockModel(reply, { delay = 0 } = {}) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const b of req) raw += b;
    const body = JSON.parse(raw);
    const call = { body, start: Date.now() };
    calls.push(call);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    let content;
    try {
      content = await reply(body, calls);
    } catch (e) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ error: e.message }));
    }
    call.end = Date.now();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const cfg = L.extendConfig(
    M.configFromEnv({ MODEL_MODE: 'glm', GLM_BASE_URL: `http://127.0.0.1:${server.address().port}/v1` }),
    { GLM_STREAM: 'false', GLM_RETRIES: '0', GLM_PARALLEL: '3' },
  );
  return { cfg, calls, close: () => new Promise((r) => (server.closeAllConnections(), server.close(r))) };
}

const system = (body) => body.messages[0].content;
const userText = (body) => {
  const c = body.messages[1].content;
  return typeof c === 'string' ? c : c.filter((x) => x.type === 'text').map((x) => x.text).join('\n');
};
const isPlan = (body) => system(body).startsWith('You are the design lead');
const isRevision = (body) => system(body).includes('REVISION MODE');
const isElement = (body) => system(body).includes('ELEMENT EDIT MODE');
const screenOf = (body) => userText(body).match(/Build screen "([^"]+)"/)?.[1];

const PLAN = {
  title: 'Service desk',
  summary: 'Track and resolve employee requests.',
  direction: 'Calm, precise, data-forward',
  preset: 'unknown-preset-falls-back',
  tokens: { accent: '#0f766e' },
  screens: [
    { id: 'Overview', name: 'Overview', purpose: 'See open work', layout: 'sidebar shell', sections: ['KPIs'], links: ['requests'] },
    { id: 'requests', name: 'Requests', purpose: 'Filter requests', sections: ['table'] },
    { id: 'new', name: 'New request', purpose: 'Submit', sections: ['form'] },
  ],
  facts: ['12 open requests'],
  tweaks: [{ var: '--sidebar-width', label: 'Sidebar', min: 200, max: 320, step: 4, unit: 'px', value: 248 }, { var: 'bad name', min: 1, max: 2 }],
};
const screenHTML = (id) =>
  `<div class="app-shell"><nav class="sidebar"><button class="nav-item" data-action="navigate" data-target="overview">Overview</button></nav><main class="p-6"><h1 class="text-2xl font-semibold">${id} screen</h1><i data-icon="search"></i><script>alert(1)</script></main></div>`;

function project(extra = {}) {
  return { kind: 'web', brand: 'Teal accent', references: [{ name: 'ref.png', data: png }], history: { briefs: [{ prompt: 'Service desk for IT' }], omitted: 0 }, designSystem: null, ...extra };
}
const ctx = (metrics = { modelCalls: 0, inputTokens: 0, outputTokens: 0 }) => ({ signal: new AbortController().signal, metrics, onStage: () => {} });

test('staged web generation plans, builds the first screen, then the rest in parallel', async (t) => {
  const m = await mockModel(
    (body) => {
      if (isPlan(body)) return '<think>planning</think>Here is the plan: ' + JSON.stringify(PLAN);
      const id = screenOf(body);
      const css = id === 'overview' ? '<forma-css>.app-shell{display:grid;grid-template-columns:var(--sidebar-width) 1fr} /* note */ .hero{background:url(http://evil/x.png) red;color:red}</forma-css>' : '<forma-css mode="append">.extra-' + id + '{gap:8px}</forma-css>';
      return `${css}\n<forma-screen id="${id}" name="x">\n\`\`\`html\n${screenHTML(id)}\n\`\`\`\n</forma-screen>`;
    },
    { delay: 120 },
  );
  t.after(m.close);
  const metrics = { modelCalls: 0, inputTokens: 0, outputTokens: 0 };
  const a = await pipeline.generate(m.cfg, project(), 'Design the service desk', null, ctx(metrics));
  assert.equal(m.calls.length, 4);
  assert.ok(isPlan(m.calls[0].body));
  assert.equal(m.calls[0].body.messages[1].content[1].image_url.url, png, 'plan sees the reference');
  assert.equal(a.screens.map((s) => s.id).join(), 'overview,requests,new');
  assert.equal(a.html, a.screens[0].html);
  assert.doesNotMatch(a.screens[0].html, /script|alert/);
  assert.match(a.screens[1].html, /data-icon="search"/);
  assert.doesNotMatch(a.css, /url\(|\/\*/);
  assert.match(a.css, /\.extra-requests\{gap:8px\}/);
  assert.match(a.css, /\.extra-new\{gap:8px\}/);
  assert.equal(a.designSystem.accent, '#0f766e');
  assert.deepEqual(a.tweaks.map((x) => x.var), ['--sidebar-width']);
  // Screens 2 and 3 receive the shared CSS and shell, and run concurrently.
  const [, first, second, third] = m.calls;
  assert.match(userText(second.body), /Shared CSS already written/);
  assert.match(userText(second.body), /First screen HTML/);
  assert.equal(second.body.messages[1].content.filter((x) => x.type === 'image_url').length, 0);
  assert.ok(second.start >= first.end && third.start < second.end, 'later screens overlap');
  assert.equal(metrics.modelCalls, 4);
  assert.equal(metrics.pipeline.mode, 'staged');
});

test('a model that answers the plan with a complete artifact is accepted in one call', async (t) => {
  const artifact = { kind: 'web', title: 'Direct', summary: '', theme: { accent: '#123456' }, html: '<main><h1>Direct answer</h1></main>', css: '' };
  const m = await mockModel(() => JSON.stringify(artifact));
  t.after(m.close);
  const a = await pipeline.generate(m.cfg, project(), 'Quick page', null, ctx());
  assert.equal(m.calls.length, 1);
  assert.equal(a.title, 'Direct');
});

test('missing screen blocks trigger one repair, then a clear error', async (t) => {
  const plan = { ...PLAN, screens: [PLAN.screens[0]] };
  let builds = 0;
  const m = await mockModel((body) => {
    if (isPlan(body)) return JSON.stringify(plan);
    builds++;
    return builds === 1 ? 'Sorry, here is some prose.' : `<forma-screen id="overview" name="Overview">${screenHTML('overview')}</forma-screen>`;
  });
  t.after(m.close);
  const a = await pipeline.generate(m.cfg, project(), 'One screen', null, ctx());
  assert.equal(builds, 2);
  assert.equal(a.screens.length, 1);

  const bad = await mockModel((body) => (isPlan(body) ? JSON.stringify(plan) : 'still prose'));
  t.after(bad.close);
  await assert.rejects(pipeline.generate(bad.cfg, project(), 'One screen', null, ctx()), /did not return the "Overview" screen/);
});

const CURRENT = {
  kind: 'web',
  title: 'Desk',
  summary: 'Original',
  theme: { accent: '#0f766e', background: '#ffffff', text: '#111111' },
  css: '.a{color:red}',
  screens: [
    { id: 'one', name: 'One', html: '<main><h1>Screen one</h1><p>Keep me exactly.</p></main>' },
    { id: 'two', name: 'Two', html: '<main><h1>Screen two</h1></main>' },
    { id: 'three', name: 'Three', html: '<main><h1>Screen three</h1></main>' },
  ],
  html: '<main><h1>Screen one</h1><p>Keep me exactly.</p></main>',
};

test('revisions return changed screens only and keep the rest byte-identical', async (t) => {
  const m = await mockModel(() =>
    'I changed screen two.\n<forma-screen id="two" name="Two v2"><main><h1>Screen two, revised</h1></main></forma-screen>\n<forma-remove id="three"></forma-remove>\n<forma-screen id="four" name="Four"><main><h1>New</h1></main></forma-screen>\n<forma-css mode="append">.b{color:blue}</forma-css>\n<forma-meta>{"summary":"Updated"}</forma-meta>',
  );
  t.after(m.close);
  const metrics = { modelCalls: 0, inputTokens: 0, outputTokens: 0 };
  const a = await pipeline.generate(m.cfg, project(), 'Revise two, drop three, add four', structuredClone(CURRENT), ctx(metrics));
  assert.equal(m.calls.length, 1);
  assert.ok(isRevision(m.calls[0].body));
  assert.match(userText(m.calls[0].body), /Keep me exactly/);
  assert.equal(a.screens[0].html, CURRENT.screens[0].html);
  assert.deepEqual(a.screens.map((s) => s.id), ['one', 'two', 'four']);
  assert.equal(a.screens[1].name, 'Two v2');
  assert.equal(a.css, '.a{color:red}\n.b{color:blue}');
  assert.equal(a.summary, 'Updated');
  assert.deepEqual(metrics.pipeline.changed, ['-three', 'two', 'four']);
});

test('a revision answered with a full JSON artifact still works', async (t) => {
  const answer = { ...structuredClone(CURRENT), title: 'Whole thing' };
  const m = await mockModel(() => JSON.stringify(answer));
  t.after(m.close);
  const a = await pipeline.generate(m.cfg, project(), 'Retitle', structuredClone(CURRENT), ctx());
  assert.equal(a.title, 'Whole thing');
  assert.equal(m.calls.length, 1);
});

test('element edits return sanitized replacement markup and CSS only', async (t) => {
  const m = await mockModel((body) => {
    assert.ok(isElement(body));
    assert.match(userText(body), /Selected element \(stored HTML\):\n<h1>Screen two<\/h1>/);
    return '<forma-element><h1 class="text-3xl" onclick="steal()">Screen two <em>now</em><script>x()</script></h1></forma-element><forma-css mode="append">.text-3xl{letter-spacing:-.02em} .x{background:url(javascript:1)}</forma-css>';
  });
  t.after(m.close);
  const out = await pipeline.editElement(m.cfg, project(), structuredClone(CURRENT), { screen: 'two', element: '<h1>Screen two</h1>', instruction: 'Make it larger' }, ctx());
  assert.equal(out.html, '<h1 class="text-3xl">Screen two <em>now</em></h1>');
  assert.match(out.css, /letter-spacing/);
  assert.doesNotMatch(out.css, /url/);
});

test('directions build distinct variants in parallel and tolerate one failure', async (t) => {
  let plans = 0;
  const m = await mockModel((body) => {
    if (isPlan(body)) {
      plans++;
      const hint = userText(body).match(/Direction ([A-D])/)[1];
      if (hint === 'B') throw new Error('boom');
      return JSON.stringify({ ...PLAN, title: 'Direction ' + hint, screens: [PLAN.screens[0]] });
    }
    return `<forma-screen id="overview" name="Overview">${screenHTML('overview')}</forma-screen>`;
  });
  t.after(m.close);
  const out = await pipeline.directions(m.cfg, project(), 'Explore', 3, ctx());
  assert.equal(plans, 3);
  assert.deepEqual(out.results.map((r) => r.artifact.title).sort(), ['Direction A', 'Direction C']);
  assert.equal(out.failed.length, 1);
});

test('cancellation stops the pipeline', async (t) => {
  const m = await mockModel((body) => (isPlan(body) ? JSON.stringify(PLAN) : `<forma-screen id="${screenOf(body)}">${screenHTML('x')}</forma-screen>`), { delay: 300 });
  t.after(m.close);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(pipeline.generate(m.cfg, project(), 'x', null, { signal: controller.signal, metrics: { modelCalls: 0, inputTokens: 0, outputTokens: 0 }, onStage: () => {} }), /Cancel/);
});

test('cleanCSS drops forbidden constructs without breaking neighbouring rules', () => {
  const css = pipeline.cleanCSS('```css\n.url-box{color:red}/* c */ .a{background:url(x.png) no-repeat;color:blue} @import "x.css"; .b\\{x} @font-face{font-family:x;src:url(y)} .c{width:expression(1)}\n```');
  assert.match(css, /\.url-box\{color:red\}/);
  assert.match(css, /\.a\{color:blue\}/);
  assert.doesNotMatch(css, /url\(|@import|@font-face|expression|\\|\/\*/);
});

test('plan normalization repairs ids and caps screens', () => {
  const plan = pipeline.normalizePlan({ screens: [{ id: '1 Home Page!' }, { name: 'Home Page' }, { id: '1 Home Page!' }, ...Array.from({ length: 20 }, (_, i) => ({ id: 'x' + i }))] }, 'brief');
  assert.equal(plan.screens.length, 12);
  assert.deepEqual(plan.screens.slice(0, 3).map((s) => s.id), ['s-1-home-page', 'home-page', 's-1-home-page-2']);
  assert.equal(pipeline.normalizePlan({}, 'Do a thing').screens[0].id, 'home');
});
