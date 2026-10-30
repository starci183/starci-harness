import { openTicket } from "../../harness/tickets.js"
import type { Project } from "../../harness/work.js"
import { repositoryRoot } from "../../shared/git.js"
import { callerRole } from "../../shared/role.js"
import { judgePush } from "../deps/push-gate.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { projectFrom } from "../supervisor/driver.js"
import { argSet, argValue, FORWARDED, runHfs } from "./hfs.js"
import type { HfsHarness } from "./hfs.js"

/**
 * What @starci/hfs's release verb gets from the harness: the caller's role (STARCI_ROLE, else owner) an urgent record names and, for an executed
 * back-fill, the host ticket queue its red verdict files a fix ticket into (kind verify, blocking) in the app's project.
 */
const releaseHarness = (project: Project | undefined): HfsHarness => {
    const role = callerRole() ?? "owner"
    if (project === undefined) return { role }
    return {
        role,
        openTicket: (input) =>
            openTicket({
                kind: "verify",
                severity: "blocking",
                title: input.title,
                evidence: { tail: input.tail },
                tried: `starci app release gate --backfill ${input.tag} --execute ran the full gate on ${input.head.slice(0, 12)}`,
                proposedDefault: null,
                options: [],
                project,
                workflow: null,
                by: role,
                code: input.code,
                waiters: [],
            }).ticket.id,
    }
}

/**
 * `starci app release`: run the app's release gates and write the L4 record and tag, or push branch and tag atomically; @starci/hfs
 * runs it in-process in the app. Before it forwards, an executed gate or push is judged installable (`judgePush`), and an executed
 * back-fill gets the host ticket queue of its project.
 */
export const appReleaseVerb = defineVerb({
    path: ["app", "release"],
    summary: "run the app's release gates and write the L4 record and tag (or back-fill an urgent release), or push branch and tag atomically (or the urgent path)",
    editions: BOTH_EDITIONS,
    effect: "remote",
    roles: ["owner", "release", "supervisor"],
    schema: "starci/app-release@1",
    forward: true,
    flags: FORWARDED,
    run: async (context, flags) => {
        const execute = argSet(flags.args, "execute")
        // An executed gate or push ships the app: its @starci pins must be installable and no local copy may run ahead of npm.
        if (execute) await judgePush(await repositoryRoot(context.cwd))
        const project = argValue(flags.args, "backfill") !== undefined && execute ? await projectFrom(context, undefined) : undefined
        return runHfs(context, "release", flags.args, true, undefined, releaseHarness(project))
    },
})
