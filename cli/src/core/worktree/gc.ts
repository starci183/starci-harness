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
    summary: "collect ended worktrees or exclusively selected --path checkouts; preserve Git work and refs, quarantine proven project remnants whole, and block selected live, primary, caller or foreign folders (dry until --execute)",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: ["owner", "debug", "supervisor", "kernel", "agent"],
    schema: "starci/worktree-gc@1",
    flags: {
        execute: { kind: "boolean", summary: "remove what is due (default: a dry run that judges every harness worktree and changes nothing)" },
        now: { kind: "boolean", summary: "retry a folder left busy now instead of after its backoff, and take a folder git no longer lists however recently it changed" },
        path: { kind: "list", summary: "exclusively select reviewed linked worktrees or canonical direct-child remnants of this project's state worktrees (repeatable); preserve Git work or quarantine all remnant bytes, blocking live holders" },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const entries = await worktreeGc(root, !flags.execute, flags.now, { paths: flags.path, caller: context.cwd })
        const state = (entry: (typeof entries)[number]): string => {
            if (entry.blocked === true) return "blocked"
            if (entry.quarantine !== undefined) return entry.quarantine === "complete" ? "quarantined" : `custody-${entry.quarantine}`
            if (entry.busy === true) return "busy"
            if (!entry.due) return "kept"
            if (!flags.execute) return "due"
            return entry.removed ? "removed" : "left"
        }
        const rows = entries.map((entry) => [entry.kind, entry.path, state(entry), entry.preserved ?? "-", entry.reason + (entry.detail === "" ? "" : `; ${entry.detail}`)])
        const message = entries.length === 0 ? "no harness worktree of this repository" : formatTable([["KIND", "WORKTREE", "STATE", "PRESERVED", "WHY"], ...rows])
        // A folder left busy is no failure of the collector: it is recorded and retried with backoff.
        return { data: { dryRun: !flags.execute, entries }, message, exitCode: entries.some((entry) => entry.blocked === true || (flags.execute && entry.due && !entry.removed && entry.busy !== true)) ? 1 : 0 }
    },
})
