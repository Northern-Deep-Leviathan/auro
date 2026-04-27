import { $, semver } from "bun"
import path from "path"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

// relax version requirement
const expectedBunVersionRange = `^${expectedBunVersion}`

if (!semver.satisfies(process.versions.bun, expectedBunVersionRange)) {
  throw new Error(`This script requires bun@${expectedBunVersionRange}, but you are using bun@${process.versions.bun}`)
}

const env = {
  AURO_CHANNEL: process.env["AURO_CHANNEL"],
  AURO_BUMP: process.env["AURO_BUMP"],
  AURO_VERSION: process.env["AURO_VERSION"],
  AURO_RELEASE: process.env["AURO_RELEASE"],
}
const CHANNEL = await (async () => {
  if (env.AURO_CHANNEL) return env.AURO_CHANNEL
  if (env.AURO_BUMP) return "latest"
  if (env.AURO_VERSION && !env.AURO_VERSION.startsWith("0.0.0-")) return "latest"
  return await $`git branch --show-current`.text().then((x) => x.trim())
})()
const IS_PREVIEW = CHANNEL !== "latest"

// Resolve version: AURO_VERSION env > preview timestamp > latest GitHub release + bump
const VERSION = await (async () => {
  if (env.AURO_VERSION) return env.AURO_VERSION
  if (IS_PREVIEW) return `0.0.0-${CHANNEL}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
  // Fetch latest release tag from GitHub; fall back to git remote for repo slug
  const repo =
    process.env["GH_REPO"] ||
    (await $`git remote get-url origin`
      .text()
      .then((x) => x.trim().replace(/\.git$/, "").replace(/^.*github\.com[:/]/, "")))
  // 404 means no releases yet — default to 0.0.0; rethrow other errors
  const result = await $`gh api repos/${repo}/releases/latest --jq .tag_name`.quiet().nothrow()
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString()
    if (!stderr.includes("Not Found") && !stderr.includes("404")) throw new Error(`Failed to fetch latest release: ${stderr}`)
  }
  const version = result.exitCode === 0 ? result.stdout.toString().trim().replace(/^v/, "") : "0.0.0"
  // Bump major/minor/patch based on AURO_BUMP, default to patch
  const [major, minor, patch] = version.split(".").map((x: string) => Number(x) || 0)
  const t = env.AURO_BUMP?.toLowerCase()
  if (t === "major") return `${major + 1}.0.0`
  if (t === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
})()

const bot = ["actions-user", "auro", "auro-agent[bot]"]
const teamPath = path.resolve(import.meta.dir, "../../../.github/TEAM_MEMBERS")
const team = [
  ...(await Bun.file(teamPath)
    .text()
    .then((x) => x.split(/\r?\n/).map((x) => x.trim()))
    .then((x) => x.filter((x) => x && !x.startsWith("#")))),
  ...bot,
]

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
  get release(): boolean {
    return !!env.AURO_RELEASE
  },
  get team() {
    return team
  },
}
console.log(`auro script`, JSON.stringify(Script, null, 2))
