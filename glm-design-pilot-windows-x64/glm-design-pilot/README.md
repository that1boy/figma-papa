# Forma — Design studio for GLM-5.3-Flash

A self-hosted design studio that turns briefs, reference images and source documents into clickable multi-screen prototypes, editable PowerPoint decks and Word documents, using only the organisation's own GLM endpoint. It runs on a Windows PC without installation or internet access, or in Docker.

Version **0.3.0** rebuilds generation around a fast, smaller model (GLM-5.3-Flash):

- **A design kit the model composes from.** A Tailwind-compatible utility engine (CSS generated on demand, no build step), a component library on design tokens, 10 curated design-system presets, 11 bundled open-source font families, 1,890 Lucide icons (`<i data-icon>`), server-rendered SVG charts from `data-chart` JSON, and sanitized inline SVG.
- **A staged pipeline.** Plan (JSON) → build the first screen with shared CSS → build the other screens in parallel → assemble and validate. Screens arrive as raw HTML in tagged blocks rather than escaped JSON. Revisions return only the screens that change; unchanged screens stay byte-identical.
- **Surgical editing.** Select an element in Design mode and ask GLM to change just that element. Tweak sliders adjust layout knobs (proposed by the plan) and design tokens live in the preview.
- **Directions.** Generate 2–4 genuinely different variants in parallel and pick one.
- **A hardened GLM client.** Streaming with live progress, retries with backoff, `<think>` stripping, tolerant JSON extraction, automatic text-only fallback when the endpoint rejects images, and per-stage reasoning effort.
- **Deterministic design lint.** WCAG contrast, tiny text, small tap targets, overflow, clipped or overlapping text, missing labels and alt text, heading order, broken navigation, unknown icons or classes. Findings are scored, shown in Checks and fed to the correction pass.
- **Richer inputs.** Up to 6 reference images (PNG, JPEG, WebP) and up to 6 source documents (DOCX, PPTX, XLSX, CSV, TSV, TXT, Markdown, HTML, JSON; PDF with Poppler) extracted as facts. Design tokens import from CSS, token JSON or a Tailwind config.
- **Slides v2.** New section, quote, stats, timeline, cards, chart and agenda layouts, with native editable PowerPoint charts and shapes.

See [docs/GAP-ANALYSIS.md](docs/GAP-ANALYSIS.md) for how this compares with Claude Design, [docs/ENGINE-SPEC.md](docs/ENGINE-SPEC.md) for the engineering design, [docs/GLM-SERVING.md](docs/GLM-SERVING.md) for the inference team, and [STUDIO-GUIDE.md](STUDIO-GUIDE.md) and [RELEASE-NOTES.md](RELEASE-NOTES.md).

**This is a shared-workspace pilot, not the 2,000-concurrent-user production system.** It defaults to two generation jobs at a time and a queue of twenty. Validate output quality with a small group before expanding the architecture.

## Start with Docker

For Windows without Docker, build the portable ZIP with `node scripts/package-windows.cjs` on any internet-connected machine (it bundles Node.js 24.18.0 and the dependencies, verified against published checksums) and follow **START-HERE-WINDOWS.txt**. An existing 0.1.x/0.2.x portable installation can also be upgraded in place: 0.3.0 adds no npm dependencies. Extract it, run `01-configure.cmd`, then `02-start.cmd`. The Windows launcher keeps both services on loopback, uses installed Edge/Chrome for web rendering, and creates secrets only on the target PC. LibreOffice and Poppler are optional additional installations for native Office PDF/image rendering.

Requirements: a Linux Docker host (or Docker Desktop using Linux containers), Docker Compose v2, and enough disk space for Chromium and LibreOffice. The first build needs approved access to your container, npm, and OS package registries. Runtime generation does not need public internet.

```sh
cp .env.example .env
docker compose up --build -d
```

On PowerShell, use `Copy-Item .env.example .env` instead of `cp` if preferred.

Open **http://localhost:8080**. The initial demo password is **`local-pilot-change-me`**.

The host port is bound to `127.0.0.1` by default. For a remote server, use an SSH tunnel (`ssh -L 8080:127.0.0.1:8080 user@server`) or place an internal TLS reverse proxy in front of the app. Before sharing access, replace the password and secrets in `.env`. Keep the renderer's port unpublished.

**Demo mode loads fixed examples. It does not interpret prompts or images and is not evidence of GLM quality.** The interface and exported evaluation data identify demo results explicitly. A failed GLM call never falls back to demo content.

## Continue without a model

Choose **Import Forma JSON** in the sidebar and select a JSON export from Forma (up to 1 MB). Supply the original brief if available. JSON exports do not contain reference images or revision history; reattach images in their original slots (PNG/JPEG, up to 3 MB each). Imports create a new project and leave the source project intact. They use the same artifact validation and web restrictions as generated work.

Use **Edit** to make changes, **History** to restore saved versions, and **Export** for HTML, editable PPTX/DOCX or JSON. These operations make no model calls. PDF and native page images still require a working renderer. Imports and their manual revisions are labelled separately and excluded from GLM evaluation summaries; the file cannot claim trusted model provenance. This imports Forma JSON, not arbitrary Office files or HTML.

Demo mode remains a fixed sample loader for new demo projects. Revise is disabled for imported artifacts, curated starters and exploration copies while in demo mode; use the canvas or Edit instead. Connect a model when you need new AI generation or model review. Local fixture tests do not establish actual GLM output quality.

## Connect your internal GLM service

Edit `.env`:

```dotenv
MODEL_MODE=glm
GLM_BASE_URL=http://your-internal-glm-host:8000/v1
GLM_MODEL=glm-5.3-flash
GLM_API_KEY=your-internal-api-key-if-required
GLM_REASONING_EFFORT=high
GLM_MAX_TOKENS=32768
APP_PASSWORD=choose-a-unique-pilot-password
SESSION_SECRET=choose-a-long-random-secret
RENDER_TOKEN=choose-another-long-random-secret
```

Use the **exact model ID and API prefix supplied by your inference team**. The app appends `/chat/completions` to `GLM_BASE_URL`. Do not enter the complete completion URL. A server inside a container cannot reach a separate host through `localhost`; use the host's internal DNS name or reachable IP.

Restart with the updated environment:

```sh
docker compose up -d --force-recreate
```

Use **Check connection** in the sidebar. This is a text completion smoke test, not a certification of vision support or artifact quality. Then create a project with a screenshot reference to exercise the multimodal path.

The adapter sends ordinary Chat Completions requests with image data URLs and `reasoning_effort`. It does not require tool calling; application code runs the generation, validation, rendering, and review steps. The server stores the API key only in its environment and never sends it to the browser or renderer.

Endpoint compatibility settings:

| Variable               | Purpose                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| `GLM_REASONING_EFFORT` | `low`, `high`, or `max`; default `high`. Benchmark with the settings you plan to deploy.                   |
| `GLM_MAX_TOKENS`       | Requested completion limit. Too small a limit can truncate JSON, including when reasoning consumes tokens. |
| `GLM_TIMEOUT_MS`       | Per-request timeout, default 240 seconds.                                                                  |
| `GLM_JSON_MODE`        | Set `true` only if your endpoint supports `response_format: {type: "json_object"}`.                        |
| `GLM_EXTRA_BODY`       | JSON object for endpoint-specific parameters. Cannot override messages, model, or tools.                   |
| `GLM_STREAM`           | `true` (default) streams responses for live progress; plain JSON replies are still accepted.             |
| `GLM_VISION`           | `auto` (default) sends images and retries once without them if the endpoint answers HTTP 400; `on`, `off`. |
| `GLM_MAX_IMAGES`       | Images per request (references plus screenshots), default 8.                                               |
| `GLM_RETRIES`          | Retries for network errors and HTTP 429/5xx, default 2 (backoff 1 s, 3 s; honours Retry-After).            |
| `GLM_STRUCTURED_OUTPUT`| `true` sends a JSON schema (`response_format: json_schema`) for JSON stages. Default `false`.             |
| `GLM_PIPELINE`         | `staged` (default: plan, parallel screens, review) or `single` (one call, the 0.2 behaviour).            |
| `GLM_PARALLEL`         | Concurrent model calls inside one job, default 3.                                                          |
| `GLM_EFFORT_PLAN`, `GLM_EFFORT_BUILD`, `GLM_EFFORT_REVIEW`, `GLM_EFFORT_EDIT` | Per-stage `reasoning_effort`. Empty means `GLM_REASONING_EFFORT`; review defaults to `low`. |
| `MAX_CONCURRENT_JOBS`  | Concurrent complete generation workflows in this single app process, default 2.                            |
| `MAX_QUEUED_JOBS`      | Waiting generation jobs, default 20.                                                                       |

For a corporate CA, mount its PEM file into the **app** container and set `NODE_EXTRA_CA_CERTS` to that path. Node reads this at startup. Do not disable TLS verification. If your org requires an outbound HTTP proxy, configure an approved route or proxy-aware deployment and verify it with the connection test; this prototype does not automatically read proxy configuration from your browser.

## What works

- Three project types: web prototype, presentation, and document.
- Up to six PNG/JPEG/WebP references, resized locally in the browser and sent to the configured model as data URLs, and up to six source documents whose extracted text is treated as facts, never instructions.
- A curated design-system preset per project (or let GLM choose), reusable styles, and token import from CSS, token JSON or Tailwind config.
- A conversational workspace: each generation or revision appears as a chat turn with what changed, model calls, tokens, duration and lint score. Live progress shows the current stage while GLM works.
- Directions (2–4 variants), GLM element edits, tweak sliders, and changed-screens-only revisions for web projects.
- Per-project brand guidance and a prompt for each generation or revision.
- Structural validation, deterministic CSS clean-up, and one model repair attempt for invalid plans, screens or JSON.
- Optional model content review against the source briefs, plus visual review when rendering succeeds, with at most one correction pass.
- Original and subsequent briefs follow the selected revision branch. Manual field changes are included; restoring a revision excludes later abandoned instructions. Omitted theme fields inherit from the selected base.
- Persistent projects and version history, manual content editing, historical preview, and restore as a new revision.
- Web HTML download, native editable PPTX and DOCX, artifact JSON, and PDF after successful rendering.
- Job progress, bounded concurrency, cancellation, and explicit error reporting. Checks lists every model call with stage, duration, tokens and whether images were dropped.
- Evaluation records with usability, quality, critical errors, baseline time, work/waiting time, and cleanup time. CSV export includes every record and its model/demo origin.

### Web prototypes

The model produces HTML using kit components, utility classes, icons, charts and small inline SVG drawings, plus a little shared CSS. The server sanitizes markup and restricts CSS resources; the kit, fonts, utility CSS, icon and chart SVG are added by trusted application code at presentation time. An application-owned runtime implements screen navigation, toggles, tabs, filters, dismissible dialogs, and local form confirmations. Designs support up to twelve linked screens sharing CSS; existing single-page artifacts still work. Previews run in sandboxed iframes with a restrictive content policy.

**Arbitrary generated JavaScript, React builds, backend code, external links, and live data connections are outside this pilot.** Forms do not submit data. Downloaded HTML keeps the same supported interactions and bundled image references.

### Slides and documents

Slides use twelve layouts: cover, bullets, two columns, table, image, section, quote, stats, timeline, cards, chart and agenda. They export to editable native PowerPoint objects, including native charts and recolourable icon shapes. Stats and charts use only numbers supplied in the brief. Documents support headings, paragraphs, lists, tables, and reference images, exporting as editable Word content. Free-position canvas editing is not implemented.

The default Preview tab is an **HTML approximation**. Choose **Rendered export** to inspect pages rendered from the actual PPTX or DOCX by LibreOffice. Fonts and pagination can still differ in Microsoft Office; inspect representative exports there during the pilot.

### Visual review boundaries

- Web rendering captures each screen at desktop 1280 px, tablet 768 px and mobile 390 px, plus the mobile bottom when needed. Checks reports overflow, missing mobile table labels, unnamed controls, duplicate IDs, missing interaction targets and buttons with no action. This is not a complete accessibility audit, and it does not exercise every interaction or inspect every scroll position.
- Office rendering captures up to 16 pages and records the configured converter version. Review now sends every captured image in batches of four. Capture limits and full page/view counts are recorded; multiple batches add model calls and latency. Native rendering requires the actual converter, not a substituted image generator.
- If the model finds issues, the app allows one correction pass and re-renders. It does not claim that the corrected output has passed an independent review.
- A successful render does not establish factual correctness, accessibility, or business usability.
- If rendering is unavailable, optional content review still runs against the briefs. Checks labels this as content-only. Native layout, PDF and image review remain unavailable. Use **Checks → Render exports** after fixing the renderer.
- Content review adds a model call even when Office rendering is unavailable; a correction adds another call. It can miss factual errors. Earlier briefs are bounded to 96,000 characters, retaining the original plus a contiguous recent suffix; omissions are reported. Large manual changes may consume that budget.
- The first 0.1.2 startup adds revision parent links to SQLite and reconstructs older links from generation jobs, restores and manual-edit ordering. Keep a stopped copy of your old installation/data before upgrading. This migration does not change saved artifacts or evaluation scores.
- Manually edited content needs a fresh render; previews from older revisions are not reused for it.

## Pilot evaluation

Use [evaluation/README.md](evaluation/README.md) for 30 representative task templates and a review protocol. Replace the templates with real, approved work briefs and supplied source facts.

Suggested decision criteria, **not performance claims**:

- 80% of tasks useful within two revision rounds.
- 30% lower median total completion time, including waiting, editing, and cleanup.
- No critical factual or functional errors in accepted deliverables.

Evaluate each format separately. The dashboard reports accepted **revisions**, not a scientific task success rate; use the CSV and task IDs to calculate your final task-level results. Repeat ratings of one revision use the latest rating in the dashboard, while the CSV retains all ratings. Demo-origin revisions remain excluded even after manual edits or restoration. Timing is entered by reviewers; avoid double-counting cleanup in work time.

## Tests

With Node.js 24 installed:

```sh
npm ci --ignore-scripts
npm test
npx playwright install chromium
npm run test:browser
```

For a locally installed Chrome instead, set `BROWSER_EXECUTABLE` to its executable path. Both browser suites exercise login, all three project types, supported web interactions, responsive preview, manual edits, downloads, revision history, and evaluations. Office rendering needs LibreOffice and Poppler locally, or the renderer container. A failed native render is surfaced, never silently certified.

After starting the Docker stack, run the native export smoke test **in demo mode**:

```sh
docker compose exec app node test/docker-smoke.cjs
```

This creates three smoke-test projects and checks screenshots and PDF exports, including the four-page PowerPoint fixture. Inspect the generated pages visually as well.

Backend tests use a local mock model to verify the API request format, image forwarding, JSON repair, error handling, and cancellation. **They do not measure the quality of your GLM service.**

## Operating the pilot

```sh
docker compose logs -f app renderer
docker compose down
```

The named `studio-data` volume persists SQLite data and rendered files across container recreation. Back up the entire volume while the app is stopped, or use SQLite's supported online backup facilities. Do not use `docker compose down -v` unless you intend to delete pilot data.

Interrupted queued/running jobs become failed on app restart, with a message inviting resubmission. Completed revisions survive. Job retry is explicit; no automatic replay of potentially expensive model calls occurs.

The renderer is a separate non-root, resource-limited container on an internal Docker network. Browser network requests are blocked: every page request is aborted, and the rendering browser is pointed at a closed local proxy port so its own background traffic (connectivity checks, updates) cannot leave the machine or reach local services either. It holds no GLM credentials and does not mount project storage. It receives only the artifact being rendered and its own internal authentication token. Apart from that proxy setting, Chromium uses Playwright's default launch configuration; Docker isolation is not a hardened boundary for arbitrary hostile code. The pilot therefore prohibits model-authored JavaScript and external browsing.

There is one password and one shared workspace. There is **no SSO, per-user authorization, tenant isolation, retention policy, distributed job queue, production rate-limit service, or high-availability setup**. Do not expose it publicly or roll it out to 5,000 people as-is.

## Restricted-network deployment

Build the images once in an approved build environment, then mirror them to your internal container registry or transfer them with Docker's image save/load commands. All runtime fonts, JavaScript dependencies, Chromium, LibreOffice, and Poppler are baked into the images. No CDN or public font service is used by the application.

```sh
docker compose build
docker save -o glm-design-pilot-images.tar glm-design-pilot-app:0.3.0 glm-design-pilot-renderer:0.3.0
# On the internal host:
docker load -i glm-design-pilot-images.tar
docker compose up -d --no-build --pull never
```

Keep `.env` separate from source/image archives. Container builds require registry access even though the running app does not. For reproducible releases, pin approved base-image digests in addition to the committed npm lockfile.

## Implementation map

- `server.cjs`: authentication, SQLite persistence, API, queue, generation/review workflow.
- `renderer.cjs`: isolated browser and native Office rendering.
- `lib/model.cjs`: GLM adapter entry points (generate, critique, element edits, directions).
- `lib/llm.cjs`: GLM client (streaming, retries, vision fallback, think stripping, JSON and tagged-block parsing).
- `lib/pipeline.cjs`, `lib/prompts.cjs`: staged web pipeline and its prompts.
- `lib/kit.cjs`, `lib/presets.cjs`, `assets/kit/forma-kit.css`, `assets/fonts/`: design tokens, presets, fonts and components.
- `lib/utilities.cjs`: Tailwind-compatible utility CSS generated on demand.
- `lib/icons.cjs`, `lib/charts.cjs`, `lib/svg.cjs`, `lib/markup.cjs`: icons, charts and SVG sanitization.
- `lib/lint.cjs`: static and in-browser design lint.
- `lib/inputs.cjs`, `lib/tokens-import.cjs`: source documents and design-token import.
- `lib/slide-layout.cjs`: slide geometry shared by preview and PPTX.
- `lib/schema.cjs`: artifact validation and HTML/CSS restrictions.
- `lib/exports.cjs`: native PowerPoint and Word writers.
- `lib/presentation.cjs`: preview/export HTML and trusted interactions.
- `public/`: dependency-free browser application.
- `test/`: unit, API, browser, and Docker smoke tests.

The first release deliberately uses a single app process and SQLite. A production version should retain this artifact/workflow separation while adding organisation identity, permissions, a durable distributed queue, shared database/storage, and measured model-capacity controls.
