import { Refusal } from "../shared/errors.js"
import { captureTool } from "../shared/exec.js"
import { currentBranch, git, resolveSha } from "../shared/git.js"
import type { CleanVerify } from "./clean-verify.js"
import type { Contract } from "./contract.js"

/** What a settle did: the branch it moved and the commit it now points at; `committed` is false when the task changed nothing. */
export interface Settlement {
    readonly branch: string
    readonly commit: string
    readonly committed: boolean
}

/** The message of a task's harness commit: `<label>: <summary>` and the task trailer. */
export const settleMessage = (contract: Contract, taskId: string): string => `${contract.label}: ${contract.input.summary}\n\nStarci-Task: ${taskId}`

/** The branch a settle will move; a detached HEAD has none, so nothing can be settled. */
export const settleBranch = async (root: string): Promise<string> => {
    const branch = await currentBranch(root)
    if (branch === undefined) throw new Refusal("HEAD_DETACHED", `${root} is on a detached HEAD; check out the branch the task lands on, then verify again`)
    return branch
}

/**
 * Lands exactly the candidate the checks saw: the branch moves to that commit only while it still points at the candidate's
 * parent, and the index of the settled paths is refreshed so the user's tree shows them clean. The work tree is never
 * written and nothing is pushed.
 */
export const settle = async (root: string, built: CleanVerify): Promise<Settlement> => {
    const branch = await settleBranch(root)
    const moved = (head: string): Refusal =>
        new Refusal("HEAD_MOVED", `${branch} moved from ${built.parent.slice(0, 12)} to ${head.slice(0, 12)} after the candidate was built; the work tree is untouched, verify again`)
    const head = await resolveSha(root, "HEAD")
    if (head !== built.parent) throw moved(head)
    if (built.changed.length === 0) return { branch, commit: head, committed: false }
    const update = await captureTool("git", ["update-ref", "-m", "starci settle", `refs/heads/${branch}`, built.candidate, built.parent], root)
    if (update.exitCode !== 0) throw moved(await resolveSha(root, "HEAD"))
    await git(root, ["reset", "-q", "--", ...built.paths.map((path) => `:(top,literal)${path}`)])
    return { branch, commit: built.candidate, committed: true }
}
