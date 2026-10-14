'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const JSZip = require('jszip');
const { start, stop, client } = require('./helpers.cjs');
const { artifact } = require('../lib/schema.cjs');
const { demo } = require('../lib/demo.cjs');
const { briefHistory } = require('../lib/history.cjs');

const image = { name: 'pixel.png', data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' };

async function setup(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forma-import-'));
  let calls = 0, app;
  const endpoint = http.createServer((req, res) => { calls++; res.writeHead(503); res.end('Model unavailable'); });
  await new Promise(resolve => endpoint.listen(0, '127.0.0.1', resolve));
  const env = { APP_PASSWORD: 'test-pilot-password', MODEL_MODE: 'glm', DATA_DIR: dir,
    RENDER_URL: '', GLM_BASE_URL: `http://127.0.0.1:${endpoint.address().port}/v1`, GLM_API_KEY: '' };
  t.after(async () => {
    await stop(app);
    endpoint.closeAllConnections();
    await new Promise(resolve => endpoint.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });
  app = await start('server.cjs', env);
  return { dir, api: await client(app.url), calls: () => calls,
    restart: async () => { await stop(app); app = await start('server.cjs', env); return client(app.url); } };
}

test('import, edit, restore, export and restart work with an unavailable model; provenance stays separate', async t => {
  const fixture = await setup(t);
  let api = fixture.api;
  const projects = [];
  for (const kind of ['web', 'slides', 'document']) {
    const original = artifact(demo(kind));
    const imported = await api('/import', 'POST', {
      artifact: { ...original, origin: 'glm', metrics: { mode: 'glm' }, id: 'spoofed' },
      sourceBrief: 'Owner: Asha. Deadline unspecified. Preserve these source facts.',
      origin: 'glm', metrics: { mode: 'glm', modelCalls: 25 },
    });
    assert.equal(imported.status, 201);
    const pid = imported.data.id;
    const p = (await api('/projects/' + pid)).data;
    assert.notEqual(pid, 'spoofed');
    assert.equal(p.brand, '');
    assert.equal(p.current.origin, 'import');
    assert.equal(p.current.metrics.mode, 'import');
    assert.equal(p.current.metrics.modelCalls, 0);
    assert.equal(p.jobs.length, 0);
    assert.deepEqual(p.current.artifact, original);
    assert.deepEqual(JSON.parse((await api(`/projects/${pid}/export?format=json`)).data.toString()), original);
    assert.equal((await api(`/projects/${pid}/preview`)).status, 200);
    assert.equal((await api(`/projects/${pid}/export?format=pdf`)).status, 409);
    const format = { web: 'html', slides: 'pptx', document: 'docx' }[kind];
    const output = await api(`/projects/${pid}/export?format=${format}`);
    assert.equal(output.status, 200);
    if (kind !== 'web') {
      const zip = await JSZip.loadAsync(output.data);
      const xml = await zip.file(kind === 'slides' ? 'ppt/slides/slide1.xml' : 'word/document.xml').async('string');
      assert.ok(xml.includes(kind === 'slides' ? original.slides[0].title : original.title));
      assert.match(xml, kind === 'slides' ? /<a:t>/ : /<w:t[ >]/);
    }
    const copy = await api('/import', 'POST', { artifact: original });
    assert.equal(copy.status, 201);
    assert.notEqual(copy.data.id, pid);
    assert.equal((await api('/projects/' + pid)).data.revisions.length, 1);
    const saved = await api(`/projects/${pid}/save`, 'POST', {
      baseId: p.current_id, artifact: { ...original, title: 'Manual ' + kind },
    });
    assert.equal(saved.status, 201);
    assert.equal((await api('/projects/' + pid)).data.current.metrics.mode, 'import');
    const evaluation = await api(`/projects/${pid}/evaluate`, 'POST', {
      revisionId: saved.data.id, mode: 'glm', quality: 4, accepted: true, criticalErrors: false,
      baselineMinutes: 20, workMinutes: 5, cleanupMinutes: 1, notes: 'Local import workflow fixture.',
    });
    assert.equal(evaluation.status, 201);
    const restored = await api(`/projects/${pid}/restore`, 'POST', { revisionId: p.current_id });
    assert.equal(restored.status, 201);
    projects.push({ pid, original, manual: saved.data.id, restored: restored.data.id });
  }
  api = await fixture.restart();
  for (const { pid, original } of projects) {
    const p = (await api('/projects/' + pid)).data;
    assert.equal(p.revisions.length, 3);
    assert.equal(p.current.metrics.mode, 'import');
    assert.deepEqual(p.current.artifact, original);
  }
  const rows = (await api('/evaluations')).data;
  assert.equal(rows.length, 3);
  assert.ok(rows.every(row => row.mode === 'import'));
  assert.equal(fixture.calls(), 0);
  const db = new DatabaseSync(path.join(fixture.dir, 'studio.sqlite'), { readOnly: true });
  try {
    const p = projects[0];
    const history = briefHistory(db, p.pid, p.manual).briefs.map(row => row.prompt).join('\n');
    assert.match(history, /Owner: Asha\. Deadline unspecified/);
    assert.match(history, /Manual web/);
    const restored = briefHistory(db, p.pid, p.restored).briefs.map(row => row.prompt).join('\n');
    assert.match(restored, /Owner: Asha/);
    assert.doesNotMatch(restored, /Manual web/);
  } finally { db.close(); }
});

test('bad imports create no project; validation and image slots survive round trips', async t => {
  const { api, calls } = await setup(t);
  const valid = artifact(demo('document'));
  for (const input of [null, {}, { artifact: null }, { artifact: { ...valid, blocks: [null] } },
    { artifact: { ...valid, theme: null } }, { artifact: valid, sourceBrief: 'x'.repeat(24001) },
    { artifact: { ...valid, unknownPadding: 'x'.repeat(1000001) } },
    { artifact: { kind: 'web', title: 'Blocked', html: '<main>Content</main>', css: 'body{background:url(https://example.com/pixel)}' } },
    { artifact: valid, references: [{ name: 'bad.png', data: 'data:image/png;base64,YmFk' }] }]) {
    const response = await api('/import', 'POST', input);
    assert.equal(response.status, 400, JSON.stringify(response.data));
  }
  assert.equal((await api('/projects')).data.length, 0);
  for (const kind of ['web', 'slides', 'document']) {
    const a = kind === 'web' ? { kind, title: 'Image slots', html: '<main><img src="{{reference:1}}" alt="Second image"><script>throw 1</script></main>', css: '' }
      : kind === 'slides' ? { kind, title: 'Image slots', slides: [{ title: 'Image', layout: 'image', imageIndex: 1 }] }
        : { kind, title: 'Image slots', blocks: [{ type: 'image', imageIndex: 1, text: 'Second image' }] };
    const missing = await api('/import', 'POST', { artifact: a, references: [image] });
    assert.equal(missing.status, 400);
    assert.match(missing.data.error, /Reference image 2 is required/);
    const ok = await api('/import', 'POST', { artifact: a, references: [image, { ...image, name: 'second.png' }] });
    assert.equal(ok.status, 201);
    const p = (await api('/projects/' + ok.data.id)).data;
    assert.equal(p.references[1].name, 'second.png');
    assert.equal(p.references[1].data, image.data);
    const preview = (await api(`/projects/${p.id}/preview`)).data.toString();
    assert.ok(preview.includes(image.data));
    assert.doesNotMatch(JSON.stringify(p.current.artifact), /throw 1/);
  }
  assert.equal((await api('/projects')).data.length, 3);
  assert.equal(calls(), 0);
});
