# Forma vs Claude Design: gap analysis

This compares what the GPT-generated Forma 0.2.0 already did, what Claude Design
offers (from Anthropic's April 2026 launch coverage), and what 0.3.0 adds.
The constraint throughout: everything runs on the organisation's
GLM-5.3-Flash endpoint, possibly without internet access.

## What Forma 0.2.0 already had

Forma 0.2.0 was a careful, honest pilot with good bones:

- Three formats: multi-screen web prototypes (up to 12 linked screens),
  slide decks with native editable PPTX export, and documents with native
  DOCX export.
- A safety model that holds: model HTML is sanitized, CSS is restricted,
  model JavaScript is forbidden, and previews run in sandboxed iframes with a
  strict content policy. A small trusted runtime implements navigation, tabs,
  toggles, dialogs, filters and forms from `data-action` attributes.
- A studio: Design and Interact modes, layer list, element inspector (text,
  colour, spacing, type, layout, links), component insertion, screen
  management, undo/redo, reusable styles, revision feedback notes, explore a
  copy, and an offline handoff ZIP.
- Persistence and provenance: SQLite, revision history with branches, restore,
  JSON import, and evaluation records that keep demo, template and import
  output out of GLM quality totals.
- A render-and-review loop: a renderer service screenshots every screen at
  desktop, tablet and mobile width (and Office files through LibreOffice);
  the model reviews the screenshots and gets one correction pass.
- Windows portable packaging with a bundled Node runtime, launch scripts and
  an optional `Forma.exe` launcher.

## Where it fell short of Claude Design

| Area | Claude Design | Forma 0.2.0 | Why it matters for GLM-5.3-Flash |
| --- | --- | --- | --- |
| Visual building blocks | Rich, polished UI, icons, charts, real typography | System fonts only (fonts blocked in previews), no icons (Unicode glyphs), no charts, no SVG, model writes all CSS from scratch | A flash model's taste and CSS precision are the weakest link. Good defaults matter more than prompts. |
| Generation strategy | Frontier model, iterative | One giant JSON answer with HTML escaped inside strings, one repair attempt | Escaped HTML in JSON wastes tokens and breaks easily; one long answer is slow and fragile |
| Model plumbing | — | No streaming, no retries, `<think>` leakage breaks parsing, images always sent (text-only endpoints fail), one reasoning level for everything | GLM-5.3-Flash always thinks; reasoning can leak into content behind a misconfigured parser |
| Refinement | Chat, inline comments, direct edits, generated sliders | Revise box regenerates the whole artifact; "Ask GLM" only pre-fills the prompt; no sliders | Regenerating everything for a small change is slow and can disturb untouched work |
| Design systems | Built from codebase/design files; multiple systems; applied automatically | Five tokens, five system fonts, four presets | Without strong tokens the model invents inconsistent colours and spacing |
| Inputs | Text, images, DOCX/PPTX/XLSX, codebase, web capture | Two images | Source documents are where facts come from |
| Quality checks | — | Model vision review of screenshots plus a few DOM counts | Deterministic checks catch what a smaller model misses (contrast, overflow, tap targets) |
| Exploration | Multiple directions | One output per request | Flash models are cheap; several drafts and a choice beat one draft |
| Slides | Free-form visual slides | Five text layouts, no charts | — |
| Collaboration and sharing | Org sharing, links, Canva export | Single password, shared workspace | Out of scope for this release (see below) |

## What 0.3.0 adds

1. **A design kit the model composes from**: a Tailwind-compatible utility
   engine (generated on demand, no build step), a component library on design
   tokens, about 10 curated design-system presets, 11 bundled open-source font
   families, 1,890 Lucide icons via `<i data-icon>`, server-rendered SVG charts
   from `data-chart` JSON, and sanitized inline SVG.
2. **A staged pipeline**: plan (JSON) → build the first screen with shared
   CSS → build the remaining screens in parallel → assemble and validate.
   Screens are raw HTML in tagged blocks, not escaped JSON. Deterministic CSS
   clean-up replaces most repair calls.
3. **Surgical changes**: revisions return only the screens that change
   (unchanged screens stay byte-identical), and element edits send one
   element to the model and replace only that element.
4. **A hardened GLM client**: streaming with live progress, retries with
   backoff, `<think>` stripping, tolerant JSON extraction, automatic text-only
   fallback when the endpoint rejects images, and per-stage reasoning effort
   (low for review, higher for planning and building).
5. **Deterministic design lint**: WCAG contrast, tiny text, small tap
   targets, overflow, clipped and overlapping text, missing labels and alt
   text, heading order, broken navigation, unknown icons or classes. Findings
   are scored, shown in Checks and fed to the fix pass.
6. **Directions**: generate 2–4 genuinely different variants in parallel and
   pick one.
7. **Tweak sliders**: the plan proposes layout knobs (CSS custom properties);
   the studio shows sliders for those plus core tokens, applied live in the
   preview and saved with the design.
8. **Richer inputs**: up to 6 reference images and source documents (DOCX,
   PPTX, XLSX, CSV, TXT, Markdown, HTML, JSON) extracted as facts; design
   tokens imported from CSS, token JSON or a Tailwind config.
9. **More slide layouts** with native PowerPoint charts.

## Still missing (recommended next steps)

- **Identity and sharing**: SSO (header auth from an internal reverse proxy is
  the cheapest route), per-user attribution of revisions and comments,
  read-only share links.
- **Real collaboration**: live presence, threaded comments that mention
  people, approvals.
- **Codebase-derived design systems**: Claude Design reads a repository.
  0.3.0 imports tokens from CSS/JSON/Tailwind files; parsing component
  libraries is a larger project.
- **Web capture**: grabbing elements from internal sites needs an allowlisted
  capture service; the renderer deliberately blocks network access today.
- **Model-authored JavaScript**: prototypes stay declarative. Allowing
  scripts would need a hardened, network-isolated sandbox and a security
  review.
- **Scale**: one Node process, SQLite and an in-process queue suit a pilot,
  not thousands of concurrent users.
- **Measured quality**: none of this is verified against the real
  GLM-5.3-Flash deployment yet. Use `evaluation/README.md` with real briefs
  before rolling out.
