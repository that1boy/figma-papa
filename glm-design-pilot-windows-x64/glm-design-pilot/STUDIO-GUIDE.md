# Forma 0.3.0 studio guide

Start with a library starter to learn the editor without waiting for a model. The three flows (operations workspace, mobile discovery app, product website) contain labelled fictional content and use the 0.3 design kit. In GLM mode, create a project and describe the audience, the key task, the screens you expect, the data and any constraints.

## Create a project

1. Choose **UI / UX design**, **Presentation** or **Document**.
2. Name it and add brand guidance if you have any.
3. Pick a **design system** preset, or leave it on Auto and GLM chooses one that fits the brief. Presets set colours, fonts, radius, spacing, density and shadows; everything the kit draws follows them.
4. Add up to six **reference images** (PNG, JPEG or WebP) and up to six **source documents** (DOCX, PPTX, XLSX, CSV, TSV, TXT, Markdown, HTML, JSON). Forma extracts the text and shows a summary for each document. GLM treats both as facts to use, never as instructions to follow. You can add or remove sources later from the **Sources** panel.

## Generate and revise in the chat

- Type the brief and press **Generate** (Ctrl/Cmd+Enter). While GLM works, a live turn shows the current stage (planning, building each screen, rendering, reviewing) and how much it has written.
- Each finished turn says what happened: how many screens were built or changed, the preset, model calls, tokens, duration and the design lint score. Failed or cancelled jobs appear with a **Retry** button.
- To revise, type what should change and press **Revise**. For web projects GLM returns only the screens that change; the others stay exactly as they were. The suggestion chips (for example *Make it denser*, *Improve mobile layout*) fill in common requests.
- **Review content and layout** (on by default) renders the result, runs the design lint and lets GLM review it, then applies one correction pass. It is the same model reviewing its own work, not independent acceptance.

## Explore directions

For a web project, set **Directions** to 2, 3 or 4 before generating. GLM plans and builds that many genuinely different variants in parallel (calm and clear, bold and expressive, dense and efficient, warm and editorial). A picker above the preview shows one card per direction. View any of them, then choose **Use this direction** to continue from it.

## Edit in the studio

1. **Interact** runs the prototype; **Design** selects elements on the canvas or in **Layers**. Icons and charts are single layers, marked with a badge.
2. Edit text, colour, size, spacing, radius, layout and links in the inspector and click **Apply changes**.
3. **Ask GLM to refine this**: describe a change for the selected element and choose **Apply with GLM**. Only that element is sent and replaced. The result is an undoable draft change; **Save design** records it with your instruction in the revision history. Not available in demo mode.
4. **Tweaks** opens sliders for the layout knobs GLM proposed for this design (for example sidebar width or card gap) and for the core tokens: accent, radius, spacing, type scale, density and fonts. Changes apply live in the preview; **Apply tweaks** writes them to the draft.
5. **Styles** edits the full design system, switches presets, saves reusable styles, and can **Import from CSS / tokens / Tailwind**: paste or upload a stylesheet, a design-token JSON file or a Tailwind config and Forma fills in the colours, fonts, radius and spacing it finds.
6. **Add a component** inserts kit-based building blocks (heading, text, button, button group, card, stats, table, form field, form, tabs, dialog, empty state, alert, sample chart).
7. Switch Desktop / Tablet / Mobile or enter a width. Undo/redo applies to the draft; **Save design** creates a revision. Ctrl+S saves, Ctrl+Z / Ctrl+Shift+Z undo and redo outside text fields, Escape leaves Design mode.

The **Edit** tab exposes all screen markup, shared CSS and the advanced artifact JSON.

## Checks

- **Design lint**: a score out of 100 and findings grouped by rule, errors first. Rules cover WCAG contrast, text under 12 px, small tap targets on mobile, horizontal overflow, clipped or overlapping text, images without alt text, unnamed controls, skipped heading levels, broken navigation and unknown icons or classes.
- **Model calls**: every call with its stage, duration, input, output and reasoning tokens, retries, and whether images were dropped because the endpoint refused them.
- **Responsive screen checks** and **Render exports**: every screen at 1280, 768 and 390 px, plus PDF.

## Slides and documents

Decks can use cover, bullets, two-column, table, image, section, quote, stats, timeline, cards, chart and agenda layouts. Stats and charts only use numbers from your brief or sources. PPTX export is native and editable, including charts. Documents export to editable Word. The preview approximates Office layout; inspect exported files in Office.

## Share and continue

- **Handoff ZIP**: index.html, per-screen HTML, `kit.css` (fonts, tokens, components and the utility classes the design uses), `styles.css`, `tokens.json`, references, Forma JSON and a README with source context, feedback and provenance. Open index.html locally; no server is needed.
- **Forma JSON**: import it into another Forma installation to keep editing.
- **HTML / PDF / PPTX / DOCX** as before.
- **Feedback** stores notes against a saved revision, screen and element. **Explore a copy** starts an independent project.

## Scope

Forma produces responsive HTML/CSS prototypes with declarative interactions, not deployable apps. Model-written JavaScript and remote resources stay disabled. There is one shared password and workspace; there is no SSO, per-user attribution, live multiplayer editing or public sharing.
