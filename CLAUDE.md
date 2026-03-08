# CLAUDE.md — OpenCode Project Guide

This file provides the context and conventions for working on the OpenCode codebase.

## Project Overview

OpenCode is an AI-powered development tool built as a monorepo. It provides CLI, desktop, and web interfaces for AI-assisted software engineering, supporting 15+ LLM providers via the Vercel AI SDK.

**Detailed architecture documentation is in `../docs/`** — read those files for deep understanding of package relationships, configuration flow, CLI execution flow, build processes, and third-party libraries.

## Repository Structure

```
opencode-advanced/              (monorepo root, managed by TurboRepo + Bun)
├── packages/
│   ├── opencode/               # Core CLI + agent engine (TypeScript, Bun, Hono)
│   │   ├── src/                # Source code
│   │   │   ├── agent/          # Agent definitions, system prompts
│   │   │   ├── cli/            # CLI commands, TUI (Terminal UI)
│   │   │   ├── config/         # Configuration loading (7-layer merge)
│   │   │   ├── mcp/            # Model Context Protocol integration
│   │   │   ├── permission/     # Per-tool permission system
│   │   │   ├── provider/       # LLM provider management, models.dev
│   │   │   ├── server/         # Hono HTTP server, REST + WebSocket routes
│   │   │   ├── session/        # Conversation history, SQLite storage, agent loop
│   │   │   ├── shell/          # Process spawning, cross-platform shell
│   │   │   └── tool/           # 17+ tools (bash, read, write, edit, grep, etc.)
│   │   └── test/               # Tests (separate directory, mirrors src/ structure)
│   ├── app/                    # Web UI (SolidJS, Vite, TailwindCSS)
│   │   └── src/                # Source + colocated tests (*.test.ts alongside source)
│   ├── desktop/                # Tauri native shell (Rust + SolidJS)
│   │   └── src-tauri/          # Rust backend, sidecar management
│   ├── sdk/js/                 # TypeScript SDK (auto-generated from OpenAPI)
│   ├── ui/                     # Shared SolidJS component library
│   ├── util/                   # Shared utilities
│   ├── plugin/                 # Plugin system
│   ├── function/               # Cloud backend (Cloudflare Workers, SST)
│   └── web/                    # Documentation site (Astro)
├── ../docs/                    # Architecture & build documentation
├── turbo.json                  # TurboRepo task definitions
└── package.json                # Workspace config, Prettier config, catalogs
```

### Package Relationships

- **`packages/opencode`** = the brain — all agent logic, LLM calls, tool execution, file I/O
- **`packages/app`** = the face — SolidJS UI components, backend-agnostic
- **`packages/desktop`** = the glue — Tauri wrapper, spawns CLI as sidecar subprocess
- Desktop imports App at compile time (Vite), communicates with CLI at runtime (HTTP/WebSocket)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | **Bun** 1.3.10 |
| Package manager | **Bun** (workspace with catalogs) |
| Monorepo | **TurboRepo** |
| Backend framework | **Hono** |
| Frontend framework | **SolidJS** |
| Desktop | **Tauri** (Rust) |
| AI SDK | **Vercel AI SDK** (`ai` package) |
| Styling | **TailwindCSS v4** |
| UI primitives | **Kobalte** |
| Database | **Drizzle ORM** (SQLite) |
| Validation | **Zod** |
| Utilities | **Remeda** (functional programming) |
| Type checking | **tsgo** (native TS compiler) |
| Formatting | **Prettier** (no ESLint, no Biome) |
| Testing | **bun:test** (unit), **Playwright** (e2e) |
| Infrastructure | **SST** on Cloudflare |

## Common Commands

### From repo root

```bash
bun install                          # Install all dependencies
bun typecheck                        # Typecheck all packages (via turbo)
```

### packages/opencode (CLI)

```bash
cd packages/opencode
bun run dev                          # Run CLI in dev mode
bun test --timeout 30000             # Run all tests
bun run build --single --baseline    # Build standalone executable
tsgo --noEmit                        # Typecheck
bun drizzle-kit                      # Database migrations
```

### packages/app (Web UI)

```bash
cd packages/app
bun run dev                          # Vite dev server
bun test                             # Run unit tests (bun test --preload ./happydom.ts ./src)
bun run test:e2e                     # Playwright e2e tests
bun run build                        # Vite production build
tsgo -b                              # Typecheck
```

### packages/desktop (Tauri)

```bash
cd packages/desktop
bun run tauri dev                    # Dev mode (from root: bun run dev:desktop)
bun run tauri build --target x86_64-pc-windows-msvc   # Build Windows installer
tsgo -b                              # Typecheck
```

## Coding Conventions

### Formatting

- **No semicolons** — Prettier `semi: false`
- **120 character line width** — Prettier `printWidth: 120`
- Prettier is the **only** formatter — no ESLint, no Biome
- Run `prettier --write` to format files

### TypeScript

- Extends `@tsconfig/bun/tsconfig.json`
- Path aliases: `@/*` maps to `src/*`, `@tui/*` maps to `src/cli/cmd/tui/*`
- `noUncheckedIndexedAccess: false` — pragmatic over strict
- JSX: `preserve` mode with `@opentui/solid` (CLI TUI) or `solid-js` (web)
- Typecheck command: `tsgo --noEmit` (opencode) or `tsgo -b` (app, desktop)

### Code Style

**Namespace exports** — group related types, functions, and constants:

```typescript
export namespace Agent {
  export const Info = z.object({
    name: z.string(),
    model: z.string().optional(),
  })
  export type Info = z.infer<typeof Info>

  export async function create(config: Info) { ... }
}
```

**Zod-driven development** — schemas define types:

```typescript
const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
})
type Message = z.infer<typeof MessageSchema>
```

**Functional programming with Remeda** — use `pipe`, `filter`, `map`, `sortBy`:

```typescript
import { pipe, filter, map, sortBy } from "remeda"

const result = pipe(
  providers,
  filter((p) => p.connected),
  sortBy((p) => p.name),
  map((p) => p.id),
)
```

**Async-first** — prefer `async/await` over Promise chains:

```typescript
export async function loadConfig() {
  const raw = await Bun.file(filepath).text()
  const parsed = ConfigSchema.safeParse(JSON.parse(raw))
  if (!parsed.success) throw new Error("Invalid config")
  return parsed.data
}
```

**Bun `using` keyword** for resource cleanup:

```typescript
await using tmp = await tmpdir({ init: async (dir) => { ... } })
```

**Lazy initialization with `Instance.state()`**:

```typescript
const state = Instance.state(async () => {
  const cfg = await Config.get()
  return buildProviders(cfg)
})
```

### Naming Conventions

| Kind | Convention | Example |
|------|-----------|---------|
| Types / Namespaces | PascalCase | `Agent`, `MessageV2`, `SessionPrompt` |
| Functions / Variables | camelCase | `createUserMessage`, `loadConfig` |
| Constants | UPPER_SNAKE_CASE | `PROVIDER_PRIORITY`, `MAX_RETRIES` |
| Config keys | snake_case | `disabled_providers`, `api_key` |
| Files | kebab-case or camelCase | `dialog-provider.tsx`, `prompt.ts` |
| Test files | `*.test.ts` | `read.test.ts`, `uuid.test.ts` |

### Comments

- **Minimal** — code should be self-documenting
- No JSDoc on functions, no file-level headers, no license blocks
- Inline comments only for non-obvious logic, workarounds, or TODOs
- Zod schemas use `.meta()` for documentation when needed

### Error Handling

```typescript
try {
  await operation()
} catch (e) {
  if (e instanceof NamedError) {
    Object.assign(data, e.toObject())
  } else if (e instanceof Error) {
    Object.assign(data, { name: e.name, message: e.message, stack: e.stack })
  }
  Log.Default.error("context", data)
}
```

### Imports

- Use path aliases (`@/`, `@tui/`) for imports within the same package
- Relative imports (`../`) when alias is not configured
- External packages imported by name

## Testing

### Framework

All tests use **bun:test** — import from `"bun:test"`:

```typescript
import { describe, expect, test } from "bun:test"
```

### Test Location

| Package | Location | Pattern |
|---------|----------|---------|
| opencode | `packages/opencode/test/` | Separate directory mirroring `src/` structure |
| app | `packages/app/src/**/*.test.ts` | Colocated alongside source files |

### Test Structure

```typescript
import { describe, expect, test } from "bun:test"

describe("feature name", () => {
  test("describes expected behavior", async () => {
    // arrange
    const input = createInput()

    // act
    const result = await feature(input)

    // assert
    expect(result).toBeDefined()
    expect(result.value).toBe("expected")
  })
})
```

### opencode Test Fixtures

Tests in `packages/opencode` use a custom `tmpdir()` fixture for isolated environments with config and git support:

```typescript
import { tmpdir } from "../fixture/fixture"

test("reads a file", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "test.txt"), "hello world")
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const result = await ReadTool.execute({ filePath: "test.txt" }, ctx)
      expect(result.output).toContain("hello world")
    },
  })
})
```

### app Test Setup

Tests in `packages/app` use HappyDOM for browser globals:

```bash
bun test --preload ./happydom.ts ./src
```

Use `mock.module()` for dependency injection.

### Running Tests

```bash
# opencode tests
cd packages/opencode && bun test --timeout 30000

# app unit tests
cd packages/app && bun test

# app e2e tests
cd packages/app && bun run test:e2e

# single test file
bun test packages/opencode/test/tool/read.test.ts
```

## Build & Verification Checklist

After making code changes, run these in order:

```bash
# 1. Typecheck (catches type errors across all packages)
bun typecheck

# 2. Format check
bunx prettier --check "packages/opencode/src/**/*.ts"

# 3. Tests for the package you changed
cd packages/opencode && bun test --timeout 30000
# or
cd packages/app && bun test

# 4. Build (if needed)
cd packages/opencode && bun run build
```

## Git Hooks

**pre-push** (`.husky/pre-push`):
1. Validates Bun version matches `packageManager` field in root `package.json`
2. Runs `bun typecheck` — push is blocked if typecheck fails

## Key Architectural Patterns

### Client-Server Model

Even when running locally, the CLI operates as a client-server system:
- **CLI Client** (`packages/opencode/src/cli/`) — TUI frontend
- **Backend Server** (`packages/opencode/src/server/`) — Hono HTTP server hosting agent logic
- Communication via HTTP REST + SSE (Server-Sent Events)

### Configuration Loading (7 layers, low to high priority)

1. Remote `.well-known/opencode` (enterprise)
2. Global config `~/.config/opencode/opencode.jsonc`
3. Custom config via `$OPENCODE_CONFIG`
4. Project config `opencode.jsonc` (found via findUp)
5. `.opencode` directories
6. Inline config via `$OPENCODE_CONFIG_CONTENT`
7. Managed config `/etc/opencode` or `C:\ProgramData\opencode`

### Provider Resolution

Models.dev catalog → env var scan → auth.json → plugin auth → blacklist/whitelist filtering

### Session Loop

User prompt → save message → agent loop → LLM call → tool execution → re-prompt with results → stream response

## Documentation Reference

Detailed documentation lives in `../docs/`:

| Document | Contents |
|----------|----------|
| `ARCHITECTURE_EXPLANATION.md` | High-level architecture overview |
| `ARCHITECTURE_CLI.md` | CLI component details |
| `ARCHITECTURE_CLI_FLOW.md` | End-to-end prompt execution flow |
| `ARCHITECTURE_DESKTOP.md` | Desktop (Tauri) architecture |
| `ARCHITECTURE_WEB.md` | Web app (SolidJS) architecture |
| `ARCHITECTURE_CLOUD.md` | Cloud infrastructure (Cloudflare) |
| `PACKAGE_RELATIONSHIPS.md` | How opencode, app, and desktop relate |
| `CONFIGURATION_FLOW.md` | Config loading, provider resolution, TUI data pipeline |
| `BUILD_DESKTOP_WINDOWS.md` | Building the Windows desktop app |
| `THIRD_PARTY_LIBRARIES.md` | All external library documentation |
