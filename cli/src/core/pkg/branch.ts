import { existsSync } from "node:fs"
import { join } from "node:path"
import { Refusal } from "../../shared/errors.js"
import { captureGit, git, refExists } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb, WRITERS } from "../../shared/verb.js"
import { APP_KEY, appName, BRANCH_PREFIX, editWorktree, harnessRepository, installPushGuard, topicSlug } from "./edit.js"

interface BranchData {
    readonly branch: string
    readonly worktree: string
    readonly harness: string
    readonly base: string
    readonly created: boolean
    readonly guard: string
    readonly link: string
}

/** `starci pkg branch <topic>`: cuts the package edit branch `pkg/<app>-<topic>` from harness main into its own worktree (see ./edit.ts). */
export const pkgBranchVerb = defineVerb({
    path: ["pkg", "branch"],
    summary: "cut a package edit branch pkg/<app>-<topic> from harness main into its own harness worktree, where this app's session edits @starci packages; Debug alone merges, pushes and publishes it",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/pkg-branch@1",
    flags: {
        topic: { kind: "string", summary: "what the edit is about, e.g. button-loading", required: true, positional: true },
        cwd: { kind: "string", summary: "the harness repository to branch (default the one this CLI runs from)" },
    },
    run: async (context, flags) => {
        const app = await appName(context.cwd)
        const harness = await harnessRepository(flags.cwd)
        const branch = `${BRANCH_PREFIX}${app}-${topicSlug(flags.topic)}`
        const worktree = editWorktree(harness, branch)
        let created = false
        if (!existsSync(worktree)) {
            const args = (await refExists(harness, `refs/heads/${branch}`)) ? ["worktree", "add", worktree, branch] : ["worktree", "add", "-b", branch, worktree, "main"]
            const run = await captureGit(args, harness)
            if (run.exitCode !== 0) throw new Refusal("PKG_BRANCH_FAILED", `git ${args.join(" ")} failed: ${run.stderr.trim()}`)
            created = true
        }
        const current = (await git(worktree, ["branch", "--show-current"])).trim()
        if (current !== branch) throw new Refusal("PKG_BRANCH_FAILED", `${worktree} exists but holds ${current || "a detached HEAD"}, not ${branch}`)
        await git(harness, ["config", `branch.${branch}.${APP_KEY}`, app])
        const guard = await installPushGuard(harness)
        const base = (await git(worktree, ["merge-base", "HEAD", "main"])).trim()
        const link = `starci deps source --local --cwd ${join(worktree, "packages").replaceAll("\\", "/")}`
        const data: BranchData = { branch, worktree: worktree.replaceAll("\\", "/"), harness: harness.replaceAll("\\", "/"), base, created, guard: guard.replaceAll("\\", "/"), link }
        const message = [
            `${created ? "created" : "reusing"} ${branch} in ${data.worktree} (from main ${base.slice(0, 9)})`,
            `edit and commit there, run each changed package's own gates (npm run build, npm test in its folder), then link it into this app: ${link}`,
            "when it is done: starci pkg handoff (add --urgent when a deploy waits on it); pushing this branch is refused for every role but debug and owner",
        ]
        return { data, message: message.join("\n") }
    },
})
