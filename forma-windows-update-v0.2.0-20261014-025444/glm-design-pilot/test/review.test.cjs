'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { start, stop, client, waitJob } = require('./helpers.cjs');
const { demo } = require('../lib/demo.cjs');
test('render → vision review → one correction → re-render uses the configured model and native export', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'design-review-test-'));
  const calls = [],
    renders = [];
  let app;
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfZkAAAAASUVORK5CYII=';
  const mock = http.createServer(async (req, res) => {
    let raw = '';
    for await (const b of req) raw += b;
    const input = JSON.parse(raw);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/office') {
      renders.push(input);
      return res.end(
        JSON.stringify({
          screenshots: [png, png],
          pdf: Buffer.from('%PDF-1.4\nmock').toString('base64'),
          pageCount: 2,
          basis: 'test double for native Office renderer',
          metrics: { renderedPages: 2 },
        }),
      );
    }
    calls.push(input);
    const a = demo('document');
    a.title = calls.length === 3 ? 'Corrected proposal' : 'Initial proposal';
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify(
                calls.length === 2
                  ? {
                      issues: ['Increase heading spacing.'],
                      summary: 'Heading spacing needs work.',
                    }
                  : a,
              ),
            },
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 34 },
      }),
    );
  });
  t.after(async () => {
    await stop(app);
    mock.closeAllConnections();
    await new Promise((r) => mock.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${mock.address().port}`;
  app = await start('server.cjs', {
    APP_PASSWORD: 'test-pilot-password',
    MODEL_MODE: 'glm',
    DATA_DIR: dir,
    RENDER_URL: base,
    RENDER_TOKEN: 'test-render-token-12345',
    GLM_BASE_URL: base + '/v1',
  });
  const api = await client(app.url);
  const p = (await api('/projects', 'POST', { kind: 'document', title: 'Review test' })).data;
  const j = (
    await api(`/projects/${p.id}/generate`, 'POST', { prompt: 'Create a proposal.', review: true })
  ).data;
  const done = await waitJob(api, j.id);
  assert.equal(done.status, 'complete', done.error);
  const r = (await api('/projects/' + p.id)).data.current;
  assert.equal(calls.length, 3);
  assert.equal(renders.length, 2);
  assert.equal(renders[0].extension, 'docx');
  assert.equal(Buffer.from(renders[0].file, 'base64').subarray(0, 2).toString(), 'PK');
  assert.equal(calls[1].messages[1].content[1].image_url.url, 'data:image/png;base64,' + png);
  assert.equal(r.artifact.title, 'Corrected proposal');
  assert.equal(r.metrics.review.refined, true);
  assert.equal(r.metrics.review.pagesReviewed, 2);
  assert.equal(r.metrics.modelCalls, 3);
  assert.equal((await api(`/projects/${p.id}/export?format=pdf`)).status, 200);
});
