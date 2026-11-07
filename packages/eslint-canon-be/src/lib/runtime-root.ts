/**
 * The package root and its bundled `runtime/` folder. `src/` (run by the specs) and `dist/` (published) both sit one level below the
 * package root, so the same relative step finds the runtime from either.
 */
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/** The package root: the folder holding package.json, runtime/ and fixtures/. */
export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

/**
 * The runtime of the installed @starci/hfs (its peer, a same-minor range): the slot manifest, the rule catalog, the canon pins and the architecture
 * machine are read from it at run time, never from a copy bundled here, so an hfs data change releases hfs alone.
 */
export const RUNTIME_ROOT = join(dirname(createRequire(import.meta.url).resolve("@starci/hfs/package.json")), "runtime")

/** The files this package keeps of its own in runtime/ (the project graph rule, the jsdoc and sonar helpers, the package-scripts template). */
export const OWN_RUNTIME_ROOT = join(PACKAGE_ROOT, "runtime")
