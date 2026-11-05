/**
 * The package's own root, the same from the TypeScript source (`src/lib`) and from the build (`dist/lib`): both sit two
 * levels below it, so every file the package reads beside its code (the bundled `runtime/`, the fixtures) resolves here.
 */
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/** The folder holding this package's package.json. */
export const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url))

/**
 * The runtime of the installed @starci/hfs (its peer, a same-minor range): the slot manifest, the architecture machine and its catalogs are read from it
 * at run time, never from a copy bundled here, so an hfs data change releases hfs alone (decision release-only-what-changed).
 */
export const RUNTIME_ROOT = join(dirname(createRequire(import.meta.url).resolve("@starci/hfs/package.json")), "runtime")

/** The files this package keeps of its own in runtime/ (the project graph rule, the jsdoc, sonar and next helpers, the package-scripts template). */
export const OWN_RUNTIME_ROOT = join(PACKAGE_ROOT, "runtime")
