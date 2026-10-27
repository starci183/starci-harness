import { z } from "zod"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import type { FlagSpec } from "../../shared/verb.js"
import { hfsArgv, QUIET_FLAG, runHfs } from "./hfs.js"

const FLAGS = {
    action: { kind: "string", summary: "baseline, restamp, plan, migrate, post-cutover, dump or reset", required: true, positional: true },
    out: { kind: "string", summary: "dump: destination outside the app and every Git worktree" },
    "schema-only": { kind: "boolean", summary: "dump: omit data parts; this backup cannot authorize reset" },
    auth: { kind: "string", summary: "reset: required keep or drop; drop deletes users and identities" },
    storage: { kind: "string", summary: "reset: required keep or drop; drop empties objects metadata but does not delete backend files" },
    backup: { kind: "string", summary: "reset: existing full encrypted backup receipt for this project, younger than database.reset.backupMaxAgeHours (default 24)" },
    stamp: { kind: "string", summary: "fourteen-digit timestamp of the new baseline migration" },
    map: { kind: "string", summary: "explicit old-to-new migration stamp map for restamp" },
    apply: { kind: "boolean", summary: "apply baseline or restamp mutations after validation" },
    local: { kind: "boolean", summary: "inspect local state; migrate applies only pending active SQL against the app's existing local stack" },
    execute: { kind: "boolean", summary: "migrate, post-cutover, reset: apply the plan (also needs STARCI_DB_ARMED=1); otherwise read-only" },
    linked: { kind: "boolean", summary: "use the linked project; required explicitly for reset and one of the dump target choices" },
    "url-env": { kind: "string", summary: "migrate, post-cutover, dump: environment variable holding the connection string" },
    "target-binding": { kind: "string", summary: "migrate: public native endpoint assertion; constrains the target and grants no authority" },
    "green-at": { kind: "string", summary: "post-cutover: ISO time of the last green smoke; must be at least database.postCutover.minAgeHours (48) old" },
    "owner-confirms-old-app-gone": { kind: "boolean", summary: "post-cutover: the owner confirms the old app is gone (opens the time gate)" },
    ...QUIET_FLAG,
} as const satisfies Readonly<Record<string, FlagSpec>>

const CHOICES = {
    action: z.enum(["baseline", "restamp", "plan", "migrate", "post-cutover", "dump", "reset"]),
} as const

/** `starci app db`: preview or apply database migrations, encrypted backups and guarded linked resets; @starci/hfs runs it in-process in the app. */
export const appDbVerb = defineVerb({
    path: ["app", "db"],
    summary: "preview or apply database migrations, encrypted backups and guarded linked resets",
    editions: BOTH_EDITIONS,
    effect: "remote",
    roles: ["owner", "release", "supervisor"],
    schema: "starci/app-db@1",
    flags: FLAGS,
    run: (context, flags) => runHfs(context, "db", hfsArgv(FLAGS, flags, CHOICES), true),
})
