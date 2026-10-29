import { z } from "zod"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import type { FlagSpec } from "../../shared/verb.js"
import { hfsArgv, QUIET_FLAG, runHfs } from "./hfs.js"

const FLAGS = {
    action: { kind: "string", summary: "new, baseline, restamp, plan, migrate, post-cutover, dump or drift", required: true, positional: true },
    name: { kind: "string", summary: "new: the kebab-case name of the migration db/migrations/<ts14>_<name>.sql", positional: true },
    out: { kind: "string", summary: "dump: destination outside the app and every Git worktree" },
    "schema-only": { kind: "boolean", summary: "dump: omit data parts" },
    stamp: { kind: "string", summary: "fourteen-digit timestamp of the new baseline migration" },
    map: { kind: "string", summary: "explicit old-to-new migration stamp map for restamp" },
    apply: { kind: "boolean", summary: "apply baseline or restamp mutations after validation" },
    squash: { kind: "boolean", summary: "baseline: rebuild the active chain from a database it is applied to (--url-env), proven by replay in a scratch container" },
    "drop-extension": { kind: "string", summary: "baseline --squash: comma-separated extensions the target db image lacks, dropped with what reaches them (default: the lite defaults; pgmq stays)" },
    "drop-pgmq-queue": { kind: "string", summary: "baseline --squash: comma-separated named pgmq queues to drop" },
    "seed-tables": { kind: "string", summary: "baseline --squash: comma-separated tables whose reference rows go to db/seed.sql" },
    image: { kind: "string", summary: "baseline --squash: the db image the replay proves against (default: the app's db image)" },
    execute: { kind: "boolean", summary: "migrate, post-cutover: apply the plan (also needs STARCI_DB_ARMED=1 unless the database is on the loopback); otherwise read-only" },
    "url-env": { kind: "string", summary: "the environment variable holding the postgres connection URL of the database (default DATABASE_URL); drift: an empty database to migrate instead of a scratch container of the app db image" },
    "green-at": { kind: "string", summary: "post-cutover: ISO time of the last green smoke; must be at least database.postCutover.minAgeHours (48) old" },
    "owner-confirms-old-app-gone": { kind: "boolean", summary: "post-cutover: the owner confirms the old app is gone (opens the time gate)" },
    ...QUIET_FLAG,
} as const satisfies Readonly<Record<string, FlagSpec>>

const CHOICES = {
    action: z.enum(["new", "baseline", "restamp", "plan", "migrate", "post-cutover", "dump", "drift"]),
} as const

/** `starci app db`: create, preview or apply the migrations of a self-hosted PostgreSQL and take encrypted backups, and check the entities against the migrated schema; @starci/hfs runs it in-process in the app. */
export const appDbVerb = defineVerb({
    path: ["app", "db"],
    summary: "create, preview or apply database migrations and take encrypted backups; drift checks the TypeORM entities against the migrated schema (BE_ENTITY_SCHEMA_DRIFT)",
    editions: BOTH_EDITIONS,
    effect: "remote",
    roles: ["owner", "release", "supervisor"],
    schema: "starci/app-db@1",
    flags: FLAGS,
    run: (context, flags) => runHfs(context, "db", hfsArgv(FLAGS, flags, CHOICES), true),
})
