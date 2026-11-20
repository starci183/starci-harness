import { WRITERS, defineVerb } from "../../shared/verb.js"
import type { VerbResult } from "../../shared/verb.js"
import { removeLockOf } from "../../harness/remove-lock.js"
import { loadSlotRules, releaseLaneSlots, slotRoot, slotsOfLane } from "../../harness/slots.js"
import { planRemoval, removalLane, removeWorktree } from "../../harness/worktree-remove.js"

/** The json data of a removal, dry or done. */
interface RemoveData {
    readonly dryRun: boolean
    readonly worktree: string
    readonly branch: string | undefined
    readonly dirty: readonly string[]
    readonly links: readonly { readonly path: string; readonly target: string; readonly directory: boolean; readonly targetExists: boolean }[]
    readonly lockHeld: string | null
    readonly branchKept: boolean
    readonly unlinked: readonly { readonly path: string; readonly target: string; readonly targetSurvived: boolean }[]
    readonly leftover: number
    /** The slot files the lane holds (a dry run) or held (released with the removal). */
    readonly slots: readonly string[]
}

/**
 * `starci lane remove <worktree-path> [--execute]`: the only sanctioned removal of a lane worktree. It unlinks every directory
 * junction and symlink in the tree as a link, never through it, so a removal can no longer empty another lane's node_modules.
 */
export const laneRemoveVerb = defineVerb({
    path: ["lane", "remove"],
    summary: "remove a lane worktree safely, the only sanctioned way: refuse a main or unregistered checkout or tracked changes, hold a removal lock the install paths respect, unlink every junction and symlink as a link (never its target), check none remains, then git worktree remove and prune; the branch is kept (dry until --execute)",
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/lane-remove@1",
    flags: {
        worktree: { kind: "string", summary: "the worktree folder to remove (a registered git worktree, not the main checkout)", required: true, positional: true },
        "keep-branch": { kind: "boolean", summary: "keep the lane's branch (the default and the only mode: the branch is never deleted)" },
        discard: { kind: "boolean", summary: "remove although tracked changes stand, throwing them away" },
        lane: { kind: "string", summary: "the lane named in the removal lock (default: STARCI_LANE, else the worktree's lane/<lane> branch)" },
        dir: { kind: "string", summary: "the slot root whose slots of the lane are released (default: STARCI_LANES_DIR, else slots.root of ops/slots.yaml, else <harness state>/slots)" },
        execute: { kind: "boolean", summary: "remove the worktree (default: a dry run that prints the plan and changes nothing)" },
    },
    run: async (context, flags): Promise<VerbResult<RemoveData>> => {
        const plan = await planRemoval(flags.worktree, context.cwd, flags.discard)
        const lane = removalLane(flags.lane, plan)
        const held = removeLockOf(plan.worktree)
        const rules = loadSlotRules()
        const slotsDir = slotRoot(flags.dir, rules)
        const slotLines = slotsOfLane(slotsDir, rules, lane).map((slot) => `${slot.kind} ${String(slot.n)}: ${slot.file} (${slot.content})`)
        const links = plan.links.map((link) => `  ${link.directory ? "junction" : "link"} ${link.relative} -> ${link.target}${link.targetExists ? "" : " (dangling)"}`)
        const head = [`worktree ${plan.worktree}`, `branch   ${plan.branch ?? "(detached)"} (kept)`, `tracked changes: ${String(plan.dirty.length)}${plan.dirty.length > 0 ? " (discarded)" : ""}`, `links to unlink, link only: ${String(plan.links.length)}`, ...links]
        if (!flags.execute) {
            const steps = [`1. take the removal lock (install paths refuse to run in the worktree)${held === undefined ? "" : `: HELD by ${held.lane}`}`, "2. unlink each link itself, verify it is gone and its target survives", "3. refuse if any link remains", "4. git worktree remove --force, git worktree prune, delete what is left with lstat", "5. keep the branch, release the lock", `6. release every slot lane ${lane} holds in ${slotsDir}: ${slotLines.length === 0 ? "none held" : String(slotLines.length)}`, ...slotLines.map((line) => `   ${line}`)]
            return { data: { dryRun: true, worktree: plan.worktree, branch: plan.branch, dirty: plan.dirty, links: plan.links.map((link) => ({ path: link.relative, target: link.target, directory: link.directory, targetExists: link.targetExists })), lockHeld: held?.lane ?? null, branchKept: true, unlinked: [], leftover: 0, slots: slotLines }, message: [...head, "plan:", ...steps, "dry run: nothing changed; pass --execute"].join("\n") }
        }
        const done = await removeWorktree(plan, lane, context.progress)
        // After the worktree is gone: a failed removal throws before this, so a lane that still has its worktree keeps its slots.
        const freed = releaseLaneSlots(slotsDir, rules, lane, `lane remove (pid ${String(process.pid)})`)
        const summary = [...head, `unlinked ${String(done.unlinked.length)} link(s); every target survived`, `removed ${plan.worktree} (${String(done.leftover)} leftover entr${done.leftover === 1 ? "y" : "ies"} deleted by hand)`, `branch ${plan.branch ?? "(detached)"} ${done.branchKept ? "kept" : "NOT FOUND after the removal"}`, "removal lock released", `released ${String(freed.released.length)} slot(s) of lane ${lane}${freed.released.length === 0 ? "" : `: ${freed.released.join(", ")}`}`]
        return { data: { dryRun: false, worktree: plan.worktree, branch: plan.branch, dirty: plan.dirty, links: [], lockHeld: null, branchKept: done.branchKept, unlinked: done.unlinked.map((entry) => ({ path: entry.link.relative, target: entry.link.target, targetSurvived: entry.targetSurvived })), leftover: done.leftover, slots: freed.released }, message: summary.join("\n"), exitCode: done.branchKept ? 0 : 1 }
    },
})
