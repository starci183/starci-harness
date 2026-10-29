import { z } from "zod"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import type { FlagSpec } from "../../shared/verb.js"
import { hfsArgv, QUIET_FLAG, runHfs } from "./hfs.js"

const FLAGS = {
    action: { kind: "string", summary: "secret, var, verify or local", required: true, positional: true },
    operation: { kind: "string", summary: "secret or var: set or sync", positional: true },
    name: { kind: "string", summary: "secret or var set: the secret or variable name", positional: true },
    env: { kind: "string", summary: "select the declared GitHub environment" },
    dependabot: { kind: "boolean", summary: "select the Dependabot secret store" },
    repo: { kind: "string", summary: "override the app repository with owner/name" },
    value: { kind: "string", summary: "public variable value that must agree with the manifest; var set ownerValue requires stdin instead" },
    execute: { kind: "boolean", summary: "apply the variable sync plan; var sync skips ownerValue variables" },
    jobs: { kind: "string", summary: "local: the jobs to run, comma separated (default fast,lint,test,coverage,build; sonar only when named)" },
    parallel: { kind: "string", summary: "local: job instances run at once (default half the CPUs, at most 4)" },
    logs: { kind: "string", summary: "local: the directory the job logs go to (default a new temp directory)" },
    "dry-run": { kind: "boolean", summary: "local: print which steps would run and which only GitHub can run" },
    ...QUIET_FLAG,
} as const satisfies Readonly<Record<string, FlagSpec>>

const CHOICES = {
    action: z.enum(["secret", "var", "verify", "local"]),
    operation: z.enum(["set", "sync"]),
} as const

/** `starci app ci`: set declared GitHub CI secrets and variables, verify their custody, or run the managed CI locally; @starci/hfs runs it in-process in the app. */
export const appCiVerb = defineVerb({
    path: ["app", "ci"],
    summary: "set declared GitHub CI secrets and variables, verify their custody, or run the managed CI locally",
    editions: BOTH_EDITIONS,
    effect: "remote",
    roles: ["owner", "supervisor"],
    schema: "starci/app-ci@1",
    flags: FLAGS,
    run: (context, flags) => runHfs(context, "ci", hfsArgv(FLAGS, flags, CHOICES), true),
})
