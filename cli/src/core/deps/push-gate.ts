import { inOrder } from "../../harness/sequential.js"
import { Refusal } from "../../shared/errors.js"
import { captureNpm } from "../../shared/exec.js"
import { locateTree } from "../../shared/tree.js"
import { judgeLocalRegistry, NPMJS_FLAGS } from "./local-refs.js"
import { refuseRecordedOverlay } from "./overlay-refusal.js"
import { committedPins } from "./packages.js"
import type { Pin } from "./packages.js"

/** A pin the registry was asked about: its requirement and whether npm can install it. */
export interface PinVerdict extends Pin {
    readonly published: boolean
}

/** What the push gate judged; `app` is false outside a StarCi app, where it judges nothing. */
export interface PushJudgement {
    readonly app: boolean
    readonly revision: string
    readonly pins: readonly PinVerdict[]
    readonly notes: readonly string[]
}

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
 * `release cut` and `app release`. It refuses DEPS_PIN_UNPUBLISHED when a package.json committed at `revision` pins a
 * `@starci` package to a spec npm cannot install (no published version matches, a path or protocol, a version only the local registry
 * holds), since CI would fail to install it. A lockfile or .npmrc committed at `revision` that names a registry on this machine (a
 * `deps install-local` install) is DEPS_LOCAL_REGISTRY_COMMITTED, in any repository, and a project that still records the removed
 * package overlay is DEPS_OVERLAY_REMOVED. Every npm question here is pinned to the public registry (`NPMJS_FLAGS`). Outside a
 * StarCi app (the harness itself, whose packages the release plan judges) it judges nothing else.
 */
export const judgePush = async (root: string, revision = "HEAD"): Promise<PushJudgement> => {
    refuseRecordedOverlay(root)
    await judgeLocalRegistry(root, revision)
    const tree = locateTree(root).tree
    if (tree !== "lite" && tree !== "full") return { app: false, revision, pins: [], notes: ["not a StarCi app (no app hfs.json): nothing to judge"] }
    const pins = await committedPins(root, revision)
    const asked = new Map<string, boolean>()
    const verdicts = await inOrder(pins, async (pin): Promise<PinVerdict> => {
        const key = `${pin.name}@${pin.spec}`
        const known = asked.get(key) ?? (await published(root, pin.name, pin.spec))
        asked.set(key, known)
        return { ...pin, published: known }
    })
    const unpublished = verdicts.filter((pin) => !pin.published)
    if (unpublished.length > 0) {
        const listed = unpublished.map((pin) => `${pin.file} ${pin.field} ${pin.name}@${pin.spec}`).join("; ")
        throw new Refusal("DEPS_PIN_UNPUBLISHED", `CI cannot install these committed @starci pins: ${listed}. Publish the package (starci release publish --execute) or pin a published version (a local version goes back with starci deps install-local --restore), then commit`)
    }
    return { app: true, revision, pins: verdicts, notes: [] }
}
