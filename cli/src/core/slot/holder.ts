import { Refusal } from "../../shared/errors.js"
import { currentBranch } from "../../shared/git.js"
import { checkHolder } from "../../harness/slots.js"

/** The variable an Orca seat or a chat lane sets to its lane name, so no verb has to be told it. */
export const LANE_ENV = "STARCI_LANE"

/**
 * The holder a slot verb writes and releases by: `--lane`, else STARCI_LANE, else the current branch without its `lane/` prefix
 * (a lane worktree's branch is `lane/<lane>`). Refused SLOT_LANE_UNSET when none names one: a slot always names its real lane.
 */
export const laneHolder = async (cwd: string, flag: string | undefined): Promise<string> => {
    if (flag !== undefined && flag !== "") return checkHolder(flag)
    const env = process.env[LANE_ENV]
    if (env !== undefined && env !== "") return checkHolder(env)
    let branch: string | undefined
    try {
        branch = await currentBranch(cwd)
    } catch {
        branch = undefined
    }
    if (branch?.startsWith("lane/") === true) return checkHolder(branch.slice("lane/".length))
    throw new Refusal("SLOT_LANE_UNSET", `name the lane with --lane or ${LANE_ENV} (the branch is ${branch ?? "none"}, not lane/<lane>): a slot always names its real lane`)
}

/** A `--wait <s>` value as seconds, or undefined (wait until free). */
export const waitSeconds = (flag: string | undefined): number | undefined => {
    if (flag === undefined) return undefined
    const seconds = Number(flag)
    if (!Number.isFinite(seconds) || seconds < 0) throw new Refusal("CLI_USAGE", `--wait takes seconds, not "${flag}"`)
    return seconds
}

/** A positive integer flag, or undefined. */
export const positiveInt = (name: string, flag: string | undefined): number | undefined => {
    if (flag === undefined) return undefined
    const value = Number(flag)
    if (!Number.isSafeInteger(value) || value < 1) throw new Refusal("CLI_USAGE", `--${name} takes a positive integer, not "${flag}"`)
    return value
}
