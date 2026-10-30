// Regenerates the @starci/hfs runtime copies that the canon packages bundle under their runtime/ folder.
//
// Each bundling package commits runtime/bundle.json: `generated` lists the paths (relative to runtime/) it takes byte for byte
// from hfs's runtime/ (the built .mjs where the hfs source is .mts, since tsc emits it in place; otherwise the tracked .mjs),
// and `own` lists the files the bundle keeps as its own tracked files, which this tool never writes. Anything in runtime/ that
// the manifest names in neither list is drift too, so a new bundled file has to be classified on purpose.
//
//   node scripts/sync-bundles.mjs            copy every generated path from hfs into each package
//   node scripts/sync-bundles.mjs --check    write nothing; exit 1 and name every drifting path

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

export const bundlePackages = [
  "eslint-canon-be",
  "eslint-canon-fe",
  "eslint-grammar-core",
  "eslint-grammar-offset-pop",
] as const

export const manifestName = "bundle.json"

export interface BundleManifest {
  readonly generated: readonly string[]
  readonly own: readonly string[]
}

export interface Drift {
  readonly pkg: string
  readonly path: string
  readonly reason: "differs" | "missing" | "hfs-missing" | "unlisted" | "listed-twice" | "own-missing"
}

export interface SyncResult {
  readonly written: readonly string[]
  readonly drift: readonly Drift[]
}

const hfsDir = join(dirname(fileURLToPath(import.meta.url)), "..")

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/** Every file under a package's runtime/ as a forward-slash path relative to runtime/, the manifest itself left out. */
export function runtimeFiles(runtimeDir: string): string[] {
  if (!existsSync(runtimeDir)) return []
  return walk(runtimeDir)
    .map((file) => relative(runtimeDir, file).split(sep).join("/"))
    .filter((path) => path !== manifestName)
    .sort()
}

function stringList(value: unknown, what: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === "string")) {
    throw new Error(`${what} must be a list of strings`)
  }
  return value
}

export function readManifest(file: string): BundleManifest {
  // The parsed JSON is the one untyped boundary: unknown is narrowed field by field below.
  const raw: unknown = JSON.parse(readFileSync(file, "utf8"))
  if (typeof raw !== "object" || raw === null) throw new Error(`${file} must hold an object`)
  const record = raw as Record<string, unknown>
  return { generated: stringList(record["generated"], `${file} generated`), own: stringList(record["own"], `${file} own`) }
}

export function manifestText(manifest: BundleManifest): string {
  return `${JSON.stringify({ generated: [...manifest.generated].sort(), own: [...manifest.own].sort() }, null, 2)}\n`
}

/** The manifest of a runtime folder today: a file hfs also has, byte for byte, is generated; any other file is the bundle's own. */
export function classifyRuntime(runtimeDir: string, hfsRuntimeDir: string): BundleManifest {
  const generated: string[] = []
  const own: string[] = []
  for (const path of runtimeFiles(runtimeDir)) {
    const source = join(hfsRuntimeDir, path)
    const same = existsSync(source) && readFileSync(source).equals(readFileSync(join(runtimeDir, path)))
    ;(same ? generated : own).push(path)
  }
  return { generated, own }
}

/**
 * Syncs (or, with `check`, only judges) every bundling package under `packagesDir`.
 * `hfsRuntimeDir` is hfs's runtime/ folder: the build output beside the sources.
 */
export function syncBundles(options: {
  readonly packagesDir: string
  readonly hfsRuntimeDir: string
  readonly check: boolean
  readonly packages?: readonly string[]
}): SyncResult {
  const written: string[] = []
  const drift: Drift[] = []
  for (const pkg of options.packages ?? bundlePackages) {
    const runtimeDir = join(options.packagesDir, pkg, "runtime")
    const manifest = readManifest(join(runtimeDir, manifestName))
    const listed = new Set<string>()
    for (const path of [...manifest.generated, ...manifest.own]) {
      if (listed.has(path)) drift.push({ pkg, path, reason: "listed-twice" })
      listed.add(path)
    }
    for (const path of manifest.own) {
      if (!existsSync(join(runtimeDir, path))) drift.push({ pkg, path, reason: "own-missing" })
    }
    for (const path of manifest.generated) {
      const source = join(options.hfsRuntimeDir, path)
      if (!existsSync(source)) {
        drift.push({ pkg, path, reason: "hfs-missing" })
        continue
      }
      const target = join(runtimeDir, path)
      const bytes = readFileSync(source)
      const current = existsSync(target) ? readFileSync(target) : undefined
      if (current !== undefined && current.equals(bytes)) continue
      if (options.check) {
        drift.push({ pkg, path, reason: current === undefined ? "missing" : "differs" })
        continue
      }
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, bytes)
      written.push(`${pkg}/runtime/${path}`)
    }
    for (const path of runtimeFiles(runtimeDir)) {
      if (!listed.has(path)) drift.push({ pkg, path, reason: "unlisted" })
    }
  }
  return { written, drift }
}

function main(argv: readonly string[]): number {
  const check = argv.includes("--check")
  const unknown = argv.filter((arg) => arg !== "--check")
  if (unknown.length > 0) {
    console.error(`unknown argument: ${unknown.join(" ")} (usage: sync-bundles [--check])`)
    return 2
  }
  const result = syncBundles({
    packagesDir: join(hfsDir, ".."),
    hfsRuntimeDir: join(hfsDir, "runtime"),
    check,
  })
  for (const path of result.written) console.log(`wrote ${path}`)
  for (const item of result.drift) console.error(`drift (${item.reason}): ${item.pkg}/runtime/${item.path}`)
  if (result.drift.length > 0) {
    console.error(check ? "bundle copies drifted: run `npm run bundles` in packages/hfs" : "bundle manifests need attention")
    return 1
  }
  console.log(check ? "bundle copies match hfs" : `bundle copies synced (${result.written.length} written)`)
  return 0
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2))
}
