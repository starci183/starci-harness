import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { requireCiGreen } from "../check/ci.js"
import { callerRole } from "../../shared/role.js"
import { argSet, argValue, FORWARDED, leadingOperands, runHfs } from "./hfs.js"

/**
 * `starci app stack`: Swarm deploy tooling of an app (prepare to rollback, dry runs without --execute) and the full edition's
 * local test-world infrastructure; @starci/hfs runs it in-process in the app with the caller's role. Before it forwards, an
 * executed production deploy of built images waits for a green CI when policy/quality.yaml lists deploy.prod in requireCi, or,
 * with --urgent, for the commit's urgent record to stand in.
 */
export const appStackVerb = defineVerb({
    path: ["app", "stack"],
    summary: "Swarm deploy tooling of an app (prepare to rollback, dry runs without --execute) and the full edition's local test-world infrastructure",
    editions: BOTH_EDITIONS,
    effect: "remote",
    roles: ["owner", "release", "supervisor", "op", "worker", "agent"],
    schema: "starci/app-stack@1",
    forward: true,
    flags: FORWARDED,
    run: async (context, flags) => {
        const args = flags.args
        // The commit the images were built from: @starci/hfs's --source-sha, which the canonical CLI spells --sha.
        const sha = argValue(args, "source-sha") ?? argValue(args, "sha")
        if (leadingOperands(args)[0] === "deploy" && argSet(args, "execute") && (argValue(args, "env") ?? "production") === "production" && sha !== undefined) {
            const accepted = await requireCiGreen(context, await repositoryRoot(context.cwd), "deploy.prod", sha, { urgent: argSet(args, "urgent") })
            if (accepted !== undefined) context.progress(`deploy.prod: ${accepted.verdict === "urgent" ? accepted.detail : `CI of ${accepted.sha.slice(0, 9)} is green`}`)
        }
        return runHfs(context, "stack", args, true, undefined, { role: callerRole() ?? "owner" })
    },
})
