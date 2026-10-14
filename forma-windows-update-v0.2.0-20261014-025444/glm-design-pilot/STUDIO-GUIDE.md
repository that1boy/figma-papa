# Forma 0.2.0 studio guide

Start with a library starter to learn the editor without waiting for a model. The three flows contain labelled fictional content. In GLM mode, create a UI / UX project with a specific audience, key task, screen list, data and constraints. Up to two supplied screenshots can guide generation. The existing connection settings are unchanged.

## Design a flow

1. Choose a screen on the left. Add, rename, copy or remove screens there; at least one remains. Linked navigation also switches the active screen.
2. **Interact** runs the prototype. **Design** selects elements on the canvas or in Layers. Edit properties and click **Apply changes**. Container text is protected: select its text child to change words without deleting its children.
3. Add a heading, text, button, card, form, table, tabs or dialog. Connect a button through **Link to screen**. A newly inserted button needs an action before it is a useful prototype control; Checks will flag inactive buttons.
4. Use **Styles** for shared colors, local fonts, spacing and corners. Presets and saved style kits are reusable across projects. Applying styles updates the current draft and the project's GLM guidance; **Save design** records the artifact revision. Token-based CSS responds to styles; hard-coded colors in imported markup may need direct editing.
5. Switch Desktop / Tablet / Mobile or enter a width. Fit scales the viewport into the available space; 100% shows actual pixels. **Focus** hides the brief panel; **Show brief** returns it.
6. Undo/redo applies to the current draft. **Save design** creates a persistent revision; **History** inspects or restores older versions. Ctrl+S saves a canvas draft, Ctrl+Z / Ctrl+Shift+Z undo/redo outside text fields. Escape leaves Design mode.

The **Edit** panel exposes all screen markup and shared CSS, plus advanced artifact JSON. Load changed JSON into the editor before saving. Switching away from unsaved edits is guarded; a reload can still lose a discarded draft. Saved revisions survive restart.

## Iterate and review

Select an element and **Ask GLM to refine this** to prepare a targeted request in the brief box. Review it and submit Revise. Generated output replaces the artifact through the normal validated revision workflow; it is not a guaranteed isolated DOM patch. Check untouched screens after revisions.

**Feedback** stores notes against the saved revision, current screen and optional element. Resolve/reopen them or put a note into the brief. Notes remain with their revision rather than silently moving to a changed design. **Explore copy** starts an independent project with selected source context and styling, without inheriting an old model review as evidence.

**Checks → Render exports** captures all screens at three widths and enables PDF. Inspect the responsive table, rendered images and actual interactions. Model review is optional and can add several requests for multi-screen work. It is the same configured model reviewing its own output, not independent acceptance.

## Share and continue

- **Handoff ZIP:** self-contained index.html, per-screen HTML, shared CSS, design tokens, reference files, Forma JSON and a README with source context, feedback and provenance. Open index.html locally; no server is required for prototype interactions.
- **Forma JSON:** import it to continue editing in a new Forma project. Reattach references in their original numbered slots. It is a selected artifact, not a backup of the database or full revision history.
- **HTML / PDF:** interactive prototype or static rendered pages. Web PDF requires the browser renderer. Native Office PDF additionally requires LibreOffice and Poppler.
- **PPTX / DOCX:** existing native editable output, including text/tables and PowerPoint notes. Browser previews approximate Office layout; inspect the exported files in the intended Office runtime.

## Scope

Forma supports responsive HTML/CSS UI prototypes for web and mobile-shaped app flows. It does not produce deployable React/Flutter/native apps, working databases or payments. Forms give explicit local-only confirmation. Generated arbitrary JavaScript and remote resources stay disabled.

Property-based layout editing is supported; freeform drag/resize, arbitrary layer reparenting, real-time multiplayer editing, user identities, public share hosting, SSO and Figma connectors are not included. The application is a shared-password workspace suitable for a small controlled pilot. The UI supports twelve screens, not unlimited canvases; content and reference limits still apply.
