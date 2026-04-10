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
