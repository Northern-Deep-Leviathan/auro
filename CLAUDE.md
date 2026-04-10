# CLAUDE.md — OpenCode Monorepo

OpenCode is an AI-powered development tool providing CLI, desktop, and web interfaces for AI-assisted software engineering.

## NOT

- Do not run tests from the repo root — `cd` into the subproject first
- Do not push with failing typecheck — pre-push hook will block it
- Do not add ESLint or Biome — this project uses Prettier only
- DO not add lots of trival and tiny tests in a similar terminology - consider to combine them if possible

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
