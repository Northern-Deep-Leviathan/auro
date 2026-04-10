# CLAUDE.md Restructuring Design

## Problem

The root `CLAUDE.md` mixes monorepo governance (rules, commands, git hooks) with subproject-specific details (per-package commands, test conventions, architecture descriptions, framework choices). This causes two issues:

1. **AI context pollution** — an agent working in `packages/app` receives irrelevant details about `packages/opencode` test fixtures, desktop Tauri build commands, etc.
2. **Maintenance burden** — a single file owns concerns that belong to their respective subprojects. Changes to a subproject's test setup require editing the root file.

## Decision

**Approach: Strict Separation**

- Root CLAUDE.md = monorepo governance only
- Each active subproject gets its own CLAUDE.md with package-specific details
- First pass covers the 3 core packages: `opencode`, `app`, `desktop`

## Files to Create/Modify

### 1. Root `CLAUDE.md` (rewrite)

**Keeps:**
- 1-line project summary
- Tech stack table (trimmed to monorepo-wide tools only — no SolidJS, Hono, Kobalte, etc.)
- Flat subproject map table (all 13 packages, one-line descriptions)
- Monorepo-wide commands (`bun install`, `bun typecheck`)
- Build & verification checklist (root-level steps only, points to subproject CLAUDE.md for test commands)
- Git hooks section (pre-push)
- Placeholder coding rules section

**Removes:**
- Project overview paragraph (replaced by 1-line summary)
- Full directory tree with nested src/ structure
- Package relationships section
- Per-subproject commands (opencode, app, desktop sections)
- Per-subproject testing details (test location, fixtures, setup)
- Per-subproject build details

### 2. `packages/opencode/CLAUDE.md` (new)

Contains:
- Commands: dev, test, build, typecheck, drizzle-kit
- Testing: bun:test, test/ directory (mirrors src/), preload setup, tmpdir() fixture, 30s timeout
- Architecture: Hono, Vercel AI SDK, @opentui TUI, MCP SDK, Drizzle ORM, Zod, Remeda
- Path aliases: @/* and @tui/*
- Build notes: models snapshot fetch, provider allowlist, dist/ output
- Placeholder coding rules

### 3. `packages/app/CLAUDE.md` (new)

Contains:
- Commands: dev (port 3000), build, serve, typecheck (tsgo -b)
- Unit testing: bun:test + HappyDOM preload, colocated tests (src/**/*.test.ts), mock.module()
- E2E testing: Playwright, e2e/ directory, interactive and report commands
- Architecture: SolidJS, TailwindCSS v4, Kobalte, ghostty-web, Shiki, marked, Luxon, virtua, i18n
- Path aliases: @/*
- Build notes: ./vite export for desktop, composite tsconfig
- Placeholder coding rules

### 4. `packages/desktop/CLAUDE.md` (new)

Contains:
- Commands: tauri dev, tauri build, typecheck, predev
- Testing: none (delegates to app)
- Architecture: Tauri v2, Rust backend, delegates frontend to @opencode-ai/app, sidecar pattern
- Build notes: predev script, port 1420 strictPort, TAURI_ENV_TARGET_TRIPLE, conf overlays
- Placeholder coding rules

## Principles

1. **Root knows nothing about subproject internals** — no framework choices, no per-package commands, no architecture details
2. **Subproject CLAUDE.md is self-contained** — everything an AI agent needs to work in that package is in its own file
3. **Flat subproject map** — simple table, not a nested tree. One-line descriptions.
4. **Tech stack at root = monorepo-wide only** — Bun, TurboRepo, tsgo, Prettier, bun:test. Subproject-specific tech (SolidJS, Hono, Tauri, Kobalte) lives in subproject files.
5. **Coding rules placeholder** — both root and subproject files include a TODO section for future rule specification

## Out of Scope

- CLAUDE.md for packages beyond the core 3 (ui, util, plugin, function, web, sdk/js, enterprise, console, slack, storybook) — deferred to future pass
- Inferring coding rules from codebase patterns — user will specify later
- Changes to docs/ architecture documentation
