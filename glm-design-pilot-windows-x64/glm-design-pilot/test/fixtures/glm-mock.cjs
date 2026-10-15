'use strict';
// Scripted OpenAI-compatible stand-in for GLM-5.3-Flash. It reads the stage
// from the system prompt (lib/prompts.cjs and lib/model.cjs systemPrompt) and
// answers the way a capable model following those prompts would: a JSON plan
// with tweaks, tagged <forma-css>/<forma-screen> builds that use the Forma kit,
// Tailwind-style utilities, <i data-icon>, a data-chart figure and real
// data-action navigation, changed-screens-only revisions, <forma-element>
// element edits, review JSON and slide/document JSON. Facts come from the
// source document text in the user message when present. Replies stream as SSE
// (reasoning_content first, then content, then a usage chunk) or as one JSON
// body when stream is false. Every request is recorded for assertions.
//
//   const mock = await startMock({ pace: 1 });   // mock.base -> GLM_BASE_URL
//   mock.requests                                // [{ stage, stream, images, text, ... }]
//   await mock.close();
//
// Run standalone: node test/fixtures/glm-mock.cjs [port]
const http = require('node:http');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---- facts ----------------------------------------------------------------
// Pulled from the source document text when it is supplied (the DOCX in the
// e2e test), with the same values as a fallback so the mock is self-contained.
function facts(text) {
  const n = (re, d) => re.exec(text)?.[1] || d;
  const teams = [];
  for (const m of text.matchAll(/\b(Finance|People|Sales)\s*(?:team)?\s*[:\-–]?\s*(\d+)\s+open/gi)) teams.push([m[1], Number(m[2])]);
  const requests = [];
  for (const m of text.matchAll(/(REQ-\d{3})\s*[|·:–-]\s*([^|\n]+?)\s*[|·]\s*(Finance|People|Sales)\s*[|·]\s*([A-Z][a-z]+ [A-Z][a-z]+)\s*[|·]\s*(Breaching SLA|Waiting|In progress)/g))
    requests.push({ id: m[1], title: m[2].trim(), team: m[3], agent: m[4], status: m[5] });
  return {
    fromSource: /Source document "/.test(text),
    open: n(/(\d+)\s+open requests/i, '48'),
    resolved: n(/(\d+)\s+(?:requests\s+)?resolved/i, '131'),
    breaching: n(/(\d+)\s+(?:requests\s+)?(?:are\s+)?breaching/i, '3'),
    sla: n(/within\s+(\d+)\s+business hours/i, '8'),
    teams: teams.length === 3 ? teams : [['Finance', 14], ['People', 9], ['Sales', 25]],
    requests: requests.length >= 3 ? requests : [
      { id: 'REQ-311', title: 'VPN drops for remote staff', team: 'Sales', agent: 'Rosa Nunez', status: 'Breaching SLA' },
      { id: 'REQ-307', title: 'Payroll export fails', team: 'Finance', agent: 'Asha Kumar', status: 'Breaching SLA' },
      { id: 'REQ-302', title: 'Shared drive access for new team', team: 'People', agent: 'Leo Martin', status: 'Breaching SLA' },
      { id: 'REQ-305', title: 'New laptop for starter', team: 'People', agent: 'Leo Martin', status: 'Waiting' },
      { id: 'REQ-298', title: 'Invoice approval access', team: 'Finance', agent: 'Asha Kumar', status: 'In progress' },
    ],
  };
}

// ---- directions -----------------------------------------------------------
const DIRECTIONS = {
  A: { key: 'calm', name: 'Clear and calm', tokens: { density: 'spacious', shadow: 'soft' }, eyebrow: '', lead: 'Open work and SLA risk across Finance, People and Sales.' },
  B: { key: 'bold', name: 'Bold and expressive', tokens: { typeScale: 1.33, shadow: 'medium' }, eyebrow: 'Live queue', lead: 'Every open request, the three at risk, and who owns them.' },
  C: { key: 'dense', name: 'Dense and efficient', tokens: { density: 'compact', shadow: 'crisp' }, eyebrow: '', lead: 'Queue health at a glance: counts, SLA risk and team load.' },
  D: { key: 'editorial', name: 'Warm and editorial', tokens: { headingFont: 'Fraunces' }, eyebrow: 'This month', lead: 'How the service desk is doing, in plain terms.' },
};
function directionOf(text) {
  const letter = /Direction ([A-D]) —/.exec(text)?.[1];
  return letter ? { letter, ...DIRECTIONS[letter] } : null;
}

// ---- plan -----------------------------------------------------------------
function plan(text) {
  const f = facts(text), d = directionOf(text);
  const projectDS = /Project design system: \{/.test(text);
  const suggested = /Suggested preset: ([a-z-]+)/.exec(text)?.[1];
  const teamLine = f.teams.map(([t, v]) => `${t} ${v}`).join(', ');
  return {
    title: d ? `IT service desk · ${d.name}` : 'IT service desk',
    summary: 'Agents see open work and SLA risk, triage the request queue, and act on a single request.',
    direction: d ? `${d.name}: ${d.key} take on a calm product UI with one accent` : 'Calm, precise product UI; compact tables, generous section spacing, one accent',
    preset: projectDS ? 'project' : suggested || 'neutral',
    // A direction is a style request, so it may adjust structure tokens; colours stay with the project system.
    tokens: d ? d.tokens : {},
    screens: [
      { id: 'overview', name: 'Overview', purpose: 'See open work and SLA risk at a glance', layout: 'app-shell with sidebar; page-header with title and a button to the queue; 3 stat tiles; bar chart card beside a needs-attention list', sections: [`Stats: ${f.open} open, ${f.resolved} resolved in September, ${f.breaching} breaching SLA`, `Open requests by team chart (${teamLine})`, 'Needs attention list linking to request detail'], states: ['empty'], links: ['requests', 'request-detail'] },
      { id: 'requests', name: 'Requests', purpose: 'Find and triage open requests', layout: 'same shell; page-header with Open/Resolved tabs; card with search filter and request table', sections: ['Search filter over request rows', 'Table: request, team, agent, status', 'Resolved tab empty state'], states: ['empty', 'filtered'], links: ['overview', 'request-detail'] },
      { id: 'request-detail', name: 'Request detail', purpose: 'Act on one request that is breaching SLA', layout: 'same shell; back button; page-header with status badge; activity timeline card beside a details card', sections: ['Activity timeline', 'Details: team, agent, status, due date unspecified', 'Reply dialog'], states: ['success'], links: ['requests'] },
    ],
    facts: [`${f.open} open requests`, `${f.resolved} resolved in September`, `${f.breaching} requests breaching SLA`, `First response within ${f.sla} business hours`, `Open by team: ${teamLine}`],
    tweaks: [
      { var: '--sidebar-width', label: 'Sidebar width', min: 200, max: 320, step: 4, unit: 'px', value: 248 },
      { var: '--aside-width', label: 'Side panel width', min: 280, max: 440, step: 8, unit: 'px', value: 340 },
    ],
  };
}

// ---- screens --------------------------------------------------------------
const CSS = `.overview-grid{display:grid;gap:var(--space-6);align-items:start}
@media (min-width:1024px){.overview-grid{grid-template-columns:minmax(0,1fr) var(--aside-width)}}
.detail-grid{display:grid;gap:var(--space-6);align-items:start}
@media (min-width:1024px){.detail-grid{grid-template-columns:minmax(0,1fr) var(--aside-width)}}
.request-meta{display:grid;grid-template-columns:7rem minmax(0,1fr);gap:var(--space-3) var(--space-4)}`;

const tone = (status) => (status === 'Breaching SLA' ? 'danger' : status === 'Waiting' ? 'warning' : 'info');
const ICON_FOR = { Sales: 'wifi-off', Finance: 'receipt', People: 'users' };

function shell(active, f, main, dialogs = '') {
  const nav = (id, iconName, label, extra = '') =>
    `<button class="nav-item${active === id ? ' is-active" aria-current="page' : ''}" data-action="navigate" data-target="${id}"><i data-icon="${iconName}"></i>${label}${extra}</button>`;
  return `<div class="app-shell">
  <aside class="sidebar">
    <div class="brand"><span class="brand-mark"><i data-icon="headphones"></i></span>Service Desk</div>
    <nav class="nav" aria-label="Main">
      <p class="nav-label">Workspace</p>
      ${nav('overview', 'layout-dashboard', 'Overview')}
      ${nav('requests', 'inbox', 'Requests', `<span class="badge badge-accent">${f.open}</span>`)}
    </nav>
    <div class="sidebar-footer"><span class="avatar avatar-sm" aria-hidden="true">AK</span><span class="min-w-0"><span class="block truncate text-sm font-medium">Asha Kumar</span><span class="block truncate text-xs text-muted">Finance agent</span></span></div>
  </aside>
  <header class="topbar">
    <p class="hidden text-sm text-muted md:block">Employee IT support · first response within ${f.sla} business hours</p>
    <button class="btn btn-primary ml-auto" data-action="open" data-target="new-request"><i data-icon="plus"></i>New request</button>
  </header>
  <main class="page">
${main}
  </main>
</div>
<dialog id="new-request" aria-labelledby="new-request-title">
  <form class="stack">
    <h2 id="new-request-title" class="dialog-title">New request</h2>
    <p class="dialog-description">Prototype only: nothing is sent.</p>
    <div class="field"><label for="new-request-summary">Summary</label><input id="new-request-summary" name="summary" type="text" required></div>
    <div class="field"><label for="new-request-team">Team</label><select id="new-request-team" name="team">${f.teams.map(([t]) => `<option>${t}</option>`).join('')}</select></div>
    <div class="dialog-footer"><button type="button" class="btn btn-ghost" data-action="close" data-target="new-request">Cancel</button><button type="submit" class="btn btn-primary">Submit request</button></div>
  </form>
</dialog>${dialogs}`;
}

function overview(f, d) {
  const breaching = f.requests.filter((r) => r.status === 'Breaching SLA');
  const chart = JSON.stringify({ type: 'bar', title: 'Open requests by team', labels: f.teams.map((t) => t[0]), series: [{ name: 'Open', values: f.teams.map((t) => t[1]) }], unit: '' });
  const stat = (iconName, label, value, delta, cls = '') => `      <div class="stat"><p class="stat-label"><i data-icon="${iconName}"></i>${label}</p><p class="stat-value">${value}</p><p class="stat-delta${cls}">${delta}</p></div>`;
  return shell('overview', f, `    <div class="page-header">
      <div>${d?.eyebrow ? `<p class="eyebrow">${esc(d.eyebrow)}</p>` : ''}<h1>Service overview</h1><p>${esc(d?.lead || DIRECTIONS.A.lead)}</p></div>
      <button class="btn btn-secondary" data-action="navigate" data-target="requests"><i data-icon="inbox"></i>Open the queue</button>
    </div>
    <section class="grid gap-4 sm:grid-cols-3" aria-label="Key figures">
${stat('inbox', 'Open requests', f.open, 'Across three teams')}
${stat('circle-check', 'Resolved in September', f.resolved, 'Closed this month', ' is-positive')}
${stat('triangle-alert', 'Breaching SLA', f.breaching, `First response over ${f.sla} business hours`, ' is-negative')}
    </section>
    <div class="overview-grid">
      <section class="card" aria-labelledby="team-chart-title">
        <div class="card-header"><h2 id="team-chart-title" class="card-title">Open requests by team</h2><span class="badge badge-neutral">${f.open} open</span></div>
        <div class="card-body"><figure class="chart" data-chart='${chart}'></figure></div>
      </section>
      <section class="card" aria-labelledby="attention-title">
        <div class="card-header"><h2 id="attention-title" class="card-title">Needs attention</h2><span class="badge badge-danger badge-dot">${f.breaching} breaching</span></div>
        <ul class="list">
${breaching.map((r) => `          <li><button class="list-item" data-action="navigate" data-target="request-detail"><span class="icon-tile"><i data-icon="${ICON_FOR[r.team] || 'inbox'}"></i></span><span class="min-w-0 flex-1"><span class="block truncate font-medium">${r.id} ${esc(r.title)}</span><span class="block truncate text-sm text-muted">${r.team} · ${r.agent}</span></span><i data-icon="chevron-right" class="text-muted"></i></button></li>`).join('\n')}
        </ul>
      </section>
    </div>`);
}

function requests(f) {
  const rows = f.requests
    .map((r) => `            <tr data-row><td data-label="Request"><button class="font-medium text-accent-strong hover:underline" data-action="navigate" data-target="request-detail">${r.id} ${esc(r.title)}</button></td><td data-label="Team">${r.team}</td><td data-label="Agent">${r.agent}</td><td data-label="Status"><span class="badge badge-${tone(r.status)}${r.status === 'Breaching SLA' ? ' badge-dot' : ''}">${r.status}</span></td></tr>`)
    .join('\n');
  return shell('requests', f, `    <div class="page-header">
      <div><h1>Requests</h1><p>${f.open} open requests. First response is due within ${f.sla} business hours.</p></div>
      <div class="tabs tabs-pill" role="tablist" aria-label="Status">
        <button class="tab" role="tab" aria-selected="true" data-action="tab" data-group="status" data-target="open-panel">Open</button>
        <button class="tab" role="tab" aria-selected="false" data-action="tab" data-group="status" data-target="resolved-panel">Resolved</button>
      </div>
    </div>
    <section id="open-panel" data-panel="status" class="card" aria-label="Open requests">
      <div class="card-header"><div class="input-icon w-full max-w-sm"><i data-icon="search"></i><input type="search" placeholder="Search by request, team or agent" aria-label="Search requests" data-action="filter" data-target="request-rows"></div><span class="badge badge-neutral">${f.requests.length} of ${f.open} shown</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th scope="col">Request</th><th scope="col">Team</th><th scope="col">Agent</th><th scope="col">Status</th></tr></thead>
          <tbody id="request-rows">
${rows}
          </tbody>
        </table>
      </div>
    </section>
    <section id="resolved-panel" data-panel="status" class="card" hidden>
      <div class="empty-state"><span class="icon-tile"><i data-icon="circle-check"></i></span><h3>${f.resolved} requests resolved in September</h3><p>Resolved requests leave the open queue.</p><button class="btn btn-secondary" data-action="navigate" data-target="overview">Back to overview</button></div>
    </section>`);
}

function requestDetail(f) {
  const r = f.requests[0];
  return shell('requests', f, `    <button class="btn btn-ghost btn-sm self-start" data-action="navigate" data-target="requests"><i data-icon="arrow-left"></i>Back to requests</button>
    <div class="page-header">
      <div><h1>${r.id} ${esc(r.title)}</h1><p>${r.team} · assigned to ${r.agent}</p></div>
      <span class="badge badge-${tone(r.status)} badge-dot">${r.status}</span>
    </div>
    <div class="detail-grid">
      <section class="card" aria-labelledby="activity-title">
        <div class="card-header"><h2 id="activity-title" class="card-title">Activity</h2></div>
        <div class="card-body">
          <ol class="timeline">
            <li class="is-complete"><time>Opened</time><strong>Logged by ${r.team}</strong><p>${esc(r.title)}.</p></li>
            <li class="is-complete"><time>Assigned</time><strong>${r.agent} picked it up</strong><p>Owner for ${r.team} requests.</p></li>
            <li class="is-active"><time>Now</time><strong>First response overdue</strong><p>The ${f.sla} business hour first-response window has passed.</p></li>
          </ol>
        </div>
      </section>
      <aside class="card" aria-labelledby="details-title">
        <div class="card-header"><h2 id="details-title" class="card-title">Details</h2></div>
        <dl class="card-body request-meta text-sm"><dt class="text-muted">Team</dt><dd>${r.team}</dd><dt class="text-muted">Agent</dt><dd>${r.agent}</dd><dt class="text-muted">Status</dt><dd><span class="badge badge-${tone(r.status)}">${r.status}</span></dd><dt class="text-muted">Due date</dt><dd>Unspecified</dd></dl>
        <div class="card-footer"><button class="btn btn-secondary" data-action="open" data-target="reply-dialog"><i data-icon="message-square"></i>Reply to requester</button></div>
      </aside>
    </div>`, `
<dialog id="reply-dialog" aria-labelledby="reply-title">
  <form class="stack">
    <h2 id="reply-title" class="dialog-title">Reply to requester</h2>
    <div class="field"><label for="reply-text">Message</label><textarea id="reply-text" name="message" rows="4" required></textarea></div>
    <div class="dialog-footer"><button type="button" class="btn btn-ghost" data-action="close" data-target="reply-dialog">Cancel</button><button type="submit" class="btn btn-primary">Send reply</button></div>
  </form>
</dialog>`);
}

const SCREENS = { overview, requests, 'request-detail': requestDetail };
function build(text) {
  const id = /Build screen "([^"]+)"/.exec(text)?.[1] || 'overview';
  const name = /Build screen "[^"]+" \(([^)]+)\)/.exec(text)?.[1] || id;
  const first = /You are building the first screen/.test(text);
  // The build prompt carries the plan's direction line, which names the direction.
  const named = /"direction":"([A-Za-z ]+):/.exec(text)?.[1];
  const letter = Object.keys(DIRECTIONS).find((k) => DIRECTIONS[k].name === named);
  const f = facts(text), d = letter ? { letter, ...DIRECTIONS[letter] } : null;
  const html = (SCREENS[id] || overview)(f, d);
  return `${first ? `<forma-css>\n${CSS}\n</forma-css>\n` : ''}<forma-screen id="${id}" name="${esc(name)}">\n${html}\n</forma-screen>`;
}

// ---- revisions ------------------------------------------------------------
function currentScreens(text) {
  const out = [];
  for (const m of text.matchAll(/<forma-screen id="([^"]+)" name="([^"]*)">\n([\s\S]*?)\n<\/forma-screen>/g)) out.push({ id: m[1], name: m[2], html: m[3] });
  return out;
}
function insertBefore(html, marker, snippet) {
  const i = html.indexOf(marker);
  return i < 0 ? html.replace('</main>', `${snippet}\n</main>`) : html.slice(0, i) + snippet + '\n    ' + html.slice(i);
}
function revise(text) {
  const screens = currentScreens(text), f = facts(text);
  // The server's review pass: "Correct these review findings ..."
  if (/Correct these review findings/.test(text)) {
    const s = screens.find((x) => x.id === 'request-detail') || screens.at(-1);
    const alert = `<div class="alert alert-warning" role="status"><i data-icon="timer"></i><div><p class="alert-title">SLA target: first response within ${f.sla} business hours</p><p>This request has passed the target. Reply to the requester or reassign it.</p></div></div>`;
    return `The review asked for the SLA target to be stated on the request itself.\n<forma-screen id="${s.id}" name="${esc(s.name)}">\n${insertBefore(s.html, '<div class="detail-grid">', alert)}\n</forma-screen>`;
  }
  const task = /\nTask: ([\s\S]*?)\nReturn only the changed blocks\./.exec(text)?.[1] || '';
  const target = screens.find((s) => new RegExp(`\\b${s.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(task)) || screens[0];
  const callout = `<div class="alert alert-warning" role="status"><i data-icon="triangle-alert"></i><div><p class="alert-title">${f.breaching} requests are breaching SLA</p><p>Each is past the ${f.sla} business hour first-response target.</p></div></div>`;
  const marker = target.html.includes('<section id="open-panel"') ? '<section id="open-panel"' : '<section';
  return `<forma-screen id="${target.id}" name="${esc(target.name)}">\n${insertBefore(target.html, marker, callout)}\n</forma-screen>\n<forma-meta>{"summary":"Agents see open work and SLA risk, triage the request queue with an SLA callout, and act on a single request."}</forma-meta>`;
}

// ---- element edit ---------------------------------------------------------
function element(text) {
  const el = /Selected element \(stored HTML\):\n([\s\S]*?)\nInstruction for this element: /.exec(text)?.[1] || '';
  const instruction = /Instruction for this element: ([\s\S]*)$/.exec(text)?.[1] || '';
  const m = /^<([a-z][a-z0-9]*)([^>]*)>([\s\S]*)<\/\1>$/i.exec(el.trim());
  if (!m) return `<forma-element>\n<div class="alert alert-info" role="status"><i data-icon="info"></i><div><p>${esc(instruction.slice(0, 120))}</p></div></div>\n</forma-element>`;
  const [, tag, attrs, inner] = m;
  const badge = /badge|status|live/i.test(instruction) ? '<span class="badge badge-success badge-dot ml-3 align-middle">Live</span>' : '';
  const body = /^h[1-3]$/i.test(tag) ? `Service desk overview${badge}` : `${inner}${badge}`;
  return `Kept the heading tag and classes; made the title specific and added a status badge.\n<forma-element>\n<${tag}${attrs}>${body}</${tag}>\n</forma-element>`;
}

// ---- review ---------------------------------------------------------------
function review(text) {
  const candidate = /Candidate artifact: ([\s\S]*)$/.exec(text)?.[1] || '';
  if (/"kind":"web"/.test(candidate) && !/SLA target/.test(candidate))
    return JSON.stringify({ issues: ['Request detail does not state the first-response SLA target from the source document (8 business hours); add it near the status so agents see the commitment.'], summary: 'Facts match the source document. Navigation, tables and dialogs are complete; one missing SLA statement on Request detail.' });
  return JSON.stringify({ issues: [], summary: 'Facts, names and numbers match the source document; no unsupported additions.' });
}

// ---- slides and documents (one-call JSON) -----------------------------------
const THEME = { accent: '#1d4ed8', background: '#ffffff', text: '#0f172a' };
function documentJSON(text) {
  const f = facts(text), breaching = f.requests.filter((r) => r.status === 'Breaching SLA');
  return {
    kind: 'document',
    title: 'Service desk summary: September',
    subtitle: 'For IT operations leads',
    summary: `${f.open} open requests, ${f.breaching} breaching the first-response SLA.`,
    theme: THEME,
    blocks: [
      { type: 'paragraph', text: `${f.open} requests are open and ${f.breaching} are breaching the first-response target of ${f.sla} business hours. ${f.resolved} requests were resolved in September.` },
      { type: 'heading', text: 'Open requests by team' },
      { type: 'table', table: { headers: ['Team', 'Open requests'], rows: f.teams.map(([t, v]) => [t, String(v)]) } },
      { type: 'heading', text: 'Requests breaching SLA' },
      { type: 'bullets', items: breaching.map((r) => `${r.id} ${r.title} (${r.team}, ${r.agent})`) },
      { type: 'heading', text: 'Open questions' },
      { type: 'paragraph', text: 'Due dates for the breaching requests are unspecified in the source document.' },
    ],
  };
}
function slidesJSON(text) {
  const f = facts(text);
  return {
    kind: 'slides',
    title: 'Service desk: September',
    summary: 'Queue health for IT operations leads.',
    theme: THEME,
    slides: [
      { layout: 'cover', title: 'Service desk: September', subtitle: 'Queue health and SLA risk', body: '', bullets: [], notes: 'Source: service desk facts document.' },
      { layout: 'bullets', title: `${f.breaching} requests are breaching SLA`, body: `First response is due within ${f.sla} business hours.`, bullets: f.requests.filter((r) => r.status === 'Breaching SLA').map((r) => `${r.id} ${r.title}`), notes: '' },
      { layout: 'table', title: 'Open requests by team', body: '', bullets: [], table: { headers: ['Team', 'Open'], rows: f.teams.map(([t, v]) => [t, String(v)]) }, notes: '' },
    ],
  };
}

// ---- stage detection --------------------------------------------------------
function textOf(content) {
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.filter((p) => p?.type === 'text').map((p) => p.text).join('\n') : '';
}
function imagesOf(messages) {
  let n = 0;
  for (const m of messages) if (Array.isArray(m.content)) n += m.content.filter((p) => p?.type === 'image_url').length;
  return n;
}
function stageOf(system, user) {
  if (/ELEMENT EDIT MODE/.test(system)) return 'element';
  if (/REVISION MODE/.test(system)) return 'revise';
  if (/^You are the design lead of Forma/.test(system)) return 'plan';
  if (/^You are a senior product designer/.test(system)) return 'build';
  if (/^You check artifacts against supplied user briefs/.test(system)) return 'review';
  const kind = /^You create useful, editable internal (web|slides|document) artifacts/.exec(system)?.[1];
  if (kind) return kind === 'document' ? 'document' : kind === 'slides' ? 'slides' : 'web-json';
  if (/Reply with the word connected/.test(user)) return 'test';
  return 'unknown';
}
const REASONING = {
  plan: 'The brief is an IT service desk for agents. Source facts: open, resolved and breaching counts, the SLA, and team load. Three screens cover the flow: overview, queue, detail. Tweaks: sidebar width and the side panel width used by the grid.',
  build: 'Reuse the app shell. Kit components first: stat tiles, card with chart, list for attention items, table with data-label cells. Navigation targets are planned screen ids. One primary action.',
  revise: 'Only the affected screen changes; every other screen is omitted so it stays byte-identical.',
  element: 'Same root tag, same classes; change only what the instruction asks.',
  review: 'Compare candidate facts with the source document and the request; check the lint summary.',
  document: 'Concise working document: conclusion first, team table, breaching list, open questions.',
  slides: 'Three slides: cover, SLA risk, team table.',
};
function answer(stage, text) {
  switch (stage) {
    case 'plan': return JSON.stringify(plan(text));
    case 'build': return build(text);
    case 'revise': return revise(text);
    case 'element': return element(text);
    case 'review': return review(text);
    case 'document': return JSON.stringify(documentJSON(text));
    case 'slides': return JSON.stringify(slidesJSON(text));
    case 'test': return '{"status":"connected"}';
    default: return '{"error":"unrecognised prompt"}';
  }
}
// Approximate time a flash model spends on each stage (ms), scaled by opts.pace.
const PACE = { plan: 1400, build: 1600, revise: 1400, element: 900, review: 800, document: 1200, slides: 1000, test: 100, unknown: 100 };

function startMock(opts = {}) {
  const requests = [];
  const pace = Number.isFinite(opts.pace) ? opts.pace : 1;
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/__requests') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(requests.map(({ text, ...r }) => ({ ...r, chars: text.length }))));
      }
      if (req.method !== 'POST' || !/\/chat\/completions$/.test(req.url)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end('{"error":{"message":"not found"}}');
      }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const system = textOf(messages.find((m) => m.role === 'system')?.content);
      const user = messages.filter((m) => m.role === 'user').map((m) => textOf(m.content)).join('\n');
      const stage = stageOf(system, user);
      const repair = messages.some((m) => m.role === 'assistant');
      const record = { n: requests.length + 1, stage, repair, stream: !!body.stream, model: body.model, effort: body.reasoning_effort, maxTokens: body.max_tokens, auth: req.headers.authorization ? 'bearer' : 'none', images: imagesOf(messages), at: Date.now(), text: user };
      requests.push(record);
      const content = answer(stage, user);
      const reasoning = REASONING[stage] || '';
      const usage = { prompt_tokens: Math.ceil((system.length + user.length) / 4) + record.images * 800, completion_tokens: Math.ceil((content.length + reasoning.length) / 4), total_tokens: 0, completion_tokens_details: { reasoning_tokens: Math.ceil(reasoning.length / 4) } };
      usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
      const total = (PACE[stage] || 300) * pace;
      const id = 'chatcmpl-mock-' + record.n, created = Math.floor(Date.now() / 1000);
      if (!body.stream) {
        await sleep(total);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ id, object: 'chat.completion', created, model: body.model, choices: [{ index: 0, message: { role: 'assistant', content, reasoning_content: reasoning }, finish_reason: 'stop' }], usage }));
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      const send = (delta, finish = null) => res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      const split = (s, n) => { const size = Math.max(1, Math.ceil(s.length / n)), out = []; for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size)); return out; };
      const rParts = split(reasoning, 6), cParts = split(content, 24), step = total / (rParts.length + cParts.length + 1);
      send({ role: 'assistant', content: '' });
      res.write(': keep-alive\n\n');
      for (const p of rParts) { send({ reasoning_content: p }); await sleep(step); }
      for (const p of cParts) { send({ content: p }); await sleep(step); }
      send({}, 'stop');
      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: body.model, choices: [], usage })}\n\n`);
      res.end('data: [DONE]\n\n');
    } catch (e) {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: String(e?.message || e) } }));
    }
  });
  return new Promise((resolve) =>
    server.listen(opts.port || 0, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}`;
      resolve({ url, base: url + '/v1', requests, server, close: () => new Promise((r) => (server.closeAllConnections?.(), server.close(() => r()))) });
    }),
  );
}

module.exports = { startMock, facts, plan, build, revise, element, review, documentJSON, slidesJSON, stageOf };
if (require.main === module) startMock({ port: Number(process.argv[2]) || 0 }).then((m) => console.log(`GLM mock listening: GLM_BASE_URL=${m.base}`));
