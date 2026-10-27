/**
 * The package root and its bundled `runtime/` folder. `src/` (run by the specs) and `dist/` (published) both sit one level below the
 * package root, so the same relative step finds the runtime from either.
 */
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/** The package root: the folder holding package.json, runtime/ and fixtures/. */
export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

/** The bundled runtime the slot manifest, rule catalog and architecture machine are read from. */
export const RUNTIME_ROOT = join(PACKAGE_ROOT, "runtime")
