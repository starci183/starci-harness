import { join } from "node:path"
import { Refusal } from "../../shared/errors.js"
import { captureGit, currentBranch, git, trackedChanges } from "../../shared/git.js"
import { WRITERS, defineVerb } from "../../shared/verb.js"
import { checkLaneName, landPaths, lanesDir, writeReady } from "../../harness/land-queue.js"
import type { ReadyEntry } from "../../harness/land-queue.js"

/**
 * `starci lane ready [lane]`: register this worktree's pushed sha with the batch lander (contexts/project/branches.md PROJECT-BRANCH-2).
 * Run after the lane's own `app check --env prod` is green except the cache and its branch is pushed; it replaces taking a turn on
 * the dev lock. Refuses a dirty tree and a sha origin does not hold as the branch tip.
 */
export const laneReadyVerb = defineVerb({
    path: ["lane", "ready"],
    summary: "register this lane's pushed, locally gated sha with the batch lander of dev; then monitor <lanes>/_land-status/<lane>.json",
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/lane-ready@1",
    flags: {
        lane: { kind: "string", summary: "the lane name (default: the branch name without its lane/ prefix)", positional: true },
        branch: { kind: "string", summary: "the pushed branch (default: the current branch)" },
        dir: { kind: "string", summary: "the lanes folder (default: STARCI_LANES_DIR)" },
    },
    run: async (context, flags) => {
        const dir = lanesDir(flags.dir)
        const branch = flags.branch ?? (await currentBranch(context.cwd))
        if (branch === undefined) throw new Refusal("LANE_READY_DETACHED", "the worktree is on no branch: name it with --branch")
        const lane = checkLaneName(flags.lane ?? branch.replace(/^lane\//, ""))
        const dirty = await trackedChanges(context.cwd)
        if (dirty.length > 0) throw new Refusal("LANE_READY_DIRTY", `${String(dirty.length)} tracked path(s) are not committed (${dirty.slice(0, 3).join(", ")}): the lander lands the pushed sha; commit, gate and push first`)
        const sha = await git(context.cwd, ["rev-parse", "HEAD"])
        const remote = await captureGit(["ls-remote", "origin", `refs/heads/${branch}`], context.cwd)
        const tip = remote.stdout.trim().split(/\s+/)[0] ?? ""
        if (tip === "") throw new Refusal("LANE_READY_NOT_PUSHED", `origin has no ${branch}: git push origin HEAD:${branch} first`)
        if (tip !== sha) throw new Refusal("LANE_READY_NOT_PUSHED", `origin/${branch} is ${tip.slice(0, 10)}, HEAD is ${sha.slice(0, 10)}: push the sha you gated`)
        const entry: ReadyEntry = { lane, branch, sha, at: new Date().toISOString() }
        writeReady(dir, entry)
        const statusFile = join(landPaths(dir).status, `${lane}.json`)
        return { data: { ...entry, status: statusFile }, message: `ready: ${lane} ${branch} ${sha.slice(0, 10)}; monitor ${statusFile}` }
    },
})
