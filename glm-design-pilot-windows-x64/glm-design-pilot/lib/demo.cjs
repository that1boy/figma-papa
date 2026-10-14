'use strict';
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
      html: `<header class="top"><strong>Northstar / People</strong><span>Demonstration data</span></header><main><div class="intro"><p class="eyebrow">EMPLOYEE SERVICES</p><h1>A little less admin.<br>More room for your work.</h1><p>Find the right service, track a request, and get back to your day.</p><button data-action="open" data-target="request">Create a request ↗</button></div><section class="services"><article><span>01</span><h2>Time away</h2><p>Plan leave and review your upcoming days off.</p><button data-action="toggle" data-target="leave">View leave details</button><p id="leave" hidden>Example balance: 12 days. This is sample data.</p></article><article><span>02</span><h2>Equipment</h2><p>Request the tools you need to do your best work.</p><button data-action="open" data-target="request">Request equipment</button></article><article><span>03</span><h2>People support</h2><p>Find help with policies, benefits, and onboarding.</p><button data-action="toggle" data-target="contact">Contact the team</button><p id="contact" hidden>Your internal support contact goes here.</p></article></section><section class="requests"><div class="row"><h2>Your requests</h2><input type="search" aria-label="Search requests" placeholder="Search requests…" data-action="filter" data-target="requests"></div><table><thead><tr><th>Request</th><th>Team</th><th>Status</th></tr></thead><tbody id="requests"><tr data-row><td>Monitor replacement</td><td>Workplace technology</td><td><span class="status">In progress</span></td></tr><tr data-row><td>Annual leave</td><td>People operations</td><td><span class="status done">Approved</span></td></tr></tbody></table></section></main><dialog id="request"><h2>New service request</h2><form><label>What do you need?<input required placeholder="Describe your request"></label><button type="submit">Save example request</button></form><button data-action="close" data-target="request">Close</button></dialog>`,
      css: `*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:#faf9f6;color:#242435}.top{padding:24px 5%;border-bottom:1px solid #e5e3df;display:flex;justify-content:space-between}.top span{font-size:12px;color:#73717d}main{max-width:1200px;margin:auto;padding:48px 5%}.eyebrow{letter-spacing:2px;font-size:12px;color:#6554c0}h1{font-size:48px;line-height:1.12;letter-spacing:-2px;margin:20px 0}p{line-height:1.6;color:#686674}button{background:#6554c0;color:white;border:0;border-radius:6px;padding:13px 18px;cursor:pointer;font:inherit}.intro{padding-bottom:40px}.services{display:grid;grid-template-columns:repeat(3,1fr);gap:32px;border-top:1px solid #ddd;padding-top:30px}.services article>span{font-size:12px;color:#888}.services h2{font-size:22px}.services button{background:transparent;color:#6554c0;padding:8px 0}.requests{margin-top:45px}.row{display:flex;align-items:center;justify-content:space-between}input{border:1px solid #ddd;border-radius:5px;padding:12px;font:inherit}table{width:100%;border-collapse:collapse;text-align:left}th,td{padding:18px 10px;border-bottom:1px solid #e7e5df;font-size:14px}th{color:#777;font-weight:normal}.status{background:#eeeafa;color:#6554c0;padding:7px 10px;border-radius:20px;font-size:12px}.done{background:#e6f2e9;color:#31754c}dialog{border:1px solid #ddd;border-radius:12px;padding:30px;max-width:500px}dialog::backdrop{background:#0006}dialog input{display:block;margin:12px 0}dialog button{margin:8px 8px 0 0}@media(max-width:650px){h1{font-size:34px}.services{grid-template-columns:1fr}.row{display:block}table{font-size:12px}}`,
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
        {
          layout: 'two-column',
          title: 'The proposed experience',
          columns: [
            {
              heading: 'For employees',
              body: 'A clear starting point for everyday requests.',
              bullets: ['Find the right service', 'See request status', 'Know who can help'],
            },
            {
              heading: 'For service teams',
              body: 'Consistent intake and clearer ownership.',
              bullets: [
                'Collect the required details',
                'Route requests to the right owner',
                'Keep employees informed',
              ],
            },
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
          layout: 'bullets',
          title: 'Evidence for the rollout decision',
          body: 'Compare the pilot with the current service process.',
          bullets: [
            'Measure time to submit a complete request',
            'Review routing accuracy and unanswered questions',
            'Collect employee and service-team feedback',
            'Expand only after reviewing the evidence',
          ],
          notes: 'Set acceptance thresholds before evaluating the pilot.',
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
