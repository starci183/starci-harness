import { join } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { mainCheckout, samePath } from "../../shared/git.js"
import { kernelTitle } from "../kernel.js"
import { opWorktreeOf } from "../land.js"
import { openExistingLedger, projectDir } from "../ledger.js"
import { inOrder } from "../sequential.js"
import { getTask, lastEvent, recordEvent } from "../tasks.js"
import { getWorkflow } from "../workflow.js"
import { inside, listWorktrees } from "../worktree-gc.js"
import { worktreeList, worktreeSetParent } from "./client.js"
import type { OrcaBinary, OrcaWorktree } from "./client.js"

/** The event of a lineage this reconcile set in Orca, and the one of a lineage Orca refused (data: the reason). */
export const LINEAGE_SET = "orca-lineage-set"
export const LINEAGE_REFUSED = "orca-lineage-refused"

/** Where a harness worktree belongs in Orca's worktree list: under `parent`, named `displayName`; `owner` is its task or workflow. */
interface WantedLineage {
    readonly path: string
    readonly parent: string
    readonly displayName: string
    readonly owner: string
}

/** What one reconcile did for one worktree: set its lineage, or Orca refused it (and why). */
export interface LineageFix {
    readonly path: string
    readonly owner: string
    readonly outcome: "set" | "refused"
    readonly detail: string
}

const workflowOf = (db: DatabaseSync, id: string): { readonly runner: string } | undefined => {
    try {
        return { runner: getWorkflow(db, id).header.runner }
    } catch {
        return undefined
    }
}

/**
 * The lineage every harness worktree of an orca workflow should have: an Op's (`<workflow>.ops/<task>`) under the worktree it
 * was cut from, `[Op] <workflow>: <task>`; a workflow's under the project's main checkout, `[Kernel] <workflow>`.
 */
const wantedLineage = async (root: string): Promise<WantedLineage[]> => {
    const state = join(projectDir(root), "worktrees")
    const main = await mainCheckout(root)
    const listed = await listWorktrees(root)
    const db = openExistingLedger(root)
    if (db === undefined) return []
    try {
        return listed.flatMap((entry): WantedLineage[] => {
            const rel = inside(state, entry.path)
            if (rel === undefined) return []
            const [first = "", second] = rel.split("/")
            if (first.endsWith(".ops") && second !== undefined) {
                const workflowId = first.slice(0, -".ops".length)
                if (workflowOf(db, workflowId)?.runner !== "orca") return []
                const made = (() => {
                    try {
                        getTask(db, second)
                        return opWorktreeOf(db, second)
                    } catch {
                        return undefined
                    }
                })()
                return made === undefined ? [] : [{ path: entry.path, parent: made.target, displayName: `[Op] ${workflowId}: ${second}`, owner: second }]
            }
            return second === undefined && workflowOf(db, first)?.runner === "orca" ? [{ path: entry.path, parent: main, displayName: kernelTitle(first), owner: first }] : []
        })
    } finally {
        db.close()
    }
}

const record = <T>(root: string, work: (db: DatabaseSync) => T): T | undefined => {
    const db = openExistingLedger(root)
    if (db === undefined) return undefined
    try {
        return work(db)
    } finally {
        db.close()
    }
}

const reasonOf = (error: unknown): string => (error instanceof Error ? (error.message.split("\n")[0] ?? error.message) : String(error))

/**
 * Re-applies Orca's worktree lineage (Supervisor > Kernel > Op) for every harness worktree of a repository whose orca workflow
 * owns it and that Orca lists without the parent it belongs under: the lineage a start set can be missing when its launch did
 * not end ready, its Kernel launched before the lineage existed, or Orca refused it. One `worktree list` per repository; a
 * worktree Orca has not discovered yet waits for the next tick. A refusal is recorded once per reason (LINEAGE_REFUSED on its
 * task or workflow) and named; a set is recorded (LINEAGE_SET). Run by every `supervisor tick`.
 */
export const reconcileLineage = async (root: string, binary: OrcaBinary, cwd: string): Promise<LineageFix[]> => {
    const wanted = await wantedLineage(root)
    if (wanted.length === 0) return []
    const known: OrcaWorktree[] = await worktreeList(binary, await mainCheckout(root), cwd)
    const due = wanted.filter((want) => {
        const shown = known.find((one) => samePath(one.path, want.path))
        return shown !== undefined && (shown.parent === null || !samePath(shown.parent, want.parent))
    })
    const fixed = await inOrder(due, async (want): Promise<LineageFix | undefined> => {
        try {
            await worktreeSetParent(binary, { worktree: want.path, parent: want.parent, displayName: want.displayName }, cwd, false)
            record(root, (db) => { recordEvent(db, LINEAGE_SET, want.owner, { worktree: want.path, parent: want.parent, displayName: want.displayName }) })
            return { path: want.path, owner: want.owner, outcome: "set", detail: `listed under ${want.parent} as ${want.displayName}` }
        } catch (error: unknown) {
            const reason = reasonOf(error)
            const fresh = record(root, (db) => {
                const last = lastEvent(db, LINEAGE_REFUSED, want.owner)
                const known = typeof last === "object" && last !== null && "reason" in last && last.reason === reason && "worktree" in last && last.worktree === want.path
                if (!known) recordEvent(db, LINEAGE_REFUSED, want.owner, { worktree: want.path, parent: want.parent, reason })
                return !known
            })
            return fresh !== false ? { path: want.path, owner: want.owner, outcome: "refused", detail: `Orca refused the lineage under ${want.parent}: ${reason}` } : undefined
        }
    })
    return fixed.filter((fix): fix is LineageFix => fix !== undefined)
}
