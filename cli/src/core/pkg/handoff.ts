import { basename } from "node:path"
import { Refusal } from "../../shared/errors.js"
import { captureGit, currentBranch, mainCheckout, repositoryRoot, resolveSha, trackedChanges } from "../../shared/git.js"
import { callerRole } from "../../shared/role.js"
import { BOTH_EDITIONS, defineVerb, EVERYONE } from "../../shared/verb.js"
import { APP_KEY, BRANCH_PREFIX, changedPackages, listHandoffs, recordHandoff } from "./edit.js"
import type { Handoff } from "./edit.js"

interface HandoffData {
    readonly recorded: Handoff | undefined
    readonly handoffs: readonly Handoff[]
}

/** `starci pkg handoff`: records the package edit branch of this worktree and its head for Debug (see ./edit.ts); `--list` is Debug's queue. */
export const pkgHandoffVerb = defineVerb({
    path: ["pkg", "handoff"],
    summary: "record this package edit branch (pkg/*) and its committed head for Debug to merge, push and publish; --urgent when an app's deploy waits on it; --list prints the queue",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: EVERYONE,
    schema: "starci/pkg-handoff@1",
    flags: {
        urgent: { kind: "boolean", summary: "an app needs to deploy on this edit: Debug publishes the batch at once" },
        note: { kind: "string", summary: "one line for Debug: what changed and which app waits" },
        list: { kind: "boolean", summary: "print every recorded handoff, urgent first, and record nothing" },
    },
    run: async (context, flags) => {
        if (flags.list) {
            const handoffs = listHandoffs()
            const lines = handoffs.map((one) => `${one.urgent ? "URGENT " : ""}${one.branch} ${one.head.slice(0, 9)} (${one.app}; ${one.packages.join(", ") || "no package folder"}) ${one.worktree} at ${one.at}${one.note === null ? "" : `: ${one.note}`}`)
            return { data: { recorded: undefined, handoffs } satisfies HandoffData, message: lines.join("\n") || "no package edit handed off" }
        }
        const worktree = await repositoryRoot(context.cwd)
        const branch = await currentBranch(worktree)
        if (branch?.startsWith(BRANCH_PREFIX) !== true) throw new Refusal("PKG_NOT_EDIT_BRANCH", `run it in a package edit worktree (a ${BRANCH_PREFIX}* branch, from starci pkg branch); this checkout is on ${branch ?? "a detached HEAD"}`)
        const dirty = await trackedChanges(worktree)
        if (dirty.length > 0) throw new Refusal("PKG_HANDOFF_DIRTY", `commit the edit first; Debug merges the committed head: ${dirty.slice(0, 5).join(", ")}`)
        const packages = await changedPackages(worktree)
        if (packages.length === 0) throw new Refusal("PKG_HANDOFF_EMPTY", `${branch} changes no package folder against main; nothing to hand off`)
        const recorded = recordHandoff({
            branch,
            head: await resolveSha(worktree, "HEAD"),
            harness: (await mainCheckout(worktree)).replaceAll("\\", "/"),
            worktree: worktree.replaceAll("\\", "/"),
            app: (await captureGit(["config", "--get", `branch.${branch}.${APP_KEY}`], worktree)).stdout.trim() || basename(worktree),
            packages,
            urgent: flags.urgent,
            note: flags.note ?? null,
            byRole: callerRole() ?? null,
        })
        const data: HandoffData = { recorded, handoffs: [] }
        return { data, message: `handed ${branch} ${recorded.head.slice(0, 9)} to Debug${recorded.urgent ? " (urgent: a deploy waits on it)" : ""}; packages: ${packages.join(", ")}` }
    },
})
