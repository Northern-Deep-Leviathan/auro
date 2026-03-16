import { test, expect } from "bun:test"
import { Skill } from "../../src/skill"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import path from "path"

test("discovers skills from OPENCODE_BUILTIN_SKILLS_PATH", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
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
        expect(builtin!.content).toContain("Built-in skill content.")
      },
    })
  } finally {
    process.env.OPENCODE_BUILTIN_SKILLS_PATH = original
  }
})

test("discovers multiple built-in skills", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skill1 = path.join(dir, "bundled-skills", "skill-alpha")
      const skill2 = path.join(dir, "bundled-skills", "skill-beta")
      await Bun.write(
        path.join(skill1, "SKILL.md"),
        `---
name: skill-alpha
description: First built-in skill.
---

# Skill Alpha
`,
      )
      await Bun.write(
        path.join(skill2, "SKILL.md"),
        `---
name: skill-beta
description: Second built-in skill.
---

# Skill Beta
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
        expect(skills.find((s) => s.name === "skill-alpha")).toBeDefined()
        expect(skills.find((s) => s.name === "skill-beta")).toBeDefined()
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

test("gracefully handles nonexistent OPENCODE_BUILTIN_SKILLS_PATH", async () => {
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

test("works when OPENCODE_BUILTIN_SKILLS_PATH is not set", async () => {
  await using tmp = await tmpdir({ git: true })

  const original = process.env.OPENCODE_BUILTIN_SKILLS_PATH
  delete process.env.OPENCODE_BUILTIN_SKILLS_PATH

  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const skills = await Skill.all()
        expect(skills).toEqual([])
      },
    })
  } finally {
    if (original !== undefined) {
      process.env.OPENCODE_BUILTIN_SKILLS_PATH = original
    }
  }
})
