# Implementation Plan: Built-in Skills for Desktop Executable

## Goal

Ship a set of built-in skills bundled inside the desktop installer so that users have useful skills available out-of-the-box, without requiring manual file creation or remote fetching. Skills should appear automatically in the `/` command palette, the `skill()` agent tool, and the `GET /skill` API — with zero user configuration.

## Approach

**Tauri Resource Bundling + Environment Variable Bridge**

Tauri natively supports bundling arbitrary files as "resources" into the app package. At runtime, the Rust backend resolves the bundled resource path and passes it to the CLI sidecar via a new environment variable (`OPENCODE_BUILTIN_SKILLS_PATH`). The existing skill discovery engine in `packages/opencode/src/skill/skill.ts` is extended with a small block to scan this path.

This approach requires changes to only **3 files** (plus new skill content files and a test file).

## Architecture

```
┌──────────────────────────────────────────────────────┐
│ Tauri Build (tauri build)                            │
│                                                      │
│   resources/skills/          ← bundled into installer│
│   ├── code-review/SKILL.md                           │
│   ├── commit/SKILL.md                                │
│   └── .../SKILL.md                                   │
└──────────────────┬───────────────────────────────────┘
                   │ tauri.conf.json: bundle.resources
                   ▼
┌──────────────────────────────────────────────────────┐
│ Runtime: Tauri Rust Backend (cli.rs)                 │
│                                                      │
│   app.path().resolve("resources/skills",             │
│       BaseDirectory::Resource)                       │
│       → e.g. "C:\Program Files\OpenCode\resources\   │
│              skills" (Windows)                        │
│       → e.g. "OpenCode.app/Contents/Resources/       │
│              resources/skills" (macOS)                │
│                                                      │
│   Passes as env var to sidecar:                      │
│   OPENCODE_BUILTIN_SKILLS_PATH = <resolved path>    │
└──────────────────┬───────────────────────────────────┘
                   │ spawn_command() → sidecar process
                   ▼
┌──────────────────────────────────────────────────────┐
│ CLI Sidecar (skill.ts: Skill.state())                │
│                                                      │
│   Reads process.env.OPENCODE_BUILTIN_SKILLS_PATH     │
│   Scans for **/SKILL.md                              │
│   Loads skills FIRST (lowest priority)               │
│                                                      │
│   → Skills appear in Skill.all(), Skill.get()        │
│   → Auto-registered as /commands                     │
│   → Available to agent via skill() tool              │
└──────────────────────────────────────────────────────┘
```

## Priority / Override Order

Built-in skills are loaded **first**, so they have the **lowest priority**. Any user-defined skill with the same name (from `.claude/skills/`, `.opencode/skill/`, `config.skills.paths`, or remote URLs) will overwrite the built-in version. This ensures users can always customize or replace built-in behavior.

```
1. Built-in skills (OPENCODE_BUILTIN_SKILLS_PATH)    ← NEW, lowest priority
2. External skills (~/.claude/skills/, ~/.agents/skills/)
3. Project external skills (./.claude/skills/, ./.agents/skills/)
4. .opencode/skill/ directories
5. config.skills.paths
6. config.skills.urls (remote)                        ← highest priority
```

## Changes Required

### File 1: `packages/desktop/src-tauri/tauri.conf.json`

**What**: Add `resources` to the `bundle` configuration.

**Location**: Line 36, inside the `"bundle"` object, after `"externalBin"`.

**Change**:

```jsonc
// Before
"bundle": {
    ...
    "externalBin": ["sidecars/opencode-cli"],
    "linux": {
    ...

// After
"bundle": {
    ...
    "externalBin": ["sidecars/opencode-cli"],
    "resources": ["resources/skills/**/*"],
    "linux": {
    ...
```

**Also apply to**: `tauri.prod.conf.json` and `tauri.auro.prod.conf.json` do NOT need this change — they inherit from the base config via Tauri's config merging. Only the base `tauri.conf.json` needs it.

> **Note**: Tauri 2 bundles resources relative to `src-tauri/`. The `resources/skills/**/*` glob will include all SKILL.md files (and any companion files) in each skill subdirectory.

---

### File 2: `packages/desktop/src-tauri/src/cli.rs`

**What**: Resolve the bundled skills directory and pass it as an environment variable to the sidecar.

**Location**: Inside `spawn_command()` function, around line 376-390, where `envs` is constructed.

**Change**:

```rust
// After line 374 (state_dir resolution), add:
let skills_dir = app
    .path()
    .resolve("resources/skills", BaseDirectory::Resource)
    .ok()  // Don't crash if resolution fails (e.g., dev mode without resources)
    .filter(|p| p.exists());

// Then in the envs vec (line 376-390), add the new entry conditionally:
let mut envs = vec![
    (
        "OPENCODE_EXPERIMENTAL_ICON_DISCOVERY".to_string(),
        "true".to_string(),
    ),
    (
        "OPENCODE_EXPERIMENTAL_FILEWATCHER".to_string(),
        "true".to_string(),
    ),
    ("OPENCODE_CLIENT".to_string(), "desktop".to_string()),
    (
        "XDG_STATE_HOME".to_string(),
        state_dir.to_string_lossy().to_string(),
    ),
];

// Add built-in skills path if resources exist
if let Some(ref skills_path) = skills_dir {
    envs.push((
        "OPENCODE_BUILTIN_SKILLS_PATH".to_string(),
        skills_path.to_string_lossy().to_string(),
    ));
}
```

**Why `.ok().filter(|p| p.exists())`**: In dev mode (`tauri dev`), the resources directory may not exist. Using `.ok()` + `.filter()` makes this gracefully optional — no env var is set, no skills loaded, no crash.

**WSL consideration**: For the WSL code path (line 397-431), the bundled resource path is a Windows path and cannot be directly used inside WSL. Built-in skills will NOT be available in WSL mode. This is acceptable — WSL users use the Linux CLI directly. Add a comment to document this.

---

### File 3: `packages/opencode/src/skill/skill.ts`

**What**: Add a new scanning block at the **beginning** of `Skill.state()` to scan the built-in skills path from the environment variable.

**Location**: Inside `Skill.state()`, immediately after the `addSkill` and `scanExternal` helper definitions (after line 102), before the existing external skills scan (line 104).

**Change**:

```typescript
// Add after line 102, before the "Scan external skill directories" comment:

// Scan built-in skills bundled with the desktop app (lowest priority)
const builtinSkillsPath = process.env.OPENCODE_BUILTIN_SKILLS_PATH
if (builtinSkillsPath) {
  const exists = await Filesystem.isDir(builtinSkillsPath)
  if (exists) {
    const matches = await Glob.scan(SKILL_PATTERN, {
      cwd: builtinSkillsPath,
      absolute: true,
      include: "file",
      symlink: true,
    })
    for (const match of matches) {
      await addSkill(match)
    }
    log.info("loaded built-in skills", { path: builtinSkillsPath, count: matches.length })
  }
}

// Scan external skill directories (.claude/skills/, .agents/skills/, etc.)
// ... existing code continues
```

**Why at the beginning**: The `addSkill` function uses `skills[parsed.data.name] = ...` which overwrites any existing entry with the same name. By loading built-in skills first, every subsequent discovery source (external, .opencode, config paths, URLs) can override them. This gives built-in skills the lowest priority.

---

### New Directory: `packages/desktop/src-tauri/resources/skills/`

**What**: Create the directory structure for built-in skill files.

**Structure**:

```
packages/desktop/src-tauri/resources/
└── skills/
    ├── code-review/
    │   └── SKILL.md
    ├── commit/
    │   └── SKILL.md
    └── <your-skill-name>/
        └── SKILL.md
```

**Skill file format** (standard SKILL.md with YAML frontmatter):

```markdown
---
name: code-review
description: Review code changes for quality, security, and best practices.
---

# Code Review

Your skill instructions and workflow here...
```

Each skill goes in its own subdirectory (matching the convention used by `.claude/skills/` and `.opencode/skill/`). The subdirectory can also contain companion files (scripts, templates, etc.) that the skill references — they'll be bundled and accessible at the same path.

---

### New Test: `packages/opencode/test/skill/builtin-skill.test.ts`

**What**: Test that the `OPENCODE_BUILTIN_SKILLS_PATH` env var is respected by the skill discovery engine.

**Pattern**: Follow the existing test patterns in `skill.test.ts` — use `tmpdir()` fixture + `Instance.provide()`.

```typescript
import { test, expect } from "bun:test"
import { Skill } from "../../src/skill"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import path from "path"

test("discovers skills from OPENCODE_BUILTIN_SKILLS_PATH", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      // Create a "builtin" skills directory outside the project
      const builtinDir = path.join(dir, "bundled-skills", "example-skill")
      await Bun.write(
        path.join(builtinDir, "SKILL.md"),
        `---
name: example-skill
description: A built-in skill for testing.
---

# Example Skill

Built-in skill content.
`,
      )
    },
  })

  const original = process.env.OPENCODE_BUILTIN_SKILLS_PATH
  process.env.OPENCODE_BUILTIN_SKILLS_PATH = path.join(tmp.path, "bundled-skills")

  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const skills = await Skill.all()
        const builtin = skills.find((s) => s.name === "example-skill")
        expect(builtin).toBeDefined()
        expect(builtin!.description).toBe("A built-in skill for testing.")
      },
    })
  } finally {
    process.env.OPENCODE_BUILTIN_SKILLS_PATH = original
  }
})

test("user skills override built-in skills with same name", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      // Built-in skill
      const builtinDir = path.join(dir, "bundled-skills", "my-skill")
      await Bun.write(
        path.join(builtinDir, "SKILL.md"),
        `---
name: my-skill
description: Built-in version.
---

# Built-in
`,
      )

      // User skill with same name (in .opencode/skill/)
      const userDir = path.join(dir, ".opencode", "skill", "my-skill")
      await Bun.write(
        path.join(userDir, "SKILL.md"),
        `---
name: my-skill
description: User-customized version.
---

# User Version
`,
      )
    },
  })

  const original = process.env.OPENCODE_BUILTIN_SKILLS_PATH
  process.env.OPENCODE_BUILTIN_SKILLS_PATH = path.join(tmp.path, "bundled-skills")

  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const skills = await Skill.all()
        const skill = skills.find((s) => s.name === "my-skill")
        expect(skill).toBeDefined()
        // User version should win (loaded after built-in)
        expect(skill!.description).toBe("User-customized version.")
      },
    })
  } finally {
    process.env.OPENCODE_BUILTIN_SKILLS_PATH = original
  }
})

test("gracefully handles missing OPENCODE_BUILTIN_SKILLS_PATH", async () => {
  await using tmp = await tmpdir({ git: true })

  const original = process.env.OPENCODE_BUILTIN_SKILLS_PATH
  process.env.OPENCODE_BUILTIN_SKILLS_PATH = path.join(tmp.path, "nonexistent")

  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const skills = await Skill.all()
        expect(skills).toEqual([])
      },
    })
  } finally {
    process.env.OPENCODE_BUILTIN_SKILLS_PATH = original
  }
})
```

## Verification Steps

After implementation, verify in this order:

```bash
# 1. Unit tests (skill discovery with env var)
cd packages/opencode
bun test test/skill/builtin-skill.test.ts --timeout 30000

# 2. Existing skill tests still pass
bun test test/skill/skill.test.ts --timeout 30000

# 3. Typecheck across all packages
bun typecheck

# 4. Format check
bunx prettier --check "packages/opencode/src/**/*.ts"

# 5. Rust compilation (catches cli.rs errors)
cd packages/desktop
bun run tauri build --target x86_64-pc-windows-msvc

# 6. Manual verification: run desktop app, type "/" in prompt,
#    confirm built-in skills appear in the command palette
```

## What This Does NOT Change

- **CLI standalone behavior**: When running the CLI directly (not via desktop), `OPENCODE_BUILTIN_SKILLS_PATH` is not set, so no built-in skills appear. This is correct — CLI users manage skills via `.opencode/skill/` or config.
- **Existing skill discovery**: All 4 existing discovery paths (external, .opencode, config paths, remote URLs) remain unchanged.
- **Sidecar binary**: The CLI binary itself is not modified at build time — only a runtime env var is added.
- **Auto-updater**: Tauri's updater replaces the entire bundle including resources, so built-in skills update alongside the app.

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Resource path resolution fails on a platform | `.ok().filter(\|p\| p.exists())` in Rust makes it gracefully optional |
| Built-in skill name collides with user skill | Built-in loaded first = lowest priority, user always wins |
| Installer size increases | SKILL.md files are plain text, typically <5KB each — negligible vs. the 167MB sidecar |
| WSL mode can't access Windows resource paths | Documented as known limitation; WSL users use CLI directly |
| `tauri dev` mode has no bundled resources | `.ok()` on path resolution + `Filesystem.isDir()` check handles this |

## Future Extensions

- **Config flag to disable built-in skills**: Add `OPENCODE_DISABLE_BUILTIN_SKILLS` to `Flag` if users want to opt out.
- **Skill versioning**: Add a `version` field to SKILL.md frontmatter for tracking updates.
- **Skill categories**: Group built-in skills by domain (e.g., git, testing, documentation) with a `category` frontmatter field.
- **Desktop settings UI**: Allow users to enable/disable individual built-in skills from the desktop settings panel.
