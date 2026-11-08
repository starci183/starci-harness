// The cli-follow step of publish.yml (CONTRIBUTING.md CONTRIB-20): the CLI follows its siblings onto npm by itself. A release raises a
// stack pin in contexts/stack/pins.yaml while the CLI cannot require that version until publish-packages brings it, so the CLI's
// requirement trails the pin by one step. Once publish-packages succeeded this script reads `starci check pins --json` (SKEWS) and,
// when every skewed pin names a version npm now serves, raises the CLI requirement and lockfile to the pins (`npm install --save-exact`
// in cli/), bumps the CLI's prerelease when its version is already on npm (a published version never changes), and records the move
// under that version in CHANGELOG.md. It writes `changed`, `version` and `message` to GITHUB_OUTPUT; the publish job commits that, builds and tests the CLI, publishes it from the commit
// and pushes the commit to main (its own ci run then finds the CLI version on npm: nothing due). A skew to a version npm does not serve yet, or a registry that cannot be asked, changes
// nothing: the next publication brings it.
import { execFileSync } from "node:child_process"
import { appendFileSync, readFileSync, writeFileSync } from "node:fs"

interface Skew {
    package: string
    expected?: string
}
interface PinsReport {
    data: { skews: Skew[] }
}
interface CliManifest {
    name: string
    version: string
}

const npm = (args: string[], cwd = "cli"): string => execFileSync("npm", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" }).trim()
const served = (name: string, version: string): boolean => {
  try {
    return npm(["view", `${name}@${version}`, "version"], ".") === version
  } catch {
    return false
  }
}
const output = (key: string, value: string): void => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)
  console.log(`${key}=${value}`)
}

// Parsed input boundary: the JSON shape `check pins --json` writes is trusted at the fields the script reads.
const skews = (JSON.parse(readFileSync(process.env.SKEWS!, "utf8")) as PinsReport).data.skews
const pins = new Map(skews.filter((skew) => skew.expected !== undefined).map((skew) => [skew.package, skew.expected!]))
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
// Parsed input boundary: the CLI's own package.json.
const manifest = JSON.parse(readFileSync("cli/package.json", "utf8")) as CliManifest
let version = manifest.version
const bumped = served(manifest.name, version)
if (bumped) version = npm(["version", "prerelease", "--no-git-tag-version"]).replace(/^v/u, "")

const moved = specs.join(", ")
const entry = `- Changed: the CLI requires ${moved}, its pin in contexts/stack/pins.yaml (CONTRIB-20, the cli-follow step of publish.yml).`
const changelog = readFileSync("CHANGELOG.md", "utf8")
const today = new Date().toISOString().slice(0, 10)
const heading = `## ${version} - `
let next: string
const at = changelog.startsWith(heading) ? 0 : changelog.indexOf(`\n${heading}`) + 1
if (changelog.startsWith(heading) || at > 0) {
  // An unpublished version already has its section: the move joins it, as the first bullet under its heading.
  const end = changelog.indexOf("\n\n", at) + 2
  next = `${changelog.slice(0, end)}${entry}\n\n${changelog.slice(end)}`
} else {
  // A new version: its section goes first, under the title.
  const first = changelog.indexOf("\n## ") + 1
  if (first === 0) throw new Error("CHANGELOG.md has no version section to put the move before")
  next = `${changelog.slice(0, first)}${heading}${today}\n\n${entry}\n\n${changelog.slice(first)}`
}
writeFileSync("CHANGELOG.md", next)

output("changed", "true")
output("version", version)
output("message", `cli ${version}: require ${moved}, the pins npm now serves (cli-follow)`)
