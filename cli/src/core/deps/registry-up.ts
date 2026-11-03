import { Refusal, UsageError } from "../../shared/errors.js"
import { defineVerb, WRITERS } from "../../shared/verb.js"
import { CONTAINER, DEFAULT_PORT, ensureRegistry, registryAnswers, registryFolder, registryStatus, registryUrl } from "./local-registry.js"

/**
 * `starci deps registry-up`: the host service `local-registry` of ops/host.yaml. It starts or reuses the `starci-local-registry`
 * container (the same one `deps publish-local --execute` ensures: config and storage under the state base, 127.0.0.1 only) and
 * returns once it answers; it publishes and builds nothing. Without `--execute` it reports where the registry stands.
 */
export const depsRegistryUpVerb = defineVerb({
    path: ["deps", "registry-up"],
    summary: "start or reuse the local npm registry container on 127.0.0.1 (the host service local-registry); dry until --execute",
    editions: ["lite", "full"],
    effect: "host",
    roles: WRITERS,
    schema: "starci/deps-registry-up@1",
    flags: {
        execute: { kind: "boolean", summary: "start or reuse the container (default: report where it stands)" },
        port: { kind: "string", summary: `the port on 127.0.0.1 (default ${String(DEFAULT_PORT)})` },
    },
    run: async (context, flags) => {
        const port = flags.port === undefined ? DEFAULT_PORT : Number(flags.port)
        if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new UsageError("--port is a number from 1024 to 65535")
        if (flags.execute) await ensureRegistry(port, context.cwd)
        const state = await registryStatus(port, context.cwd)
        const answers = state === "running" && (await registryAnswers(port))
        if (flags.execute && !answers) throw new Refusal("LOCAL_REGISTRY_NOT_READY", `${registryUrl(port)} does not answer; see docker logs ${CONTAINER}`)
        const folder = registryFolder()
        return {
            data: { container: CONTAINER, registry: registryUrl(port), state, answers, folder, mode: flags.execute ? "up" : "plan" },
            message: `${CONTAINER} ${state}${answers ? ", answering" : ""} at ${registryUrl(port)} (config and storage in ${folder})${flags.execute ? "" : "; dry run, add --execute to start it"}`,
        }
    },
})
