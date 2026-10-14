# Forma 0.1.3

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
