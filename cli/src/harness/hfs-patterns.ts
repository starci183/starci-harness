import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { asRefusal, Refusal } from "../shared/errors.js"
import { captureGit, git, mainCheckout, resolveSha } from "../shared/git.js"
import { addToStringArray } from "../shared/json-edit.js"
import { locateTree } from "../shared/tree.js"
import { now } from "./ledger.js"
import { withMachine } from "./machine.js"
import { ENDED_NEED_STATES, needOf, needRepo, normalizeNeedKey, patchNeed, recordNeedEvent } from "./needs.js"
import type { NeedResolver } from "./needs.js"
import { thisVerifier, withSettleLock } from "./settle.js"
import { recordEvent } from "./tasks.js"
import { projectOf } from "./work.js"

/**
 * Opt-in pattern ownership. A slot of the hfs manifest with `pattern: <name>` is enabled only by `sides.<side>.patterns` of the
 * app's hfs.json, an app-root file every workflow shares and no task writes. When a task's paths lie in such a slot, the harness
 * itself adds the pattern: an additive edit of that one list (every other byte of hfs.json kept), committed on the workflow's
 * branch under its land lock as a commit of its own (trailer `Starci-Harness: hfs-pattern`), before the task's Op worktree is cut,
 * again before its verify for the files its result names, and when a red names HFS_SLOT_NOT_ENABLED (then the verify or wave runs
 * again on the new head, so no try is spent). The add is recorded as an `hfs-pattern-enabled` ledger event and lands like a shared
 * need: one key per pattern (`config:hfs.<side>.patterns.<name>`) resolved by the first commit, and an add on another workflow's
 * branch recorded as its relay. The commit belongs to no task, so no task's diff carries hfs.json and no task is judged app-wide
 * for it: what the pattern makes legal or red is judged on the files a task lands in the pattern's slots.
 */

/** The trailer of a harness pattern commit. */
export const PATTERN_TRAILER = "Starci-Harness: hfs-pattern"

/** The ledger event of a pattern add, and of an add the harness could not land. */
export const PATTERN_ENABLED_EVENT = "hfs-pattern-enabled"
export const PATTERN_REFUSED_EVENT = "hfs-pattern-refused"

const LOCK_WAIT_MS = 60_000

/** One opt-in pattern some paths need: the side whose hfs.json list enables it, its name, and the slots that ask for it. */
export interface PatternNeed {
    readonly side: string
    readonly pattern: string
    readonly slots: readonly string[]
}

/** The fields of a manifest slot this module reads. */
interface ManifestSlot {
    readonly id: string
    readonly presence?: string
    readonly pattern?: string
    readonly profiles?: readonly string[]
}

const loadManifest = async (): Promise<readonly ManifestSlot[]> => {
    const { loadSlotManifest } = await import("@starci/hfs/runtime/scripts/hfs/slots.mjs")
    return loadSlotManifest().slots
}

const sideOf = (slot: ManifestSlot, path: string): string => {
    const profiles = slot.profiles ?? []
    const head = path.split("/")[0] ?? ""
    return profiles.includes(head) ? head : (profiles[0] ?? head)
}

const grouped = (hits: readonly { readonly slot: ManifestSlot; readonly path: string }[]): PatternNeed[] => {
    const needs = new Map<string, { side: string; pattern: string; slots: Set<string> }>()
    for (const { slot, path } of hits) {
        if (slot.presence !== "opt-in" || slot.pattern === undefined) continue
        const side = sideOf(slot, path)
        const key = `${side}\0${slot.pattern}`
        const need = needs.get(key) ?? { side, pattern: slot.pattern, slots: new Set<string>() }
        need.slots.add(slot.id)
        needs.set(key, need)
    }
    return [...needs.values()].map((need) => ({ side: need.side, pattern: need.pattern, slots: [...need.slots].sort((left, right) => left.localeCompare(right)) })).sort((left, right) => `${left.side}.${left.pattern}`.localeCompare(`${right.side}.${right.pattern}`))
}

/** The app root a checkout holds (its hfs.json app, not the runtime) and hfs.json's path in the checkout; undefined when it holds none. */
const appOf = (checkout: string): { readonly root: string; readonly file: string } | undefined => {
    const tree = locateTree(checkout)
    if (tree.root === undefined || (tree.tree !== "full" && tree.tree !== "lite")) return undefined
    return { root: tree.root, file: relative(checkout, join(tree.root, "hfs.json")).replaceAll("\\", "/") }
}

/**
 * The opt-in patterns the slots owning `paths` (repository-relative files or folders of `checkout`) need, enabled or not, read
 * through @starci/hfs's own classifier (`starci app explain`). A checkout with no app hfs.json, or one @starci/hfs refuses, needs none.
 */
export const patternsOfPaths = async (checkout: string, paths: readonly string[]): Promise<PatternNeed[]> => {
    const app = appOf(checkout)
    if (app === undefined || paths.length === 0) return []
    try {
        const { explainPath } = await import("@starci/hfs/runtime/scripts/hfs/check.mjs")
        const { loadSlotManifest } = await import("@starci/hfs/runtime/scripts/hfs/slots.mjs")
        const manifest = loadSlotManifest()
        const byId = new Map(manifest.slots.map((slot) => [slot.id, slot]))
        const prefix = relative(checkout, app.root).replaceAll("\\", "/")
        const hits = paths.flatMap((path) => {
            const inApp = prefix === "" ? path : path.startsWith(`${prefix}/`) ? path.slice(prefix.length + 1) : undefined
            if (inApp === undefined) return []
            const slot = byId.get(explainPath({ repoRoot: app.root, input: inApp, manifest }).slot ?? "")
            return slot === undefined ? [] : [{ slot, path: inApp }]
        })
        return grouped(hits)
    } catch {
        return []
    }
}

/** The opt-in patterns an HFS_SLOT_NOT_ENABLED finding names (`<path> belongs to <slot>, an opt-in slot ...`) in a check's output. */
export const patternsOfFindings = async (outputs: readonly string[]): Promise<PatternNeed[]> => {
    const named = outputs.flatMap((text) => [...text.matchAll(/(\S+) belongs to ([a-z][\w.-]*), an opt-in slot/g)].map((match) => ({ path: match[1] ?? "", slot: match[2] ?? "" })))
    if (named.length === 0) return []
    try {
        const byId = new Map((await loadManifest()).map((slot) => [slot.id, slot]))
        return grouped(named.flatMap(({ path, slot }) => {
            const found = byId.get(slot)
            return found === undefined ? [] : [{ slot: found, path }]
        }))
    } catch {
        return []
    }
}

/** The patterns of `needs` an hfs.json text does not declare yet. */
export const undeclaredIn = (text: string, needs: readonly PatternNeed[]): PatternNeed[] => {
    const parsed: unknown = JSON.parse(text)
    const listed = (side: string): unknown => {
        const sides = typeof parsed === "object" && parsed !== null ? (parsed as { readonly sides?: unknown }).sides : undefined
        const entry = typeof sides === "object" && sides !== null ? (sides as Record<string, unknown>)[side] : undefined
        return typeof entry === "object" && entry !== null ? (entry as { readonly patterns?: unknown }).patterns : undefined
    }
    return needs.filter((need) => {
        const patterns = listed(need.side)
        return !(Array.isArray(patterns) && patterns.includes(need.pattern))
    })
}

/** The patterns of `needs` the app hfs.json in `checkout`'s work tree does not declare yet (none without an app). */
export const undeclaredPatterns = (checkout: string, needs: readonly PatternNeed[]): PatternNeed[] => {
    const app = appOf(checkout)
    return app === undefined || needs.length === 0 ? [] : undeclaredIn(readFileSync(join(checkout, app.file), "utf8"), needs)
}

/** Where the harness enables patterns: the branch a workflow's tasks land on, checked out at `checkout`, for the task that needs them. */
export interface PatternPlace {
    readonly db: DatabaseSync
    readonly checkout: string
    readonly branch: string
    readonly workflow: string
    readonly task: string
    /** What asked for the add: `op-start`, `verify`, `verify-red` or `wave-red`. */
    readonly why: string
}

/** What one add did: the commit it landed (null when every pattern was already declared or the add was refused) and why it was refused. */
export interface PatternsEnabled {
    readonly commit: string | null
    readonly added: readonly PatternNeed[]
    readonly refused: string | null
}

const needKeyOf = (need: PatternNeed): string => normalizeNeedKey(`config:hfs.${need.side}.patterns.${need.pattern}`)

/** The pattern commit on top of `head`: hfs.json rewritten to `text`, through a private index so no work tree is touched. */
const commitFile = async (checkout: string, head: string, file: string, text: string, message: string): Promise<string> => {
    const dir = mkdtempSync(join(tmpdir(), "starci-hfs-pattern-"))
    try {
        const env = { GIT_INDEX_FILE: join(dir, "index") }
        writeFileSync(join(dir, "hfs.json"), text)
        const blob = await git(checkout, ["hash-object", "-w", `--path=${file}`, join(dir, "hfs.json")])
        const mode = (await git(checkout, ["ls-tree", head, "--", file])).split(/\s/)[0] ?? "100644"
        for (const args of [["read-tree", head], ["update-index", "--cacheinfo", `${mode},${blob},${file}`]]) {
            const run = await captureGit(args, checkout, { env })
            if (run.exitCode !== 0) throw new Refusal("HFS_PATTERN_NOT_LANDED", `git ${args[0] ?? ""}: ${run.stderr}`)
        }
        const tree = await captureGit(["write-tree"], checkout, { env })
        if (tree.exitCode !== 0) throw new Refusal("HFS_PATTERN_NOT_LANDED", `git write-tree: ${tree.stderr}`)
        return await git(checkout, ["commit-tree", tree.stdout, "-p", head, "-m", message])
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
}

/** Records the add in the host store as the shared need of each pattern: resolved by the first commit, relayed on every later branch. */
const recordNeeds = async (place: PatternPlace, added: readonly PatternNeed[], commit: string, file: string): Promise<void> => {
    const project = await projectOf(place.checkout)
    if (project.key === "") return
    const repo = needRepo(await mainCheckout(place.checkout))
    withMachine((db) => {
        for (const need of added) {
            const key = needKeyOf(need)
            const reason = `the harness enabled the ${need.side} pattern ${need.pattern} in hfs.json for task ${place.task} (opt-in slots ${need.slots.join(", ")})`
            const resolver: NeedResolver = { kind: "task", repo, workflow: place.workflow, key: null, task: null, commits: [commit] }
            let row = needOf(db, project.key, key)
            if (row === undefined) {
                const at = now()
                db.prepare("INSERT INTO shared_needs (project, key, scope, level, state, round, opened_at, updated_at) VALUES (?, ?, 'shared', NULL, 'open', 1, ?, ?)").run(project.key, key, at, at)
                recordNeedEvent(db, "opened", project.key, key, { task: place.task, workflow: place.workflow, repo, by: "harness" })
                row = needOf(db, project.key, key)
            }
            if (row !== undefined && !ENDED_NEED_STATES.includes(row.state)) {
                patchNeed(db, project.key, key, { state: "resolved", resolver, reason, resolvedAt: now() }, "resolved")
                continue
            }
            const first = row?.resolver?.kind === "task" ? (row.resolver.commits ?? [])[0] : undefined
            recordNeedEvent(db, "relayed", project.key, key, { workflow: place.workflow, round: row?.round ?? 1, branch: place.branch, commits: [commit], relay: { status: "relayed", relayed: [{ from: first ?? commit, to: commit }], files: [file] } })
        }
    })
}

/**
 * Adds the patterns of `needs` that the app's hfs.json on `place.branch` lacks, as one harness commit on that branch under its land
 * lock, and moves the checkout to it by a fast-forward (`git merge --ff-only`, which refuses rather than overwrite a dirty hfs.json).
 * Never throws: an add that cannot land is an `hfs-pattern-refused` event and the task goes on to meet the red it would meet anyway.
 */
export const enablePatterns = async (place: PatternPlace, needs: readonly PatternNeed[]): Promise<PatternsEnabled> => {
    const app = appOf(place.checkout)
    if (app === undefined || needs.length === 0) return { commit: null, added: [], refused: null }
    try {
        return await withSettleLock(place.db, thisVerifier(`hfs-pattern:${place.workflow}`), LOCK_WAIT_MS, `land-lock:${place.branch}`, async (): Promise<PatternsEnabled> => {
            const head = await resolveSha(place.checkout, `refs/heads/${place.branch}`)
            const path = join(place.checkout, app.file)
            const blob = await git(place.checkout, ["rev-parse", `${head}:${app.file}`])
            if (!existsSync(path) || (await git(place.checkout, ["hash-object", path])) !== blob) {
                throw new Refusal("HFS_PATTERN_NOT_LANDED", `${path} differs from ${app.file} at the head of ${place.branch}; the harness edits hfs.json only where the checkout holds it as the branch does`)
            }
            const text = readFileSync(path, "utf8")
            const added = undeclaredIn(text, needs)
            if (added.length === 0) return { commit: null, added: [], refused: null }
            const edited = [...new Set(added.map((need) => need.side))].reduce(
                (current, side) => addToStringArray(current, ["sides", side, "patterns"], added.filter((need) => need.side === side).map((need) => need.pattern)),
                text,
            )
            const names = added.map((need) => `${need.side}:${need.pattern}`).join(", ")
            const slots = added.flatMap((need) => need.slots).join(", ")
            const message = `hfs: enable pattern ${names} for task ${place.task}\n\nThe opt-in slots ${slots} hold paths of task ${place.task}; the harness declares their pattern in\n${app.file} (sides.<side>.patterns, add only), since no task writes the app-root declaration.\n\n${PATTERN_TRAILER}`
            const commit = await commitFile(place.checkout, head, app.file, edited, message)
            const ff = await captureGit(["merge", "--ff-only", "--quiet", commit], place.checkout)
            if (ff.exitCode !== 0) throw new Refusal("HFS_PATTERN_NOT_LANDED", `git merge --ff-only in ${place.checkout}: ${ff.stderr}`)
            recordEvent(place.db, PATTERN_ENABLED_EVENT, place.workflow, { task: place.task, why: place.why, branch: place.branch, base: head, commit, file: app.file, added })
            await recordNeeds(place, added, commit, app.file)
            return { commit, added, refused: null }
        })
    } catch (error: unknown) {
        const refusal = asRefusal(error)
        const refused = `${refusal.code}: ${refusal.message.split("\n")[0] ?? ""}`
        try {
            recordEvent(place.db, PATTERN_REFUSED_EVENT, place.workflow, { task: place.task, why: place.why, branch: place.branch, needs, refused })
        } catch {
            // The refusal is still returned to the caller, which reports it.
        }
        return { commit: null, added: [], refused }
    }
}
