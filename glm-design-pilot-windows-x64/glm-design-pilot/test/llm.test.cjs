'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const L = require('../lib/llm.cjs');

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfZkAAAAASUVORK5CYII=';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MSGS = [
  { role: 'system', content: 'You are a test.' },
  { role: 'user', content: 'Say hi.' },
];
const withImages = (n) => [
  { role: 'system', content: 'sys' },
  { role: 'user', content: [{ type: 'text', text: 'Look.' }, ...Array.from({ length: n }, () => ({ type: 'image_url', image_url: { url: png } }))] },
];
const imagesIn = (body) => body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((p) => p.type === 'image_url').length;
const textIn = (body) => body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [{ text: m.content }])).map((p) => p.text || '').join('\n');

// Mirrors model.configFromEnv() output so these tests do not depend on files
// other modules are editing; one test below checks the real composition.
const baseCfg = (base, over = {}) => ({ mode: 'glm', base, model: 'glm-5.3-flash', key: '', reasoning: 'high', maxTokens: 32768, timeout: 240000, jsonMode: false, extra: {}, ...over });
const cfgFor = (base, env = {}, over = {}) => L.extendConfig(baseCfg(base, over), env);
const noSleep = (log = []) => async (ms) => void log.push(ms);

async function serve(handler) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const b of req) raw += b;
    let body = null;
    try {
      body = JSON.parse(raw);
    } catch {}
    calls.push({ body, headers: req.headers, url: req.url, method: req.method });
    req.socket.setNoDelay(true);
    try {
      await handler(req, res, body, calls.length);
    } catch {
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}/v1`, calls, close: () => new Promise((r) => (server.closeAllConnections(), server.close(r))) };
}
const reply = (res, obj, status = 200, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(typeof obj === 'string' ? obj : JSON.stringify(obj));
};
const completion = (content, { finish = 'stop', usage = { prompt_tokens: 11, completion_tokens: 22 }, message = {} } = {}) => ({
  id: 'x',
  choices: [{ index: 0, finish_reason: finish, message: { role: 'assistant', content, ...message } }],
  usage,
});
const chunk = (delta, finish = null, index = 0) => ({ object: 'chat.completion.chunk', choices: [{ index, delta, finish_reason: finish }] });
const ssePayload = (events, nl = '\n') => events.map((e) => (typeof e === 'string' ? e : `data: ${JSON.stringify(e)}`).split('\n').join(nl) + nl + nl).join('');
async function writeSSE(res, payload, { size = 1 << 20, gap = 0, end = true, type = 'text/event-stream; charset=utf-8' } = {}) {
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  const buf = Buffer.from(payload);
  for (let i = 0; i < buf.length && !res.destroyed; i += size) {
    res.write(buf.subarray(i, i + size));
    await (gap ? sleep(gap) : new Promise((r) => setImmediate(r)));
  }
  if (end) res.end();
}
const simpleStream = (text, extra = []) => ssePayload([chunk({ role: 'assistant', content: '' }), chunk({ content: text }), chunk({}, 'stop'), { choices: [], usage: { prompt_tokens: 3, completion_tokens: 4 } }, ...extra, 'data: [DONE]']);

test.beforeEach(() => L._internal.VISION.clear());

// ---- configuration --------------------------------------------------------

test('extendConfig adds the 0.3 settings with defaults that follow GLM_REASONING_EFFORT', () => {
  const cfg = baseCfg('http://127.0.0.1:9/v1');
  const out = L.extendConfig(cfg, {});
  assert.equal(out, cfg, 'extends the object it is given');
  assert.equal(cfg.stream, true);
  assert.equal(cfg.vision, 'auto');
  assert.equal(cfg.maxImages, 8);
  assert.equal(cfg.retries, 2);
  assert.equal(cfg.structured, false);
  assert.equal(cfg.jsonMode, false);
  assert.equal(cfg.parallel, 3);
  assert.equal(cfg.pipeline, 'staged');
  assert.deepEqual(cfg.effort, { plan: 'high', build: 'high', review: 'low', edit: 'high', repair: 'high', test: 'low' });
  assert.deepEqual(cfgFor('http://x/v1', {}, { reasoning: 'max' }).effort, { plan: 'max', build: 'max', review: 'low', edit: 'max', repair: 'max', test: 'low' });
  const all = cfgFor('http://x/v1', {
    GLM_STREAM: 'false',
    GLM_VISION: 'OFF',
    GLM_MAX_IMAGES: '3',
    GLM_RETRIES: '0',
    GLM_STRUCTURED_OUTPUT: 'true',
    GLM_EFFORT_PLAN: 'max',
    GLM_EFFORT_BUILD: 'low',
    GLM_EFFORT_REVIEW: 'high',
    GLM_EFFORT_EDIT: ' low ',
    GLM_PARALLEL: '5',
    GLM_PIPELINE: 'single',
  });
  assert.deepEqual(
    { stream: all.stream, vision: all.vision, maxImages: all.maxImages, retries: all.retries, structured: all.structured, parallel: all.parallel, pipeline: all.pipeline },
    { stream: false, vision: 'off', maxImages: 3, retries: 0, structured: true, parallel: 5, pipeline: 'single' },
  );
  assert.deepEqual(all.effort, { plan: 'max', build: 'low', review: 'high', edit: 'low', repair: 'low', test: 'low' });
  for (const v of ['1', 'yes', 'on', 'TRUE']) assert.equal(cfgFor('http://x/v1', { GLM_STREAM: v }).stream, true);
  for (const v of ['0', 'no', 'off', 'False']) assert.equal(cfgFor('http://x/v1', { GLM_STREAM: v }).stream, false);
  assert.equal(cfgFor('http://x/v1', { GLM_STREAM: '' }).stream, true, 'empty means default');
  // jsonMode from configFromEnv is kept; a bare cfg reads GLM_JSON_MODE.
  assert.equal(cfgFor('http://x/v1', { GLM_JSON_MODE: 'false' }, { jsonMode: true }).jsonMode, true);
  assert.equal(L.extendConfig({ mode: 'glm', base: 'http://x' }, { GLM_JSON_MODE: 'true' }).jsonMode, true);
});

test('extendConfig rejects invalid values in GLM mode with clear messages and ignores them in demo mode', () => {
  const cases = [
    [{ GLM_STREAM: 'maybe' }, 'GLM_STREAM must be true or false.'],
    [{ GLM_STRUCTURED_OUTPUT: '2' }, 'GLM_STRUCTURED_OUTPUT must be true or false.'],
    [{ GLM_VISION: 'sometimes' }, 'GLM_VISION must be auto, on, or off.'],
    [{ GLM_MAX_IMAGES: '-1' }, 'Invalid GLM_MAX_IMAGES. Use a whole number from 0 to 32.'],
    [{ GLM_MAX_IMAGES: '2.5' }, 'Invalid GLM_MAX_IMAGES. Use a whole number from 0 to 32.'],
    [{ GLM_RETRIES: '9' }, 'Invalid GLM_RETRIES. Use a whole number from 0 to 5.'],
    [{ GLM_RETRIES: 'two' }, 'Invalid GLM_RETRIES. Use a whole number from 0 to 5.'],
    [{ GLM_PARALLEL: '0' }, 'Invalid GLM_PARALLEL. Use a whole number from 1 to 8.'],
    [{ GLM_PIPELINE: 'fast' }, 'GLM_PIPELINE must be staged or single.'],
    [{ GLM_EFFORT_PLAN: 'medium' }, 'GLM_EFFORT_PLAN must be low, high, or max.'],
    [{ GLM_EFFORT_BUILD: 'x' }, 'GLM_EFFORT_BUILD must be low, high, or max.'],
    [{ GLM_EFFORT_REVIEW: 'none' }, 'GLM_EFFORT_REVIEW must be low, high, or max.'],
    [{ GLM_EFFORT_EDIT: 'ultra' }, 'GLM_EFFORT_EDIT must be low, high, or max.'],
  ];
  for (const [env, message] of cases) {
    assert.throws(() => cfgFor('http://x/v1', env), { message });
    const demo = L.extendConfig(baseCfg('', { mode: 'demo' }), env);
    assert.equal(demo.vision, 'auto');
    assert.equal(demo.retries, 2);
    assert.equal(demo.pipeline, 'staged');
    assert.equal(demo.effort.plan, 'high');
  }
});

test('extendConfig composes with model.configFromEnv and chat reproduces completion()', async (t) => {
  const M = require('../lib/model.cjs');
  const s = await serve((req, res, body, n) => (n > 2 ? reply(res, '{"error":"busy"}', 503) : reply(res, completion('{"ok":1}', { usage: { prompt_tokens: 7, completion_tokens: 9 } }))));
  t.after(s.close);
  const env = { MODEL_MODE: 'glm', GLM_BASE_URL: s.base + '/', GLM_API_KEY: 'k-1', GLM_MAX_TOKENS: '4096', GLM_JSON_MODE: 'true', GLM_EXTRA_BODY: '{"chat_template_kwargs":{"a":1}}', GLM_STREAM: 'false', GLM_RETRIES: '0' };
  const cfg = L.extendConfig(M.configFromEnv(env), env);
  const m1 = { modelCalls: 0, inputTokens: 0, outputTokens: 0 };
  const m2 = { modelCalls: 0, inputTokens: 0, outputTokens: 0 };
  const signal = new AbortController().signal;
  const a = await M.completion(cfg, MSGS, signal, m1);
  const b = await L.chat(cfg, MSGS, { signal, metrics: m2, stage: 'build', json: true });
  assert.equal(b.text, a);
  assert.deepEqual(s.calls[1].body, s.calls[0].body, 'same request body as 0.2');
  assert.equal(s.calls[1].url, '/v1/chat/completions');
  assert.equal(s.calls[1].headers.authorization, 'Bearer k-1');
  assert.deepEqual([m2.modelCalls, m2.inputTokens, m2.outputTokens], [m1.modelCalls, m1.inputTokens, m1.outputTokens]);
  const e1 = await M.completion(cfg, MSGS, signal, m1).catch((e) => e);
  const e2 = await L.chat(cfg, MSGS, { signal, metrics: m2 }).catch((e) => e);
  assert.equal(e2.message, e1.message);
  assert.equal(e2.code, 'http');
  const dead = { ...cfg, base: 'http://127.0.0.1:1/v1' };
  const e3 = await M.completion(dead, MSGS, signal, m1).catch((e) => e);
  const e4 = await L.chat(dead, MSGS, { signal }).catch((e) => e);
  assert.equal(e4.message, e3.message);
  assert.equal(e4.code, 'network');
  for (const k of ['model', 'messages', 'stream', 'tools', 'tool_choice'])
    assert.throws(() => M.configFromEnv({ ...env, GLM_EXTRA_BODY: JSON.stringify({ [k]: 1 }) }), { message: `GLM_EXTRA_BODY cannot override ${k}.` });
});

// ---- request bodies -------------------------------------------------------

test('request bodies keep the 0.2 shape with per-stage reasoning effort', async (t) => {
  const s = await serve((req, res) => reply(res, completion('ok')));
  t.after(s.close);
  const cfg = cfgFor(s.base, { GLM_STREAM: 'false', GLM_EFFORT_PLAN: 'max', GLM_EFFORT_BUILD: 'high', GLM_EFFORT_EDIT: 'low' }, { key: 'secret-key', maxTokens: 4096 });
  for (const stage of ['plan', 'build', 'review', 'edit', 'repair', 'test']) await L.chat(cfg, MSGS, { stage });
  assert.deepEqual(s.calls.map((c) => c.body.reasoning_effort), ['max', 'high', 'low', 'low', 'high', 'low']);
  assert.deepEqual(s.calls[0].body, { temperature: 1, top_p: 0.95, reasoning_effort: 'max', max_tokens: 4096, model: 'glm-5.3-flash', messages: MSGS, stream: false });
  assert.equal(s.calls[0].url, '/v1/chat/completions');
  assert.equal(s.calls[0].method, 'POST');
  assert.equal(s.calls[0].headers.authorization, 'Bearer secret-key');
  assert.match(s.calls[0].headers['content-type'], /^application\/json/);
  await L.chat(cfg, MSGS, { stage: 'plan', effort: 'low', maxTokens: 2048, temperature: 0.3 });
  const last = s.calls.at(-1).body;
  assert.deepEqual([last.reasoning_effort, last.max_tokens, last.temperature], ['low', 2048, 0.3]);
  await L.chat(cfg, MSGS, { stage: 'plan', effort: 'bogus' });
  assert.equal(s.calls.at(-1).body.reasoning_effort, 'max', 'invalid per-call effort is ignored');
  // An un-extended 0.2 config still works with spec defaults (stream on, review low).
  await L.chat(baseCfg(s.base), MSGS, { stage: 'review' });
  assert.equal(s.calls.at(-1).body.stream, true);
  assert.deepEqual(s.calls.at(-1).body.stream_options, { include_usage: true });
  assert.equal(s.calls.at(-1).body.reasoning_effort, 'low');
  assert.equal(s.calls.at(-1).headers.authorization, undefined);
});

test('streaming requests send stream_options.include_usage and accept JSON replies', async (t) => {
  const s = await serve((req, res) => reply(res, completion('plain JSON reply')));
  t.after(s.close);
  const cfg = cfgFor(s.base);
  const r = await L.chat(cfg, MSGS, { stage: 'build' });
  assert.equal(r.text, 'plain JSON reply');
  assert.equal(s.calls[0].body.stream, true);
  assert.deepEqual(s.calls[0].body.stream_options, { include_usage: true });
  assert.match(s.calls[0].headers.accept, /text\/event-stream/);
  assert.equal(r.finishReason, 'stop');
  assert.deepEqual(r.usage, { inputTokens: 11, outputTokens: 22, reasoningTokens: 0 });
});

test('response_format variants follow GLM_JSON_MODE and GLM_STRUCTURED_OUTPUT', async (t) => {
  const s = await serve((req, res) => reply(res, completion('{}')));
  t.after(s.close);
  const schema = { type: 'object', properties: { title: { type: 'string' } } };
  const rf = async (env, opts) => {
    // configFromEnv() already turns GLM_JSON_MODE into cfg.jsonMode.
    const cfg = cfgFor(s.base, { GLM_STREAM: 'false', ...env }, { jsonMode: env.GLM_JSON_MODE === 'true' });
    await L.chat(cfg, MSGS, { stage: 'plan', ...opts });
    return s.calls.at(-1).body.response_format;
  };
  assert.deepEqual(await rf({ GLM_JSON_MODE: 'true' }, { json: true }), { type: 'json_object' });
  assert.equal(await rf({ GLM_JSON_MODE: 'true' }, { stage: 'build' }), undefined, 'tagged-block builds never get JSON mode');
  assert.equal(await rf({}, { json: true }), undefined);
  assert.deepEqual(await rf({ GLM_STRUCTURED_OUTPUT: 'true' }, { schema }), { type: 'json_schema', json_schema: { name: 'forma_plan', schema, strict: false } });
  assert.deepEqual((await rf({ GLM_STRUCTURED_OUTPUT: 'true' }, { schema, schemaName: 'my plan!' })).json_schema.name, 'my_plan_');
  assert.deepEqual(await rf({ GLM_JSON_MODE: 'true' }, { schema }), { type: 'json_object' }, 'schema without structured output falls back to JSON mode');
  assert.equal(await rf({ GLM_STRUCTURED_OUTPUT: 'true' }, { json: true }), undefined, 'structured output needs a schema');
});

test('GLM_EXTRA_BODY merges as in 0.2 but cannot override model, messages, stream, tools or tool_choice', async (t) => {
  const s = await serve((req, res) => reply(res, completion('ok')));
  t.after(s.close);
  const extra = {
    temperature: 0.6,
    top_p: 0.8,
    reasoning_effort: 'max',
    response_format: { type: 'text' },
    stream_options: { continuous_usage_stats: true, include_usage: false },
    chat_template_kwargs: { enable_thinking: true },
    model: 'evil',
    messages: [],
    stream: false,
    tools: [{ type: 'function' }],
    tool_choice: 'auto',
  };
  const cfg = cfgFor(s.base, {}, { extra });
  await L.chat(cfg, MSGS, { stage: 'build' });
  let b = s.calls.at(-1).body;
  assert.deepEqual(
    { t: b.temperature, p: b.top_p, e: b.reasoning_effort, so: b.stream_options, k: b.chat_template_kwargs, m: b.model, s: b.stream },
    { t: 0.6, p: 0.8, e: 'max', so: { continuous_usage_stats: true, include_usage: true }, k: { enable_thinking: true }, m: 'glm-5.3-flash', s: true },
  );
  assert.deepEqual(b.messages, MSGS);
  assert.equal('response_format' in b, false, 'a configured response_format only applies to JSON calls');
  assert.equal('tools' in b || 'tool_choice' in b, false);
  await L.chat(cfg, MSGS, { stage: 'plan', json: true, temperature: 0.2, effort: 'low' });
  b = s.calls.at(-1).body;
  assert.deepEqual(b.response_format, { type: 'text' });
  assert.equal(b.temperature, 0.2, 'explicit per-call options win over GLM_EXTRA_BODY');
  assert.equal(b.reasoning_effort, 'low');
  await L.chat(cfgFor(s.base, { GLM_STREAM: 'false' }, { extra }), MSGS, {});
  b = s.calls.at(-1).body;
  assert.equal(b.stream, false);
  assert.equal('stream_options' in b, false, 'stream_options is never sent without stream');
});

// ---- SSE ------------------------------------------------------------------

const AWKWARD = [
  ': keep-alive comment',
  chunk({ role: 'assistant', content: '' }),
  chunk({ reasoning_content: 'Plan the ' }),
  chunk({ reasoning_content: 'layout. ', reasoning: 'Plan the layout. ' }),
  chunk({ reasoning: 'Done.' }),
  'data: {"choices":[{"index":0,\ndata: "delta":{"content":"Héllo 👋 "}}]}',
  chunk({ content: 'IGNORED' }, null, 1),
  ':another comment',
  'event: message\ndata: ' + JSON.stringify(chunk({ content: [{ type: 'text', text: '世界' }] })),
  'id: 7\nretry: 1000\ndata:' + JSON.stringify(chunk({ content: '!' }, 'stop')),
  'data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 9, completion_tokens_details: { reasoning_tokens: 4 } } }),
  'data: [DONE]',
];

for (const [name, nl, size] of [
  ['LF, one byte per write', '\n', 1],
  ['CRLF, one byte per write', '\r\n', 1],
  ['CR only, three bytes per write', '\r', 3],
  ['CRLF, seven bytes per write', '\r\n', 7],
]) {
  test(`SSE stream (${name}) with comments, multi-line data and multi-byte text`, async (t) => {
    const s = await serve((req, res) => writeSSE(res, ssePayload(AWKWARD, nl), { size }));
    t.after(s.close);
    const metrics = { modelCalls: 0, inputTokens: 0, outputTokens: 0 };
    const deltas = [];
    const r = await L.chat(cfgFor(s.base), MSGS, { stage: 'build', metrics, onDelta: (d) => deltas.push(d) });
    assert.equal(r.text, 'Héllo 👋 世界!');
    assert.equal(r.reasoning, 'Plan the layout. Done.');
    assert.equal(r.finishReason, 'stop');
    assert.deepEqual(r.usage, { inputTokens: 5, outputTokens: 9, reasoningTokens: 4 });
    assert.equal(r.imagesDropped, 0);
    assert.equal(metrics.modelCalls, 1);
    assert.equal(metrics.inputTokens, 5);
    assert.equal(metrics.outputTokens, 9);
    assert.equal(metrics.reasoningTokens, 4);
    assert.equal(metrics.calls.length, 1);
    const c = metrics.calls[0];
    assert.deepEqual({ ...c, ms: 0 }, { stage: 'build', ms: 0, inputTokens: 5, outputTokens: 9, reasoningTokens: 4, retries: 0, imagesDropped: 0 });
    assert.ok(c.ms >= 0);
    assert.ok(deltas.length >= 1 && deltas[0].stage === 'build');
  });
}

test('SSE parser handles arbitrary chunking directly, including a CR split from its LF', () => {
  const payload = ssePayload(AWKWARD, '\r\n') + 'data: {"tail":true}';
  for (const step of [1, 2, 5, 13]) {
    const events = [];
    const p = L._internal.sseParser((e) => void events.push(e));
    for (let i = 0; i < payload.length; i += step) p.push(payload.slice(i, i + step));
    p.end();
    assert.equal(events.length, AWKWARD.length - 2 + 1, `step ${step}`);
    assert.equal(events[4].data, '{"choices":[{"index":0,\n"delta":{"content":"Héllo 👋 "}}]}');
    assert.equal(events.at(-2).data, '[DONE]');
    assert.equal(events.at(-1).data, '{"tail":true}', 'a final event without a blank line is still delivered');
  }
  const stopAt = [];
  const p = L._internal.sseParser((e) => (stopAt.push(e.data), e.data === 'stop'));
  p.push('data: a\n\ndata: stop\n\ndata: after\n\n');
  assert.deepEqual(stopAt, ['a', 'stop']);
  assert.equal(p.stopped, true);
  const small = L._internal.sseParser(() => {}, 100);
  assert.throws(() => small.push('data: ' + 'x'.repeat(200)), { code: 'too-large' });
  const many = L._internal.sseParser(() => {}, 100);
  assert.throws(() => many.push('data: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n'.repeat(3)), { code: 'too-large' });
  // A long line delivered one character at a time stays linear.
  const t0 = Date.now();
  const got = [];
  const slow = L._internal.sseParser((e) => void got.push(e.data.length));
  slow.push('data: ');
  for (let i = 0; i < 1000000; i++) slow.push('x');
  slow.push('\r');
  slow.push('\n\r\n');
  assert.deepEqual(got, [1000000]);
  assert.ok(Date.now() - t0 < 2000, `${Date.now() - t0}ms`);
  const tooLong = L._internal.sseParser(() => {}, 1000);
  assert.throws(() => {
    for (let i = 0; i < 2000; i++) tooLong.push('y');
  }, { code: 'too-large' });
  // Lone CR line endings, an event type and an id field.
  const crEvents = [];
  const crp = L._internal.sseParser((e) => void crEvents.push(e));
  crp.push('event: error\rid: 1\rdata: one\rdata: two\r\r: c\rdata: x');
  crp.end();
  assert.deepEqual(crEvents, [
    { event: 'error', data: 'one\ntwo' },
    { event: 'message', data: 'x' },
  ]);
});

test('JSON replies accept content arrays and reasoning_content', async (t) => {
  const s = await serve((req, res) =>
    reply(res, {
      choices: [{ finish_reason: 'stop', message: { content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }, { type: 'image' }], reasoning_content: 'why' } }],
      usage: { prompt_tokens: 1, completion_tokens: 2, completion_tokens_details: { reasoning_tokens: 1 } },
    }),
  );
  t.after(s.close);
  const deltas = [];
  const r = await L.chat(cfgFor(s.base, { GLM_STREAM: 'false' }), MSGS, { onDelta: (d) => deltas.push(d), stage: 'plan' });
  assert.equal(r.text, 'Hello world');
  assert.equal(r.reasoning, 'why');
  assert.deepEqual(deltas, [{ stage: 'plan', contentChars: 11, reasoningChars: 3 }]);
});

test('an SSE body served with a JSON content type is still parsed', async (t) => {
  const s = await serve((req, res) => writeSSE(res, simpleStream('via proxy'), { type: 'application/json' }));
  t.after(s.close);
  const r = await L.chat(cfgFor(s.base), MSGS, {});
  assert.equal(r.text, 'via proxy');
  assert.deepEqual(r.usage, { inputTokens: 3, outputTokens: 4, reasoningTokens: 0 });
});

test('a stream that ends without [DONE] or finish_reason is a dropped connection and is retried', async (t) => {
  const s = await serve((req, res, body, n) => writeSSE(res, n === 1 ? ssePayload([chunk({ content: 'partial' })]) : simpleStream('complete')));
  t.after(s.close);
  const r = await L.chat(cfgFor(s.base), MSGS, { sleep: noSleep() });
  assert.equal(r.text, 'complete');
  assert.equal(r.retries, 1);
  const s2 = await serve((req, res) => writeSSE(res, ssePayload([chunk({ content: 'x' }, 'stop')])));
  t.after(s2.close);
  assert.equal((await L.chat(cfgFor(s2.base), MSGS, {})).text, 'x', 'finish_reason without [DONE] is complete');
});

// ---- retries --------------------------------------------------------------

test('429 with Retry-After is retried after the advertised delay', async (t) => {
  const s = await serve((req, res, body, n) => (n === 1 ? reply(res, '{"error":"slow down"}', 429, { 'Retry-After': '2' }) : writeSSE(res, simpleStream('after retry'))));
  t.after(s.close);
  const sleeps = [];
  const metrics = {};
  const r = await L.chat(cfgFor(s.base), MSGS, { sleep: noSleep(sleeps), metrics, stage: 'review' });
  assert.equal(r.text, 'after retry');
  assert.deepEqual(sleeps, [2000]);
  assert.equal(r.retries, 1);
  assert.equal(s.calls.length, 2);
  assert.equal(metrics.modelCalls, 1, 'only the completed request counts');
  assert.equal(metrics.calls[0].retries, 1);
  assert.equal(metrics.calls[0].stage, 'review');
});

test('retryable statuses back off 1s then 3s, cap Retry-After at 20s and keep the 0.2 message', async (t) => {
  let status = 503,
    after = null;
  const s = await serve((req, res) => reply(res, '{"error":"unavailable"}', status, after ? { 'Retry-After': after } : {}));
  t.after(s.close);
  const cfg = cfgFor(s.base);
  let sleeps = [];
  const metrics = { modelCalls: 0, inputTokens: 0, outputTokens: 0 };
  const e = await L.chat(cfg, MSGS, { sleep: noSleep(sleeps), metrics }).catch((x) => x);
  assert.equal(e.message, 'GLM returned HTTP 503. Check credentials, model ID, endpoint parameters, and service capacity.');
  assert.equal(e.code, 'http');
  assert.equal(e.status, 503);
  assert.equal(e.detail, '{"error":"unavailable"}');
  assert.deepEqual(sleeps, [1000, 3000]);
  assert.equal(s.calls.length, 3);
  assert.equal(metrics.modelCalls, 0);
  assert.deepEqual({ ...metrics.calls[0], ms: 0 }, { stage: 'build', ms: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, retries: 2, imagesDropped: 0, error: 'http' });
  for (const code of [429, 500, 502, 504]) {
    status = code;
    sleeps = [];
    await assert.rejects(L.chat(cfgFor(s.base, { GLM_RETRIES: '1' }), MSGS, { sleep: noSleep(sleeps) }), { status: code });
    assert.equal(sleeps.length, 1, `HTTP ${code} is retried`);
  }
  status = 503;
  after = '120';
  sleeps = [];
  await assert.rejects(L.chat(cfgFor(s.base, { GLM_RETRIES: '1' }), MSGS, { sleep: noSleep(sleeps) }));
  assert.deepEqual(sleeps, [20000]);
  after = new Date(Date.now() + 8000).toUTCString();
  sleeps = [];
  await assert.rejects(L.chat(cfgFor(s.base, { GLM_RETRIES: '1' }), MSGS, { sleep: noSleep(sleeps) }));
  assert.ok(sleeps[0] > 5000 && sleeps[0] <= 8000, `HTTP-date Retry-After: ${sleeps[0]}`);
  after = null;
  const before = s.calls.length;
  await assert.rejects(L.chat(cfgFor(s.base, { GLM_RETRIES: '0' }), MSGS, { sleep: noSleep() }));
  assert.equal(s.calls.length - before, 1, 'GLM_RETRIES=0 disables retries');
});

test('400, 401, 403 and 404 are never retried', async (t) => {
  let status = 400;
  const s = await serve((req, res) => reply(res, '{}', status));
  t.after(s.close);
  for (const code of [400, 401, 403, 404]) {
    status = code;
    const before = s.calls.length;
    const sleeps = [];
    const e = await L.chat(cfgFor(s.base), MSGS, { sleep: noSleep(sleeps) }).catch((x) => x);
    assert.equal(e.message, `GLM returned HTTP ${code}. Check credentials, model ID, endpoint parameters, and service capacity.`);
    assert.equal(s.calls.length - before, 1);
    assert.deepEqual(sleeps, []);
  }
});

test('network errors are retried and keep the 0.2 message', async (t) => {
  const s = await serve((req) => req.socket.destroy());
  t.after(s.close);
  const sleeps = [];
  const e = await L.chat(cfgFor(s.base), MSGS, { sleep: noSleep(sleeps) }).catch((x) => x);
  assert.equal(e.message, 'Cannot reach GLM. Check the API URL, network route, and corporate CA configuration.');
  assert.equal(e.code, 'network');
  assert.equal(s.calls.length, 3);
  assert.deepEqual(sleeps, [1000, 3000]);
  const refused = await L.chat(cfgFor('http://127.0.0.1:1/v1', { GLM_RETRIES: '0' }), MSGS, {}).catch((x) => x);
  assert.equal(refused.code, 'network');
});

// ---- vision ---------------------------------------------------------------

test('GLM_VISION=auto retries once without images after HTTP 400 and remembers it', async (t) => {
  const s = await serve((req, res, body) => (imagesIn(body) ? reply(res, '{"error":"image input not supported"}', 400) : reply(res, completion('text only'))));
  t.after(s.close);
  const cfg = cfgFor(s.base, { GLM_STREAM: 'false' });
  const messages = withImages(2);
  const snapshot = structuredClone(messages);
  const metrics = {};
  assert.equal(L.visionSupported(cfg), null);
  const r = await L.chat(cfg, messages, { metrics, stage: 'plan', sleep: noSleep() });
  assert.equal(r.text, 'text only');
  assert.equal(r.imagesDropped, 2);
  assert.equal(r.retries, 0);
  assert.equal(s.calls.length, 2);
  assert.equal(imagesIn(s.calls[0].body), 2);
  assert.equal(imagesIn(s.calls[1].body), 0);
  assert.match(textIn(s.calls[1].body), /Images omitted/);
  assert.deepEqual(messages, snapshot, 'caller messages are not mutated');
  assert.equal(metrics.calls[0].imagesDropped, 2);
  assert.equal(L.visionSupported(cfg), false);
  const again = await L.chat(cfg, withImages(1), {});
  assert.equal(s.calls.length, 3, 'later calls skip images without a failing round trip');
  assert.equal(imagesIn(s.calls[2].body), 0);
  assert.equal(again.imagesDropped, 1);
});

test('vision fallback is not remembered when the image-free retry also fails', async (t) => {
  const s = await serve((req, res) => reply(res, '{}', 400));
  t.after(s.close);
  const cfg = cfgFor(s.base, { GLM_STREAM: 'false' });
  await assert.rejects(L.chat(cfg, withImages(1), {}), { status: 400, code: 'http' });
  assert.equal(s.calls.length, 2);
  assert.equal(L.visionSupported(cfg), null);
  await assert.rejects(L.chat(cfg, MSGS, {}), { status: 400 });
  assert.equal(s.calls.length, 3, 'a 400 without images is not retried');
});

test('GLM_VISION=on never drops images and off never sends them', async (t) => {
  const s = await serve((req, res, body) => (imagesIn(body) ? reply(res, '{}', 400) : reply(res, completion('ok'))));
  t.after(s.close);
  await assert.rejects(L.chat(cfgFor(s.base, { GLM_VISION: 'on', GLM_STREAM: 'false' }), withImages(1), {}), { status: 400 });
  assert.equal(s.calls.length, 1);
  const r = await L.chat(cfgFor(s.base, { GLM_VISION: 'off', GLM_STREAM: 'false' }), withImages(3), {});
  assert.equal(s.calls.length, 2);
  assert.equal(imagesIn(s.calls[1].body), 0);
  assert.match(textIn(s.calls[1].body), /Images omitted/);
  assert.equal(r.imagesDropped, 3);
});

test('GLM_MAX_IMAGES caps images per request and successful image calls are remembered', async (t) => {
  const s = await serve((req, res) => reply(res, completion('seen')));
  t.after(s.close);
  const cfg = cfgFor(s.base, { GLM_MAX_IMAGES: '2', GLM_STREAM: 'false' });
  const metrics = {};
  const r = await L.chat(cfg, withImages(3), { metrics });
  assert.equal(imagesIn(s.calls[0].body), 2);
  assert.match(textIn(s.calls[0].body), /1 image omitted: at most 2 images per request/);
  assert.equal(r.imagesDropped, 1);
  assert.equal(metrics.calls[0].imagesDropped, 1);
  assert.equal(L.visionSupported(cfg), true);
});

test('stripImages and countImages copy messages and leave a note where images were', () => {
  const msgs = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: [{ type: 'text', text: 'hi' }, { type: 'image_url', image_url: { url: png } }, { type: 'image_url', image_url: { url: png } }] },
    { role: 'user', content: [{ type: 'image_url', image_url: { url: png } }] },
    { role: 'user', content: [{ type: 'text', text: 'no images' }] },
  ];
  assert.equal(L.countImages(msgs), 3);
  assert.equal(L.countImages(null), 0);
  assert.equal(L.countImages([{ role: 'user', content: 'x' }, null]), 0);
  const s = L.stripImages(msgs, 'NOTE');
  assert.equal(L.countImages(s), 0);
  assert.equal(L.countImages(msgs), 3, 'input untouched');
  assert.equal(s[0], msgs[0]);
  assert.equal(s[3], msgs[3]);
  assert.deepEqual(s[1].content, [{ type: 'text', text: 'hi' }, { type: 'text', text: 'NOTE' }]);
  assert.deepEqual(s[2].content, [{ type: 'text', text: 'NOTE' }]);
  assert.equal(L.stripImages(msgs)[2].content, '', 'no empty content arrays without a note');
  assert.deepEqual(L.stripImages(msgs)[1].content, [{ type: 'text', text: 'hi' }]);
});

// ---- mid-stream errors ----------------------------------------------------

test('a mid-stream error event becomes an HTTP-style error and is retried when retryable', async (t) => {
  const s = await serve((req, res, body, n) =>
    writeSSE(res, n === 1 ? ssePayload([chunk({ content: 'first try ' }), { error: { message: 'overloaded', type: 'ServiceUnavailable', code: 503 } }]) : simpleStream('second try'), { size: 5 }),
  );
  t.after(s.close);
  const sleeps = [];
  const r = await L.chat(cfgFor(s.base), MSGS, { sleep: noSleep(sleeps) });
  assert.equal(r.text, 'second try', 'partial text from a failed attempt is discarded');
  assert.equal(r.retries, 1);
  assert.deepEqual(sleeps, [1000]);
});

test('non-retryable mid-stream errors fail fast in all common shapes', async (t) => {
  const shapes = [
    { error: { message: 'bad image', type: 'BadRequestError', code: 400 } },
    'event: error\ndata: {"message":"invalid request: context length","type":"invalid_request_error"}',
    { object: 'error', message: 'This model does not support images', type: 'BadRequestError', param: null, code: 400 },
  ];
  let shape = shapes[0];
  const s = await serve((req, res) => writeSSE(res, ssePayload([chunk({ content: 'x' }), shape])));
  t.after(s.close);
  for (shape of shapes) {
    const before = s.calls.length;
    const e = await L.chat(cfgFor(s.base), MSGS, { sleep: noSleep() }).catch((x) => x);
    assert.equal(e.code, 'http');
    assert.equal(e.status, 400);
    assert.equal(e.message, 'GLM returned HTTP 400. Check credentials, model ID, endpoint parameters, and service capacity.');
    assert.ok(e.detail.length > 0);
    assert.equal(s.calls.length - before, 1);
  }
});

test('a connection dropped mid-stream is retried, then reported as a network error', async (t) => {
  const s = await serve(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(ssePayload([chunk({ content: 'half' })]));
    await sleep(20);
    res.destroy();
  });
  t.after(s.close);
  const e = await L.chat(cfgFor(s.base, { GLM_RETRIES: '1' }), MSGS, { sleep: noSleep() }).catch((x) => x);
  assert.equal(e.code, 'network');
  assert.equal(e.message, 'GLM closed the connection before the response finished.');
  assert.equal(s.calls.length, 2);
});

test('malformed stream data is a non-JSON response and is not retried', async (t) => {
  const s = await serve((req, res) => writeSSE(res, 'data: {"choices": [nope\n\n'));
  t.after(s.close);
  const e = await L.chat(cfgFor(s.base), MSGS, { sleep: noSleep() }).catch((x) => x);
  assert.equal(e.message, 'GLM returned a non-JSON HTTP response.');
  assert.equal(s.calls.length, 1);
});

// ---- cancellation and timeouts --------------------------------------------

test('abort cancels a slow stream immediately', async (t) => {
  const s = await serve(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (let i = 0; i < 200 && !res.destroyed; i++) {
      res.write(`data: ${JSON.stringify(chunk({ content: 'x' }))}\n\n`);
      await sleep(100);
    }
    res.end();
  });
  t.after(s.close);
  const ac = new AbortController();
  let abortedAt = 0;
  const deltas = [];
  const metrics = {};
  setTimeout(() => ((abortedAt = Date.now()), ac.abort()), 350);
  const e = await L.chat(cfgFor(s.base), MSGS, { signal: ac.signal, onDelta: (d) => deltas.push(d), metrics }).catch((x) => x);
  const lag = Date.now() - abortedAt;
  assert.equal(e.message, 'Cancelled.');
  assert.equal(e.code, 'cancelled');
  assert.ok(lag < 150, `cancelled ${lag}ms after abort`);
  assert.ok(deltas.length >= 1 && deltas.at(-1).contentChars >= 2, 'stream was running');
  assert.equal(metrics.modelCalls, undefined);
  assert.equal(metrics.calls, undefined, 'cancelled calls are not recorded');
});

test('abort cancels during a retry backoff, even with an injected sleep that never ends', async (t) => {
  const s = await serve((req, res) => reply(res, '{}', 503));
  t.after(s.close);
  for (const sleepFn of [undefined, () => new Promise(() => {})]) {
    const ac = new AbortController();
    const before = s.calls.length;
    let abortedAt = 0;
    setTimeout(() => ((abortedAt = Date.now()), ac.abort()), 150);
    const e = await L.chat(cfgFor(s.base), MSGS, { signal: ac.signal, sleep: sleepFn }).catch((x) => x);
    assert.equal(e.code, 'cancelled');
    assert.ok(Date.now() - abortedAt < 150);
    assert.equal(s.calls.length - before, 1);
  }
  const ac = new AbortController();
  ac.abort();
  const before = s.calls.length;
  await assert.rejects(L.chat(cfgFor(s.base), MSGS, { signal: ac.signal }), { message: 'Cancelled.', code: 'cancelled' });
  assert.equal(s.calls.length, before, 'an aborted signal sends nothing');
});

test('timeouts keep the 0.2 message and are not retried', async (t) => {
  const s = await serve(async (req, res, body, n) => {
    if (body.messages[1].content === 'backoff') return reply(res, '{}', 503);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(': waiting\n\n');
  });
  t.after(s.close);
  const cfg = cfgFor(s.base);
  cfg.timeout = 300;
  const started = Date.now();
  const e = await L.chat(cfg, MSGS, {}).catch((x) => x);
  assert.equal(e.message, 'GLM request timed out. Increase GLM_TIMEOUT_MS or reduce the task.');
  assert.equal(e.code, 'timeout');
  assert.ok(Date.now() - started < 1000);
  assert.equal(s.calls.length, 1);
  const e2 = await L.chat(cfg, [MSGS[0], { role: 'user', content: 'backoff' }], {}).catch((x) => x);
  assert.equal(e2.code, 'timeout', 'the timeout also covers backoff sleeps');
  assert.equal(s.calls.length, 2);
});

// ---- content handling -----------------------------------------------------

test('<think> leaking into streamed content is moved to reasoning', async (t) => {
  let pieces;
  const s = await serve((req, res) => writeSSE(res, ssePayload([...pieces.map((p) => chunk(p)), chunk({}, 'stop'), 'data: [DONE]']), { size: 3 }));
  t.after(s.close);
  const cfg = cfgFor(s.base);
  pieces = [{ content: '<thi' }, { content: 'nk>I should plan.' }, { content: ' Maybe {"x":1}</th' }, { content: 'ink>\n\n{"a":1}' }];
  let r = await L.chat(cfg, MSGS, {});
  assert.equal(r.text, '{"a":1}');
  assert.equal(r.reasoning, 'I should plan. Maybe {"x":1}');
  pieces = [{ reasoning_content: 'parsed' }, { content: 'template opened the block' }, { content: '</think>Answer' }];
  r = await L.chat(cfg, MSGS, {});
  assert.equal(r.text, 'Answer');
  assert.equal(r.reasoning, 'parsed\n\ntemplate opened the block');
  pieces = [{ content: '<think>only thinking, never closed' }];
  await assert.rejects(L.chat(cfg, MSGS, {}), { code: 'empty', message: 'GLM returned an empty response.' });
});

test('finish_reason length keeps the 0.2 message, counts tokens and exposes partial text', async (t) => {
  let stream = true;
  const s = await serve((req, res) =>
    stream
      ? writeSSE(res, ssePayload([chunk({ content: '<forma-screen id="a"><p>cut' }), chunk({}, 'length'), { choices: [], usage: { prompt_tokens: 10, completion_tokens: 100 } }, 'data: [DONE]']))
      : reply(res, completion('{"a":', { finish: 'length' })),
  );
  t.after(s.close);
  const metrics = { modelCalls: 0, inputTokens: 0, outputTokens: 0 };
  const e = await L.chat(cfgFor(s.base), MSGS, { metrics, sleep: noSleep() }).catch((x) => x);
  assert.equal(e.message, 'GLM hit the output limit. Increase GLM_MAX_TOKENS or request a smaller artifact.');
  assert.equal(e.code, 'length');
  assert.equal(e.partial, '<forma-screen id="a"><p>cut');
  assert.equal(metrics.modelCalls, 1);
  assert.equal(metrics.outputTokens, 100);
  assert.equal(metrics.calls[0].error, 'length');
  assert.equal(metrics.calls[0].outputTokens, 100);
  assert.equal(s.calls.length, 1, 'not retried');
  stream = false;
  await assert.rejects(L.chat(cfgFor(s.base, { GLM_STREAM: 'false' }), MSGS, {}), { code: 'length', partial: '{"a":' });
});

test('malformed, empty and oversized completions fail with clear codes', async (t) => {
  let mode;
  const s = await serve(async (req, res) => {
    if (mode === 'nochoice') return reply(res, { choices: [] });
    if (mode === 'html') return reply(res, '<html>login</html>', 200, { 'Content-Type': 'text/html' });
    if (mode === 'empty') return reply(res, completion(''));
    if (mode === 'error200') return reply(res, { error: { message: 'model overloaded', code: 503 } });
    if (mode === 'bigjson') return reply(res, '{"choices":[{"message":{"content":"' + 'x'.repeat(5100000) + '"}}]}');
    if (mode === 'bigsse') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const piece = `data: ${JSON.stringify(chunk({ content: 'y'.repeat(1000000) }))}\n\n`;
      for (let i = 0; i < 7 && !res.destroyed; i++) await new Promise((r) => res.write(piece, r));
      return res.end();
    }
  });
  t.after(s.close);
  const cfg = cfgFor(s.base, { GLM_RETRIES: '0' });
  const run = async (m) => ((mode = m), L.chat(cfg, MSGS, {}).catch((x) => x));
  let e = await run('nochoice');
  assert.deepEqual([e.code, e.message], ['empty', 'GLM returned no completion choice.']);
  e = await run('html');
  assert.deepEqual([e.code, e.message], ['http', 'GLM returned a non-JSON HTTP response.']);
  e = await run('empty');
  assert.deepEqual([e.code, e.message], ['empty', 'GLM returned an empty response.']);
  e = await run('error200');
  assert.deepEqual([e.code, e.status], ['http', 503]);
  e = await run('bigjson');
  assert.deepEqual([e.code, e.message], ['too-large', 'GLM response exceeded the pilot size limit.']);
  e = await run('bigsse');
  assert.deepEqual([e.code, e.message], ['too-large', 'GLM response exceeded the pilot size limit.']);
});

test('metrics: missing fields are initialised and calls are capped at 100 entries', async (t) => {
  const s = await serve((req, res) => reply(res, completion('ok', { usage: { prompt_tokens: 2, completion_tokens: 3, reasoning_tokens: 1 } })));
  t.after(s.close);
  const cfg = cfgFor(s.base, { GLM_STREAM: 'false' });
  const metrics = {};
  await L.chat(cfg, MSGS, { metrics, stage: 'edit' });
  assert.deepEqual({ ...metrics, calls: metrics.calls.length }, { modelCalls: 1, inputTokens: 2, outputTokens: 3, reasoningTokens: 1, calls: 1 });
  metrics.calls = Array.from({ length: 100 }, () => ({}));
  await L.chat(cfg, MSGS, { metrics });
  assert.equal(metrics.calls.length, 100);
  assert.equal(metrics.modelCalls, 2);
  await L.chat(cfg, MSGS, {}); // no metrics object at all
});

test('onDelta is throttled to at most one call per 250 ms and errors in it are ignored', async (t) => {
  const s = await serve(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (let i = 0; i < 24; i++) {
      res.write(`data: ${JSON.stringify(chunk(i % 2 ? { content: 'ab' } : { reasoning_content: 'r' }))}\n\n`);
      await sleep(40);
    }
    res.end(ssePayload([chunk({}, 'stop'), 'data: [DONE]']));
  });
  t.after(s.close);
  const seen = [];
  const r = await L.chat(cfgFor(s.base), MSGS, {
    stage: 'build',
    onDelta: (d) => {
      seen.push({ ...d, at: Date.now() });
      throw new Error('UI bug');
    },
  });
  assert.equal(r.text, 'ab'.repeat(12));
  assert.ok(seen.length >= 2 && seen.length <= 5, `${seen.length} progress calls`);
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i].at - seen[i - 1].at >= 245, 'spaced by 250 ms');
    assert.ok(seen[i].contentChars + seen[i].reasoningChars > seen[i - 1].contentChars + seen[i - 1].reasoningChars);
  }
  assert.deepEqual(Object.keys(seen[0]).sort(), ['at', 'contentChars', 'reasoningChars', 'stage']);
});

// ---- stripThinking --------------------------------------------------------

test('stripThinking removes think blocks, a leading closed-only block and a leading unclosed block', () => {
  const S = L.stripThinking;
  assert.equal(S('plain answer'), 'plain answer');
  assert.equal(S('  untouched spacing  '), '  untouched spacing  ', 'no think tags means no change');
  assert.equal(S('<think>reason</think>\n\nanswer'), 'answer');
  assert.equal(S('<THINK>a</THINK>x<think >b</think>y'), 'xy');
  assert.equal(S('<thinking>long form</thinking>ok'), 'ok');
  assert.equal(S('reasoning without opener</think>\nanswer'), 'answer');
  assert.equal(S('<think>never closed'), '');
  assert.equal(S('   <think>never closed'), '');
  assert.equal(S('answer then <think>unclosed tail'), 'answer then <think>unclosed tail', 'only a leading unclosed block is dropped');
  assert.equal(S('<thinker>not a think tag</thinker>'), '<thinker>not a think tag</thinker>');
  assert.equal(S(null), '');
  assert.deepEqual(L._internal.splitThinking('a</think><think>b</think>c'), { text: 'c', thinking: 'a\n\nb' });
  const hostile = '<think>'.repeat(100000) + '</think>'.repeat(10);
  const t0 = Date.now();
  S(hostile);
  S('<think>x'.repeat(100000));
  S('<think '.repeat(100000));
  S('x<thinking>'.repeat(100000));
  assert.ok(Date.now() - t0 < 2000, `${Date.now() - t0}ms`);
});

// ---- extractJSON ----------------------------------------------------------

test('extractJSON tolerates think blocks, prose, fences and trailing commas', () => {
  const X = L.extractJSON;
  assert.deepEqual(X('{"a":1}'), { a: 1 });
  assert.deepEqual(X('﻿  \n{"a":1}\n '), { a: 1 });
  assert.deepEqual(X('<think>Use {"wrong": true} here</think>{"a":1}'), { a: 1 });
  assert.deepEqual(X('I thought {"wrong":1}</think>\n{"a":2}'), { a: 2 });
  assert.deepEqual(X('Here is the plan:\n{"a":1}\nHope that helps! {not json}'), { a: 1 });
  assert.deepEqual(X('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(X('Sure.\n```JSON\n{"a":1,}\n```\nDone.'), { a: 1 });
  assert.deepEqual(X('Example: {"example": true}\n```json\n{"real": true}\n```'), { real: true }, 'a json fence beats an earlier example');
  assert.deepEqual(X('```\n{"a": [1, 2, ], "b": {"c": 3,},}\n```'), { a: [1, 2], b: { c: 3 } });
  assert.deepEqual(X('Answer:\n{\n  "a": [\n    1,\n  ],\n}\nThanks'), { a: [1] });
  assert.deepEqual(X('{"s": "brace } and { and \\"quote\\" }", "n": {"m": "]"}}'), { s: 'brace } and { and "quote" }', n: { m: ']' } });
  assert.deepEqual(X('pre {"s": "a\\\\", "t": "}"} post'), { s: 'a\\', t: '}' });
  assert.deepEqual(X('Use {curly} braces, then {"a": "x"}'), { a: 'x' });
  assert.deepEqual(X('a { b {"a":1}'), { a: 1 });
  assert.deepEqual(X('{"a": ", }", "b": 1,}'), { a: ', }', b: 1 }, 'commas inside strings are kept');
  assert.deepEqual(X('{"a": "\\u007b\\u007d"}'), { a: '{}' });
  assert.deepEqual(X('{"a": nope} and then {"b": 1}'), { b: 1 });
  assert.deepEqual(X('[{"a":1},]'), [{ a: 1 }]);
  // Objects come first (callers want objects): an object wrapped in prose and
  // an array is still found; arrays are a fallback when no object exists.
  assert.deepEqual(X('Result: [{"a":1}] end'), { a: 1 });
  assert.deepEqual(X('Result: ["a", "b",] end'), ['a', 'b']);
  assert.deepEqual(X('See [1] and [2]. {"ok": true}'), { ok: true });
  assert.deepEqual(X('```json\n{"html": "<p>```</p>"}\n```'.replace('```</p>', '`</p>')), { html: '<p>`</p>' });
  assert.deepEqual(X('Here:\n```json\n{"md": "use ``` fences", "n": 1,}\n```\nbye'), { md: 'use ``` fences', n: 1 }, 'backticks inside strings');
  assert.equal(X('42'), 42, 'a bare JSON answer is returned as-is like 0.2');
});

test('extractJSON rejects truncated, nested-only and missing JSON with the 0.2 message', () => {
  const bad = [
    '',
    'no json here',
    '{"title": "x", "screens": [{"id": "a"}, {"id": "b"',
    '```json\n{"a": 1,\n',
    '<think>{"a":1}</think>',
    '<think>unclosed {"a":1}',
    '{"a": "unterminated}',
    '{"outer": {"inner": 1}, broken} trailing',
    'See [1] and [2].',
  ];
  for (const s of bad) assert.throws(() => L.extractJSON(s), { message: 'The model did not return valid JSON.' }, JSON.stringify(s));
  assert.throws(() => L.extractJSON(null), { message: 'The model returned no text content.' });
  assert.throws(() => L.extractJSON(undefined), { message: 'The model returned no text content.' });
});

test('extractJSON stays fast on hostile input', () => {
  const t0 = Date.now();
  for (const s of ['{'.repeat(200000), '{"a":'.repeat(100000), '{"a": x} '.repeat(100000), '```\n'.repeat(100000), '"'.repeat(200000), '[['.repeat(100000), '{"a":"\\'.repeat(50000)])
    assert.throws(() => L.extractJSON(s));
  assert.deepEqual(L.extractJSON('x'.repeat(1000000) + '{"a":1}'), { a: 1 });
  assert.ok(Date.now() - t0 < 3000, `${Date.now() - t0}ms`);
});

// ---- parseBlocks ----------------------------------------------------------

test('parseBlocks reads every block type with any attribute order, quotes and missing names', () => {
  const b = L.parseBlocks(
    [
      'Intro note.',
      "<forma-css mode='append'>.a{color:red}</forma-css>",
      `<forma-screen name="Dash board" id='dash'><main><h1>Dash</h1></main></forma-screen>`,
      '<forma-screen id=list><ul><li>x</li></ul></forma-screen>',
      '<forma-screen id="c" name="A > B &amp; C"><p>C</p></forma-screen>',
      '<forma-remove id="old"></forma-remove>',
      '<forma-remove id="older"/>',
      '<forma-remove id="oldest">no longer needed</forma-remove>',
      '<forma-element><button class="btn">Go</button></forma-element>',
      '<forma-meta>{"title":"T","summary":"S","tweaks":[]}</forma-meta>',
      'Closing note.',
    ].join('\n'),
  );
  assert.equal(b.css, '.a{color:red}');
  assert.equal(b.cssMode, 'append');
  assert.deepEqual(b.screens, [
    { id: 'dash', name: 'Dash board', html: '<main><h1>Dash</h1></main>' },
    { id: 'list', name: '', html: '<ul><li>x</li></ul>' },
    { id: 'c', name: 'A > B & C', html: '<p>C</p>' },
  ]);
  assert.deepEqual(b.removed, ['old', 'older', 'oldest']);
  assert.equal(b.element, '<button class="btn">Go</button>');
  assert.deepEqual(b.meta, { title: 'T', summary: 'S', tweaks: [] });
  assert.equal(b.notes, 'Intro note.\n\nClosing note.');
  assert.equal(b.truncated, false);
});

test('parseBlocks concatenates repeated css blocks and honours replace', () => {
  let b = L.parseBlocks('<forma-css>.a{}</forma-css>\n<forma-css mode="append">.b{}</forma-css>');
  assert.deepEqual([b.css, b.cssMode], ['.a{}\n.b{}', 'append']);
  b = L.parseBlocks('<forma-css>.a{}</forma-css><forma-css MODE="REPLACE">.b{}</forma-css><forma-css>.c{}</forma-css>');
  assert.deepEqual([b.css, b.cssMode], ['.b{}\n.c{}', 'replace']);
  b = L.parseBlocks('<forma-screen id="a"><p>x</p></forma-screen>');
  assert.deepEqual([b.css, b.cssMode], [null, 'append']);
  assert.equal(L.parseBlocks('<forma-css></forma-css>').css, '');
  assert.equal(L.parseBlocks('<forma-css mode="sideways">.z{}</forma-css>').cssMode, 'append');
});

test('parseBlocks handles mixed-case tags, CRLF and markdown fences inside blocks', () => {
  const b = L.parseBlocks(
    '<FORMA-SCREEN ID="Home" Name="Home">\r\n```html\r\n<main>\r\n<h1>Hi</h1>\r\n</main>\r\n```\r\n</Forma-Screen >\r\n<Forma-CSS Mode="Replace">```css\r\n.x{}\r\n```</FORMA-CSS>\r\n<forma-element>\n```\n<b>e</b>\n```\n</forma-element>\n```\n<forma-screen id="w"><p>wrapped in a fence</p></forma-screen>\n```',
  );
  assert.deepEqual(b.screens[0], { id: 'Home', name: 'Home', html: '<main>\n<h1>Hi</h1>\n</main>' });
  assert.deepEqual([b.css, b.cssMode], ['.x{}', 'replace']);
  assert.equal(b.element, '<b>e</b>');
  assert.deepEqual(b.screens[1], { id: 'w', name: '', html: '<p>wrapped in a fence</p>' });
  assert.equal(b.notes, '');
});

test("parseBlocks does not end a block at '</forma-screen' inside attribute text or comments", () => {
  const html = '<p title="</forma-screen>">A</p><a data-x=\'</forma-screen>\' href="#">B</a><!-- </forma-screen> --><i data-icon="x"></i><p title="x </forma-screen y">C</p>';
  const b = L.parseBlocks(`<forma-screen id="a">${html}</forma-screen>\n<forma-screen id="b"><p>B</p></forma-screen>`);
  assert.deepEqual(b.screens.map((s) => s.id), ['a', 'b']);
  assert.equal(b.screens[0].html, html);
  assert.equal(b.screens[1].html, '<p>B</p>');
  const e = L.parseBlocks('<forma-element><button aria-label="</forma-element>">x</button></forma-element>');
  assert.equal(e.element, '<button aria-label="</forma-element>">x</button>');
});

test('parseBlocks recovers from broken markup: unclosed quotes and stray < inside tags', () => {
  let b = L.parseBlocks('<forma-screen id="a"><p title="oops>Text</p></forma-screen>\n<forma-screen id="b"><p class="x">B</p></forma-screen>');
  assert.deepEqual(b.screens.map((s) => [s.id, s.html]), [
    ['a', '<p title="oops>Text</p>'],
    ['b', '<p class="x">B</p>'],
  ]);
  b = L.parseBlocks('<forma-screen id="a"><div class="x"</forma-screen><forma-screen id="b"><p>B</p></forma-screen>');
  assert.deepEqual(b.screens.map((s) => [s.id, s.html]), [
    ['a', '<div class="x"'],
    ['b', '<p>B</p>'],
  ]);
  b = L.parseBlocks('<forma-screen id="a"><p>x<y and z</p></forma-screen><forma-screen id="b"><p>B</p></forma-screen>');
  assert.equal(b.screens[0].html, '<p>x<y and z</p>');
  b = L.parseBlocks('<forma-screen id="a"><!-- never closed <p>A</p></forma-screen>');
  assert.equal(b.screens[0].html, '<!-- never closed <p>A</p>');
  b = L.parseBlocks('<forma-screen id="home><main>Broken open tag</main></forma-screen>');
  assert.deepEqual(b.screens, [{ id: 'home', name: '', html: '<main>Broken open tag</main>' }]);
});

test('parseBlocks reports unclosed blocks via notes instead of dropping them', () => {
  let b = L.parseBlocks('<forma-screen id="a"><p>A</p></forma-screen>\n<forma-screen id="b" name="B"><main><h1>Half');
  assert.equal(b.screens.length, 2);
  assert.deepEqual(b.screens[1], { id: 'b', name: 'B', html: '<main><h1>Half', truncated: true });
  assert.equal(b.truncated, true);
  assert.match(b.notes, /<forma-screen id="b"> block was not closed; the answer looks truncated/);
  b = L.parseBlocks('<forma-css>.a{color:red');
  assert.deepEqual([b.css, b.truncated], ['.a{color:red', true]);
  b = L.parseBlocks('<forma-meta>{"title": "x"');
  assert.equal(b.meta, null);
  assert.match(b.notes, /not a JSON object/);
  assert.match(b.notes, /truncated/);
  b = L.parseBlocks('<forma-element><b>1</b></forma-element><forma-element><b>2');
  assert.equal(b.element, '<b>1</b>', 'a complete element beats a truncated one');
  b = L.parseBlocks('<forma-element><b>only partial');
  assert.deepEqual([b.element, b.truncated], ['<b>only partial', true]);
  b = L.parseBlocks('<forma-screen id="a"><p>A</p>\n<forma-screen id="b"><p>B</p></forma-screen>');
  assert.deepEqual(b.screens.map((s) => [s.id, s.html]), [
    ['a', '<p>A</p>'],
    ['b', '<p>B</p>'],
  ]);
  assert.equal(b.truncated, false);
  assert.match(b.notes, /<forma-screen id="a"> block was not closed before the next block/);
  b = L.parseBlocks('<forma-css>.a{}\n<forma-screen id="s"><p>S</p></forma-screen>');
  assert.deepEqual([b.css, b.screens.length], ['.a{}', 1]);
  b = L.parseBlocks('<forma-screen id="x"/>');
  assert.deepEqual(b.screens, [{ id: 'x', name: '', html: '' }]);
  b = L.parseBlocks('Done. <forma-screen id="last">');
  assert.deepEqual(b.screens, [{ id: 'last', name: '', html: '', truncated: true }]);
});

test('parseBlocks ignores think blocks, inline-code and prose mentions of the protocol', () => {
  const b = L.parseBlocks(
    '<think>Draft: <forma-screen id="draft"><p>no</p></forma-screen></think>I will return the <forma-css> and <forma-screen> blocks, like `<forma-meta>`.\n<forma-screen id="real"><p>yes</p></forma-screen>\nSee the <forma-element> note.',
  );
  assert.deepEqual(b.screens, [{ id: 'real', name: '', html: '<p>yes</p>' }]);
  assert.equal(b.css, null);
  assert.equal(b.meta, null);
  assert.equal(b.element, null);
  assert.equal(b.truncated, false);
  assert.match(b.notes, /I will return the <forma-css> and <forma-screen> blocks, like `<forma-meta>`\./);
  assert.match(b.notes, /See the <forma-element> note\./);
  assert.doesNotMatch(b.notes, /draft/);
});

test('parseBlocks keeps the last complete copy of a repeated screen and dedupes removals', () => {
  const b = L.parseBlocks(
    '<forma-screen id="a"><p>1</p></forma-screen><forma-screen id="z"><p>z</p></forma-screen><forma-screen id="a" name="A2"><p>2</p></forma-screen><forma-remove id="x"></forma-remove><forma-remove id="x"></forma-remove><forma-remove></forma-remove><forma-screen id="a"><p>3, cut',
  );
  assert.deepEqual(b.screens, [
    { id: 'a', name: 'A2', html: '<p>2</p>' },
    { id: 'z', name: '', html: '<p>z</p>' },
  ]);
  assert.deepEqual(b.removed, ['x']);
  assert.equal(b.truncated, true);
});

test('parseBlocks parses meta with fences and trailing commas, merges repeats and reports invalid meta', () => {
  let b = L.parseBlocks('<forma-meta>\n```json\n{"title": "T", "tweaks": [{"var": "--x",},],}\n```\n</forma-meta><forma-meta>{"summary": "S"}</forma-meta>');
  assert.deepEqual(b.meta, { title: 'T', tweaks: [{ var: '--x' }], summary: 'S' });
  b = L.parseBlocks('<forma-meta>title: T</forma-meta>');
  assert.equal(b.meta, null);
  assert.match(b.notes, /<forma-meta> block was not a JSON object/);
  b = L.parseBlocks('<forma-meta>["not", "an", "object"]</forma-meta>');
  assert.equal(b.meta, null);
  b = L.parseBlocks('<forma-meta>{"__proto__": {"polluted": true}, "title": "T"}</forma-meta>');
  assert.equal(b.meta.title, 'T');
  assert.equal({}.polluted, undefined);
});

test('parseBlocks returns an empty result for non-strings, prose and JSON answers', () => {
  const empty = { css: null, cssMode: 'append', screens: [], removed: [], element: null, meta: null, notes: '', truncated: false };
  assert.deepEqual(L.parseBlocks(null), empty);
  assert.deepEqual(L.parseBlocks(''), empty);
  assert.deepEqual(L.parseBlocks('Sorry, here is some prose.'), { ...empty, notes: 'Sorry, here is some prose.' });
  const json = JSON.stringify({ kind: 'web', screens: [{ id: 'one', html: '<main><h1>One</h1></main>' }] });
  const b = L.parseBlocks(json);
  assert.deepEqual([b.screens.length, b.css, b.meta, b.removed.length], [0, null, null, 0]);
  assert.equal(L.extractJSON(b.notes).kind, 'web', 'the JSON survives in notes for the fallback path');
  assert.equal(L.parseBlocks('<forma-screens id="x">plural is not a tag</forma-screens>').screens.length, 0);
  assert.equal(L.parseBlocks('<forma-cssx>no</forma-cssx>').css, null);
});

test('parseBlocks stays linear on hostile input', () => {
  const inputs = [
    '<forma-css '.repeat(50000),
    '<forma-css>'.repeat(50000),
    '<forma-screen id="a">'.repeat(30000),
    '<forma-screen id="a">' + '<p title="'.repeat(50000),
    '<forma-screen id="a">' + '<p '.repeat(50000) + '</forma-screen>',
    '<forma-remove id=x>'.repeat(30000),
    '<forma-screen id="a"><!--'.repeat(30000),
    '</forma-screen>'.repeat(50000),
    '<forma-screen id="' + 'x'.repeat(200000),
    '<forma-meta>' + '{"a":'.repeat(50000),
  ];
  const t0 = Date.now();
  for (const s of inputs) {
    const b = L.parseBlocks(s);
    assert.ok(b.notes.length <= 4000);
  }
  assert.ok(Date.now() - t0 < 4000, `${Date.now() - t0}ms`);
});
