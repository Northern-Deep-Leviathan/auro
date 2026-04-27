#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { $ } from "bun"
import { fileURLToPath } from "url"

const highlightsTemplate = `
<!--
Add highlights before publishing. Delete this section if no highlights.

- For multiple highlights, use multiple <highlight> tags
- Highlights with the same source attribute get grouped together
-->

<!--
<highlight source="SourceName (TUI/Desktop/Web/Core)">
  <h2>Feature title goes here</h2>
  <p short="Short description used for Desktop Recap">
    Full description of the feature or change
  </p>

  https://github.com/user-attachments/assets/uuid-for-video (you will want to drag & drop the video or picture)

  <img
    width="1912"
    height="1164"
    alt="image"
    src="https://github.com/user-attachments/assets/uuid-for-image"
  />
</highlight>
-->

`

console.log("=== Post Building ===\n")

const pkgjsons = await Array.fromAsync(
  new Bun.Glob("**/opencode/package.json").scan({
    absolute: true,
  }),
).then((arr) => arr.filter((x) => !x.includes("node_modules") && !x.includes("dist")))

for (const file of pkgjsons) {
  let pkg = await Bun.file(file).text()
  pkg = pkg.replaceAll(/"version": "[^"]+"/g, `"version": "${Script.version}"`)
  console.log("updated:", file)
  await Bun.file(file).write(pkg)
}

if (Script.release) {
  try {
    if (!Script.preview) {
      const status = (await $`git status --porcelain`.text()).trim()
      if (status) {
        await $`git commit -am "release: v${Script.version}"`
      } else {
        console.log("no file changes, skipping commit")
      }
      const existingTag = (await $`git tag -l v${Script.version}`.text()).trim()
      if (existingTag) {
        console.log(`tag v${Script.version} already exists, deleting and re-tagging`)
        await $`git tag -d v${Script.version}`
      }
      await $`git tag v${Script.version}`
      await $`git fetch origin`
      await $`git cherry-pick HEAD..origin/dev`.nothrow()
      await $`git push origin HEAD --tags --no-verify --force-with-lease`
      await new Promise((resolve) => setTimeout(resolve, 5_000))
    }

    await $`gh release edit v${Script.version} --draft=false --repo ${process.env.GH_REPO}`
  } catch (err) {
    console.error("release failed, deleting draft release:", err)
    await $`gh release delete v${Script.version} --repo Northern-Deep-Leviathan/auro --cleanup-tag --yes`.nothrow()
    throw err
  }
}

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)
