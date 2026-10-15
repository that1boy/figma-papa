# Verification

## Forma 0.3.0 — 15 October 2026

Environment: Linux container, Node.js 24.18.0 (the version bundled for Windows), Playwright 1.62.1 with Chromium, no GLM endpoint.

| Check | Result |
| --- | --- |
| `npm test` (unit, API and integration tests with mock GLM servers) | 329 passed, 0 failed |
| `node test/browser.cjs` (demo mode: login, all formats, web interactions, responsive preview, edits, downloads, revisions, import, evaluations) | passed |
| `node test/studio-browser.cjs` (starters, linked screens, forms, dialogs, visual edits, undo/redo, components, styles, feedback, copy, offline ZIP, responsive checks on all 11 starter screens) | passed |
| `npm run test:glm-e2e` (GLM mode against a scripted streaming mock: preset, reference image, DOCX source, staged generation with review and correction, 3 directions, element edit, live tweaks, changed-screens revision, exports, document project) | passed |
| Hostile markup probes rendered in Chromium (SVG scripts/handlers, `javascript:`/`data:` URLs, mXSS, chart/icon attribute injection, CSS and tweak injection) | nothing executed; dangerous CSS and tweaks rejected |
| `node scripts/package-windows.cjs` | built forma-windows-x64-0.3.0.zip (41.9 MB, 1,651 files); extracted copy started and served `/api/config` |
| Visual review | kit presets, starters, slide layouts (preview and LibreOffice-rendered PPTX) and GLM-mode workspace screenshots inspected |

Not verified here: real GLM-5.3-Flash quality, latency or image handling; running on Windows; Docker; LibreOffice/Poppler rendering through the renderer service for every layout. These need the organisation's environment.

Reproduce:

```sh
npm ci --ignore-scripts
npm test
BROWSER_EXECUTABLE=/path/to/chrome node test/browser.cjs
BROWSER_EXECUTABLE=/path/to/chrome node test/studio-browser.cjs
BROWSER_EXECUTABLE=/path/to/chrome npm run test:glm-e2e
```

## Earlier releases


## 14 October 2026: version 0.2.0

- All 23 automated tests passed under local Node.js 24. Tests use synthetic artifacts and local model/renderer doubles; no new live GLM quality result is claimed.
- Both real Chrome suites passed: the existing all-format workflow and the new studio workflow. The latter covers linked navigation, empty search, forms, dismissible dialogs, canvas text/property edits, preserved prior styling, undo/redo, element duplication, screen creation, components/navigation, reusable styles, revision feedback, copies, source-draft protection, rendering diagnostics and offline handoff ZIP use. No uncaught page errors. Expected initial 401/404 console responses remain in the existing suite.
- All 11 curated starter screens were rendered at 1280, 768 and 390 pixels with no measured horizontal overflow, unnamed controls, missing targets, inactive buttons or duplicate IDs. Mobile screenshots were visually inspected. These finite checks are not full accessibility certification or coverage of every possible interaction.
- Browser-generated PDFs contain headings from all eleven starter screens: operations 5 pages, discovery 4 pages, product website 5 pages. Text extraction normalizes whitespace because PDF line breaks can join words. Web print pagination can split a long screen across pages.
- The in-app preview was visually inspected at fitted zoom and layers selected the matching heading/property inspector. Standalone browser tests use 100% for iframe interaction assertions because automation hit testing in a scaled opaque iframe is unreliable. This automation limitation is separate from responsive rendering checks.
- Nine-image review regression verifies all views reach the configured model in batches of 4/4/1, with full count and capture limits. A copied multi-screen design test verifies source/manual/style context reaches the GLM adapter and omitted style metadata inherits correctly.
- Native PPTX/DOCX ZIP/XML editability checks passed. Actual Microsoft Office/LibreOffice rendering, Docker, concurrent load, real team acceptance and fresh GLM output quality remain unverified locally. Office converter identity is now recorded when a converter runs.
- No dependency additions, public deployments, external provider calls, changed benchmark prompts/scores or copied organisation report data. Historical release archives remain intact. The update is source-only and reuses the existing portable runtime/dependencies.

See STUDIO-GUIDE.md and TEAM-REVIEW.md. Repository docs/uiux-studio-verification.md records the official feature-guide mapping, package hash and fresh-extraction result.

## 6 October 2026: version 0.1.3

- All 19 automated tests passed. Import integration checks run in GLM configuration against an unavailable local endpoint and assert zero model requests throughout import, edits, restore, exports and restart persistence.
- All three artifact types retain validated content in JSON and editable native exports. Tests cover independent project copies, server-owned provenance, evaluation separation, source briefs through manual/restore history, rejected malformed/oversize imports, restricted web markup/CSS, and both reference image slots. Invalid imports create no project.
- Chrome workflow passed, including exporting a document as JSON, an inline invalid-JSON error, importing the exported file, previewing, editing, downloading DOCX, restoring and evaluating it. The new flow sent no generation/model-test requests. Imported evaluation rows left GLM summaries at zero.
- Visually inspected the import dialog, imported document workspace and Checks panel. No uncaught browser errors occurred. Expected initial HTTP 401/404 console messages remain. Evidence is under `work/verification/offline-import-20261006` at the repository root.
- No new dependencies, external provider calls, benchmark changes or submitted evidence changes. Tests use fictional fixed artifacts. Actual GLM quality, native Office rendering and Docker execution remain unverified locally. Package integrity is recorded separately in `docs/offline-import-verification.md` at the repository root.

## 3 October 2026: version 0.1.2

- Seventeen automated tests passed under local Node.js 24.18.0. New checks cover legacy history migration, restore-branch isolation, source briefs and manual edits reaching the model, content review/correction without native rendering, missing-theme inheritance, native table-slide explanatory text, and document spacing/keep-with-next/table-header properties.
- Chrome workflow passed. The real renderer detected deliberately missing mobile labels and mobile-only overflow; captured mobile PNG width was 390 pixels. Representative slide content stayed within its preview regions; heading/content boxes did not overlap. Mobile document preview had no horizontal page overflow.
- Visually inspected the two-column, comparison-table and takeaway/bullets slide previews plus the mobile document fixture. These are fixed-fixture HTML previews, not GLM results or native Office rendering.
- Normal login, generation, interactions, manual edits, native downloads, history and demo-separated evaluation passed. No uncaught browser page errors occurred. Expected initial HTTP 401/404 console messages remain.
- Native export ZIP/XML checks preserve editable text/tables, supplied colors, speaker notes and new layout/paragraph instructions. LibreOffice/Microsoft Office page rendering and pagination remain unverified locally.
- No dependency changes or new dependencies. The 0.1.2 archive is a source update and excludes installed dependencies/runtime and private evidence. A separate release record covers package integrity and update smoke checks.

Real GLM improvements remain to be judged on the organisation system. Content review is performed by the same configured model, adds calls even when rendering is unavailable, and is not independent factual validation. The original benchmarks and submitted evidence have not been changed.

## 3 October 2026: version 0.1.1

All twelve automated tests passed under Node.js 24.18.0 after the HTML sanitizer repair and style-instruction clarification. The Chrome smoke test passed the existing application workflow plus a mobile regression asserting that sanitized/exported table labels render through CSS, definition-list structure survives, and document-head text stays out of the visible body. There were no uncaught page errors; HTTP 401/404 console messages also occurred in the unchanged baseline workflow.

Actual GLM behavior after the prompt change remains unverified. The organisation must regenerate affected tasks to test it. Earlier verification below describes the 0.1.0 baseline.

Date: 2 October 2026

## Completed in this workspace

- Ten automated tests passed under Node.js 24.19.0.
- API coverage includes authentication, request guards, persistent revisions, restore, editable exports, evaluations, restart persistence, image forwarding to a mock GLM API, invalid JSON repair, provider failures, and cancellation without a partial commit.
- A separate test verified the render → screenshot review → one correction → re-render sequence with local model and renderer test doubles. This is a workflow test, not a GLM quality result.
- A real headless Chrome smoke test passed login, all three project types, web toggles/filtering/dialogs/form confirmation, a 390-pixel mobile viewport, manual editing, artifact downloads, history, and evaluations.
- Browser screenshots were inspected for the project library, web prototype, slide preview, document preview, and mobile preview. These are application/HTML previews, not native Office render validation.
- Native PPTX and DOCX ZIP/XML checks confirmed editable text and tables, including speaker notes in PowerPoint.
- npm audit reported zero known vulnerabilities in the installed production dependencies at verification time. The lockfile includes the patched image-size override.

## Still required on your deployment

- Docker image build and Compose execution: Docker is not installed in this workspace. The container recipes are supplied, but have not been executed here.
- Native Office-to-PDF rendering and page-image inspection: LibreOffice is not available locally. The Docker renderer installs LibreOffice and Poppler. Run `docker compose exec app node test/docker-smoke.cjs` after starting the stack in demo mode, then inspect the rendered pages and exports in your Office applications.
- Actual GLM quality, multimodal compatibility, latency, and throughput: no internal endpoint or credentials were provided. Local mock responses cannot establish these properties.
- Real employee evaluation and concurrent-load testing: this is a small shared-workspace pilot, not a validated deployment for 2,000 simultaneous users.

No benchmark success rate, time saving, Claude Design parity, or production capacity is claimed by this prototype.
