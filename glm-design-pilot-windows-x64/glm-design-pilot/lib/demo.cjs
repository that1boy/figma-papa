'use strict';
// Fixed demonstration artifacts for MODEL_MODE=demo (no model calls). The web demo is
// built only from the Forma kit, utility classes, <i data-icon> icons and one data-chart,
// on a curated preset, so demo previews look like the 0.3 engine output. Every figure is
// labelled sample data. test/browser.cjs and test/core.test.cjs rely on its ids and copy
// (#leave, #requests rows, the request dialog, "Create a request", "Save example request").
const { preset } = require('./presets.cjs');
const WEB_SYSTEM = Object.freeze({ ...preset('neutral').tokens, name: 'Northstar People' });
const chart = (spec) => `<figure class="chart" data-chart='${JSON.stringify(spec)}'></figure>`;
const service = (icon, title, text, action) => `<article class="card feature"><span class="icon-tile"><i data-icon="${icon}"></i></span><h3>${title}</h3><p>${text}</p>${action}</article>`;
const row = (request, team, status, tone) => `<tr data-row><td data-label="Request" class="font-medium">${request}</td><td data-label="Team">${team}</td><td data-label="Status"><span class="badge ${tone} badge-dot">${status}</span></td></tr>`;
const WEB_HTML =
  `<header class="topbar"><div class="brand"><span class="brand-mark"><i data-icon="sparkles"></i></span>Northstar / People</div><span class="badge badge-neutral badge-dot ml-auto">Demonstration data</span></header>` +
  `<main class="container stack gap-10 py-8 sm:py-12">` +
  `<section class="grid items-center gap-8 lg:grid-cols-2"><div class="stack gap-4"><p class="eyebrow">Employee services</p><h1>A little less admin.<br>More room for your work.</h1><p class="lead">Find the right service, track a request, and get back to your day.</p><div class="cluster"><button class="btn btn-primary btn-lg" data-action="open" data-target="request"><i data-icon="plus"></i>Create a request</button></div></div>` +
  `<div class="card">${chart({ type: 'bar', title: 'Requests by service', labels: ['Time away', 'Equipment', 'People support'], series: [{ name: 'Requests', values: [42, 27, 18] }], caption: 'Example quarter. Sample data, not company figures.' })}</div></section>` +
  `<section class="stack gap-5" aria-labelledby="services-title"><div class="stack gap-1"><h2 id="services-title">Services</h2><p class="text-muted">Start with the service that fits what you need.</p></div><div class="feature-grid">` +
  service('calendar-days', 'Time away', 'Plan leave and review your upcoming days off.', `<button class="btn btn-ghost -ml-3" aria-expanded="false" data-action="toggle" data-target="leave"><i data-icon="eye"></i>View leave details</button><p id="leave" hidden class="text-sm">Example balance: 12 days. This is sample data.</p>`) +
  service('laptop', 'Equipment', 'Request the tools you need to do your best work.', `<button class="btn btn-ghost -ml-3" data-action="open" data-target="request"><i data-icon="package"></i>Request equipment</button>`) +
  service('life-buoy', 'People support', 'Find help with policies, benefits, and onboarding.', `<button class="btn btn-ghost -ml-3" aria-expanded="false" data-action="toggle" data-target="contact"><i data-icon="message-circle"></i>Contact the team</button><p id="contact" hidden class="text-sm">Support contacts are not configured in this demonstration.</p>`) +
  `</div></section>` +
  `<section class="card" aria-labelledby="requests-title"><div class="card-header"><h2 id="requests-title" class="card-title">Your requests</h2><div class="input-icon sm:max-w-xs"><i data-icon="search"></i><input type="search" aria-label="Search requests" placeholder="Search requests…" data-action="filter" data-target="requests"></div></div>` +
  `<div class="table-wrap"><table><thead><tr><th scope="col">Request</th><th scope="col">Team</th><th scope="col">Status</th></tr></thead><tbody id="requests">${row('Monitor replacement', 'Workplace technology', 'In progress', 'badge-warning')}${row('Annual leave', 'People operations', 'Approved', 'badge-success')}</tbody></table></div></section>` +
  `</main>` +
  `<footer class="border-t border-border"><p class="container py-6 text-sm text-muted">Fixed demonstration content. Connect your GLM endpoint to generate from your own brief.</p></footer>` +
  `<dialog id="request" aria-labelledby="request-title"><form class="stack gap-4"><div><h2 id="request-title" class="dialog-title">New service request</h2><p class="dialog-description">Nothing is sent or stored in this demonstration.</p></div><div class="field"><label for="request-need">What do you need?</label><input id="request-need" name="need" required placeholder="Describe your request"></div><div class="dialog-footer"><button type="button" class="btn btn-secondary" data-action="close" data-target="request">Close</button><button type="submit" class="btn btn-primary">Save example request</button></div></form></dialog>`;
// The kit styles everything else; only the runtime's empty-search message needs room in the card.
const WEB_CSS = '[data-forma-filter-status]{margin:0;padding:var(--space-6) var(--pad);text-align:center}';
function demo(kind, previous) {
  if (previous) return structuredClone(previous);
  const common = {
    kind,
    title: 'Employee services',
    summary:
      'Fixed demonstration content. Connect your GLM endpoint to generate from your own brief.',
    theme: { accent: '#6554c0', background: '#faf9f6', text: '#202333' },
  };
  if (kind === 'web')
    return {
      ...common,
      theme: { accent: WEB_SYSTEM.accent, background: WEB_SYSTEM.background, text: WEB_SYSTEM.text },
      designSystem: { ...WEB_SYSTEM },
      html: WEB_HTML,
      css: WEB_CSS,
    };
  if (kind === 'slides')
    return {
      ...common,
      title: 'A better employee service experience',
      slides: [
        {
          layout: 'cover',
          title: 'A better employee service experience',
          subtitle: 'A proposal for a small internal pilot',
          body: 'One place to find services and track requests.',
          notes: 'Fixed demonstration deck. No company performance data is asserted.',
        },
        // Slides v2 layouts (cards, timeline) around the table slide. core.test pins four slides
        // with the table third; test/browser.cjs adds body text and a bullet to that table slide.
        {
          layout: 'cards',
          title: 'The proposed experience',
          cards: [
            { title: 'For employees', body: 'A clear starting point: find the right service, see request status and know who can help.', icon: 'users' },
            { title: 'For service teams', body: 'Consistent intake and clearer ownership, with requests routed to the right owner.', icon: 'route' },
            { title: 'For the pilot review', body: 'Evidence from the pilot, not assumptions, before any decision to expand.', icon: 'clipboard-check' },
          ],
          notes: 'These are proposed capabilities, not measured results.',
        },
        {
          layout: 'table',
          title: 'Pilot scope',
          table: {
            headers: ['Service', 'Example request', 'Pilot owner'],
            rows: [
              ['People operations', 'Leave and policy questions', 'To be assigned'],
              ['Workplace technology', 'Equipment replacement', 'To be assigned'],
              ['Facilities', 'Workspace support', 'To be assigned'],
            ],
          },
          notes: 'Owners are placeholders.',
        },
        {
          layout: 'timeline',
          title: 'Evidence for the rollout decision',
          body: 'Compare the pilot with the current service process.',
          steps: [
            { label: 'Measure', title: 'Submission time', detail: 'How long it takes to submit a complete request.' },
            { label: 'Review', title: 'Routing accuracy', detail: 'Whether requests reach the right team, and which questions go unanswered.' },
            { label: 'Listen', title: 'Feedback', detail: 'What employees and service teams say about the new process.' },
            { label: 'Decide', title: 'Expand or adjust', detail: 'Expand only after reviewing the evidence.' },
          ],
          notes: 'Set acceptance thresholds before evaluating the pilot. No dates are set for these steps.',
        },
      ],
    };
  return {
    ...common,
    title: 'Employee services pilot proposal',
    subtitle: 'Scope and evaluation plan',
    blocks: [
      {
        type: 'paragraph',
        text: 'This proposal describes a small internal portal for employee service requests. The pilot will test whether a shared starting point makes it easier to find support and submit a complete request.',
      },
      { type: 'heading', text: 'Scope' },
      {
        type: 'paragraph',
        text: 'The first version covers people operations, workplace technology, and facilities. Employees can select a service, describe a request, and view its status. Each participating team will nominate an owner before the pilot starts.',
      },
      {
        type: 'table',
        table: {
          headers: ['Workstream', 'Deliverable'],
          rows: [
            ['Service catalogue', 'Approved descriptions and routing owners'],
            ['Request experience', 'Forms and status views'],
            ['Evaluation', 'Task completion and feedback records'],
          ],
        },
      },
      { type: 'heading', text: 'Evaluation' },
      {
        type: 'bullets',
        items: [
          'Compare completion time with the existing process.',
          'Check whether requests reach the correct team with enough information.',
          'Review employee feedback and unresolved issues before expanding.',
        ],
      },
      { type: 'heading', text: 'Open decisions' },
      {
        type: 'paragraph',
        text: 'Pilot dates, participating teams, and acceptance thresholds remain to be agreed. This fixed demonstration contains no measured company results.',
      },
    ],
  };
}
module.exports = { demo };
