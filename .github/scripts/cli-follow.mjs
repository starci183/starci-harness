// The cli-follow job of ci.yml (CONTRIBUTING.md CONTRIB-20): the CLI follows its siblings onto npm by itself. A release raises a
// stack pin in contexts/stack/pins.yaml while the CLI cannot require that version until publish-packages brings it, so the CLI's
// requirement trails the pin by one step. Once publish-packages succeeded this script reads `starci check pins --json` (SKEWS) and,
// when every skewed pin names a version npm now serves, raises the CLI requirement and lockfile to the pins (`npm install --save-exact`
// in cli/), bumps the CLI's prerelease when its version is already on npm (a published version never changes), and records the move
// under that version in CHANGELOG.md. It writes `changed`, `version` and `message` to GITHUB_OUTPUT; the job commits and pushes, and
// the run of that commit publishes the CLI. A skew to a version npm does not serve yet, or a registry that cannot be asked, changes
// nothing: the next publication brings it.
import { execFileSync } from "node:child_process"
import { appendFileSync, readFileSync, writeFileSync } from "node:fs"

const npm = (args, cwd = "cli") => execFileSync("npm", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" }).trim()
const served = (name, version) => {
  try {
    return npm(["view", `${name}@${version}`, "version"], ".") === version
  } catch {
    return false
  }
}
const output = (key, value) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)
  console.log(`${key}=${value}`)
}

const skews = JSON.parse(readFileSync(process.env.SKEWS, "utf8")).data.skews
const pins = new Map(skews.filter((skew) => skew.expected !== undefined).map((skew) => [skew.package, skew.expected]))
if (pins.size === 0) {
  console.log("the CLI takes every @starci package at its pin: nothing to follow")
  output("changed", "false")
  process.exit(0)
}
const waiting = [...pins].filter(([name, version]) => !served(name, version))
if (waiting.length > 0) {
  console.log(`not on npm yet: ${waiting.map(([name, version]) => `${name}@${version}`).join(", ")}; the CLI follows once they are`)
  output("changed", "false")
  process.exit(0)
}

const specs = [...pins].map(([name, version]) => `${name}@${version}`)
npm(["install", "--save-exact", "--no-audit", "--no-fund", ...specs])
const manifest = JSON.parse(readFileSync("cli/package.json", "utf8"))
let version = manifest.version
const bumped = served(manifest.name, version)
if (bumped) version = npm(["version", "prerelease", "--no-git-tag-version"]).replace(/^v/u, "")

const moved = specs.join(", ")
const entry = `- The CLI requires ${moved}, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).`
const changelog = readFileSync("CHANGELOG.md", "utf8")
const today = new Date().toISOString().slice(0, 10)
const heading = `## [${version}]`
let next
if (changelog.includes(heading)) {
  // An unpublished version already has its section: the move joins it, under its "### Changed" when it has one.
  const at = changelog.indexOf(heading)
  const sectionEnd = changelog.indexOf("\n## [", at + heading.length)
  const section = changelog.slice(at, sectionEnd < 0 ? undefined : sectionEnd)
  const changed = section.indexOf("### Changed\n\n")
  if (changed >= 0) {
    const insert = at + changed + "### Changed\n\n".length
    next = `${changelog.slice(0, insert)}${entry}\n${changelog.slice(insert)}`
  } else {
    const end = changelog.indexOf("\n\n", at) + 2
    next = `${changelog.slice(0, end)}### Changed\n\n${entry}\n\n${changelog.slice(end)}`
  }
} else {
  next = changelog.replace("## [Unreleased]\n", `## [Unreleased]\n\n${heading} - ${today}\n\n### Changed\n\n${entry}\n`)
}
if (next === changelog) throw new Error("CHANGELOG.md has no [Unreleased] heading to record the move under")
writeFileSync("CHANGELOG.md", next)

output("changed", "true")
output("version", version)
output("message", `cli ${version}: require ${moved}, the pins npm now serves (cli-follow)`)
