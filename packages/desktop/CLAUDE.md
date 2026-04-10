# CLAUDE.md — desktop (Tauri Desktop Shell)

## NOT

- Do not skip `predev` — it builds the opencode CLI sidecar binary required by Tauri

<!-- TODO: Add more desktop-specific prohibitions -->

## PREFERRED

- No dedicated tests in this package — desktop delegates UI logic to `packages/app`
- To verify UI behavior, run tests in app: `cd ../app && bun test`
- `predev` must complete before `tauri dev` will work

## Build & Verification

Run in order:

```bash
tsgo -b                              # 1. Typecheck
bun run predev                       # 2. Build opencode sidecar binary
bun run tauri build --target <triple> # 3. Build installer (substitute target triple)
```

## Coding Rules

<!-- TODO: Add desktop-specific coding rules -->

## Commands

```bash
bun run tauri dev                    # Dev mode (runs predev automatically)
bun run tauri build --target <triple> # Build installer for target platform
tsgo -b                              # Typecheck
bun run predev                       # Build opencode CLI binary → src-tauri/sidecars/
```

## Architecture

- Shell: Tauri v2 (Rust backend + SolidJS frontend)
- Frontend: delegates entirely to @opencode-ai/app
- Sidecar: bundles the opencode CLI binary as a native subprocess
- Rust backend: `src-tauri/src/`
- Dev server: port 1420 (strictPort, required by Tauri)
- Env: `TAURI_ENV_TARGET_TRIPLE` controls sidecar target
- Config overlays: multiple `tauri.conf.json` variants for beta/prod/auro
