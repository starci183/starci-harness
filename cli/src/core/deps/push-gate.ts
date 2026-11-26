import { inOrder } from "../../harness/sequential.js"
import { Refusal } from "../../shared/errors.js"
import { captureNpm } from "../../shared/exec.js"
import { locateTree } from "../../shared/tree.js"
import { declaresDevLocal, devLocalNote, EXACT_VERSION, integrationRefs, landsOnDev, namesLocalRegistry } from "./dev-local.js"
import type { DevLocalCode, PushTarget } from "./dev-local.js"
import { judgeLocalRegistry, NPMJS_FLAGS } from "./local-refs.js"
import { PORT, registryVersions } from "./local-registry.js"
import { judgeLockIntegrity } from "./lock-integrity.js"
import type { ServedLookup } from "./lock-integrity.js"
import { committedPins } from "./packages.js"
import type { Pin } from "./packages.js"
import { committedWorkspaceMembers, workspaceSatisfies } from "./workspace-pins.js"

/** A pin the registry was asked about: its requirement and whether npm can install it. */
export interface PinVerdict extends Pin {
    readonly published: boolean
    /** True for a pin only the local registry serves, accepted on a declared dev push (dev-local.ts). */
    readonly local?: boolean
}

/** What the push gate judged; `app` is false outside a StarCi app, where it judges nothing. */
export interface PushJudgement {
    readonly app: boolean
    readonly revision: string
    readonly pins: readonly PinVerdict[]
    readonly notes: readonly string[]
    /** The codes a declared dev push accepted (dev-local.ts); empty otherwise. */
    readonly accepted?: readonly DevLocalCode[]
}

/** What one judgement asks beyond the commit: where the push goes, and the registry questions (seams for the specs). */
export interface PushGateOptions {
    /** The refs the push updates (the pre-push hook's stdin). Only a target that lands on dev can accept local pins; a release verb passes none. */
    readonly target?: PushTarget
    /** Whether npm serves `name@spec` (default: `npm view` on the public registry). */
    readonly published?: (root: string, name: string, spec: string) => Promise<boolean>
    /** Whether the local registry serves exactly `name@version` (default: its version list). */
    readonly servedLocally?: (root: string, name: string, version: string) => Promise<boolean>
    /** What npm serves of a locked harness package (default: npmCopy). */
    readonly served?: ServedLookup
}

const servedByLocalRegistry = async (root: string, name: string, version: string): Promise<boolean> => (await registryVersions(name, PORT, root)).includes(version)

// A spec npm resolves from the registry: a version, range or dist-tag. A path, a protocol or a `user/repo` shorthand is not.
const fromRegistry = (spec: string): boolean => !/^(?:[a-z][\w+.-]*:|\.|\/|~\/)/i.test(spec) && !/^[\w.-]+\/[\w.-]+/.test(spec)

/** Whether `name@spec` has a published version; DEPS_REGISTRY_UNREACHABLE when npm cannot say, since an unknown is never a yes. */
const published = async (root: string, name: string, spec: string): Promise<boolean> => {
    if (!fromRegistry(spec)) return false
    const run = await captureNpm(["view", `${name}@${spec}`, "version", "--json", ...NPMJS_FLAGS], root)
    if (run.exitCode === 0) return run.stdout.trim() !== ""
    if (/E404|ETARGET|No match found/.test(`${run.stdout}\n${run.stderr}`)) return false
    throw new Refusal("DEPS_REGISTRY_UNREACHABLE", `npm view ${name}@${spec} failed, so the pin cannot be called installable: ${run.stderr.trim().split("\n").slice(-3).join(" ")}`)
}

/**
 * The push gate of an app's `@starci` dependencies, run by the app's pre-push hook (`starci deps check`), `release push`,
 * `release cut` and `app release`. A pin that names a workspace member of the same repository at exactly its version (the committed lockfile links it,
 * `"link": true`) is satisfied by the workspace and never asked of npm; the member still publishes through the normal release. It refuses DEPS_PIN_UNPUBLISHED when a package.json committed at `revision` pins a
 * `@starci` package to a spec npm cannot install (no published version matches, a path or protocol, a version only the local registry
 * holds), since CI would fail to install it. A lockfile or .npmrc committed at `revision` that names a registry on this machine (a
 * `deps install-local` install) is DEPS_LOCAL_REGISTRY_COMMITTED, and a lockfile that holds a harness package at a version npm serves with
 * another integrity (a build of the local registry) is DEPS_LOCK_INTEGRITY, in any repository. Every npm question here is pinned to the public registry (`NPMJS_FLAGS`). Outside a
 * StarCi app (the harness itself, whose packages the release plan judges) it judges nothing else. A push whose `target` lands on dev, of an app
 * that declares hfs.json `deps.devAllowsLocalRegistry` at `revision`, accepts the three codes for the local registry only (dev-local.ts);
 * `release push`, `release cut` and `app release` pass no target, so they always refuse.
 */
export const judgePush = async (root: string, revision = "HEAD", options: PushGateOptions = {}): Promise<PushJudgement> => {
    const devLocal = landsOnDev(options.target, integrationRefs(root)) && (await declaresDevLocal(root, revision))
    const accepted = new Set<DevLocalCode>()
    await judgeLocalRegistry(root, revision, (found) => {
        if (!devLocal || !found.every((one) => namesLocalRegistry(one.url))) return false
        accepted.add("DEPS_LOCAL_REGISTRY_COMMITTED")
        return true
    })
    try {
        await judgeLockIntegrity(root, revision, options.served)
    } catch (error) {
        if (!(devLocal && error instanceof Refusal && error.code === "DEPS_LOCK_INTEGRITY")) throw error
        accepted.add("DEPS_LOCK_INTEGRITY")
    }
    const tree = locateTree(root).tree
    const notesOf = (): string[] => (accepted.size > 0 ? [devLocalNote(options.target?.refs ?? [], [...accepted])] : [])
    if (tree !== "app") return { app: false, revision, pins: [], notes: ["not a StarCi app (no app hfs.json): nothing to judge", ...notesOf()], accepted: [...accepted] }
    const pins = await committedPins(root, revision)
    const members = await committedWorkspaceMembers(root, revision)
    const isPublished = options.published ?? published
    const servedLocally = options.servedLocally ?? servedByLocalRegistry
    const asked = new Map<string, boolean>()
    const verdicts = await inOrder(pins, async (pin): Promise<PinVerdict> => {
        const key = `${pin.name}@${pin.spec}`
        // A workspace member of this repository at exactly the pinned version is linked by npm ci, so the workspace satisfies the pin; the release still publishes it later.
        const known = asked.get(key) ?? ((await workspaceSatisfies(root, revision, members, pin.name, pin.spec)) || (await isPublished(root, pin.name, pin.spec)))
        asked.set(key, known)
        if (known || !devLocal || !EXACT_VERSION.test(pin.spec)) return { ...pin, published: known }
        // A declared dev push may hold an exact version the local registry serves; anything else stays refused.
        return (await servedLocally(root, pin.name, pin.spec)) ? { ...pin, published: false, local: true } : { ...pin, published: false }
    })
    const unpublished = verdicts.filter((pin) => !pin.published && pin.local !== true)
    if (unpublished.length > 0) {
        const listed = unpublished.map((pin) => `${pin.file} ${pin.field} ${pin.name}@${pin.spec}`).join("; ")
        throw new Refusal("DEPS_PIN_UNPUBLISHED", `CI cannot install these committed @starci pins: ${listed}. Publish the package (starci release publish --execute) or pin a published version (a local version goes back with starci deps install-local --restore), then commit`)
    }
    if (verdicts.some((pin) => pin.local === true)) accepted.add("DEPS_PIN_UNPUBLISHED")
    return { app: true, revision, pins: verdicts, notes: notesOf(), accepted: [...accepted] }
}
