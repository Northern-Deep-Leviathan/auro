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

Sections in order:
1. 1-line project summary (header)
2. NOT rules — `do not run tests from root`, `do not push if typecheck fails`
3. PREFERRED rules — Prettier formatting, git hooks (pre-push: bun version check + typecheck)
4. Build & Verification Checklist — `bun typecheck` → format check → subproject tests
5. Coding rules — placeholder (TODO)
6. Commands — `bun install`, `bun typecheck`
7. Subproject Map — flat table, all 13 packages
8. Tech Stack — monorepo-wide only (Bun, TurboRepo, tsgo, Prettier, bun:test)

**Removes from current file:** project overview paragraph, directory tree, package relationships, all per-subproject commands/testing/build details.

### 2. `packages/opencode/CLAUDE.md` (new)

Sections in order:
1. 1-line package summary (header)
2. NOT rules — placeholder
3. PREFERRED rules — 30s test timeout, test/ mirrors src/ structure, tmpdir() fixture for isolation
4. Build & Verification — tsgo --noEmit → bun test --timeout 30000
5. Coding rules — placeholder, path aliases (@/*, @tui/*)
6. Commands — dev, test, build, typecheck, drizzle-kit
7. Architecture — Hono, Vercel AI SDK, @opentui TUI, MCP SDK, Drizzle ORM, Zod, Remeda

### 3. `packages/app/CLAUDE.md` (new)

Sections in order:
1. 1-line package summary (header)
2. NOT rules — placeholder
3. PREFERRED rules — colocated tests (src/**/*.test.ts), HappyDOM preload, mock.module() for DI
4. Build & Verification — tsgo -b → bun test → bun run test:e2e
5. Coding rules — placeholder, path aliases (@/*)
6. Commands — dev (port 3000), build, serve, typecheck, test:unit, test:e2e variants
7. Architecture — SolidJS, TailwindCSS v4, Kobalte, ghostty-web, Shiki, Luxon, virtua

### 4. `packages/desktop/CLAUDE.md` (new)

Sections in order:
1. 1-line package summary (header)
2. NOT rules — placeholder
3. PREFERRED rules — no dedicated tests (delegates to app), predev must run before tauri dev
4. Build & Verification — tsgo -b → bun run predev → bun run tauri build
5. Coding rules — placeholder
6. Commands — tauri dev, tauri build, typecheck, predev
7. Architecture — Tauri v2, Rust backend, sidecar pattern, port 1420 strictPort

## Constraints

- **Each CLAUDE.md must be under 800 words.** If a file exceeds this, strip from the bottom of the priority order first.
- **Root knows nothing about subproject internals** — no framework choices, no per-package commands, no architecture details
- **Subproject CLAUDE.md is self-contained** — everything an AI agent needs to work in that package is in its own file

## Section Priority Order (highest to lowest)

Every CLAUDE.md follows this ordering. If the file exceeds 800 words, strip sections from the bottom first.

1. **NOT rules** — things the AI must NOT do (hard prohibitions)
2. **PREFERRED rules** — conventions, style preferences, git hooks/husky
3. **Build & Verification Checklist** — ordered steps to validate changes
4. **Coding Rules** — patterns, imports, structure conventions
5. **Commands** — dev, test, build, typecheck commands
6. **Subproject Map** (root only) — flat table of packages
7. **Tech Stack** (root only) / **Architecture** (subprojects) — framework/library reference

Sections 6-7 are the first to be cut if space is tight. The 1-line project summary sits above all sections as a header.

## Out of Scope

- CLAUDE.md for packages beyond the core 3 (ui, util, plugin, function, web, sdk/js, enterprise, console, slack, storybook) — deferred to future pass
- Inferring coding rules from codebase patterns — user will specify later
- Changes to docs/ architecture documentation
