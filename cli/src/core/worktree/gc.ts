import { worktreeGc } from "../../harness/worktree-gc.js"
import { formatTable } from "../../shared/output.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

/**
 * `starci worktree gc [--dry-run]`: removes the worktrees the harness made for this repository whose owner's work ended (an
 * Op's task settled, a workflow done or stopped, a Supervisor's worker accepted or rejected, a package edit landed) and the
 * orphans no ledger row owns, each after its uncommitted work is preserved; `supervisor tick` runs it for every repository
 * of every project.
 */
export const worktreeGcVerb = defineVerb({
    path: ["worktree", "gc"],
    summary: "remove the harness's worktrees whose owner ended (Op, workflow, worker, landed package edit) and orphans, preserving their uncommitted work first; --dry-run only lists",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: ["owner", "debug", "supervisor", "kernel", "agent"],
    schema: "starci/worktree-gc@1",
    flags: {
        "dry-run": { kind: "boolean", summary: "judge every harness worktree and change nothing" },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const entries = await worktreeGc(root, flags["dry-run"])
        const rows = entries.map((entry) => [entry.kind, entry.path, entry.due ? (flags["dry-run"] ? "due" : entry.removed ? "removed" : "left") : "kept", entry.preserved ?? "-", entry.reason + (entry.detail === "" ? "" : `; ${entry.detail}`)])
        const message = entries.length === 0 ? "no harness worktree of this repository" : formatTable([["KIND", "WORKTREE", "STATE", "PRESERVED", "WHY"], ...rows])
        return { data: { dryRun: flags["dry-run"], entries }, message, exitCode: entries.some((entry) => entry.due && !entry.removed && !flags["dry-run"]) ? 1 : 0 }
    },
})
