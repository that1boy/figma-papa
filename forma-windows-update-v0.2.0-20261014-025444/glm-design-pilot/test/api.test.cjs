'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { start, stop, client, waitJob } = require('./helpers.cjs');
const { demo } = require('../lib/demo.cjs');
test('demo lifecycle, access control, revisions, exports, evaluation and restart persistence', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'design-api-test-'));
  let server = await start('server.cjs', {
    APP_PASSWORD: 'test-pilot-password',
    MODEL_MODE: 'demo',
    DATA_DIR: dir,
    RENDER_URL: '',
    SESSION_SECRET: 'test-session-secret-12345',
  });
  t.after(async () => {
    await stop(server);
    await fs.rm(dir, { recursive: true, force: true });
  });
  let api = await client(server.url);
  assert.equal((await fetch(server.url + '/api/projects')).status, 401);
  assert.equal(
    (await fetch(server.url + '/api/projects', { method: 'POST', body: '{}' })).status,
    403,
  );
  for (const kind of ['web', 'slides', 'document']) {
    const created = await api('/projects', 'POST', {
      kind,
      title: 'Pilot ' + kind,
      brand: 'Use violet.',
    });
    assert.equal(created.status, 201);
    const pid = created.data.id;
    const j = await api(`/projects/${pid}/generate`, 'POST', {
      prompt: 'Make an employee service experience.',
      review: true,
    });
    assert.equal(j.status, 202);
    assert.equal(
      (await api(`/projects/${pid}/generate`, 'POST', { prompt: 'Duplicate' })).status,
      409,
    );
    const job = await waitJob(api, j.data.id);
    assert.equal(job.status, 'complete', job.error);
    const p = (await api('/projects/' + pid)).data;
    assert.equal(p.revisions.length, 1);
    assert.equal(p.current.metrics.mode, 'demo');
    assert.equal(p.current.metrics.modelCalls, 0);
    assert.ok(p.current.metrics.warnings.some((x) => x.includes('Rendering unavailable')));
    const preview = await api(`/projects/${pid}/preview`);
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get('content-security-policy'), /sandbox allow-scripts/);
    const exported = await api(
      `/projects/${pid}/export?format=${kind === 'web' ? 'html' : kind === 'slides' ? 'pptx' : 'docx'}`,
    );
    assert.equal(exported.status, 200);
    assert.ok(exported.data.length > 500);
    assert.equal((await api(`/projects/${pid}/export?format=pdf`)).status, 409);
    const a = p.current.artifact;
    a.title = 'Edited ' + kind;
    const saved = await api(`/projects/${pid}/save`, 'POST', { baseId: p.current_id, artifact: a });
    assert.equal(saved.status, 201);
    assert.equal(
      (await api(`/projects/${pid}/save`, 'POST', { baseId: p.current_id, artifact: a })).status,
      409,
    );
    const evaluation = {
      revisionId: saved.data.id,
      quality: 4,
      accepted: true,
      criticalErrors: false,
      baselineMinutes: 30,
      workMinutes: 10,
      cleanupMinutes: 5,
      notes: 'Checked the export.',
    };
    assert.equal((await api(`/projects/${pid}/evaluate`, 'POST', evaluation)).status, 201);
    assert.equal(
      (await api(`/projects/${pid}/evaluate`, 'POST', { ...evaluation, criticalErrors: true }))
        .status,
      400,
    );
    assert.equal(
      (await api(`/projects/${pid}/restore`, 'POST', { revisionId: p.current_id })).status,
      201,
    );
    const restored = (await api('/projects/' + pid)).data;
    assert.equal(restored.revisions.length, 3);
    assert.equal(
      restored.current.artifact.title,
      p.current.artifact.title.replace(
        'Edited ' + kind,
        kind === 'web'
          ? 'Employee services'
          : kind === 'slides'
            ? 'A better employee service experience'
            : 'Employee services pilot proposal',
      ),
    );
  }
  const records = (await api('/evaluations')).data;
  assert.equal(records.length, 3);
  assert.ok(records.every((e) => e.mode === 'demo'));
  assert.match((await api('/evaluations.csv')).data.toString(), /baselineMinutes/);
  await stop(server);
  server = await start('server.cjs', {
    APP_PASSWORD: 'test-pilot-password',
    MODEL_MODE: 'demo',
    DATA_DIR: dir,
    RENDER_URL: '',
    SESSION_SECRET: 'test-session-secret-12345',
  });
  api = await client(server.url);
  assert.equal((await api('/projects')).data.length, 3);
});
test('GLM adapter sends references, repairs invalid output, and never falls back to demo', async (t) => {
  const requests = [];
  let fail = false;
  const mock = http.createServer(async (req, res) => {
    let s = '';
    for await (const b of req) s += b;
    const data = JSON.parse(s);
    requests.push({ url: req.url, auth: req.headers.authorization, data });
    res.setHeader('Content-Type', 'application/json');
    if (fail) {
      res.statusCode = 503;
      return res.end('{"error":"unavailable"}');
    }
    const a = demo('web');
    a.title = 'From the test model';
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: requests.length === 1 ? 'invalid JSON' : JSON.stringify(a) },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 200 },
      }),
    );
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'design-glm-test-'));
  const server = await start('server.cjs', {
    APP_PASSWORD: 'test-pilot-password',
    MODEL_MODE: 'glm',
    DATA_DIR: dir,
    RENDER_URL: '',
    GLM_BASE_URL: `http://127.0.0.1:${mock.address().port}/v1`,
    GLM_API_KEY: 'not-a-real-key',
    GLM_MAX_TOKENS: '4096',
    GLM_JSON_MODE: 'true',
  });
  t.after(async () => {
    await stop(server);
    await new Promise((r) => mock.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const api = await client(server.url);
  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfZkAAAAASUVORK5CYII=';
  const p = (
    await api('/projects', 'POST', {
      kind: 'web',
      title: 'Test',
      references: [{ name: 'ref.png', data: png }],
    })
  ).data;
  let job = await api(`/projects/${p.id}/generate`, 'POST', { prompt: 'Use the reference.', review: false });
  let done = await waitJob(api, job.data.id);
  assert.equal(done.status, 'complete', done.error);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, '/v1/chat/completions');
  assert.equal(requests[0].auth, 'Bearer not-a-real-key');
  assert.equal(requests[0].data.messages[1].content[1].image_url.url, png);
  assert.equal(requests[0].data.response_format.type, 'json_object');
  const current = (await api('/projects/' + p.id)).data.current;
  assert.equal(current.artifact.title, 'From the test model');
  assert.equal(current.metrics.modelCalls, 2);
  assert.equal(current.metrics.outputTokens, 400);
  assert.equal(current.origin, 'glm');
  fail = true;
  job = await api(`/projects/${p.id}/generate`, 'POST', { prompt: 'Make it different.' });
  done = await waitJob(api, job.data.id);
  assert.equal(done.status, 'failed');
  assert.match(done.error, /HTTP 503/);
  assert.equal((await api('/projects/' + p.id)).data.revisions.length, 1);
});
test('cancellation does not commit partial artifacts', async (t) => {
  const mock = http.createServer(async (req, res) => {
    for await (const b of req) {
    }
    setTimeout(() => {
      if (!res.destroyed) {
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(demo('web')) } }] }),
        );
      }
    }, 1500);
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'design-cancel-test-'));
  const server = await start('server.cjs', {
    APP_PASSWORD: 'test-pilot-password',
    MODEL_MODE: 'glm',
    DATA_DIR: dir,
    RENDER_URL: '',
    GLM_BASE_URL: `http://127.0.0.1:${mock.address().port}/v1`,
  });
  t.after(async () => {
    await stop(server);
    mock.closeAllConnections();
    await new Promise((r) => mock.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const api = await client(server.url);
  const p = (await api('/projects', 'POST', { kind: 'web', title: 'Cancel test' })).data;
  const j = (await api(`/projects/${p.id}/generate`, 'POST', { prompt: 'Create a page.' })).data;
  await api('/jobs/' + j.id + '/cancel', 'POST', {});
  assert.equal((await waitJob(api, j.id)).status, 'cancelled');
  assert.equal((await api('/projects/' + p.id)).data.revisions.length, 0);
});
