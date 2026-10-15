# Forma release notes

## 0.3.0 — 15 October 2026

Generation is rebuilt around a fast, smaller model: the organisation's GLM-5.3-Flash. The aim is output close to Claude Design while every call stays on the internal endpoint and the app works offline.

**Design engine**
- A design kit the model composes from instead of writing CSS from scratch: a Tailwind-compatible utility engine (CSS generated on demand for the classes a design uses), a token-driven component library, 10 curated design-system presets, 11 bundled open-source font families (embedded in every page, so previews, exports and renders look the same everywhere), 1,890 Lucide icons via `<i data-icon>`, accessible SVG charts from `data-chart` JSON (bar, horizontal bar, stacked bar, line, area, donut, pie, sparkline), and sanitized inline SVG.
- A staged pipeline for web projects: plan (JSON) → first screen with shared CSS → remaining screens in parallel → assemble and validate. Screens are raw HTML in tagged blocks rather than escaped JSON strings; forbidden CSS is removed deterministically instead of costing a repair call. `GLM_PIPELINE=single` keeps the 0.2 one-call behaviour.
- Revisions return only the screens that change; unchanged screens stay byte-identical. A review correction is applied the same way.
- Directions: 2–4 different variants in parallel (calm, bold, dense, editorial), each saved as a revision; pick one with **Use this direction**.
- GLM element edits: select an element and describe a change; only that element is sent and replaced, as an undoable draft change.
- Tweak sliders for layout knobs proposed in the plan and for core tokens, applied live in the preview.
- Deterministic design lint (static and in the browser at desktop, tablet and mobile): contrast, small text, tap targets, overflow, clipped and overlapping text, alt text, unnamed controls, heading order, broken navigation, unknown classes and icons. Lint errors are merged into the review so the correction pass fixes them; the score and findings appear in chat and Checks. Content inside closed accordions (`<details>`) is treated as hidden, as the browser shows it.

**GLM client**
- Streaming with live progress, retries with backoff for network errors and HTTP 429/5xx, `<think>` stripping for misconfigured reasoning parsers, tolerant JSON extraction, per-stage `reasoning_effort` (review defaults to `low`), image caps, and an automatic text-only fallback when the endpoint rejects images (`GLM_VISION=auto`). Every call is recorded with stage, duration, tokens, retries and whether images were dropped.
- System prompts contain no project data, so an inference server's prefix cache can reuse them.

**Inputs and styles**
- Up to 6 reference images (PNG, JPEG, WebP) and up to 6 source documents (DOCX, PPTX, XLSX, CSV, TSV, TXT, Markdown, HTML, JSON; PDF with Poppler), extracted with zip-bomb and XML-entity protection and passed to GLM as facts.
- A preset can be chosen when creating a project. Design tokens import from CSS, W3C/Style Dictionary token JSON or a Tailwind config. 0.2 design systems gain the new tokens automatically.

**Workspace and studio**
- Chat thread with what each generation changed, live progress, retry for failed jobs, suggestion chips and Ctrl/Cmd+Enter.
- Sources panel, directions picker, tweaks panel, token import, kit-based components, and a Checks tab with the lint report and a model-calls table.
- Rebuilt curated starters and demo fixtures on the kit. All three starters pass the design lint with no errors or warnings, including 44 px tap targets on phones.

**Slides and documents**
- New slide layouts: section, quote, stats, timeline, cards, chart and agenda, with geometry shared by preview and PPTX, native editable PowerPoint charts and recolourable icon shapes, design-system office fonts and contrast-checked header text. Tables now appear only on table slides in both preview and PPTX.
- DOCX: Caption style defined, line breaks kept, contrast-checked table headers.

**Server and operations**
- Database migration adds job kind/options/progress/result IDs and a source documents table. All inserts use named columns.
- New routes for sources, element edits, design-token import and directions; render requests are serialized to the renderer's limit and retried once on HTTP 429.
- The rendering browser is pointed at a closed local proxy port, so its own background traffic (connectivity checks, updates) never leaves the machine or reaches local services. Measured here: no outbound connection attempts during renders, where the browser previously made two per render.
- `scripts/package-windows.cjs` builds the portable Windows ZIP (Node.js 24.18.0 verified against nodejs.org checksums, production dependencies, SHA256SUMS). `scripts/checksums.cjs` regenerates or checks program-file hashes. No npm dependencies were added.

**Verification (this environment, Linux, Node.js 24.18.0, Chromium)**
- `npm test`: 331 tests passed.
- `test/browser.cjs` and `test/studio-browser.cjs`: passed (demo mode, all three formats, all 11 starter screens at three widths).
- `npm run test:glm-e2e`: passed. A scripted OpenAI-compatible mock that streams reasoning and follows Forma's prompts drives the full GLM-mode flow in a real browser: create with preset, reference image and DOCX source; staged generation with review and correction; 3 directions; a GLM element edit; live tweaks; a changed-screens revision (unchanged screens byte-identical); HTML, ZIP and JSON exports; a document project.
- Hostile-input probes (SVG script and event handlers, `javascript:` and `data:` URLs, mXSS nesting, chart and icon attribute injection, CSS and tweak injection) were neutralised.
- The Windows package was built; from its extracted copy, with only the bundled dependencies, `npm test`, `test/browser.cjs` and `test/glm-e2e.cjs` passed.

**Not verified, and known limits**
- Real GLM-5.3-Flash output quality, latency and image handling have **not** been measured; the mock only proves the plumbing. Run the evaluation in `evaluation/README.md` with real briefs.
- Windows itself, Docker and LibreOffice/Poppler rendering of every new slide layout were not run end to end here (PPTX output was spot-checked through LibreOffice).
- When a project has an explicit preset, directions share its palette and differ mainly in layout, density and emphasis.
- One shared password and workspace; no SSO, per-user attribution or live collaboration.

## 0.2.0 — 14 October 2026

UI/UX is now the primary workflow. Open a curated operations workspace, mobile discovery flow or product website, or generate with the configured GLM endpoint. Starters contain eleven linked screens in total and remain explicitly labelled as curated, with zero model calls.

- Manage up to twelve linked screens. Inspect layers, select canvas elements, edit text/color/spacing/type/layout, add common components, duplicate/reorder/remove elements, and wire navigation. Switch between interaction and design modes, responsive widths, zoom and a focused canvas.
- Save reusable design styles, import/export style JSON, apply tokens and pass project styles to GLM. Save edits as revisions; undo/redo a draft. Dirty-draft guards and optimistic revision checks protect against accidental replacement.
- Record feedback against a saved revision, screen and element; resolve it or use it as a revision prompt. Explore an independent project copy with source context preserved. Feedback is shared workspace data, not live attributed collaboration.
- Download an offline handoff ZIP with linked HTML, per-screen markup, CSS, tokens, artifact JSON, references, source context, provenance and feedback. Native editable PPTX/DOCX, JSON, HTML and renderer-dependent PDF remain available.
- Render every web screen at desktop/tablet/mobile widths. Display screen diagnostics in Checks. Review every captured image in bounded batches instead of reviewing only the first four. Record the actual configured Office converter version.
- Preserve legacy artifact compatibility, GLM failure visibility, reference restrictions, sandboxed prototypes and separate demo/template/import/copy provenance. No dependency changes.

Validation: 23 automated tests passed; browser and release-package results are recorded in VERIFICATION.md. Local mock/fixture tests do not prove this version's real GLM output quality. This is a bounded internal review release, not full Claude Design parity or a production collaboration platform. See STUDIO-GUIDE.md and TEAM-REVIEW.md.

6 October 2026. Continue existing work without a model connection.

- Import a Forma JSON export as a new web, slide or document project. Optionally retain the original brief and reattach up to two images in their original slots.
- Edit, preview, save revisions, restore and export locally. Imports validate before saving; invalid content or missing required images leave no partial project.
- Label imports explicitly, retain their provenance after edits/restores, and exclude them from GLM evaluation summaries. Imported metadata cannot forge IDs, model usage or GLM origin.
- Preserve source briefs in the branch history for future model-assisted revisions. Keep the existing HTML/CSS execution restrictions.

All 19 automated tests passed. The new import integration checks ran with an unavailable local model endpoint and observed zero model requests. Chrome passed JSON export/import, inline validation, editing, restore, DOCX download and separate evaluation totals. Import, workspace and Checks screenshots were visually inspected. Fixtures verify app behavior, not GLM generation quality. Native Office rendering and Docker remain unverified.

This source-only Windows update reuses the runtime and dependencies of an existing 0.1.0–0.1.2 portable installation. Follow `UPDATE-WINDOWS.txt`. JSON imports do not recover earlier revision history or embedded images; arbitrary Office and HTML imports are not supported. PDF still requires rendering. Historical packages and benchmark evidence remain intact.

# Forma 0.1.2

3 October 2026. One focused output-quality iteration using the existing evaluation findings.

## Changes in 0.1.2

- Keep original briefs, intervening instructions and manual changes available during generation and review. Follow the selected revision's history; restoring an older version excludes abandoned later instructions.
- Inherit missing theme fields from the selected revision instead of introducing a default color. Explicit model-supplied style changes remain possible.
- Strengthen instructions for source facts, unknown policy details, revision consistency and concise copy. Review content even if native Office rendering is unavailable. Model findings can trigger one correction pass and are not treated as new source facts.
- Include user reference images in quality review. Web rendering captures desktop and mobile views, reports mobile overflow and empty responsive field labels, and sends those diagnostics to the reviewer.
- Use shared title/subtitle/content geometry for slide previews and native exports. Separate the takeaway and evidence on body-plus-bullet slides. Keep table-slide explanatory paragraphs and bullets in the native PPTX; these were previously omitted. Image-slide bullets are now retained too.
- Reduce document paragraph/table spacing, keep headings with following content, retain repeating native table headers and prevent table rows splitting across pages. Improve mobile document previews. These changes do not guarantee a particular native page count.
- Checks distinguishes content-only review from content-and-visual review.

## Verification and limits

Seventeen automated tests passed. Chrome workflow checks passed, including mobile diagnostics, slide content bounds, mobile document readability, editing, exports and history. Slide/table previews and the mobile document fixture were visually inspected. Native PPTX/DOCX ZIP/XML checks verify editable content and formatting instructions.

Local tests use fixed fixtures and mock model responses. They verify the workflow, not actual GLM judgment or generation quality. LibreOffice/Microsoft Office layout rendering and Docker execution were not verified here. Native export pagination, real-model latency and the amount of user cleanup still need on-system use.

## Install and use

This release is a source update for an existing portable Windows installation. No installed dependencies, runtime, credentials or reports are included. Follow `UPDATE-WINDOWS.txt`; package dependencies are unchanged. Startup performs a small revision-history migration, so preserve a stopped copy of the old installation before using its data in the updated copy.

Use a few representative working tasks with review enabled: revise facts in a document, make a comparison deck and revise its constraints, and check a reference-based web page at 390 px. Judge correctness and cleanup effort. Another complete Forma/DSH benchmark is not required for this development decision.

Existing artifact content is not rewritten. New previews and exports use the new layout code. Prompt and review improvements apply when generating a new revision.

# Forma 0.1.1 (historical)

3 October 2026. This is a focused repair for issues found while reviewing the first Forma/DSH benchmark submission.

## Changes

- Preserve definition-list markup (`dl`, `dt`, `dd`) so label/value layouts keep their structure and CSS styling.
- Preserve `data-label` on table cells and headers so responsive layouts using `content: attr(data-label)` can show field labels.
- Discard document-head/title text when a model returns a whole HTML document in place of the requested body fragment. This prevents an extra unstyled title from appearing above the design.
- Clarify generation instructions: follow explicit requested colors; otherwise use project branding and preserve existing revision styling. Schema example colors are illustrative. This prompt adjustment still needs real model verification.

Executable markup, event handlers, external resources, and generated JavaScript remain blocked as before. No dependency update, database migration, or change to the benchmark was made.

## Local verification

All twelve automated tests passed, including new sanitizer regression cases and the existing security checks. The real Chrome workflow test also passed, including a mobile CSS label check after validation/export and the existing login, generation, editing, export, and revision scenarios. These tests use demo or mock-model content.

Docker execution and native Office rendering were not verified here. Actual GLM output and visual quality require the organisation retest.

## Focused retest

Extract this package into a separate folder. Configure it for the same internal model using `01-configure.cmd`. Stop the old local app before running `02-start.cmd`, or configure a different port pair. Keep the previous run's evidence.

1. Regenerate W01 and apply its prescribed revision in a new project. Confirm label/value spacing and the absence of the stray title above the portal. Recheck the four services and search/details behavior.
2. Regenerate W02 with its reference image, then apply its revision. At 390 px, check that each stacked ticket row shows Ticket, Request, Owner, and Status labels alongside its values. Recheck facts and the requested teal accent.
3. Rerun S02 and D02 if testing the color-instruction change. Verify S02's requested blue accent on white in the native PPTX and preservation of D02's requested blue accent in the DOCX after revision. Save both original and revised native files.
4. Export the missing native PPTX files for the original S02 run and native DOCX files for the original D02 run if still available. Keep them with that original run. HTML previews cannot establish native Office layout or editability.

The sanitizer preserves supported information when it is present in newly generated HTML. It does not reconstruct attributes/tags already removed from saved artifacts, nor does it supply labels omitted by the model. Existing projects need regeneration or an explicit content edit to benefit.

This release does not resolve all design-quality limitations or the unsupported factual additions found during review. Check the delivered files manually as well as using automated checks, and measure time from request submission to export readiness consistently in both tools.
