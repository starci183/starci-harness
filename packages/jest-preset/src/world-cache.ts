/**
 * The result cache of the integration and e2e projects: a spec file whose inputs are unchanged since its last green run is not run
 * again, it is reported "cached"; a new, changed or previously red spec runs. The same mechanism serves both kinds, in both editions.
 *
 * The inputs of a spec (each one a digest, sha256 of the bytes with CRLF read as LF so a Windows checkout and a Linux one agree):
 *   spec      the spec file;
 *   closure   the spec's import closure: every local file its imports reach, resolved through the nearest `tsconfig.json` (path aliases,
 *             `extends`), static, type-only, dynamic-literal and `require` imports, JSON; a package in `node_modules` is the lockfile's;
 *   tree      the application source the spec can reach: every file of the jest root (`be/`) but the other specs (unit specs, the other
 *             integration, e2e and contract specs: each is its own record), the world folder (own part) and build output;
 *   world     the world declaration, `src/tests/world/**`;
 *   lock      the lockfiles of the jest root and of the app root;
 *   stack     the stack definition: `.starcistacks/application-stacks.yaml` and every `.starcistacks/<env>/` but its `runtime/` (sealed);
 *   versions  `@starci/test-world`, `@starci/jest-preset` (this one) and the kind.
 * The tree is wider than the closure on purpose: the world boots modules, migrations and seeds the static imports of a spec never name.
 *
 * Records live in the application repository, `.starcistacks/cache/test/<kind>/<area>.jsonl` (the area is the spec's first folder below
 * `src/tests/<kind>/`, `root` for a file directly in it): JSON Lines, one record per spec, sorted, keys sorted, LF, committed with the code, so a
 * warm cache survives across machines. A record holds the spec's app-relative path, its key, the digests behind the key (so a run says
 * what changed), the result (`passed`, the only one stored) and the duration of the green run in ms. A red spec is never cached: its
 * record is removed. A spec that boots a live provider (`useSandbox`) is never cached, and neither is a run that selects tests by name.
 *
 * Modes: `STARCI_TEST_CACHE=off` ignores the cache (`--full`); a run that names spec paths runs them regardless; both still write the record
 * of a green run, so a full run warms the cache.
 */

import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import fs from "node:fs"
import path from "node:path"
import type TypeScript from "typescript"

type Ts = typeof TypeScript

/** This package and its version, the preset part of a key. */
export const PRESET_ID: string = (() => {
  // dist/ sits one level below the package root that holds package.json
  const own: { name: string; version: string } = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"))
  return `${own.name}@${own.version}`
})()

/** The kinds the cache serves; a contract spec runs live, so it is never cached. */
export const CACHED_KINDS: readonly string[] = Object.freeze(["integration", "e2e"])
/** `off`: ignore the cache for this run (`starci test <kind> --full`). */
export const CACHE_ENV = "STARCI_TEST_CACHE"
/** The file a run writes its report (json) to, for the CLI verb that started it. */
export const REPORT_ENV = "STARCI_TEST_REPORT"
/** The folder of the records under the app root. */
export const CACHE_FOLDER = path.join(".starcistacks", "cache", "test")

/** The digests behind a key, each shortened to 16 hex characters. */
export interface Parts {
  readonly spec: string
  readonly closure: string
  readonly tree: string
  readonly world: string
  readonly lock: string
  readonly stack: string
  readonly versions: string
}

/** One record of the cache. */
export interface CacheRecord {
  readonly spec: string
  readonly key: string
  readonly parts: Parts
  readonly result: "passed"
  readonly ms: number
}

/** Whether a spec file declares itself exclusive: its `useTestWorld(...)` call carries `exclusive: true` (a latency budget, a soak, a load run), so it runs alone. */
export function isExclusive(spec: string): boolean {
  try {
    return /\buseTestWorld\s*(?:<[^>]*>)?\s*\([\s\S]{0,4000}?\bexclusive\s*:\s*true\b/.test(fs.readFileSync(spec, "utf8"))
  } catch {
    return false
  }
}

/** What the runner does with one spec file. */
export type Plan =
  | { readonly run: false; readonly spec: string; readonly kind: string; readonly record: CacheRecord }
  | { readonly run: true; readonly spec: string; readonly kind: string; readonly why: string; readonly key: string | undefined; readonly parts: Parts | undefined; readonly write: boolean }

/** The sha256 (hex) of bytes, CRLF read as LF when they are text (no NUL in the first 8000 bytes, git's own test). */
export function hashBytes(bytes: Buffer): string {
  const probe = bytes.subarray(0, 8000)
  const text = !probe.includes(0)
  return createHash("sha256").update(text ? Buffer.from(bytes.toString("latin1").replaceAll("\r\n", "\n"), "latin1") : bytes).digest("hex")
}

/** One digest over named parts: sorted by name, each `name NUL hash NUL`, so no two part sets share a digest. */
export function combine(parts: Readonly<Record<string, string>>): string {
  const h = createHash("sha256")
  for (const name of Object.keys(parts).sort()) h.update(`${name}\0${parts[name] ?? ""}\0`)
  return h.digest("hex")
}

const posix = (file: string): string => file.split(path.sep).join("/")
const short = (digest: string): string => digest.slice(0, 16)

/** A JSON value with its object keys sorted at every depth, so one record is one line of the same bytes everywhere. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted)
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, item]) => [key, sorted(item)]))
  return value
}

/** The typescript of the app at `root`, or null when it has none (a spec then has no closure and always runs). */
export function loadTypescript(root: string): Ts | null {
  try {
    return createRequire(path.join(root, "package.json"))("typescript") as Ts
  } catch {
    return null
  }
}

/** Folders that hold no input: installs, build output, coverage; every dot-folder (`.git`, `.next`, a jest cache) is skipped too. */
const SKIPPED_DIRS = new Set(["node_modules", "dist", "coverage"])
/** What the tree digest reads: code, configuration, schemas and data the world boots from; logs and reports are not inputs. */
const INPUT_FILE = /\.(?:[cm]?[jt]sx?|json|ya?ml|sql|graphql|gql|proto|hbs|html|csv|txt|md)$/
const SPEC_FILE = /\.(?:spec|integration-spec|e2e-spec|contract-spec)\.[cm]?tsx?$/
const OTHER_SPEC_FOLDER = /(?:^|\/)src\/tests\/(?:integration|e2e|contract|world)\//
const LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"]
const SCRIPT = /\.(?:[cm]?[jt]sx?)$/

/** Every file below `dir` (absolute, sorted) that `keep` accepts, never descending into a folder `skip` names. */
function filesBelow(dir: string, keep: (relative: string) => boolean, skip: (name: string, relative: string) => boolean, base = dir): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const absolute = path.join(dir, entry.name)
    const relative = posix(path.relative(base, absolute))
    if (entry.isDirectory()) {
      if (!skip(entry.name, relative)) out.push(...filesBelow(absolute, keep, skip, base))
    } else if (entry.isFile() && keep(relative)) out.push(absolute)
  }
  return out
}

/** The nearest ancestor of `from` (itself included) that holds a `.starcistacks` folder: the app root; undefined when there is none. */
export function appRootOf(from: string): string | undefined {
  for (let at = path.resolve(from); ; at = path.dirname(at)) {
    if (fs.existsSync(path.join(at, ".starcistacks"))) return at
    if (path.dirname(at) === at) return undefined
  }
}

/** The version of an installed package, found through the node_modules folders above `from`; `absent` when it is not installed. */
function installedVersion(from: string, name: string): string {
  for (let at = path.resolve(from); ; at = path.dirname(at)) {
    try {
      const manifest: unknown = JSON.parse(fs.readFileSync(path.join(at, "node_modules", name, "package.json"), "utf8"))
      if (typeof manifest === "object" && manifest !== null && "version" in manifest && typeof manifest.version === "string") return manifest.version
    } catch {
      // not here, look one folder up
    }
    if (path.dirname(at) === at) return "absent"
  }
}

/** The inputs of the specs of one jest root, read once per run (the shared digests and every file hash are memoised). */
export class SpecInputs {
  readonly appRoot: string | undefined
  readonly #root: string
  readonly #ts: Ts | null
  readonly #preset: string
  readonly #hashes = new Map<string, string>()
  readonly #options = new Map<string, TypeScript.CompilerOptions>()
  #shared: Omit<Parts, "spec" | "closure"> | undefined

  constructor(root: string, preset: string = PRESET_ID, ts: Ts | null = loadTypescript(root)) {
    this.#root = path.resolve(root)
    this.#preset = preset
    this.#ts = ts
    this.appRoot = appRootOf(root)
  }

  /** The digest of a file, `absent` when it cannot be read. */
  hashOf(file: string): string {
    const known = this.#hashes.get(file)
    if (known !== undefined) return known
    let digest: string
    try {
      digest = hashBytes(fs.readFileSync(file))
    } catch {
      digest = "absent"
    }
    this.#hashes.set(file, digest)
    return digest
  }

  #digestOf(files: readonly string[], base: string): string {
    return combine(Object.fromEntries(files.map((file) => [posix(path.relative(base, file)), this.hashOf(file)])))
  }

  /** The digests every spec of the root shares. */
  shared(): Omit<Parts, "spec" | "closure"> {
    if (this.#shared !== undefined) return this.#shared
    const root = this.#root
    const app = this.appRoot ?? root
    const tree = filesBelow(root, (relative) => INPUT_FILE.test(relative) && !SPEC_FILE.test(relative) && !OTHER_SPEC_FOLDER.test(`/${relative}`), (name, relative) => SKIPPED_DIRS.has(name) || name.startsWith(".") || OTHER_SPEC_FOLDER.test(`/${relative}/`))
    const world = filesBelow(path.join(root, "src", "tests", "world"), () => true, (name) => SKIPPED_DIRS.has(name))
    const locks = [...new Set([root, app])].flatMap((dir) => LOCKFILES.map((name) => path.join(dir, name)).filter((file) => fs.existsSync(file)))
    const stackRoot = path.join(app, ".starcistacks")
    const stackFiles = [
      path.join(stackRoot, "application-stacks.yaml"),
      ...(fs.existsSync(stackRoot) ? fs.readdirSync(stackRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name !== "cache") : []).flatMap((entry) =>
        filesBelow(path.join(stackRoot, entry.name), () => true, (name, relative) => SKIPPED_DIRS.has(name) || /^[^/]+\/runtime$/.test(relative), stackRoot),
      ),
    ].filter((file) => fs.existsSync(file))
    const versions = combine({
      "@starci/test-world": installedVersion(root, "@starci/test-world"),
      "@starci/jest-preset": this.#preset,
    })
    this.#shared = {
      tree: short(this.#digestOf(tree, root)),
      world: short(this.#digestOf(world, root)),
      lock: short(this.#digestOf(locks, app)),
      stack: short(this.#digestOf(stackFiles, stackRoot)),
      versions: short(versions),
    }
    return this.#shared
  }

  #optionsFor(dir: string): TypeScript.CompilerOptions {
    const ts = this.#ts
    if (ts === null) return {}
    for (let at = dir; ; at = path.dirname(at)) {
      const config = path.join(at, "tsconfig.json")
      const known = this.#options.get(config)
      if (known !== undefined) return known
      if (fs.existsSync(config)) {
        const read = ts.readConfigFile(config, ts.sys.readFile)
        const options = { ...(read.config === undefined ? {} : ts.parseJsonConfigFileContent(read.config, ts.sys, at).options), resolveJsonModule: true, allowJs: true }
        this.#options.set(config, options)
        return options
      }
      if (path.dirname(at) === at || at === this.#root) return {}
    }
  }

  /** The local files a spec reaches through its imports, resolved through the nearest tsconfig, the spec itself not among them. */
  closureOf(spec: string): string[] {
    const ts = this.#ts
    if (ts === null) return []
    const seen = new Set<string>([spec])
    const queue = [spec]
    for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
      if (!SCRIPT.test(file)) continue
      let text: string
      try {
        text = fs.readFileSync(file, "utf8")
      } catch {
        continue
      }
      const options = this.#optionsFor(path.dirname(file))
      for (const imported of ts.preProcessFile(text, true, true).importedFiles) {
        const resolved = ts.resolveModuleName(imported.fileName, file, options, ts.sys).resolvedModule
        if (resolved === undefined || resolved.isExternalLibraryImport === true) continue
        const target = path.resolve(resolved.resolvedFileName)
        if (target.split(path.sep).includes("node_modules") || seen.has(target)) continue
        seen.add(target)
        queue.push(target)
      }
    }
    seen.delete(spec)
    return [...seen].sort()
  }

  /** The key of a spec and the digests behind it. */
  of(spec: string, kind: string): { key: string; parts: Parts } {
    const shared = this.shared()
    const parts: Parts = { spec: short(this.hashOf(spec)), closure: short(this.#digestOf(this.closureOf(spec), this.#root)), ...shared }
    return { key: combine({ kind, ...parts }), parts }
  }
}

const areaOf = (kind: string, specRelative: string): string => {
  const below = specRelative.split(`/src/tests/${kind}/`)[1] ?? specRelative.split(`src/tests/${kind}/`)[1]
  const folders = below === undefined ? [] : below.split("/").slice(0, -1)
  return folders[0] ?? "root"
}

/** The file of the records of one spec's area. */
export const recordFile = (appRoot: string, kind: string, specRelative: string): string => path.join(appRoot, CACHE_FOLDER, kind, `${areaOf(kind, specRelative)}.jsonl`)

/** The records of a file, in order; a line that is not a record is dropped. */
export function readRecords(file: string): CacheRecord[] {
  let text: string
  try {
    text = fs.readFileSync(file, "utf8")
  } catch {
    return []
  }
  const records: CacheRecord[] = []
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue
    try {
      const value: unknown = JSON.parse(line)
      if (typeof value === "object" && value !== null && "spec" in value && typeof value.spec === "string" && "key" in value && typeof value.key === "string" && "parts" in value && "ms" in value && typeof value.ms === "number") {
        records.push(value as CacheRecord)
      }
    } catch {
      // a torn line is no record
    }
  }
  return records
}

function writeRecords(file: string, records: readonly CacheRecord[]): void {
  if (records.length === 0) {
    fs.rmSync(file, { force: true })
    return
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const text = `${[...records].sort((a, b) => (a.spec < b.spec ? -1 : 1)).map((record) => JSON.stringify(sorted(record))).join("\n")}\n`
  const temp = `${file}.tmp-${String(process.pid)}`
  fs.writeFileSync(temp, text)
  fs.renameSync(temp, file)
}

/** The parts that differ between two digests, named: what changed since the green run. */
export const changedParts = (before: Parts, after: Parts): string[] => (Object.keys(after) as (keyof Parts)[]).filter((name) => before[name] !== after[name])

/** How a run reads and writes the cache. */
export interface CacheMode {
  /** `--full`: the cache is not read. */
  readonly full: boolean
  /** Spec paths were named on the command line: they run regardless. */
  readonly named: boolean
  /** A test-name filter is on: a run that proves only part of a file writes no record. */
  readonly partial: boolean
}

/** The cache of one jest run: decides each spec, records the green ones, forgets the red ones. */
export class SpecCache {
  readonly #inputs: SpecInputs
  readonly #mode: CacheMode

  constructor(inputs: SpecInputs, mode: CacheMode) {
    this.#inputs = inputs
    this.#mode = mode
  }

  /** Whether this run can cache at all: the app root holds the cache folder's home. */
  get available(): boolean {
    return this.#inputs.appRoot !== undefined
  }

  /** The app-relative posix path of a spec. */
  relative(spec: string): string {
    return posix(path.relative(this.#inputs.appRoot ?? process.cwd(), spec))
  }

  plan(spec: string, kind: string): Plan {
    const appRoot = this.#inputs.appRoot
    const relative = this.relative(spec)
    if (appRoot === undefined) return { run: true, spec, kind, why: "no .starcistacks folder above the jest root, nothing is cached", key: undefined, parts: undefined, write: false }
    if (this.#sandboxed(spec)) return { run: true, spec, kind, why: "live provider (useSandbox), never cached", key: undefined, parts: undefined, write: false }
    const { key, parts } = this.#inputs.of(spec, kind)
    const write = !this.#mode.partial
    if (this.#mode.full) return { run: true, spec, kind, why: "full run", key, parts, write }
    if (this.#mode.named) return { run: true, spec, kind, why: "named on the command line", key, parts, write }
    const record = readRecords(recordFile(appRoot, kind, relative)).find((candidate) => candidate.spec === relative)
    if (record === undefined) return { run: true, spec, kind, why: "new or previously red", key, parts, write }
    if (record.key !== key) {
      const changed = changedParts(record.parts, parts)
      return { run: true, spec, kind, why: `changed: ${changed.length === 0 ? "kind" : changed.join(", ")}`, key, parts, write }
    }
    return { run: false, spec, kind, record }
  }

  #sandboxed(spec: string): boolean {
    try {
      return fs.readFileSync(spec, "utf8").includes("useSandbox")
    } catch {
      return false
    }
  }

  /** Stores the green run of a planned spec. */
  green(plan: Plan, ms: number): void {
    const appRoot = this.#inputs.appRoot
    if (plan.run === false || !plan.write || appRoot === undefined || plan.key === undefined || plan.parts === undefined) return
    const relative = this.relative(plan.spec)
    const file = recordFile(appRoot, plan.kind, relative)
    const others = readRecords(file).filter((record) => record.spec !== relative && fs.existsSync(path.join(appRoot, record.spec)))
    writeRecords(file, [...others, { spec: relative, key: plan.key, parts: plan.parts, result: "passed", ms: Math.round(ms) }])
  }

  /** Removes the record of a spec that ran red: a red spec is never cached. */
  red(plan: Plan): void {
    const appRoot = this.#inputs.appRoot
    if (appRoot === undefined || plan.run === false || this.#mode.partial) return
    const relative = this.relative(plan.spec)
    const file = recordFile(appRoot, plan.kind, relative)
    const records = readRecords(file)
    if (records.some((record) => record.spec === relative)) writeRecords(file, records.filter((record) => record.spec !== relative))
  }
}

/** The spec files of a kind below a jest root, absolute and sorted: every `<name>.<kind>-spec.ts` below `src/tests/<kind>/`, the files the project of that name matches. */
export function listSpecs(root: string, kind: string): string[] {
  return filesBelow(path.join(root, "src", "tests", kind), (relative) => relative.endsWith(`.${kind}-spec.ts`), (name) => SKIPPED_DIRS.has(name))
}

/** What a run of a whole kind would do before any jest process starts: one entry per spec file, and whether every one of them is cached. */
export interface Preflight {
  readonly specs: number
  readonly cached: number
  /** True when there is at least one spec and the cache holds each of them green: nothing needs to run, so no world needs to start. */
  readonly allCached: boolean
  readonly lines: readonly ReportLine[]
}

/**
 * The cache's answer for every spec of `kind` under the jest root `root`, with no jest and no world: `starci test <kind>` asks it first and, when every
 * spec is cached, reports and starts nothing (a world's globalSetup, its containers included, runs before any runner could skip a file). It reads the
 * cache as a plain run does; `full` or a named spec never reach it.
 */
export function preflight(root: string, kind: string): Preflight {
  const cache = new SpecCache(new SpecInputs(root), { full: false, named: false, partial: false })
  const specs = CACHED_KINDS.includes(kind) && cache.available ? listSpecs(root, kind) : []
  const lines: ReportLine[] = []
  for (const spec of specs) {
    const plan = cache.plan(spec, kind)
    if (!plan.run) lines.push({ spec: cache.relative(spec), kind, outcome: "cached", ms: plan.record.ms, why: "inputs unchanged since the last green run" })
  }
  return { specs: specs.length, cached: lines.length, allCached: specs.length > 0 && lines.length === specs.length, lines }
}

/** One line of a run's report. */
export interface ReportLine {
  readonly spec: string
  readonly kind: string
  readonly outcome: "ran" | "cached" | "failed"
  /** Duration of this run, or of the green run a cached spec stands for. */
  readonly ms: number
  readonly why: string
}

/** A duration as `4.2s`, `850ms` or `2m03s`. */
export function duration(ms: number): string {
  if (ms < 1000) return `${String(Math.round(ms))}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${String(Math.floor(ms / 60_000))}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}s`
}

/** The text of one report line. */
export function reportLine(line: ReportLine): string {
  const mark = line.outcome === "cached" ? "cached" : line.outcome === "failed" ? "FAILED" : "ran   "
  const note = line.outcome === "cached" ? `green before in ${duration(line.ms)}` : `${duration(line.ms)}, ${line.why}`
  return `  ${mark}  ${line.spec}  (${note})`
}

/** The one-line summary of a run's lines: counts, the time spent and the time the cache saved. */
export function summary(lines: readonly ReportLine[]): string {
  const count = (outcome: ReportLine["outcome"]): number => lines.filter((line) => line.outcome === outcome).length
  const total = (outcome: ReportLine["outcome"]): number => lines.filter((line) => line.outcome === outcome).reduce((sum, line) => sum + line.ms, 0)
  const spent = total("ran") + total("failed")
  return `starci test: ${String(lines.length)} spec file(s), ${String(count("ran"))} ran, ${String(count("cached"))} cached, ${String(count("failed"))} failed; ${duration(spent)} spent, ${duration(total("cached"))} saved by the cache`
}
