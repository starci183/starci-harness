import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { LOCAL_ROOT_ENV, mainCheckoutOf, runtimeRoot, stateBase } from "../../harness/ledger.js"
import { Refusal } from "../../shared/errors.js"
import { captureTool } from "../../shared/exec.js"
import type { ToolRun } from "../../shared/exec.js"
import { NPMJS_REGISTRY } from "./local-refs.js"

/**
 * The npm registry on this machine (`starci deps publish-local`): a Verdaccio container named `starci-local-registry`, published
 * on 127.0.0.1 only, with no login, that stores what was published locally in a bind-mounted folder of the harness state base
 * and passes every other request through to registry.npmjs.org. It is not a publication: nothing in it reaches npm, CI or an app's
 * committed files, and it never serves a version npm already serves (Verdaccio refuses to publish over one).
 */
export const CONTAINER = "starci-local-registry"
export const IMAGE = "verdaccio/verdaccio:5.33.0"
export const DEFAULT_PORT = 4873
export const LOOPBACK = "127.0.0.1"
const INNER_PORT = 4873

/** The registry URL npm is given, with the trailing slash npm writes. */
export const registryUrl = (port: number): string => `http://${LOOPBACK}:${String(port)}/`

/** The config and the storage the container mounts: `local-registry` of the state base, which for a CLI run from a worktree is the main checkout's (one container, one storage per machine). */
export const registryFolder = (): string => ((process.env[LOCAL_ROOT_ENV] ?? "") === "" ? join(mainCheckoutOf(runtimeRoot()), ".runtime", "local-registry") : join(stateBase(), "local-registry"))

/** The Verdaccio config: anonymous read and publish (the port is loopback-only), no new users, npmjs as the uplink for everything. */
export const registryConfig = (): string =>
    [
        "# Written by starci deps publish-local; edits are overwritten.",
        "storage: /verdaccio/storage",
        "listen: 0.0.0.0:4873",
        "auth:",
        "  htpasswd:",
        "    file: /verdaccio/storage/htpasswd",
        "    max_users: -1",
        "uplinks:",
        "  npmjs:",
        `    url: ${NPMJS_REGISTRY}`,
        "packages:",
        '  "**":',
        "    access: $all",
        "    publish: $all",
        "    unpublish: $all",
        "    proxy: npmjs",
        "max_body_size: 200mb",
        "log: { type: stdout, format: pretty, level: warn }",
        "",
    ].join("\n")

/**
 * The npmrc of an app's install: only `@starci` resolves from the registry (every other package still comes from npm, so the
 * lockfile gains no other local URL), and a `resolved` already locked to npmjs stays there (`replace-registry-host=never`).
 */
export const installNpmrc = (port: number): string => [`@starci:registry=${registryUrl(port)}`, "replace-registry-host=never", ""].join("\n")

/** The npmrc of this CLI's own publish, view and unpublish calls: the registry for everything, and the placeholder token npm wants before it publishes (the registry takes anyone). */
export const publishNpmrc = (port: number): string => [installNpmrc(port).trimEnd(), `registry=${registryUrl(port)}`, `//${LOOPBACK}:${String(port)}/:_authToken=local-registry`, ""].join("\n")

/** The npm flags that point one app command at the registry for `@starci` only (no file, no environment). */
export const installFlags = (port: number): string[] => [`--@starci:registry=${registryUrl(port)}`, "--replace-registry-host=never"]

/** The npm flags of this CLI's own calls: the whole registry, which wins over any npm setting of the machine. */
export const registryFlags = (port: number): string[] => [`--registry=${registryUrl(port)}`, ...installFlags(port)]

/** The docker argv that creates the container: the port is published on 127.0.0.1 only, the config read-only, the storage writable. */
export const runArgv = (port: number, folder: string): string[] => [
    "run", "-d", "--name", CONTAINER, "--restart", "unless-stopped",
    "-p", `${LOOPBACK}:${String(port)}:${String(INNER_PORT)}`,
    "-v", `${join(folder, "conf")}:/verdaccio/conf:ro`,
    "-v", `${join(folder, "storage")}:/verdaccio/storage`,
    IMAGE,
]

const inspectSchema = z.array(
    z.object({
        State: z.object({ Running: z.boolean() }),
        HostConfig: z.object({ PortBindings: z.record(z.string(), z.array(z.object({ HostIp: z.string(), HostPort: z.string() })).nullable()).nullable() }),
    }),
).min(1)

/** What the container looks like from outside. */
export interface ContainerState {
    readonly running: boolean
    readonly bindings: readonly { readonly ip: string; readonly port: string }[]
}

/** The container's state from `docker inspect` output; DOCKER_INSPECT_UNREADABLE when it is not that. */
export const readInspect = (text: string): ContainerState => {
    let raw: unknown
    try {
        raw = JSON.parse(text)
    } catch {
        raw = undefined
    }
    const parsed = inspectSchema.safeParse(raw)
    const first = parsed.success ? parsed.data[0] : undefined
    if (first === undefined) throw new Refusal("DOCKER_INSPECT_UNREADABLE", `docker inspect ${CONTAINER} printed something else than its json`)
    const bindings = Object.values(first.HostConfig.PortBindings ?? {}).flatMap((list) => (list ?? []).map((one) => ({ ip: one.HostIp, port: one.HostPort })))
    return { running: first.State.Running, bindings }
}

/**
 * Refuses LOCAL_REGISTRY_EXPOSED when the existing container is reachable beyond this machine, and LOCAL_REGISTRY_PORT when it
 * listens on another port than asked. Nothing is removed: the owner removes a wrong container (`docker rm -f`), its storage stays.
 */
export const judgeContainer = (state: ContainerState, port: number): void => {
    const open = state.bindings.filter((one) => !/^127(?:\.\d{1,3}){3}$|^::1$/.test(one.ip))
    if (open.length > 0) {
        const openText = open.map((one) => `${one.ip === "" ? "all interfaces" : one.ip}:${one.port}`).join(", ")
        throw new Refusal("LOCAL_REGISTRY_EXPOSED", `${CONTAINER} is published on ${openText}, not on ${LOOPBACK} only; remove it (docker rm -f ${CONTAINER}) and run this again`)
    }
    if (!state.bindings.some((one) => one.port === String(port))) throw new Refusal("LOCAL_REGISTRY_PORT", `${CONTAINER} listens on ${state.bindings.map((one) => one.port).join(", ") || "no port"}, not ${String(port)}; pass --port to match it, or remove it (docker rm -f ${CONTAINER})`)
}

const docker = (dockerArgv: readonly string[], cwd: string): Promise<ToolRun> => captureTool("docker", dockerArgv, cwd)

const failed = (what: string, run: ToolRun): Refusal =>
    new Refusal("DOCKER_FAILED", `${what} failed: ${[run.stderr, run.stdout].join(" ").trim().split("\n").slice(-3).join(" ")}`)

/** Where the registry stands, without changing anything: `absent`, `stopped` or `running` (judged loopback-only on the asked port). */
export const registryStatus = async (port: number, cwd: string): Promise<"absent" | "stopped" | "running"> => {
    const probe = await docker(["version", "--format", "{{.Server.Version}}"], cwd)
    if (probe.exitCode !== 0) throw new Refusal("DOCKER_UNAVAILABLE", "docker does not answer; start Docker Desktop")
    const inspected = await docker(["inspect", CONTAINER], cwd)
    if (inspected.exitCode !== 0) return "absent"
    const state = readInspect(inspected.stdout)
    judgeContainer(state, port)
    return state.running ? "running" : "stopped"
}

const PING_SECONDS = 60

/** Whether the registry answers its ping. */
export const registryAnswers = async (port: number): Promise<boolean> => {
    try {
        return (await fetch(`${registryUrl(port)}-/ping`, { signal: AbortSignal.timeout(2000) })).ok
    } catch {
        return false
    }
}

/** Starts or reuses the container with the current config, and returns once the registry answers. */
export const ensureRegistry = async (port: number, cwd: string): Promise<void> => {
    const folder = registryFolder()
    mkdirSync(join(folder, "conf"), { recursive: true })
    mkdirSync(join(folder, "storage"), { recursive: true })
    const file = join(folder, "conf", "config.yaml")
    const changed = !existsSync(file) || readFileSync(file, "utf8") !== registryConfig()
    if (changed) writeFileSync(file, registryConfig())
    const status = await registryStatus(port, cwd)
    if (status === "absent") {
        const created = await docker(runArgv(port, folder), cwd)
        if (created.exitCode !== 0) throw failed(`docker run ${IMAGE}`, created)
    } else if (status === "stopped") {
        const started = await docker(["start", CONTAINER], cwd)
        if (started.exitCode !== 0) throw failed(`docker start ${CONTAINER}`, started)
    } else if (changed) {
        const restarted = await docker(["restart", CONTAINER], cwd)
        if (restarted.exitCode !== 0) throw failed(`docker restart ${CONTAINER}`, restarted)
    }
    for (let waited = 0; waited < PING_SECONDS; waited += 1) {
        if (await registryAnswers(port)) return
        await new Promise((done) => setTimeout(done, 1000))
    }
    throw new Refusal("LOCAL_REGISTRY_NOT_READY", `${registryUrl(port)} did not answer within ${String(PING_SECONDS)} s; see docker logs ${CONTAINER}`)
}

/** Writes the two npmrc files beside the config and returns their paths: `NPM_CONFIG_USERCONFIG=<install>` points one app command at the registry. */
export const writeNpmrcs = (port: number): { readonly install: string; readonly publish: string } => {
    const folder = registryFolder()
    mkdirSync(folder, { recursive: true })
    const install = join(folder, "install.npmrc")
    const publish = join(folder, "publish.npmrc")
    writeFileSync(install, installNpmrc(port))
    writeFileSync(publish, publishNpmrc(port))
    return { install, publish }
}
