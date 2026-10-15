# Forma 0.3.0 — portable Windows package

`forma-windows-x64-0.3.0.zip` is a ready-to-run copy of Forma for a Windows x64
PC with no internet access, no installer and no npm. It contains:

- the application from commit `3adc934` on branch `claude/pensive-mayer-m54wxi`
  (`glm-design-pilot-windows-x64/glm-design-pilot/`),
- `runtime/node.exe`: Node.js v24.18.0 for Windows x64, downloaded from
  nodejs.org and verified against its published SHASUMS256.txt,
- `node_modules`: production dependencies pinned by `package-lock.json`,
- `SHA256SUMS.txt`: a checksum for every file in the package.

This branch holds only the package. The source and full documentation are on
`claude/pensive-mayer-m54wxi` (and `main` once merged). It can be rebuilt at
any time with `node scripts/package-windows.cjs`.

## Check the download

PowerShell, in the folder with the ZIP:

```powershell
Get-FileHash .\forma-windows-x64-0.3.0.zip -Algorithm SHA256
```

The hash must equal the value in `forma-windows-x64-0.3.0.zip.sha256`.

## Install

1. Use Extract All on the ZIP, into a writable folder such as
   `Documents\Forma`. Do not run it from inside the ZIP.
2. In the extracted `glm-design-pilot` folder, run `01-configure.cmd`. It
   creates `.env` with a random login password and secrets, then opens it.
3. Keep `MODEL_MODE=demo` to explore, or set `MODEL_MODE=glm`,
   `GLM_BASE_URL` (the `/v1` prefix of your endpoint), `GLM_MODEL` (the exact
   served model name) and `GLM_API_KEY` if required.
4. Run `02-start.cmd` and open http://127.0.0.1:8080. Log in with
   `APP_PASSWORD` from `.env`.

Upgrading an existing Forma 0.1.x/0.2.x install instead? Copy your `.env`
and `data` folder into the extracted package (stop the old copy first, keep it
as a backup, and never run two versions against the same data).

`START-HERE-WINDOWS.txt` inside the package covers troubleshooting, optional
LibreOffice/Poppler rendering and the optional `Forma.exe` launcher.

## Verified before publishing

Built and checked on Linux with Node.js 24.18.0 and Chromium: every file
matched the package's SHA256SUMS; the program files were byte-identical to
the commit; and from the extracted package, using only its bundled
dependencies, `npm test` (331 tests), the browser smoke test and the GLM-mode
end-to-end test passed. It has not been run on Windows itself or against the
real GLM-5.3-Flash endpoint yet.
