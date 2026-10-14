# Forma 0.2.0: short team review

Purpose: decide whether the UI/UX workflow helps real work. This release has local software verification and curated starter coverage; this version's generation quality must still be observed on the organisation's GLM endpoint. Earlier task reports do not automatically verify the new multi-screen prompt and editor.

## Owner check before inviting the team

Update a backed-up copy using UPDATE-WINDOWS.txt. Keep the existing approved GLM settings. Open one starter, change a heading, save, reopen and export its handoff ZIP. Confirm the ZIP's index.html opens and navigation works.

Run one representative synthetic UI task through the actual endpoint. For example: "Design an internal equipment request flow with Overview, Requests, Request detail and New request screens. Use labelled fictional sample data. Link the screens. Provide search with an empty state, a dismissible detail dialog, and a clearly simulated submit confirmation. Make it work at desktop and 390-pixel mobile widths. Do not invent approval policy, deadlines or prices."

Revise one named heading or screen and check that the other screens retain their contents. Inspect Checks, exercise the primary path with mouse and keyboard, and open the handoff. This is a new product smoke check; it does not replace or modify the existing benchmark prompts or scoring.

Do not invite reviewers if generation fails, saved work disappears, the primary flow is broken or the export cannot open. Record the visible error and version; demo fixtures cannot stand in for successful GLM generation.

## Give 3–5 reviewers one useful task each

Ask for a task they understand, using data approved for the configured service. Let them generate or start from a template, make one visual edit, revise one detail and hand it off. Target a 20–30 minute session. Capture blockers first, then unnecessary steps, visual quality, missing controls and usefulness of the exported artifact. Do not require a fresh full benchmark before collecting human feedback.

## Return one Markdown file

No ZIP or screenshot is required. Keep confidential content inside the organisation. A redacted description or fictional reproduction is enough to start diagnosis.

- Forma version / model ID / test date:
- Task and expected useful result:
- Starting point: GLM generation, starter or imported artifact:
- Main flow works: yes / no; failed step:
- Revision preserved other screens: yes / no; example:
- Manual editing and save/reopen: yes / no:
- Export opens and remains useful: yes / no; format:
- Checks warnings and visible errors:
- Time waiting / time editing / cleanup effort:
- Reviewer rating: useful now / useful after a fix / not useful:
- Three most important improvements:

Native Office rendering, shared-network deployment and concurrent use require checks in their actual environment. A single-user local pass is not a load or production-security certification.
