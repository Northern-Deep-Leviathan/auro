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
  const branch = `release/v${Script.version}`

  // Convert workflow cancellation (SIGINT/SIGTERM) into a thrown error so the
  // catch block can clean up the PR, branch, and draft release. Without this,
  // Bun exits immediately on signal and leaves the release half-published.
  let cancelled = false
  const onSignal = (sig: NodeJS.Signals) => {
    if (cancelled) return
    cancelled = true
    console.error(`received ${sig}, cancelling release...`)
    // Defer the throw so any in-flight `await $\`...\`` rejects cleanly
    setImmediate(() => {
      throw new Error(`release cancelled (${sig})`)
    })
  }
  process.on("SIGINT", onSignal)
  process.on("SIGTERM", onSignal)

  try {
    if (!Script.preview) {
      const status = (await $`git status --porcelain`.text()).trim()

      if (status) {
        // Create a release branch (protection rules forbid direct commits to main)
        await $`git checkout -b ${branch}`
        await $`git commit -am "release: v${Script.version}"`

        // Rebase on latest main to surface conflicts before opening the PR
        await $`git fetch origin main`
        const rebased = await $`git rebase origin/main`.nothrow()
        if (rebased.exitCode !== 0) {
          await $`git rebase --abort`.nothrow()
          throw new Error("release branch conflicts with origin/main — resolve manually and retry")
        }

        await $`git push origin ${branch} --force-with-lease --no-verify`

        // Open the release PR
        await $`gh pr create --base main --head ${branch} \
          --title "release: v${Script.version}" \
          --body "Automated version bump for v${Script.version}" \
          --repo ${process.env.GH_REPO}`

        // Wait for required status checks (tolerate "no checks reported")
        console.log("waiting for PR checks...")
        const checks = await $`gh pr checks ${branch} --watch --repo ${process.env.GH_REPO}`.nothrow()
        if (checks.exitCode !== 0) {
          const stderr = checks.stderr.toString()
          if (stderr.includes("no checks reported")) {
            console.log("no checks configured for this PR, proceeding")
          } else {
            throw new Error(`PR checks failed: ${stderr}`)
          }
        }

        // Merge immediately using the release App's bypass.
        // --admin tells `gh` to invoke the bypass path (approval / code-owners / etc.
        // are bypassed via the ruleset bypass_actors entry for the Auro App).
        await $`gh pr merge ${branch} --squash --admin --repo ${process.env.GH_REPO}`

        // Best-effort branch cleanup in case "Automatically delete head branches" is off
        await $`git push origin --delete ${branch} --no-verify`.nothrow()

        await $`git fetch origin main`
      } else {
        console.log("no file changes, skipping PR")
        await $`git fetch origin main`
      }

      // Tag the merged commit on origin/main (tags are not branch-protected)
      const existingTag = (await $`git tag -l v${Script.version}`.text()).trim()
      if (existingTag) {
        console.log(`tag v${Script.version} already exists, deleting and re-tagging`)
        await $`git tag -d v${Script.version}`
      }
      await $`git tag v${Script.version} origin/main`
      await $`git push origin v${Script.version} --no-verify`

      await new Promise((resolve) => setTimeout(resolve, 5_000))
    }

    await $`gh release edit v${Script.version} --draft=false --repo ${process.env.GH_REPO}`
  } catch (err) {
    console.error("release failed, cleaning up:", err)

    // Close the release PR if one was opened and is still open
    const prState = (
      await $`gh pr view ${branch} --json state -q .state --repo ${process.env.GH_REPO}`.nothrow().text()
    ).trim()
    if (prState === "OPEN") {
      console.log(`closing release PR for ${branch}`)
      await $`gh pr close ${branch} --comment "Release failed, auto-closing." --repo ${process.env.GH_REPO}`.nothrow()
    }

    // Delete the remote release branch if it still exists
    const remoteRef = (await $`git ls-remote --heads origin ${branch}`.nothrow().text()).trim()
    if (remoteRef) {
      console.log(`deleting remote branch ${branch}`)
      await $`git push origin --delete ${branch} --no-verify`.nothrow()
    }

    // Delete the draft release and its tag
    await $`gh release delete v${Script.version} --repo ${process.env.GH_REPO} --cleanup-tag --yes`.nothrow()

    throw err
  } finally {
    process.off("SIGINT", onSignal)
    process.off("SIGTERM", onSignal)
  }
}

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)
