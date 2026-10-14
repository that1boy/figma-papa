# Forma — GLM Design Pilot

A small, self-hosted application for evaluating a local GLM model on web prototypes, presentations, and documents. The deliverable is a Docker app with a real model adapter, editable exports, saved revisions, and human evaluation records.

**This is a shared-workspace pilot, not the 2,000-concurrent-user production system.** It defaults to two generation jobs at a time and a queue of twenty. Validate output quality with a small group before expanding the architecture.

## Start with Docker

For a local Windows experiment without Docker, use **glm-design-pilot-windows-x64.zip** and follow **START-HERE-WINDOWS.txt**. That transfer ZIP includes Node.js and application dependencies. Extract it, run `01-configure.cmd`, then `02-start.cmd`. The Windows launcher keeps both services on loopback, uses installed Edge/Chrome for web rendering, and creates secrets only on the target PC. LibreOffice and Poppler are optional additional installations for native Office PDF/image rendering.

Requirements: a Linux Docker host (or Docker Desktop using Linux containers), Docker Compose v2, and enough disk space for Chromium and LibreOffice. The first build needs approved access to your container, npm, and OS package registries. Runtime generation does not need public internet.

```sh
cp .env.example .env
docker compose up --build -d
```

On PowerShell, use `Copy-Item .env.example .env` instead of `cp` if preferred.

Open **http://localhost:8080**. The initial demo password is **`local-pilot-change-me`**.

The host port is bound to `127.0.0.1` by default. For a remote server, use an SSH tunnel (`ssh -L 8080:127.0.0.1:8080 user@server`) or place an internal TLS reverse proxy in front of the app. Before sharing access, replace the password and secrets in `.env`. Keep the renderer's port unpublished.

**Demo mode loads fixed examples. It does not interpret prompts or images and is not evidence of GLM quality.** The interface and exported evaluation data identify demo results explicitly. A failed GLM call never falls back to demo content.

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

The adapter sends ordinary Chat Completions requests with image data URLs. It does not require tool calling; application code runs the generation, validation, rendering, and review steps. The server stores the API key only in its environment and never sends it to the browser or renderer.

Endpoint compatibility settings:

| Variable               | Purpose                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| `GLM_REASONING_EFFORT` | `low`, `high`, or `max`; default `high`. Benchmark with the settings you plan to deploy.                   |
| `GLM_MAX_TOKENS`       | Requested completion limit. Too small a limit can truncate JSON, including when reasoning consumes tokens. |
| `GLM_TIMEOUT_MS`       | Per-request timeout, default 240 seconds.                                                                  |
| `GLM_JSON_MODE`        | Set `true` only if your endpoint supports `response_format: {type: "json_object"}`.                        |
| `GLM_EXTRA_BODY`       | JSON object for endpoint-specific parameters. Cannot override messages, model, or tools.                   |
| `MAX_CONCURRENT_JOBS`  | Concurrent complete generation workflows in this single app process, default 2.                            |
| `MAX_QUEUED_JOBS`      | Waiting generation jobs, default 20.                                                                       |

For a corporate CA, mount its PEM file into the **app** container and set `NODE_EXTRA_CA_CERTS` to that path. Node reads this at startup. Do not disable TLS verification. If your org requires an outbound HTTP proxy, configure an approved route or proxy-aware deployment and verify it with the connection test; this prototype does not automatically read proxy configuration from your browser.

## What works

- Three project types: web prototype, presentation, and document.
- Up to two PNG/JPEG references, resized locally in the browser and sent to the configured model as data URLs.
- Per-project brand guidance and a prompt for each generation or revision.
- Structural validation, with one model repair attempt for invalid artifact JSON.
- Rendering followed by optional model visual review and at most one correction pass.
- Persistent projects and version history, manual content editing, historical preview, and restore as a new revision.
- Web HTML download, native editable PPTX and DOCX, artifact JSON, and PDF after successful rendering.
- Job progress, bounded concurrency, cancellation, and explicit error reporting.
- Evaluation records with usability, quality, critical errors, baseline time, work/waiting time, and cleanup time. CSV export includes every record and its model/demo origin.

### Web prototypes

The model produces HTML and CSS. The server sanitizes markup and restricts CSS resources. A small trusted script implements toggles, tabs, filters, dialogs, and local form confirmations. Previews run in sandboxed iframes with a restrictive content policy.

**Arbitrary generated JavaScript, React builds, backend code, external links, and live data connections are outside this pilot.** Forms do not submit data. Downloaded HTML keeps the same supported interactions and bundled image references.

### Slides and documents

Slides use five layouts: cover, bullets, two columns, table, and image. They export to editable native PowerPoint objects. Documents support headings, paragraphs, lists, tables, and reference images, exporting as editable Word content. Native editable charts and free-position canvas editing are not implemented.

The default Preview tab is an **HTML approximation**. Choose **Rendered export** to inspect pages rendered from the actual PPTX or DOCX by LibreOffice. Fonts and pagination can still differ in Microsoft Office; inspect representative exports there during the pilot.

### Visual review boundaries

- Web review sees the first desktop viewport. It does not automatically exercise every interaction or responsive breakpoint.
- Office rendering captures up to 16 pages. The model review receives the first four screenshots at most, with the page count stated in its prompt.
- If the model finds issues, the app allows one correction pass and re-renders. It does not claim that the corrected output has passed an independent review.
- A successful render does not establish factual correctness, accessibility, or business usability.
- If rendering is unavailable, the artifact remains editable and exportable as HTML/PPTX/DOCX/JSON. PDF and image review are explicitly unavailable. Use **Checks → Render exports** after fixing the renderer.
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

For a locally installed Chrome instead, set `BROWSER_EXECUTABLE` to its executable path. The browser smoke test exercises login, all three project types, supported web interactions, responsive preview, manual edits, downloads, revision history, and evaluations. Office rendering needs LibreOffice and Poppler locally, or the renderer container. A failed native render is surfaced, never silently certified.

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

The renderer is a separate non-root, resource-limited container on an internal Docker network. Browser network requests are blocked. It holds no GLM credentials and does not mount project storage. It receives only the artifact being rendered and its own internal authentication token. Chromium uses its default Playwright launch configuration; Docker isolation is not a hardened boundary for arbitrary hostile code. The pilot therefore prohibits model-authored JavaScript and external browsing.

There is one password and one shared workspace. There is **no SSO, per-user authorization, tenant isolation, retention policy, distributed job queue, production rate-limit service, or high-availability setup**. Do not expose it publicly or roll it out to 5,000 people as-is.

## Restricted-network deployment

Build the images once in an approved build environment, then mirror them to your internal container registry or transfer them with Docker's image save/load commands. All runtime fonts, JavaScript dependencies, Chromium, LibreOffice, and Poppler are baked into the images. No CDN or public font service is used by the application.

```sh
docker compose build
docker save -o glm-design-pilot-images.tar glm-design-pilot-app:0.1.0 glm-design-pilot-renderer:0.1.0
# On the internal host:
docker load -i glm-design-pilot-images.tar
docker compose up -d --no-build --pull never
```

Keep `.env` separate from source/image archives. Container builds require registry access even though the running app does not. For reproducible releases, pin approved base-image digests in addition to the committed npm lockfile.

## Implementation map

- `server.cjs`: authentication, SQLite persistence, API, queue, generation/review workflow.
- `renderer.cjs`: isolated browser and native Office rendering.
- `lib/model.cjs`: local GLM adapter and format instructions.
- `lib/schema.cjs`: artifact validation and HTML/CSS restrictions.
- `lib/exports.cjs`: native PowerPoint and Word writers.
- `lib/presentation.cjs`: preview/export HTML and trusted interactions.
- `public/`: dependency-free browser application.
- `test/`: unit, API, browser, and Docker smoke tests.

The first release deliberately uses a single app process and SQLite. A production version should retain this artifact/workflow separation while adding organisation identity, permissions, a durable distributed queue, shared database/storage, and measured model-capacity controls.
