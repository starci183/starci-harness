import { openTicket } from "../../harness/tickets.js"
import type { Project } from "../../harness/work.js"
import { repositoryRoot } from "../../shared/git.js"
import { assertRole, callerRole } from "../../shared/role.js"
import { judgePush } from "../deps/push-gate.js"
import { defineVerb } from "../../shared/verb.js"
import { projectFrom } from "../supervisor/driver.js"
import { argSet, argValue, FORWARDED, runHfs } from "./hfs.js"
import type { HfsHarness, HfsRunData } from "./hfs.js"
import type { AnyVerb, VerbContext, VerbResult } from "../../shared/verb.js"

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
                tried: `starci app check --release --backfill ${input.tag} --execute ran the full release check on ${input.head.slice(0, 12)}`,
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
 * Runs `verb` (`check` with `--release`, or the deprecated `release gate`) of @starci/hfs for a release: an executed check or push is judged
 * installable first (`judgePush`: its @starci pins must be installable and no local copy may run ahead of npm), and an executed back-fill gets the host
 * ticket queue of its project.
 */
export const runRelease = async (context: VerbContext, verb: "check" | "release", args: readonly string[]): Promise<VerbResult<HfsRunData>> => {
    // `app check` is open to every writer; its --release form tags a release, so it holds the roles of `app release`.
    if (verb === "check") assertRole({ ...appReleaseVerb, path: ["app", "check"] } as unknown as AnyVerb)
    const execute = argSet(args, "execute")
    if (execute) await judgePush(await repositoryRoot(context.cwd))
    const project = argValue(args, "backfill") !== undefined && execute ? await projectFrom(context, undefined) : undefined
    return runHfs(context, verb, args, true, undefined, releaseHarness(project))
}

/**
 * `starci app release`: push branch and tag atomically (or the urgent path); @starci/hfs runs it in-process in the app. `release gate` is the
 * deprecated spelling of `starci app check --release` (@starci/hfs prints the rename and runs the same check).
 */
export const appReleaseVerb = defineVerb({
    path: ["app", "release"],
    summary: "push branch and tag atomically (or the urgent path); `release gate` is renamed `starci app check --release` and still runs it after printing the rename",
    effect: "remote",
    roles: ["owner", "release", "supervisor"],
    schema: "starci/app-release@1",
    forward: true,
    flags: FORWARDED,
    run: async (context, flags) => runRelease(context, "release", flags.args),
})
