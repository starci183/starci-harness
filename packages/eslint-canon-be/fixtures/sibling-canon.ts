/**
 * The front-end canon, for the specs that prove one machine finding reaches the right side's rule. It is loaded through the
 * sibling package's own `package.json` entry (`exports["."]`), never by a source path, so it follows that package wherever
 * its build puts the entry (`index.mjs` today, `dist/index.js` once built); build the sibling before testing this one.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import type { CanonRule } from "./typed/tester.ts"

const FE_ROOT = join(import.meta.dirname, "..", "..", "eslint-canon-fe")

/** The `.` entry of a package.json: a string, or a conditions object. */
type Entry = string | { readonly import?: string; readonly default?: string }

/** The fields of a package.json that locate its entry. */
interface Manifest {
    readonly exports?: Readonly<Record<string, Entry>>
    readonly main?: Entry
}

/** The `.` entry of a package.json `exports` (a string, or the `import`/`default` condition). */
const entryOf = (manifest: Manifest): string => {
    const main = manifest.exports?.["."] ?? manifest.main
    if (main === undefined) throw new Error("the front-end canon declares no entry")
    const entry = typeof main === "string" ? main : (main.import ?? main.default)
    if (entry === undefined) throw new Error("the front-end canon declares no import entry")
    return entry
}

/** The front-end canon's gathered plugin. */
export interface FePlugin {
    readonly rules: Readonly<Record<string, CanonRule>>
}

// The parsed manifest is the one untyped boundary: a file read from the sibling package, shaped as `Manifest` above.
const manifest = JSON.parse(readFileSync(join(FE_ROOT, "package.json"), "utf8")) as Manifest

/** The front-end canon's gathered plugin (its default export). */
export const fePlugin = ((await import(pathToFileURL(join(FE_ROOT, entryOf(manifest))).href)) as { readonly default: FePlugin }).default
