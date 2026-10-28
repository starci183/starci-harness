import { z } from "zod"
import { openTicket } from "../../harness/tickets.js"
import type { Project } from "../../harness/work.js"
import { repositoryRoot } from "../../shared/git.js"
import { callerRole } from "../../shared/role.js"
import { judgePush } from "../deps/push-gate.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import type { FlagSpec } from "../../shared/verb.js"
import { projectFrom } from "../supervisor/driver.js"
import { hfsArgv, QUIET_FLAG, runHfs } from "./hfs.js"
import type { HfsHarness } from "./hfs.js"

const FLAGS = {
    action: { kind: "string", summary: "gate or push", required: true, positional: true },
    execute: { kind: "boolean", summary: "run the gates and write the record and tag (gate) or push for real (push); without it both are dry runs" },
    source: { kind: "string", summary: "gate: ref that must equal HEAD (default HEAD)" },
    "tag-prefix": { kind: "string", summary: "gate: release tag prefix (default from release.tagPrefix, v)" },
    sonar: { kind: "boolean", summary: "gate: append a local Sonar scan using services.sonar host and the token environment variable named by ci.token (default SONAR_TOKEN)" },
    backfill: { kind: "string", summary: "gate: the tag of an urgent release, checked out at HEAD: the full gate judges it; green promotes its urgent record to L4, red opens a verify ticket" },
    remote: { kind: "string", summary: "push: remote name (default origin)" },
    urgent: { kind: "boolean", summary: "push: the urgent path (owner ruling 2026-10-29): the fast local checks only, then tag, push and the URGENT record; needs --reason" },
    reason: { kind: "string", summary: "push --urgent: why the release cannot wait for CI and the full gate, one line the urgent record keeps" },
    ...QUIET_FLAG,
} as const satisfies Readonly<Record<string, FlagSpec>>

const CHOICES = {
    action: z.enum(["gate", "push"]),
} as const

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

/** `starci app release`: run the app's release gates and write the L4 record and tag, or push branch and tag atomically; @starci/hfs runs it in-process in the app. */
export const appReleaseVerb = defineVerb({
    path: ["app", "release"],
    summary: "run the app's release gates and write the L4 record and tag (or back-fill an urgent release), or push branch and tag atomically (or the urgent path)",
    editions: BOTH_EDITIONS,
    effect: "remote",
    roles: ["owner", "release", "supervisor"],
    schema: "starci/app-release@1",
    flags: FLAGS,
    run: async (context, flags) => {
        // An executed gate or push ships the app: its @starci pins must be installable and no local copy may run ahead of npm.
        if (flags.execute) await judgePush(await repositoryRoot(context.cwd))
        const project = flags.backfill !== undefined && flags.execute ? await projectFrom(context, undefined) : undefined
        return runHfs(context, "release", hfsArgv(FLAGS, flags, CHOICES), true, undefined, releaseHarness(project))
    },
})
