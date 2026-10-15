# Forma 0.3 design engine: engineering spec

Status: build spec for the 0.3 upgrade. It defines module boundaries and
interfaces so modules can be built in parallel and wired together later.

## Goal and model constraints

Forma should produce output close to Claude Design while running only on the
organisation's GLM-5.3-Flash endpoint, possibly without internet access.

What we know about GLM-5.3-Flash (third-party listings, verify on the real
deployment): 320B-total / 18B-active MoE, ~1M token context, up to 131k output
tokens, native image input (PNG/JPEG/WebP), function calling and structured
output support, thinking always on, controlled by `reasoning_effort`
(`low` | `high` | `max`, default `max`). Behind vLLM the reasoning text should
arrive in `reasoning_content`; with a misconfigured reasoning parser it leaks
into `content` as `<think>…</think>`.

A flash model is fast and cheap but has weaker taste and precision than a
frontier model. The engine therefore:

1. Gives the model high-level, well-known building blocks instead of asking it
   to invent CSS: a Tailwind-compatible utility engine, a component kit, design
   token presets, bundled fonts, an icon set and declarative charts.
2. Splits work into small calls (plan, then per-screen builds in parallel,
   then targeted fixes) instead of one giant JSON answer.
3. Lets the model write raw HTML/CSS in tagged blocks rather than escaped
   strings inside JSON.
4. Checks the output with deterministic lint (contrast, overflow, tap targets,
   broken links, unknown classes or icons), not just model vision, and feeds
   precise findings back for fixes.
5. Edits surgically: element-level and changed-screens-only revisions keep
   untouched work byte-identical.

## Hard constraints (all modules)

- Node.js 24, CommonJS (`.cjs`), `'use strict'`. Match the existing terse style.
- **No new npm dependencies.** Offline Windows installs reuse an existing
  `node_modules` with only: `docx`, `pptxgenjs`, `playwright`, `sanitize-html`
  and their transitive deps (`jszip`, `htmlparser2`, `postcss`, …). Requiring a
  transitive dependency is allowed only for `jszip` and `htmlparser2`.
- No network access at runtime except the configured GLM endpoint. All fonts,
  icons and CSS live in `assets/` and are inlined into pages.
- Model output is untrusted. Model-authored JavaScript, inline `style`
  attributes, event handlers, external URLs, `url()`, `@import` and
  `@font-face` stay forbidden. Only application code generates `<style>`,
  `<script>`, `@font-face` and data URIs.
- Every module ships unit tests in `test/<module>.test.cjs` using `node:test`
  and `node:assert/strict`, runnable with `npm test`.
- Keep existing behaviour and tests passing. Existing user-facing error
  messages in `lib/model.cjs` must keep their wording.

## Module map

| Module | Files | Purpose |
| --- | --- | --- |
| GLM client | `lib/llm.cjs` | Streaming chat, retries, `<think>` stripping, JSON and tagged-block parsing, vision fallback, per-stage effort, metrics |
| Tokens and kit | `lib/presets.cjs`, `lib/kit.cjs`, `assets/kit/forma-kit.css`, `assets/fonts/*` | Design tokens, curated presets, font embedding, base and component CSS, prompt reference |
| Utility engine | `lib/utilities.cjs` | On-demand CSS for a Tailwind-v3-compatible class subset using design tokens |
| Rich markup | `lib/icons.cjs`, `lib/charts.cjs`, `lib/svg.cjs`, edits in `lib/schema.cjs` `safeHTML` | Icons, declarative SVG charts, sanitized inline SVG |
| Lint | `lib/lint.cjs`, hook in `lib/browser-render.cjs` | Static and in-browser design checks, scoring, prompt summaries |
| Inputs | `lib/inputs.cjs`, `lib/tokens-import.cjs` | Text extraction from DOCX/PPTX/XLSX/CSV/TXT/MD/HTML/JSON; design token import from CSS/JSON |
| Pipeline | `lib/pipeline.cjs`, edits in `lib/model.cjs` | Plan, build, assemble, review, fix; changed-screens revisions; element edits; directions |
| Slides v2 | `lib/exports.cjs`, `lib/slide-layout.cjs`, slide parts of `lib/schema.cjs` and `lib/presentation.cjs` | New layouts and native charts |

## 1. GLM client: `lib/llm.cjs`

```js
chat(cfg, messages, opts) -> Promise<{ text, reasoning, finishReason, usage, imagesDropped }>
// opts: { signal, metrics, stage, effort?, json?, schema?, maxTokens?, temperature?, onDelta? }
// stage: 'plan' | 'build' | 'review' | 'edit' | 'repair' | 'test'
stripThinking(text) -> string
extractJSON(text) -> any              // throws Error('The model did not return valid JSON.')
parseBlocks(text) -> { css, cssMode, screens, removed, element, meta, notes }
stripImages(messages, note) -> messages
countImages(messages) -> number
extendConfig(cfg, env) -> cfg         // adds the settings below to model.configFromEnv() output
```

New settings (environment):

| Variable | Default | Meaning |
| --- | --- | --- |
| `GLM_STREAM` | `true` | Use SSE streaming (`stream: true`, `stream_options.include_usage`). Non-SSE JSON replies are still accepted. |
| `GLM_VISION` | `auto` | `auto`: send images; on HTTP 400 for a request containing images, retry once without them and remember that for the process. `on`: always send. `off`: never send (text-only review using lint findings). |
| `GLM_MAX_IMAGES` | `8` | Cap on images per request (references + screenshots). |
| `GLM_RETRIES` | `2` | Retries for network errors and HTTP 429/500/502/503/504, backoff 1s then 3s, honour `Retry-After` up to 20s. Never retry 400/401/403/404 or aborts. |
| `GLM_STRUCTURED_OUTPUT` | `false` | When `true` and a call passes `schema`, send `response_format: {type:'json_schema', json_schema:{name, schema, strict:false}}`. |
| `GLM_JSON_MODE` | `false` | Existing. `json_object` response format for JSON calls. |
| `GLM_EFFORT_PLAN`, `GLM_EFFORT_BUILD`, `GLM_EFFORT_REVIEW`, `GLM_EFFORT_EDIT` | reasoning, reasoning, `low`, reasoning | Per-stage `reasoning_effort`. |
| `GLM_PARALLEL` | `3` | Max concurrent model calls inside one job. |
| `GLM_PIPELINE` | `staged` | `staged` (plan, build, review) or `single` (0.2 one-call behaviour). |

Behaviour:

- Request body keeps the 0.2 shape (`temperature: 1, top_p: 0.95,
  reasoning_effort, max_tokens, model, messages`), plus `stream` and
  `response_format` as configured. `GLM_EXTRA_BODY` merges as before and still
  cannot override `model`, `messages`, `stream`, `tools`, `tool_choice`.
- SSE: handle chunk boundaries, `:` keep-alive lines, `data: [DONE]`, error
  objects mid-stream, `delta.content`, `delta.reasoning_content` and
  `delta.reasoning`. Call `onDelta({ stage, contentChars, reasoningChars })` at
  most every 250 ms.
- `text` is content with `<think>…</think>` removed (also a leading unclosed
  think block terminated by `</think>`).
- Errors carry `.code` (`cancelled`, `timeout`, `network`, `http`, `length`,
  `empty`, `too-large`) and keep the 0.2 messages.
- `metrics` gains `reasoningTokens` and `calls: [{ stage, ms, inputTokens,
  outputTokens, reasoningTokens, retries, imagesDropped }]` (max 100 entries).
- `extractJSON` tolerates think blocks, fences anywhere, prose before or after
  the object and trailing commas. It finds the first balanced top-level object
  while respecting strings and escapes.

### Tagged block protocol

Web builds return raw HTML/CSS in tags. Anything outside tags is ignored as
notes. Markdown fences inside a block are stripped.

```text
<forma-css mode="append|replace">shared CSS</forma-css>
<forma-screen id="dashboard" name="Dashboard">body fragment HTML</forma-screen>
<forma-remove id="old-screen"></forma-remove>
<forma-element>replacement HTML for one element</forma-element>
<forma-meta>{"title": "...", "summary": "...", "tweaks": [...]}</forma-meta>
```

The parser handles attribute order, single or double quotes, missing `name`,
repeated `forma-css` blocks (concatenated) and an unclosed final block at end
of text (treated as truncated: report via `notes`, do not drop silently).

## 2. Tokens, presets and kit

### Token object (stored as `artifact.designSystem`, backward compatible)

```js
{
  name, preset,                       // preset id or 'custom'
  accent, accent2, background, surface, text, muted, border,
  success, warning, danger,           // #RRGGBB
  headingFont, bodyFont, monoFont,    // keys of FONTS
  font,                               // legacy alias of bodyFont (keep writing it)
  radius,                             // 0–40 px
  spacing,                            // 4–24 px base unit
  density: 'compact'|'comfortable'|'spacious',
  shadow: 'none'|'soft'|'medium'|'crisp',
  typeScale                           // 1.1–1.5
}
```

0.2 design systems only have `name, accent, background, text, surface, muted,
font, radius, spacing`. `normalizeTokens` must accept those and fill the rest.

### `lib/presets.cjs`

```js
FONTS   // { 'Inter': { file, category:'sans'|'serif'|'mono'|'display', fallback, office }, ..., 'Segoe UI': { system:true, ... } }
PRESETS // [{ id, name, description, mood:[...], tokens:{...} }]  about 10 curated systems
preset(id) -> preset | null
```

Bundled families (files in `assets/fonts/`, latin subset, variable weight):
Inter, Manrope, Space Grotesk, IBM Plex Sans, Source Serif 4, Fraunces,
JetBrains Mono, DM Sans, Plus Jakarta Sans, Outfit, DM Serif Display (400
only). System fonts stay valid: Arial, Segoe UI, Georgia, Verdana, Trebuchet
MS. `office` names a safe font for PPTX/DOCX when the family is not installed.

### `lib/kit.cjs`

```js
normalizeTokens(ds) -> tokens
tokensCSS(tokens) -> ':root{...}'      // all CSS variables
fontFaceCSS(families) -> string        // @font-face with data:font/woff2;base64 (cached)
kitCSS(tokens) -> string               // fontFaceCSS(used) + tokensCSS + base + components
KIT_REFERENCE                          // compact prompt text, <= ~1800 tokens
KIT_EXAMPLE                            // one exemplary screen fragment using kit + utilities
tweakDefaults(tokens) -> [{ var, label, min, max, step, unit, value }]
```

CSS variables kept from 0.2 (model CSS already uses them): `--accent
--on-accent --background --surface --text --muted --radius --space --font`.
New: `--accent-2 --accent-soft --accent-strong --border --success --warning
--danger --font-heading --font-mono --space-1…--space-12 --radius-sm
--radius-lg --radius-pill --shadow-sm --shadow --shadow-lg --text-xs…--text-5xl
--leading-tight --leading-normal --chart-1…--chart-6`. Derive tints with
`color-mix(in oklab, …)`.

`assets/kit/forma-kit.css`: modern reset and base typography, then
components: `btn` (+ `btn-primary btn-secondary btn-ghost btn-danger btn-sm
btn-lg btn-icon`), `card` (+ `card-header card-body card-footer`), `badge`
(+ tones `badge-success|warning|danger|info|neutral|accent`), `field label input
select textarea help`, `switch`, `checkbox`, `tabs tab`, `table` (responsive
stacking with `data-label` at ≤ 640px), `app-shell sidebar topbar nav nav-item
is-active`, `avatar`, `stat` (KPI), `hero`, `section eyebrow display lead`,
`feature-grid`, `pricing`, `timeline`, `steps`, `empty-state`, `alert`
(tones), `toast`, `dialog` styling, `list list-item`, `breadcrumb`,
`pagination`, `progress`, `chip`, `divider`, `kbd`, `chart` container,
`icon`, `sr-only`, `container`, `stack`, `cluster`, `grid-auto`. Accessible
focus rings, 44px touch targets on coarse pointers, reduced-motion support.

## 3. Utility engine: `lib/utilities.cjs`

```js
utilityCSS(classNames: Iterable<string>, tokens) -> string   // CSS for supported classes only
classifyClasses(classNames) -> { supported: [...], unknown: [...] }
collectClasses(html) -> Set<string>
UTILITY_REFERENCE                                           // short prompt text
```

A Tailwind v3 compatible subset generated on demand: display, position and
inset, z-index, flex and grid (cols/rows 1–12, span, auto-fit helpers), gap,
space-x/y, padding and margin (Tailwind spacing scale, negative margins,
auto), width/height/min/max (scale, fractions, full, screen, fit, prose
widths), typography (text-xs…9xl, font weights, leading, tracking, alignment,
truncate, line-clamp-1…6, uppercase, whitespace), colours (`bg-*`, `text-*`,
`border-*`, `ring-*`, `fill-*`, `stroke-*`) for semantic tokens (`accent,
accent-2, background, surface, text, muted, border, success, warning, danger,
on-accent, white, black, transparent, current`) and the Tailwind palette
(slate, gray, zinc, neutral, stone, red, orange, amber, yellow, lime, green,
emerald, teal, cyan, sky, blue, indigo, violet, purple, fuchsia, pink, rose,
50–950), opacity modifiers (`bg-accent/10`), borders and radius, shadows,
opacity, overflow, object-fit, aspect ratio, transitions, cursor,
`sr-only`. Variants: `sm: md: lg: xl: 2xl:` (min-width 640/768/1024/1280/1536),
`hover: focus: focus-visible: active: disabled: group-hover:`, `dark:`
ignored. Arbitrary values `[...]` only for lengths, percentages, numbers,
`#hex` colours and `var(--token)`; anything else (including `url(`) is
unknown. Selectors must be escaped. Unknown classes produce no CSS and are
reported by lint.

## 4. Rich markup

- `lib/icons.cjs`: `expandIcons(html)`, `iconNames()`, `ICON_PROMPT_NAMES`
  (~150 common names). Model writes `<i data-icon="search" class="..."></i>`.
  Expansion replaces it with inline Lucide SVG (`assets/icons/lucide.json`,
  1,890 icons) carrying `data-forma-expanded="icon"`, the original classes,
  `aria-hidden="true"` unless an `aria-label` is present. Unknown names use
  an alias table, then a neutral fallback icon, and are reported by lint.
- `lib/charts.cjs`: `expandCharts(html)`, `validateChart(spec)`,
  `chartSVG(spec)`. Model writes `<figure class="chart"
  data-chart='{"type":"bar","title":"…","labels":[…],"series":[{"name":"…","values":[…]}],"unit":"%"}'></figure>`.
  Types: bar, hbar, stacked-bar, line, area, donut, pie, sparkline. At most
  24 labels and 6 series, finite numbers. Output is accessible SVG (`role="img"`,
  `<title>`, a visually hidden data table) coloured with `var(--chart-n)`,
  marked `data-forma-expanded="chart"`.
- `lib/svg.cjs` and `safeHTML` in `lib/schema.cjs`: allow inline SVG drawing
  elements with validated attributes (paint values: `none`, `currentColor`,
  hex, CSS colour names, `var(--token)`, internal `url(#id)` only), allow
  `<i data-icon>`, `data-chart` (≤ 6000 chars, valid JSON), `figure`,
  `figcaption`, `h5`, `h6`, `blockquote`, `code`, `pre`, `kbd`, `mark`, `time`,
  `progress`, `meter`, `fieldset`, `legend`, `output`. Still no `style`,
  `script`, `foreignObject`, `use`, `image`, external `href`.
- Expansion happens at presentation time. Stored artifacts keep the compact
  `<i data-icon>` and `data-chart` forms. The studio inspector must skip
  descendants of `[data-forma-expanded]` so element indexes match stored HTML.

## 5. Lint: `lib/lint.cjs`

```js
staticLint(artifact) -> findings
PAGE_LINT                         // function source, run with page.evaluate(PAGE_LINT_FN, viewport)
scoreFindings(findings) -> { score: 0..100, counts: { error, warning, info } }
findingsPrompt(findings, max = 20) -> string
// finding: { rule, severity: 'error'|'warning'|'info', screen, viewport, target, message }
```

Static rules: navigation and `data-target` destinations exist, duplicate IDs
per screen, unreachable screens, inputs without labels, dialogs without an
open trigger, invalid `data-chart`, unknown icon names, unknown utility
classes, placeholder copy (lorem ipsum, TODO, `[image]`), empty screens.

Page rules (per screen and viewport): text contrast below WCAG AA (4.5:1, 3:1
for large text) on solid backgrounds, text under 12px, tap targets under
24px (error) / 44px (warning) at mobile, horizontal overflow and the
elements causing it, clipped text, overlapping text boxes, images without alt,
controls without accessible names, skipped heading levels, more than 8 font
sizes, paragraph lines over ~90 characters.

`browserRender` adds `lint: findings[]` (capped at 200) and `lintScore` to its
metrics without changing existing fields.

## 6. Inputs

- `lib/inputs.cjs`: `extractSource({ name, data })` where `data` is a base64
  string or Buffer. Returns `{ name, kind, text, chars, truncated, summary }`.
  Supports `.docx`, `.pptx` (slide text and notes, per slide), `.xlsx`
  (shared strings and inline strings, first 200 rows per sheet as TSV), `.csv`,
  `.tsv`, `.txt`, `.md`, `.json`, `.html` (tags stripped). Limits: 15 MB input,
  60,000 extracted characters, zip entry count and uncompressed size caps (zip
  bomb protection), no XML entity expansion. `.pdf` only through Poppler
  `pdftotext` when `PDFTOTEXT_PATH` or a sibling of `PDFINFO_PATH` exists,
  otherwise a clear error.
- `lib/tokens-import.cjs`: `importTokens(text)` reads CSS custom properties,
  hex/rgb/hsl colours by frequency, `font-family` values, border radius and
  spacing from CSS, design-token JSON (W3C `$value`, Style Dictionary) or a
  Tailwind `theme` object literal. Returns a partial token object plus
  `notes`, ready for `normalizeTokens`.

## 7. Pipeline: `lib/pipeline.cjs` (wired from `lib/model.cjs`)

```js
generate(cfg, project, prompt, current, ctx) -> artifact      // ctx: { signal, metrics, onStage, onDelta }
editElement(cfg, project, artifact, { screen, index, html, instruction }, ctx) -> artifact
directions(cfg, project, prompt, count, ctx) -> artifact[]
review(cfg, project, prompt, artifact, render, ctx) -> { issues, summary, ... }  // existing critique shape
```

- Web, new design: plan (JSON, `stage:'plan'`) → build screen 1 with shared
  CSS (tagged blocks) → build the other screens in parallel (`GLM_PARALLEL`) →
  assemble → `schema.artifact` → per-screen repair on validation errors.
- Web, revision: one call that returns only changed or new screens plus
  `forma-remove` and optional CSS; unchanged screens are copied verbatim.
- Element edit: send the element's stored outer HTML, its screen, shared CSS
  and the instruction; expect `<forma-element>` (+ optional `forma-css`
  append). Replace exactly that element.
- Directions: N plans with different direction briefs (e.g. editorial, dense
  enterprise, bold marketing) and presets, built in parallel.
- Review: lint findings plus screenshots (if vision enabled) → issues → fix as
  a changed-screens revision. One fix round by default.
- Slides and documents keep JSON generation through the hardened client.

## 8. Slides v2

New layouts: `section`, `quote`, `stats` (2–4 user-supplied numbers with
labels), `timeline` (3–6 steps), `cards` (3–4 cards with title/body), `chart`
(chart spec from section 4, native pptxgenjs chart in PPTX), `agenda`. Shared
geometry in `lib/slide-layout.cjs`, HTML preview in `lib/presentation.cjs`,
native export in `lib/exports.cjs`, validation in `lib/schema.cjs`. Office
fonts use `FONTS[family].office`.

## 9. Integration contracts (wave 2)

### Artifact additions (validated in `lib/schema.cjs`)

- `designSystem`: the token object from section 2, validated by
  `designSystem(value)` which calls `normalizeTokens` and then checks colours,
  fonts (keys of `FONTS`), ranges and enums. Legacy objects stay valid and are
  returned with the new fields filled in.
- `tweaks` (web only, optional, at most 8): `[{ var: /^--[a-z][a-z0-9-]{1,40}$/,
  label ≤ 40, min, max, step > 0, unit ∈ px|rem|em|%|vh|vw|'' , value }]`,
  `min < max`, `value` clamped. Same rules as `pipeline.normalizeTweaks`.
- References: up to `MAX_REFERENCES = 6` images. `{{reference:N}}` and
  `imageIndex` accept 0–5. PNG, JPEG and WebP data URLs.

### Page assembly (`lib/presentation.cjs`)

Web pages: `<style>` = `kitCSS(tokens)` → `utilityCSS(collectClasses(all screen
HTML), tokens)` → model `css` → `:root{<tweak vars>}`. Body HTML goes through
`expandMarkup` after `{{reference:N}}` substitution. CSP gains `font-src data:`.
The handoff ZIP adds `kit.css` (kit + utilities + tokens, fonts inlined) and
`tokens.json`; `styles.css` stays the model CSS only.

### Preview runtime messages (`lib/design-runtime.cjs`)

- `inspectorRuntime.nodes()` skips descendants of `[data-forma-expanded]` (the
  expanded element itself still counts, matching the stored `<i>` or
  `<figure>`). A click inside an expanded subtree selects its host.
- `selection` messages add `html`: the element's stored-equivalent outer HTML
  (≤ 20,000 characters; for expanded hosts, the original compact form).
- Parent → frame `{type:'tokens', vars:{'--name': 'value'}}` sets
  `document.documentElement.style` properties. Only `--[a-z0-9-]+` names and
  values matching `^(#[0-9a-fA-F]{3,8}|-?\d+(\.\d+)?(px|rem|em|%|vh|vw)?|[A-Za-z][A-Za-z0-9 ,'-]{0,80})$`.

### Server API additions (`server.cjs`, `lib/studio-routes.cjs`)

Jobs table gains `kind TEXT DEFAULT 'generate'` (`generate` | `directions`),
`options TEXT DEFAULT '{}'` (JSON), `progress TEXT DEFAULT '{}'` (JSON) and
`result_ids TEXT DEFAULT '[]'`. All INSERTs use named columns.

| Route | Body → response |
| --- | --- |
| `GET /api/config` | adds `vision`, `pipeline`, `maxReferences`, `presets: [{id,name,description,tokens}]`, `fonts: [names]`, `version: '0.3.0'` |
| `POST /api/projects` | adds optional `sources: [{name, data(base64)}]` (≤ 6 files, extracted with `inputs.extractSource`) and optional `preset` (id) which seeds the project design system; `references` up to 6 |
| `GET /api/projects/:pid` | adds `sources: [{id,name,kind,chars,summary,truncated}]` (no text) |
| `POST /api/projects/:pid/sources` | `{name, data}` → 201 `{id, summary}` |
| `DELETE /api/projects/:pid/sources/:sid` | → `{ok:true}` |
| `POST /api/projects/:pid/generate` | adds `directions: 2..4` (web, GLM mode, no current revision required). Creates a `directions` job |
| `POST /api/projects/:pid/element-edit` | `{revisionId, screen, element, instruction ≤ 4000}` → `{html, css, notes}`. Synchronous model call (counts against the job concurrency limit; 429 when saturated; aborted when the client disconnects). Demo mode returns 409 |
| `POST /api/projects/:pid/save` | accepts optional `note` (≤ 300 chars, e.g. `GLM element edit: …`) stored in the revision prompt and metrics |
| `POST /api/design-tokens/import` | `{text}` (≤ 200 KB) → `{tokens, notes}` via `importTokens` + `normalizeTokens` |
| `GET /api/jobs/:jid` | adds parsed `progress` and `result_ids` |

`progress`: `{ phase, label, done, total, chars, calls }`, written at most once
per second. Directions jobs commit every successful direction as a revision
with `parent_id = base_id`; the first becomes current, the others do not
advance `current_id`. Each carries `metrics.direction = { name, index, jobId }`.

Sources table: `project_sources(id, project_id, name, kind, text, chars,
summary, truncated, created)`. The job's `p.sources = [{name, text}]` feeds
`prompts.sources()`. `duplicate` copies sources.

Revision metrics add `lint` (static + page findings, capped), `lintScore`,
`pipeline`, `calls` (from llm metrics) and `reasoningTokens`. Lint errors that
survive the review pass become `warnings`.
