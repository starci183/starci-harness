import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { requireCiGreen, requireCiRunGreen } from "../check/ci.js"
import { callerRole } from "../../shared/role.js"
import { Refusal } from "../../shared/errors.js"
import { argSet, argValue, FORWARDED, leadingOperands, runHfs, withoutArg } from "./hfs.js"

/**
 * `starci app stack`: Swarm deploy tooling of an app (prepare to rollback, dry runs without --execute); @starci/hfs runs it in-process in the app with the caller's role. Before it forwards, an
 * executed production deploy of built images waits for a green CI when policy/quality.yaml lists deploy.prod in requireCi, or,
 * with --urgent, for the commit's urgent record to stand in. `--ci-run <run>` (the CI deploy, inside the run that is still in progress, or on the run
 * a reused candidate verdict names) replaces that lookup: the CLI itself reads the run's jobs from GitHub and accepts only when every job the CI
 * standard requires concluded success for the exact `--sha`; the flag is the CLI's alone and never reaches @starci/hfs.
 */
export const appStackVerb = defineVerb({
    path: ["app", "stack"],
    summary: "Swarm deploy tooling of an app (prepare to rollback, dry runs without --execute)",
    editions: BOTH_EDITIONS,
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
        const forwarded = withoutArg(args, "ci-run")
        if (forwarded.length !== args.length) {
            if (!deploy) throw new Refusal("CI_RUN_USAGE", "--ci-run belongs to `stack deploy`: it names the CI run that proves the commit being deployed")
            if (ciRun === undefined || ciRun === "" || ciRun.startsWith("-")) throw new Refusal("CI_RUN_USAGE", "--ci-run takes the id of the GitHub Actions run to judge")
            if (argSet(args, "urgent")) throw new Refusal("CI_RUN_USAGE", "--ci-run and --urgent exclude each other: an urgent deploy stands on its urgent record, a CI deploy on its run")
            if (argSet(args, "execute")) {
                if (sha === undefined) throw new Refusal("CI_RUN_USAGE", "--ci-run judges one exact commit: add --sha <40-hex commit being deployed>")
                const evidence = await requireCiRunGreen(await repositoryRoot(context.cwd), sha, ciRun)
                context.progress(`ci evidence: run ${String(evidence.runId)} of ${sha.slice(0, 9)}: ${evidence.checked.map((check) => check.job).join(", ")} green`)
            } else context.progress(`ci evidence: dry run; run ${ciRun} is judged when --execute deploys`)
        } else if (deploy && argSet(args, "execute") && (argValue(args, "env") ?? "production") === "production" && sha !== undefined) {
            const accepted = await requireCiGreen(context, await repositoryRoot(context.cwd), "deploy.prod", sha, { urgent: argSet(args, "urgent") })
            if (accepted !== undefined) context.progress(`deploy.prod: ${accepted.verdict === "urgent" ? accepted.detail : `CI of ${accepted.sha.slice(0, 9)} is green`}`)
        }
        return runHfs(context, "stack", forwarded, true, undefined, { role: callerRole() ?? "owner" })
    },
})
