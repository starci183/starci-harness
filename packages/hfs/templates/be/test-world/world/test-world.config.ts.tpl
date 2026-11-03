/**
 * The declaration of the test world: selection and overrides only. The service list and the image versions come from the stack
 * definition (`.starcistacks/dev`); the library runs the Postgres of every connection real behind toxiproxy, migrates it once per
 * run through the cli app and boots the api apps in process.
 */
import { applyCorrelation } from "@modules/platform/logging"
import { defineTestWorld } from "@starci/test-world"
import type { TestWorldApi } from "@starci/test-world"
{{appModuleImports}}
import { {{optionsImports}} } from "./test-apps.options"

const world: TestWorldApi = defineTestWorld({
    stack: ".starcistacks/dev",
    stacks: {
        postgresql: { connections: [{{connectionDeclarations}}] },
    },
    apps: {
{{worldApps}}
    },
    migrate: { module: migrateCli, options: cliOptionsOf },
    modules: { base: platformBase },
})

/** Registers the hooks that boot and close the world around a spec and answers its handle; call it inside `describe`. */
export const useTestWorld: TestWorldApi["useTestWorld"] = world.useTestWorld

/** The contract layer: the real integration client against a provider sandbox, in a `contract-spec`. */
export const useSandbox: TestWorldApi["useSandbox"] = world.useSandbox
