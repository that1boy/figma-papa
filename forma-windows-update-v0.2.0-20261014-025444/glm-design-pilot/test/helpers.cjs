'use strict';
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
async function freePort() {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const p = server.address().port;
  await new Promise((r) => server.close(r));
  return p;
}
async function start(file, env = {}) {
  const port = Number(env.PORT || env.RENDER_PORT || (await freePort()));
  const child = spawn(process.execPath, [file], {
    cwd: root,
    env: { ...process.env, PORT: String(port), ...env },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (b) => (output += b));
  child.stderr.on('data', (b) => (output += b));
  // Cold Windows process launches can be delayed by endpoint scanning. Allow
  // startup to finish; test operations still retain their own bounded timeouts.
  for (let n = 0; n < 600; n++) {
    if (child.exitCode !== null) throw new Error(output);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok)
        return { child, port, url: `http://127.0.0.1:${port}`, logs: () => output };
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error('Server did not start: ' + output);
}
async function stop(s) {
  if (!s || s.child.exitCode !== null) return;
  const done = new Promise((r) => s.child.once('exit', r));
  s.child.kill();
  await done;
}
async function client(url, password = 'test-pilot-password') {
  const r = await fetch(url + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Studio-Request': '1' },
    body: JSON.stringify({ password }),
  });
  if (!r.ok) throw new Error('Login failed: ' + (await r.text()));
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return async (route, method = 'GET', data) => {
    const res = await fetch(url + '/api' + route, {
      method,
      headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Studio-Request': '1' },
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    });
    const type = res.headers.get('content-type') || '';
    return {
      status: res.status,
      headers: res.headers,
      data: type.includes('application/json')
        ? await res.json()
        : Buffer.from(await res.arrayBuffer()),
    };
  };
}
async function waitJob(api, jid, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const r = await api('/jobs/' + jid);
    if (!['queued', 'running'].includes(r.data.status)) return r.data;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Job did not complete.');
}
module.exports = { root, freePort, start, stop, client, waitJob };
