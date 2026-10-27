/**
 * The front-end canon, for the specs that prove one machine finding reaches the right side's rule. It is loaded through the
 * sibling package's own `package.json` entry (`exports["."]`), never by a source path, so it follows that package wherever
 * its build puts the entry (`index.mjs` today, `dist/index.js` once built); build the sibling before testing this one.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const FE_ROOT = join(import.meta.dirname, "..", "..", "eslint-canon-fe")

/** The `.` entry of a package.json `exports` (a string, or the `import`/`default` condition). */
const entryOf = (manifest) => {
    const main = manifest.exports?.["."] ?? manifest.main
    return typeof main === "string" ? main : main.import ?? main.default
}

/** The front-end canon's gathered plugin (its default export). */
export const fePlugin = (await import(pathToFileURL(join(FE_ROOT, entryOf(JSON.parse(readFileSync(join(FE_ROOT, "package.json"), "utf8"))))).href)).default
