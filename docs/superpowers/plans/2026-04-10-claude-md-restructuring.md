# CLAUDE.md Restructuring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the monorepo's single root CLAUDE.md into a hierarchy — lean root for monorepo governance + 3 subproject CLAUDE.md files (opencode, app, desktop) for package-specific details.

**Architecture:** Strict separation. Root owns rules, verification checklist, commands, and subproject map. Each subproject owns its own commands, testing conventions, and architecture. Section priority: NOT rules > PREFERRED rules > Build checklist > Coding rules > Commands > Map/Architecture.

**Tech Stack:** Markdown files only. No code changes.

**Spec:** `docs/superpowers/specs/2026-04-10-claude-md-restructuring-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Rewrite | `CLAUDE.md` | Monorepo governance: rules, verification, commands, subproject map |
| Create | `packages/opencode/CLAUDE.md` | CLI/agent engine: commands, testing, architecture |
| Create | `packages/app/CLAUDE.md` | Web UI: commands, unit+e2e testing, architecture |
| Create | `packages/desktop/CLAUDE.md` | Tauri shell: commands, build notes, architecture |

---

### Task 1: Rewrite root CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (full rewrite)

- [ ] **Step 1: Replace root CLAUDE.md with monorepo-governance-only content**

Replace the entire contents of `CLAUDE.md` with:

```markdown
# CLAUDE.md — OpenCode Monorepo

OpenCode is an AI-powered development tool providing CLI, desktop, and web interfaces for AI-assisted software engineering.

## NOT

- Do not run tests from the repo root — `cd` into the subproject first
- Do not push with failing typecheck — pre-push hook will block it
- Do not add ESLint or Biome — this project uses Prettier only

## PREFERRED

- Formatting: Prettier (`semi: false`, `printWidth: 120`)
- Git hooks (`.husky/pre-push`): validates Bun version matches `packageManager` in root `package.json`, then runs `bun typecheck`
- Each subproject has its own CLAUDE.md — refer to it for package-specific rules and commands

## Build & Verification Checklist

Run in order after making changes:

```bash
bun typecheck                                            # 1. Typecheck all packages (via turbo)
bunx prettier --check "packages/<pkg>/src/**/*.ts"       # 2. Format check (substitute <pkg>)
cd packages/<pkg> && <test command>                      # 3. Tests (see subproject CLAUDE.md)
```

## Coding Rules

<!-- TODO: Add monorepo-wide coding rules -->

## Commands

```bash
bun install          # Install all dependencies
bun typecheck        # Typecheck all packages (via turbo)
```

## Subproject Map

| Folder | Description |
|--------|-------------|
| packages/opencode | Core CLI + agent engine |
| packages/app | Web UI (SolidJS) |
| packages/desktop | Tauri desktop shell |
| packages/ui | Shared component library |
| packages/util | Shared utilities |
| packages/plugin | Plugin system |
| packages/function | Cloud backend (CF Workers) |
| packages/web | Documentation site |
| packages/sdk/js | TypeScript SDK |
| packages/enterprise | Enterprise features |
| packages/console | Console tools |
| packages/slack | Slack integration |
| packages/storybook | Component storybook |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun 1.3.10 |
| Package manager | Bun (workspace with catalogs) |
| Monorepo | TurboRepo |
| Type checking | tsgo (native TS compiler) |
| Formatting | Prettier (no ESLint, no Biome) |
| Testing | bun:test (unit), Playwright (e2e) |
```

- [ ] **Step 2: Verify word count is under 800**

Run: `wc -w CLAUDE.md`
Expected: under 800 words

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "refactor: rewrite root CLAUDE.md for monorepo governance only"
```

---

### Task 2: Create packages/opencode/CLAUDE.md

**Files:**
- Create: `packages/opencode/CLAUDE.md`

- [ ] **Step 1: Write packages/opencode/CLAUDE.md**

Create `packages/opencode/CLAUDE.md` with:

```markdown
# CLAUDE.md — opencode (Core CLI + Agent Engine)

## NOT

<!-- TODO: Add opencode-specific prohibitions -->

## PREFERRED

- Always pass `--timeout 30000` when running tests
- Tests live in `test/` directory (separate from `src/`, mirrors `src/` structure)
- Tests use a custom `tmpdir()` fixture for isolated environments with config and git support
- Preload: `test/preload.ts` sets XDG env vars, creates temp dir, cleans up SQLite DB

## Build & Verification

Run in order:

```bash
tsgo --noEmit                        # 1. Typecheck
bun test --timeout 30000             # 2. Run all tests
```

## Coding Rules

<!-- TODO: Add opencode-specific coding rules -->

Path aliases:
- `@/*` → `./src/*`
- `@tui/*` → `./src/cli/cmd/tui/*`

## Commands

```bash
bun run dev                          # Run CLI in dev mode
bun test --timeout 30000             # Run all tests
bun run build --single --baseline    # Build standalone executable
tsgo --noEmit                        # Typecheck
bun drizzle-kit                      # Database migrations
```

## Architecture

- Server: Hono (REST + WebSocket routes)
- AI: Vercel AI SDK (`ai`) with 15+ provider adapters
- TUI: @opentui/core + @opentui/solid (Solid.js rendered in terminal)
- MCP: @modelcontextprotocol/sdk
- DB: Drizzle ORM (SQLite)
- Validation: Zod
- Utilities: Remeda (functional programming)
```

- [ ] **Step 2: Verify word count is under 800**

Run: `wc -w packages/opencode/CLAUDE.md`
Expected: under 800 words

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/CLAUDE.md
git commit -m "docs: add CLAUDE.md for opencode package"
```

---

### Task 3: Create packages/app/CLAUDE.md

**Files:**
- Create: `packages/app/CLAUDE.md`

- [ ] **Step 1: Write packages/app/CLAUDE.md**

Create `packages/app/CLAUDE.md` with:

```markdown
# CLAUDE.md — app (Web UI)

## NOT

<!-- TODO: Add app-specific prohibitions -->

## PREFERRED

- Unit tests colocated with source: `src/**/*.test.ts`
- Unit tests use HappyDOM preload (`happydom.ts`) for DOM APIs
- Use `mock.module()` for dependency injection in tests
- E2E tests live in `e2e/` directory (Playwright)

## Build & Verification

Run in order:

```bash
tsgo -b                              # 1. Typecheck (project references mode)
bun test                             # 2. Unit tests
bun run test:e2e                     # 3. E2E tests (Playwright)
```

## Coding Rules

<!-- TODO: Add app-specific coding rules -->

Path aliases:
- `@/*` → `./src/*`

## Commands

```bash
bun run dev                          # Vite dev server (port 3000)
bun run build                        # Vite production build
bun run serve                        # Vite preview server
tsgo -b                              # Typecheck
bun test                             # Unit tests (alias for test:unit)
bun run test:unit:watch              # Unit tests in watch mode
bun run test:e2e                     # Playwright e2e tests
bun run test:e2e:ui                  # Playwright interactive UI
bun run test:e2e:report              # Show Playwright report
```

## Architecture

- UI: SolidJS (solid-js, @solidjs/router, @solidjs/meta)
- Styling: TailwindCSS v4 (@tailwindcss/vite)
- UI primitives: Kobalte (@kobalte/core)
- Terminal: ghostty-web
- Syntax highlighting: Shiki
- Markdown: marked
- Date/time: Luxon
- Virtualization: virtua
```

- [ ] **Step 2: Verify word count is under 800**

Run: `wc -w packages/app/CLAUDE.md`
Expected: under 800 words

- [ ] **Step 3: Commit**

```bash
git add packages/app/CLAUDE.md
git commit -m "docs: add CLAUDE.md for app package"
```

---

### Task 4: Create packages/desktop/CLAUDE.md

**Files:**
- Create: `packages/desktop/CLAUDE.md`

- [ ] **Step 1: Write packages/desktop/CLAUDE.md**

Create `packages/desktop/CLAUDE.md` with:

```markdown
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
```

- [ ] **Step 2: Verify word count is under 800**

Run: `wc -w packages/desktop/CLAUDE.md`
Expected: under 800 words

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/CLAUDE.md
git commit -m "docs: add CLAUDE.md for desktop package"
```

---

### Task 5: Final verification

**Files:**
- Read: `CLAUDE.md`, `packages/opencode/CLAUDE.md`, `packages/app/CLAUDE.md`, `packages/desktop/CLAUDE.md`

- [ ] **Step 1: Verify all 4 files exist and are under 800 words**

Run:
```bash
wc -w CLAUDE.md packages/opencode/CLAUDE.md packages/app/CLAUDE.md packages/desktop/CLAUDE.md
```
Expected: each file under 800 words

- [ ] **Step 2: Verify no subproject-specific content remains in root**

Read `CLAUDE.md` and confirm:
- No mentions of `bun run dev`, `bun run build --single`, `tsgo -b`, `tauri`, `drizzle-kit`
- No mentions of HappyDOM, Playwright config, tmpdir() fixture
- No nested directory tree
- No "Package Relationships" section

- [ ] **Step 3: Verify root CLAUDE.md has no architecture/framework details**

Confirm root does NOT mention: Hono, SolidJS, Kobalte, Tauri, Drizzle, Vercel AI SDK, ghostty-web, Shiki, Luxon, Remeda, @opentui
