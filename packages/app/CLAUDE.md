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
