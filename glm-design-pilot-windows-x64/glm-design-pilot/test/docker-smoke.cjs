'use strict';
// Run after docker compose up. This proves the container-only native rendering path.
const assert = require('node:assert/strict');
const { client, waitJob } = require('./helpers.cjs');
(async () => {
  const api = await client(
    process.env.PILOT_URL || 'http://127.0.0.1:8080',
    process.env.APP_PASSWORD || 'local-pilot-change-me',
  );
  const config = (await api('/config')).data;
  assert.equal(
    config.mode,
    'demo',
    'Run the Docker smoke test in demo mode so no real model calls are made.',
  );
  for (const kind of ['web', 'slides', 'document']) {
    const p = (await api('/projects', 'POST', { kind, title: 'Docker smoke ' + kind })).data;
    const j = (
      await api(`/projects/${p.id}/generate`, 'POST', {
        prompt: 'Load the fixed sample.',
        review: false,
      })
    ).data;
    const done = await waitJob(api, j.id, 180000);
    assert.equal(done.status, 'complete', done.error);
    const r = (await api('/projects/' + p.id)).data.current;
    assert.ok(r.metrics.render, JSON.stringify(r.metrics));
    const pdf = await api(`/projects/${p.id}/export?format=pdf`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF');
    const png = await api(`/projects/${p.id}/screenshot`);
    assert.equal(png.status, 200);
    assert.equal(png.data[0], 137);
    if (kind === 'slides') assert.equal(r.metrics.render.pageCount, 4);
    console.log(kind, 'rendered', r.metrics.render.pageCount, 'page(s)');
  }
  console.log('Docker smoke passed. Inspect each rendered export visually before a pilot rollout.');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
