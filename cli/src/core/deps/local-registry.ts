import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { hostUp, loadHost, selectServices } from "../../harness/host.js"
import type { UpOutcome } from "../../harness/host.js"
import { sharedStateBase } from "../../harness/ledger.js"
import { Refusal } from "../../shared/errors.js"
import { captureNpm } from "../../shared/exec.js"
import { cliPackageName } from "../version.js"

/**
 * The npm registry on this machine (`starci deps publish-local`): a Verdaccio container named `starci-local-registry`, published
 * on 127.0.0.1 only, with no login, that stores what was published locally in the named volume `starci-local-registry-storage`
 * and passes every other request through to registry.npmjs.org. It is the service `local-registry` of the host stack `starci`
 * (ops/host.yaml; compose file and config in ops/host/stack/), the only way it runs. It is not a publication: nothing in it reaches npm, CI or
 * an app's committed files, and what it holds is published under the version committed in git (`deps publish-local` refuses a version
 * npm serves with other content).
 */
export const CONTAINER = "starci-local-registry"
export const HOST_SERVICE = "local-registry"
export const PORT = 4873
export const LOOPBACK = "127.0.0.1"

/** The registry URL npm is given, with the trailing slash npm writes. */
export const registryUrl = (port: number): string => `http://${LOOPBACK}:${String(port)}/`

/** The folder of this CLI's own registry files (its publish npmrc): `local-registry` of the shared state base, one per machine whichever checkout runs the CLI. The registry's storage is the stack's named volume, no folder here. */
export const registryFolder = (): string => join(sharedStateBase(), "local-registry")

/**
 * The npmrc lines of an app's install: only `@starci` resolves from the registry (every other package still comes from npm, so the
 * lockfile gains no other local URL), and a `resolved` already locked to npmjs stays there (`replace-registry-host=never`).
 */
export const installNpmrc = (port: number): string => [`@starci:registry=${registryUrl(port)}`, "replace-registry-host=never", ""].join("\n")

/** The npmrc of this CLI's own publish and view calls: the registry for everything, and the placeholder token npm wants before it publishes (the registry takes anyone). */
export const publishNpmrc = (port: number): string => [installNpmrc(port).trimEnd(), `registry=${registryUrl(port)}`, `//${LOOPBACK}:${String(port)}/:_authToken=local-registry`, ""].join("\n")

/**
 * The npm flags that point one app command at the registry (no file, no environment): the `@starci` scope always, and for a command that
 * installs the CLI (`starci-harness`, the one unscoped package of the harness, which npm cannot route by scope) the registry itself, so
 * only that command resolves a package that is not locked yet through it. The registry is never npm's default and nothing writes it to an `.npmrc`.
 */
export const installFlags = (port: number, packages: readonly string[] = []): string[] => [
    `--@starci:registry=${registryUrl(port)}`,
    "--replace-registry-host=never",
    ...(packages.includes(cliPackageName()) ? [`--registry=${registryUrl(port)}`] : []),
]

/** The npm flags of this CLI's own calls: the whole registry, which wins over any npm setting of the machine. */
export const registryFlags = (port: number): string[] => [`--registry=${registryUrl(port)}`, ...installFlags(port)]

const versionsSchema = z.union([z.array(z.string()), z.string()])

/** The versions the local registry lists of `name` (what it published and what npm serves through its uplink); empty when it knows none. */
export const registryVersions = async (name: string, port: number, cwd: string): Promise<string[]> => {
    const view = await captureNpm(["view", name, "versions", "--json", ...registryFlags(port)], cwd)
    if (view.exitCode !== 0) return []
    let raw: unknown
    try {
        raw = JSON.parse(view.stdout)
    } catch {
        raw = undefined
    }
    const parsed = versionsSchema.safeParse(raw)
    if (!parsed.success) return []
    return typeof parsed.data === "string" ? [parsed.data] : parsed.data
}

const packumentSchema = z.object({ versions: z.record(z.string(), z.object({ peerDependencies: z.record(z.string(), z.string()).optional() })) })

/**
 * Each version the local registry lists of `name` with the peer ranges it was published with (its packument, read over HTTP);
 * undefined when the registry lists none or cannot be read.
 */
export const registryPeerLine = async (name: string, port: number): Promise<Readonly<Record<string, Readonly<Record<string, string>>>> | undefined> => {
    try {
        const answer = await fetch(`${registryUrl(port)}${name.replace("/", "%2f")}`, { signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } })
        if (!answer.ok) return undefined
        const parsed = packumentSchema.safeParse(await answer.json())
        if (!parsed.success) return undefined
        return Object.fromEntries(Object.entries(parsed.data.versions).map(([version, manifest]) => [version, manifest.peerDependencies ?? {}]))
    } catch {
        return undefined
    }
}

/** The version a package was last published to the local registry under (its `local` dist-tag, set by every `deps publish-local`); undefined when it holds none. */
export const latestLocal = async (name: string, port: number, cwd: string): Promise<string | undefined> => {
    const view = await captureNpm(["view", name, "dist-tags.local", "--json", ...registryFlags(port)], cwd)
    if (view.exitCode !== 0) return undefined
    try {
        const raw: unknown = JSON.parse(view.stdout)
        return typeof raw === "string" ? raw : undefined
    } catch {
        return undefined
    }
}

/** The dist-tag every local publish carries, so no local publish moves `latest` or a prerelease tag of the registry's npm copy. */
export const LOCAL_TAG = "local"

/** The process side of the registry's lifecycle: the ping and the host service start. The specs replace it; every other caller takes the default. */
export interface RegistryIo {
    readonly answers: () => Promise<boolean>
    readonly up: (cwd: string) => Promise<readonly UpOutcome[]>
}

/** Whether the registry answers its ping. */
export const registryAnswers = async (port = PORT): Promise<boolean> => {
    try {
        return (await fetch(`${registryUrl(port)}-/ping`, { signal: AbortSignal.timeout(2000) })).ok
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
