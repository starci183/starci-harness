/**
 * The package's own root, the same from the TypeScript source (`src/lib`) and from the build (`dist/lib`): both sit two
 * levels below it, so every file the package reads beside its code (the bundled `runtime/`, the fixtures) resolves here.
 */
import { join } from "node:path"
import { fileURLToPath } from "node:url"

/** The folder holding this package's package.json. */
export const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url))

/** The bundled runtime the canon reads the slot manifest, the architecture machine and its catalogs from. */
export const RUNTIME_ROOT = join(PACKAGE_ROOT, "runtime")
