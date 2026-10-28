import { z } from "zod"
import { repositoryRoot } from "../../shared/git.js"
import { judgePush } from "../deps/push-gate.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import type { FlagSpec } from "../../shared/verb.js"
import { hfsArgv, QUIET_FLAG, runHfs } from "./hfs.js"

const FLAGS = {
    action: { kind: "string", summary: "gate or push", required: true, positional: true },
    execute: { kind: "boolean", summary: "run the gates and write the record and tag (gate) or push for real (push); without it both are dry runs" },
    source: { kind: "string", summary: "gate: ref that must equal HEAD (default HEAD)" },
    "tag-prefix": { kind: "string", summary: "gate: release tag prefix (default from release.tagPrefix, v)" },
    sonar: { kind: "boolean", summary: "gate: append a local Sonar scan using services.sonar host and the token environment variable named by ci.token (default SONAR_TOKEN)" },
    remote: { kind: "string", summary: "push: remote name (default origin)" },
    ...QUIET_FLAG,
} as const satisfies Readonly<Record<string, FlagSpec>>

const CHOICES = {
    action: z.enum(["gate", "push"]),
} as const

/** `starci app release`: run the app's release gates and write the L4 record and tag, or push branch and tag atomically; @starci/hfs runs it in-process in the app. */
export const appReleaseVerb = defineVerb({
    path: ["app", "release"],
    summary: "run the app's release gates and write the L4 record and tag, or push branch and tag atomically",
    editions: BOTH_EDITIONS,
    effect: "remote",
    roles: ["owner", "release", "supervisor"],
    schema: "starci/app-release@1",
    flags: FLAGS,
    run: async (context, flags) => {
        // An executed gate or push ships the app: its @starci pins must be installable and no local copy may run ahead of npm.
        if (flags.execute) await judgePush(await repositoryRoot(context.cwd))
        return runHfs(context, "release", hfsArgv(FLAGS, flags, CHOICES), true)
    },
})
