import { repositoryRoot } from "../../shared/git.js"
import { defineVerb } from "../../shared/verb.js"
import type { VerbContext } from "../../shared/verb.js"
import { findCiRunGreen, requireCiGreen, requireCiRunGreen } from "../check/ci.js"
import { callerRole } from "../../shared/role.js"
import { asRefusal, Refusal } from "../../shared/errors.js"
import { judgeHostServices } from "./check.js"
import { argSet, argValue, FORWARDED, leadingOperands, runHfs, withoutArg } from "./hfs.js"

/**
 * Waits for a green CI (or the urgent record) before an executed production deploy, as policy/quality.yaml requireCi asks. A commit whose
 * CI reading is red is still accepted when one of its CI runs is evidence by the run judgement (verdict and images green): the reading counts
 * the run's conclusion, which a failed auto-deploy after the verdict turns red, and that must not block the manual deploy that repairs it.
 */
const judgeProductionCi = async (context: VerbContext, args: readonly string[], sha: string): Promise<void> => {
    const root = await repositoryRoot(context.cwd)
    const urgent = argSet(args, "urgent")
    let accepted
    try {
        accepted = await requireCiGreen(context, root, "deploy.prod", sha, { urgent })
    } catch (error: unknown) {
        if (urgent || asRefusal(error).code !== "CI_NOT_GREEN") throw error
        const evidence = await findCiRunGreen(root, sha).catch((found: unknown) => {
            throw new Refusal("CI_NOT_GREEN", `${asRefusal(error).message}; and ${asRefusal(found).message}`)
        })
        context.progress(`deploy.prod: ci evidence run ${String(evidence.runId)} of ${sha.slice(0, 9)}: ${evidence.checked.map((check) => check.job).join(", ")} green (its deploy jobs are not evidence)`)
        return
    }
    if (accepted !== undefined) {
        const verdictText = accepted.verdict === "urgent" ? accepted.detail : `CI of ${accepted.sha.slice(0, 9)} is green`
        context.progress(`deploy.prod: ${verdictText}`)
    }
}

/** The argv without an empty `--ci-run` (`--ci-run=`, `--ci-run ""`, or `--ci-run` before another flag or at the end), every other token kept. */
const withoutEmptyCiRun = (args: readonly string[]): string[] =>
    args.filter((token, at) => {
        if (token === "--ci-run=") return false
        if (token === "--ci-run") return false
        return !(token === "" && args[at - 1] === "--ci-run")
    })

/**
 * Judges the CI run `--ci-run` names as the evidence of the commit being deployed (or says it is judged once `--execute` deploys), and returns
 * the argv to forward. An empty `--ci-run` names no run: the newest run of the commit the judgement accepts is found and forwarded in its place.
 */
const judgeNamedRun = async (context: VerbContext, args: readonly string[], deploy: boolean, sha: string | undefined, ciRun: string | undefined): Promise<readonly string[]> => {
    if (!deploy) throw new Refusal("CI_RUN_USAGE", "--ci-run belongs to `stack deploy`: it names the CI run that proves the commit being deployed")
    if (argSet(args, "urgent")) throw new Refusal("CI_RUN_USAGE", "--ci-run and --urgent exclude each other: an urgent deploy stands on its urgent record, a CI deploy on its run")
    const named = ciRun !== undefined && ciRun !== "" && !ciRun.startsWith("-") ? ciRun : undefined
    if (!argSet(args, "execute")) {
        context.progress(named === undefined ? "ci evidence: dry run; the newest run of the commit with a green verdict and images is found when --execute deploys" : `ci evidence: dry run; run ${named} is judged when --execute deploys`)
        return named === undefined ? withoutEmptyCiRun(args) : args
    }
    if (sha === undefined) throw new Refusal("CI_RUN_USAGE", "--ci-run judges one exact commit: add --sha <40-hex commit being deployed>")
    const root = await repositoryRoot(context.cwd)
    const evidence = named === undefined ? await findCiRunGreen(root, sha) : await requireCiRunGreen(root, sha, named)
    context.progress(`ci evidence: run ${String(evidence.runId)} of ${sha.slice(0, 9)}: ${evidence.checked.map((check) => check.job).join(", ")} green`)
    return named === undefined ? [...withoutEmptyCiRun(args), "--ci-run", String(evidence.runId)] : args
}

/**
 * `starci app stack`: Swarm deploy tooling of an app (prepare to rollback, dry runs without --execute); @starci/hfs runs it in-process in the app with the caller's role. Before it forwards, an
 * executed production deploy of built images waits for a green CI when policy/quality.yaml lists deploy.prod in requireCi, or,
 * with --urgent, for the commit's urgent record to stand in; a red reading is still accepted when a CI run of the commit is evidence by the run
 * judgement below (a failed auto-deploy turns the run red after its verdict). `--ci-run <run>` (the CI deploy, inside the run that is still in progress, or on the run
 * a reused candidate verdict names) replaces that lookup: the CLI itself reads the run's jobs from GitHub and accepts only when every job the CI
 * standard requires (the verdict among them) and every images job concluded success for the exact `--sha`; the deploy jobs and the rollback are
 * never read. An empty `--ci-run` finds that run among the commit's CI runs and forwards its id. Only after that judgement is the id forwarded: @starci/hfs takes `--ci-run` as a journal label (the attempt is a CI one and names the run), never as evidence.
 */
export const appStackVerb = defineVerb({
    path: ["app", "stack"],
    summary: "Swarm deploy tooling of an app (prepare to rollback, dry runs without --execute)",
    effect: "remote",
    roles: ["owner", "release", "supervisor", "op", "worker", "agent"],
    schema: "starci/app-stack@1",
    forward: true,
    flags: FORWARDED,
    run: async (context, flags) => {
        const args = flags.args
        const sha = argValue(args, "sha")
        const deploy = leadingOperands(args)[0] === "deploy"
        const ciRun = argValue(args, "ci-run")
        // The host services the environment needs (hostServices) exist on its machines before anything deploys (HOST_SERVICE_MISSING).
        if (deploy) judgeHostServices(context, argValue(args, "env") ?? "production")
        let forwarded: readonly string[] = args
        if (withoutArg(args, "ci-run").length !== args.length) {
            forwarded = await judgeNamedRun(context, args, deploy, sha, ciRun)
        } else if (deploy && argSet(args, "execute") && (argValue(args, "env") ?? "production") === "production" && sha !== undefined) {
            await judgeProductionCi(context, args, sha)
        }
        return runHfs(context, "stack", forwarded, true, undefined, { role: callerRole() ?? "owner" })
    },
})
