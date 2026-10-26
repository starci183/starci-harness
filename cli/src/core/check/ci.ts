import { loadPolicy } from "../../harness/policy.js"
import type { CiGatedAction } from "../../harness/policy.js"
import { asRefusal, Refusal } from "../../shared/errors.js"
import { resolveSha } from "../../shared/git.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"
import type { VerbContext } from "../../shared/verb.js"
import { ciStatusVerb } from "../release/ci-status.js"

/** What `release ci-status` answered for one commit, or why it could not answer. */
export interface CiReading {
    readonly sha: string
    readonly verdict: string
    readonly detail: string
}

const verdictOf = (data: unknown): string => (typeof data === "object" && data !== null && "verdict" in data && typeof data.verdict === "string" ? data.verdict : "unreadable")

/** Reads the CI verdict of `sha` through `release ci-status` itself; a verdict that cannot be read is `unreadable`, never green. */
export const readCi = async (context: VerbContext, cwd: string, sha: string): Promise<CiReading> => {
    try {
        const result = await ciStatusVerb.run({ ...context, cwd }, { sha })
        return { sha, verdict: verdictOf(result.data), detail: result.message }
    } catch (error: unknown) {
        const refusal = asRefusal(error)
        return { sha, verdict: "unreadable", detail: `${refusal.code}: ${refusal.message}` }
    }
}

/**
 * The require-ci gate of an action: when policy/quality.yaml lists it in requireCi, the action refuses CI_NOT_GREEN unless
 * CI of `sha` is green. Returns the reading, or undefined when the policy does not make the action wait.
 */
export const requireCiGreen = async (context: VerbContext, root: string, action: CiGatedAction, sha: string): Promise<CiReading | undefined> => {
    if (!loadPolicy(root).quality.requireCi.includes(action)) return undefined
    const reading = await readCi(context, root, sha)
    if (reading.verdict !== "green") {
        throw new Refusal("CI_NOT_GREEN", `${action} waits for a green CI (policy/quality.yaml requireCi); CI of ${sha.slice(0, 9)} is ${reading.verdict}: ${reading.detail.split("\n")[0] ?? ""}`)
    }
    return reading
}

/** `starci check ci`: exits 0 only when CI of the commit is green; the check a contract uses to wait for CI (preset ci-green). */
export const checkCiVerb = defineVerb({
    path: ["check", "ci"],
    summary: "exit 0 only when the GitHub Actions verdict of a commit is green (red, pending, none or unreadable exit 1)",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/check-ci@1",
    flags: {
        sha: { kind: "string", summary: "the commit to judge" },
        ref: { kind: "string", summary: "the ref whose commit is judged when no --sha is given (default HEAD)" },
    },
    run: async (context, flags) => {
        const sha = flags.sha ?? (await resolveSha(context.cwd, flags.ref ?? "HEAD"))
        const reading = await readCi(context, context.cwd, sha)
        const message = reading.verdict === "unreadable" ? `${sha.slice(0, 9)}: unreadable\n${reading.detail}` : reading.detail
        return { data: reading, message, exitCode: reading.verdict === "green" ? 0 : 1 }
    },
})
