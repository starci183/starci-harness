import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { hostUp, loadHost, selectServices } from "../../harness/host.js"
import type { UpOutcome } from "../../harness/host.js"
import { sharedStateBase } from "../../harness/ledger.js"
import { Refusal } from "../../shared/errors.js"

/**
 * The npm registry on this machine (`starci deps publish-local`): a Verdaccio container named `starci-local-registry`, published
 * on 127.0.0.1 only, with no login, that stores what was published locally in a bind-mounted folder of the shared state base
 * and passes every other request through to registry.npmjs.org. It is the host service `local-registry` of ops/host.yaml
 * (compose file and config in ops/host/registry/), the only way it runs. It is not a publication: nothing in it reaches npm, CI or
 * an app's committed files, and what it holds is published under local versions of its own (`./local-version.ts`).
 */
export const CONTAINER = "starci-local-registry"
export const HOST_SERVICE = "local-registry"
export const PORT = 4873
export const LOOPBACK = "127.0.0.1"

/** The registry URL npm is given, with the trailing slash npm writes. */
export const registryUrl = (port: number): string => `http://${LOOPBACK}:${String(port)}/`

/** The registry's folder: `local-registry` of the shared state base (one container, one storage per machine, whichever checkout runs the CLI); its `storage/` is what the container mounts. */
export const registryFolder = (): string => join(sharedStateBase(), "local-registry")

/**
 * The npmrc lines of an app's install: only `@starci` resolves from the registry (every other package still comes from npm, so the
 * lockfile gains no other local URL), and a `resolved` already locked to npmjs stays there (`replace-registry-host=never`).
 */
export const installNpmrc = (port: number): string => [`@starci:registry=${registryUrl(port)}`, "replace-registry-host=never", ""].join("\n")

/** The npmrc of this CLI's own publish and view calls: the registry for everything, and the placeholder token npm wants before it publishes (the registry takes anyone). */
export const publishNpmrc = (port: number): string => [installNpmrc(port).trimEnd(), `registry=${registryUrl(port)}`, `//${LOOPBACK}:${String(port)}/:_authToken=local-registry`, ""].join("\n")

/** The npm flags that point one app command at the registry for `@starci` only (no file, no environment). */
export const installFlags = (port: number): string[] => [`--@starci:registry=${registryUrl(port)}`, "--replace-registry-host=never"]

/** The npm flags of this CLI's own calls: the whole registry, which wins over any npm setting of the machine. */
export const registryFlags = (port: number): string[] => [`--registry=${registryUrl(port)}`, ...installFlags(port)]

/** The process side of the registry's lifecycle: the ping and the host service start. The specs replace it; every other caller takes the default. */
export interface RegistryIo {
    readonly answers: () => Promise<boolean>
    readonly up: (cwd: string) => Promise<readonly UpOutcome[]>
}

/** Whether the registry answers its ping. */
export const registryAnswers = async (): Promise<boolean> => {
    try {
        return (await fetch(`${registryUrl(PORT)}-/ping`, { signal: AbortSignal.timeout(2000) })).ok
    } catch {
        return false
    }
}

export const realIo: RegistryIo = {
    answers: registryAnswers,
    up: (cwd) => {
        const config = loadHost()
        return hostUp(config, selectServices(config, [HOST_SERVICE]), cwd, () => undefined)
    },
}

/** Where the registry stands, changing nothing: `up` when it answers its ping, else `down`. */
export const registryState = async (io: RegistryIo = realIo): Promise<"up" | "down"> => ((await io.answers()) ? "up" : "down")

/**
 * Brings the registry up through its host service (`host up local-registry`, the same start `host up` runs) and returns once it
 * answers. It is idempotent: a registry that already answers is left alone, so the container running on the port is adopted,
 * never replaced; nothing here runs docker itself.
 */
export const ensureRegistry = async (cwd: string, io: RegistryIo = realIo): Promise<void> => {
    mkdirSync(join(registryFolder(), "storage"), { recursive: true })
    if (await io.answers()) return
    const outcomes = await io.up(cwd)
    if (await io.answers()) return
    const evidence = outcomes.map((one) => `${one.id}: ${one.outcome} (${one.evidence})`).join("; ")
    throw new Refusal("LOCAL_REGISTRY_NOT_READY", `${registryUrl(PORT)} does not answer after host up ${HOST_SERVICE}${evidence === "" ? "" : `: ${evidence}`}; see docker logs ${CONTAINER}`)
}

/** Writes the npmrc of this CLI's own publish calls beside the config and returns its path (`--userconfig <file>`). */
export const writePublishNpmrc = (port: number): string => {
    const folder = registryFolder()
    mkdirSync(folder, { recursive: true })
    const publish = join(folder, "publish.npmrc")
    writeFileSync(publish, publishNpmrc(port))
    return publish
}
