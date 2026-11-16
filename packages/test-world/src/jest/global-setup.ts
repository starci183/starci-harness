/**
 * The jest globalSetup of the test world (default export, Jest API). `src/tests/world/global-setup.ts` re-exports it as a
 * one-liner. It finds the repository declaration itself: `src/tests/world/test-world.config.ts` under the project rootDir,
 * loaded through jest's own transformer (the hook is live while this function runs), after the path aliases are registered.
 */
import { join } from "node:path"
import { rememberedDeclaration } from "../config/registry"
import { TestWorldErrorCode, worldError } from "../errors"
import { lazyRequire } from "../lazy"
import { registerTsPaths } from "./paths"
import { requestedWorkers, selectedKinds, setupWorld } from "./setup"
import type { SetupHandles } from "./setup"

/** Where the setup keeps what the teardown needs; jest runs both in the same parent process. */
const HANDLES_KEY = Symbol.for("@starci/test-world/setup-handles")

/** The handles of the running setup, or null. */
export const setupHandles = (): SetupHandles | null => ((globalThis as Record<symbol, unknown>)[HANDLES_KEY] as SetupHandles | undefined) ?? null

/**
 * The globalSetup. `projectConfig.rootDir` is the be side (the declaration lives under it); declared paths resolve from its app
 * root (appRootOf). The data slots of a run are the workers `.starcistacks/application-stacks.yaml` declares for the selected kinds (`tests.integration.workers`, `tests.e2e.workers`, one when absent), or `STARCI_TEST_WORLD_WORKERS` when asked for explicitly, capped by the declaration's `workers`; jest's `--maxWorkers` is not read.
 */
export default async function globalSetup(_globalConfig?: unknown, projectConfig?: { readonly rootDir?: string }): Promise<void> {
    const root = projectConfig?.rootDir ?? process.cwd()
    registerTsPaths(root)
    const file = join(root, "src", "tests", "world", "test-world.config.ts")
    try {
        lazyRequire(file)
    } catch (cause) {
        throw worldError(TestWorldErrorCode.ConfigInvalid, `${file} could not be loaded: ${cause instanceof Error ? cause.message : String(cause)}`, cause)
    }
    const declaration = rememberedDeclaration()
    if (declaration === null) {
        throw worldError(TestWorldErrorCode.ConfigInvalid, `${file} did not call defineTestWorld(...) from @starci/test-world`)
    }
    ;(globalThis as Record<symbol, unknown>)[HANDLES_KEY] = await setupWorld(declaration, root, { explicit: requestedWorkers(), kinds: selectedKinds(process.argv) })
}
