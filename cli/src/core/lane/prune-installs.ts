import { Refusal } from "../../shared/errors.js"
import { WRITERS, defineVerb } from "../../shared/verb.js"
import { emptyTrash, installTargets, lastActivityMs, laneTrees, liveContext, liveReasons, pruneLine, pruneTree, sizeMb } from "../../harness/install-janitor.js"
import type { PrunedTree } from "../../harness/install-janitor.js"
import { readMarkers, sweepCleanupMarkers } from "../../harness/land-cleanup.js"
import { loadSlotRules, slotRoot } from "../../harness/slots.js"

/** One worktree as prune-installs judged it. */
interface PruneRow {
    readonly worktree: string
    readonly lane: string
    readonly idleHours: number
    /** Why it is skipped (live, or not idle long enough); empty when it is taken. */
    readonly skipped: readonly string[]
    readonly targets: readonly { readonly path: string; readonly link: boolean; readonly mb: number | null }[]
    readonly freedMb: number | null
    readonly kept: readonly string[]
}

/**
 * `starci lane prune-installs [--idle-hours N] [--execute]`: the install janitor (harness/install-janitor.ts) over every lane worktree of the lanes
 * folder idle at least N hours (default janitor.idleHours of ops/slots.yaml) that nothing holds: no removal lock, no slot of its lane, no git
 * operation, no process working inside it. A dry run (the default) prints each worktree it would take with the folders and their MB, and why it
 * skips the others; --execute deletes them link-safely and empties the trash an earlier prune left.
 */
export const lanePruneInstallsVerb = defineVerb({
    path: ["lane", "prune-installs"],
    summary: "delete the reinstallable folders (janitor.dirs of ops/slots.yaml: node_modules, .next, dist, .turbo, and safe-install trash) of every lane worktree of the lanes folder idle at least --idle-hours that nothing holds (no removal lock, no live slot of its lane, no git operation, no process working inside it); links are unlinked first, never deleted through; the worktree, its branch and every tracked file stay (dry run until --execute, printing what and how many MB)",
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/lane-prune-installs@1",
    flags: {
        "idle-hours": { kind: "string", summary: "take a worktree only when it has not moved for this many hours (default: janitor.idleHours of ops/slots.yaml)" },
        dir: { kind: "string", summary: "the lanes folder (default: STARCI_LANES_DIR, else slots.root of ops/slots.yaml, else <harness state>/slots)" },
        execute: { kind: "boolean", summary: "delete (default: a dry run that measures and prints, changing nothing)" },
    },
    run: async (context, flags) => {
        const rules = loadSlotRules()
        const janitor = rules.janitor
        if (janitor === undefined) throw new Refusal("OPS_INVALID", "ops/slots.yaml declares no janitor (idleHours, dirs)")
        const idleHours = flags["idle-hours"] === undefined ? janitor.idleHours : Number(flags["idle-hours"])
        if (!Number.isFinite(idleHours) || idleHours < 0) throw new Refusal("CLI_USAGE", `--idle-hours takes a number of hours, not "${String(flags["idle-hours"])}"`)
        const root = slotRoot(flags.dir, rules)
        const live = await liveContext(root, rules)
        const rows: PruneRow[] = []
        const markers = readMarkers(root)
        const lines: string[] = [`lanes folder ${root}; idle at least ${String(idleHours)} h; folders ${janitor.dirs.join(", ")}`]
        // A worktree a landing could not remove (busy) left a marker: the janitor takes it now, with the guard of the landing; a dry run only lists them.
        const swept = flags.execute && markers.length > 0 ? await sweepCleanupMarkers(root, context.cwd, rules) : []
        for (const marker of markers) {
            const result = swept.find((one) => one.lane === marker.lane)
            lines.push(flags.execute ? `land cleanup ${marker.lane} (${marker.worktree}): ${result?.state === "kept" ? `kept: ${String(result.reason)}` : (result?.state ?? "not swept")}` : `land cleanup pending: ${marker.lane} (${marker.worktree}), marked ${marker.at}: ${marker.reason}`)
        }
        for (const tree of laneTrees(root)) {
            const idle = Math.round(((Date.now() - lastActivityMs(tree.path)) / 3_600_000) * 10) / 10
            const skipped = [...liveReasons(tree, live), ...(idle < idleHours ? [`moved ${String(idle)} h ago, under ${String(idleHours)} h`] : [])]
            const targets = skipped.length > 0 ? [] : installTargets(tree.path, janitor.dirs)
            if (skipped.length > 0) {
                rows.push({ worktree: tree.path, lane: tree.lane, idleHours: idle, skipped, targets: [], freedMb: null, kept: [] })
                lines.push(`skip ${tree.lane} (${tree.path}): ${skipped.join("; ")}`)
                continue
            }
            if (targets.length === 0) continue
            if (!flags.execute) {
                const measured = targets.map((target) => ({ path: target.relative, link: target.link, mb: target.link ? 0 : sizeMb(target.path) }))
                rows.push({ worktree: tree.path, lane: tree.lane, idleHours: idle, skipped: [], targets: measured, freedMb: null, kept: [] })
                lines.push(`would delete in ${tree.lane} (${tree.path}, idle ${String(idle)} h): ${measured.map((target) => `${target.path}${target.link ? " (link: unlinked)" : ` ${String(target.mb)} MB`}`).join(", ")}`)
                continue
            }
            const pruned: PrunedTree = pruneTree(tree, targets, root)
            rows.push({ worktree: tree.path, lane: tree.lane, idleHours: idle, skipped: [], targets: targets.map((target) => ({ path: target.relative, link: target.link, mb: null })), freedMb: pruned.freedMb, kept: pruned.targets.flatMap((target) => (target.kept === undefined ? [] : [`${target.target.relative}: ${target.kept}`])) })
            lines.push(`deleted ${pruneLine(pruned)}`)
        }
        const trash = flags.execute ? emptyTrash(root) : 0
        const taken = rows.filter((row) => row.skipped.length === 0)
        const total = flags.execute ? taken.reduce((sum, row) => sum + Math.max(0, row.freedMb ?? 0), 0) : taken.reduce((sum, row) => sum + row.targets.reduce((part, target) => part + (target.mb ?? 0), 0), 0)
        lines.push(`${String(taken.length)} worktree(s) ${flags.execute ? `pruned, ${String(total)} MB freed${trash > 0 ? `; ${String(trash)} leftover trash entries deleted` : ""}` : `to prune, ${String(total)} MB; dry run: pass --execute`}; ${String(rows.length - taken.length)} skipped`)
        return { data: { root, idleHours, execute: flags.execute, rows, totalMb: total, landCleanup: { pending: markers.length, swept } }, message: lines.join("\n") }
    },
})
