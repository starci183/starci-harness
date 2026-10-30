import { worktreeGc } from "../../harness/worktree-gc.js"
import { formatTable } from "../../shared/output.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

/**
 * `starci worktree gc [--execute]`: removes the worktrees the harness made for this repository whose owner's work ended (an
 * Op's task settled, a workflow done or stopped, a Supervisor's worker accepted or rejected, a package edit landed) and the
 * orphans no ledger row owns, each after its uncommitted work is preserved, plus the harness worktrees left for a retired
 * project; a folder something holds is left busy and retried with backoff (exit 0); `supervisor tick` runs it for every
 * repository of every project.
 */
export const worktreeGcVerb = defineVerb({
    path: ["worktree", "gc"],
    summary: "remove the harness's worktrees whose owner ended (Op, workflow, worker, landed package edit) and orphans, preserving their uncommitted work first (dry until --execute: it only lists)",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: ["owner", "debug", "supervisor", "kernel", "agent"],
    schema: "starci/worktree-gc@1",
    flags: {
        execute: { kind: "boolean", summary: "remove what is due (default: a dry run that judges every harness worktree and changes nothing)" },
        now: { kind: "boolean", summary: "retry a folder left busy now instead of after its backoff, and take a folder git no longer lists however recently it changed" },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const entries = await worktreeGc(root, !flags.execute, flags.now)
        const state = (entry: (typeof entries)[number]): string => {
            if (entry.busy === true) return "busy"
            if (!entry.due) return "kept"
            if (!flags.execute) return "due"
            return entry.removed ? "removed" : "left"
        }
        const rows = entries.map((entry) => [entry.kind, entry.path, state(entry), entry.preserved ?? "-", entry.reason + (entry.detail === "" ? "" : `; ${entry.detail}`)])
        const message = entries.length === 0 ? "no harness worktree of this repository" : formatTable([["KIND", "WORKTREE", "STATE", "PRESERVED", "WHY"], ...rows])
        // A folder left busy is no failure of the collector: it is recorded and retried with backoff.
        return { data: { dryRun: !flags.execute, entries }, message, exitCode: entries.some((entry) => state(entry) === "left") ? 1 : 0 }
    },
})
