# figma-papa — Forma design studio for GLM-5.3-Flash

Forma is an internal, self-hosted design studio that turns briefs, reference
images and documents into clickable multi-screen prototypes, editable
PowerPoint decks and Word documents. It runs entirely on the organisation's
own GLM-5.3-Flash endpoint and works without internet access.

The app lives in **`glm-design-pilot-windows-x64/glm-design-pilot/`**.

## What is in this repository

| Path | What it is |
| --- | --- |
| `glm-design-pilot-windows-x64/glm-design-pilot/` | The application (version 0.3.0): source, tests, docs, Windows launch scripts and Docker files. |
| `forma-launcher-1.0.0-20261005-201153/` | Optional `Forma.exe` launcher (Start / Stop / Settings) and its C# source. Put `Forma.exe` next to `02-start.cmd`. |
| `START-HERE-WINDOWS.txt` | Setup steps for the organisation's Windows PC. |
| `SHA256SUMS.txt` | Checksums of the original ZIP downloads (historical). |

How the three original uploads map to this layout: the first upload carried
the launcher, the guides and the 0.2.0 source update; the second created the
Windows bundle folder; the third carried that bundle's `lib/`, `public/`,
`test/`, `scripts/`, `evaluation/` and `runtime/LICENSE`, which were moved into
the bundle folder (all checksums matched). The 0.2.0 update was then applied
to the bundle, as its own install guide prescribes, and 0.3.0 was built on top.

`runtime/node.exe` and `node_modules/` are not stored in git. Either keep them
from an existing Forma installation (0.3.0 adds no npm dependencies) or build
a complete portable ZIP with `scripts/package-windows.cjs` (below).

## Quick start

**Windows (portable, no install):**

A prebuilt `forma-windows-x64-0.3.0.zip` (with its SHA-256 and install notes)
is on the [`claude/windows-package`](https://github.com/that1boy/figma-papa/tree/claude/windows-package)
branch. Download it, check the hash, then continue at step 2. To build it
yourself instead:

1. On any internet-connected machine with Node.js 24:
   `cd glm-design-pilot-windows-x64/glm-design-pilot && node scripts/package-windows.cjs`
   This writes `dist/forma-windows-x64-0.3.0.zip` (about 42 MB) with Node.js,
   dependencies and a checksum list.
2. Copy the ZIP to the organisation PC, Extract All, run `01-configure.cmd`,
   edit `.env` (set `MODEL_MODE=glm`, `GLM_BASE_URL`, `GLM_MODEL`,
   `GLM_API_KEY`), then run `02-start.cmd` and open http://127.0.0.1:8080.

**Any OS with Node.js 24 (development):**

```sh
cd glm-design-pilot-windows-x64/glm-design-pilot
npm ci --ignore-scripts
cp .env.example .env        # demo mode works out of the box
npm start                   # app on http://127.0.0.1:8080 (password in .env)
npm test                    # unit and integration tests
```

Web screenshots, PDF export and visual review need the renderer
(`npm run renderer`) and a Chromium/Edge/Chrome (`BROWSER_EXECUTABLE`).

## Documentation

- `glm-design-pilot-windows-x64/glm-design-pilot/README.md`: features,
  configuration, security model, operations.
- `…/docs/GAP-ANALYSIS.md`: what Forma had, what was missing compared with
  Claude Design, what 0.3.0 adds and what remains.
- `…/docs/ENGINE-SPEC.md`: engineering spec of the 0.3 design engine.
- `…/docs/GLM-SERVING.md`: notes for the team serving GLM-5.3-Flash.
- `…/STUDIO-GUIDE.md` and `…/RELEASE-NOTES.md`.
