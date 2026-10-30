import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { FORWARDED, runHfs } from "./hfs.js"

/** `starci app db`: create, preview or apply the migrations of a self-hosted PostgreSQL and take encrypted backups, and check the entities against the migrated schema; @starci/hfs runs it in-process in the app. */
export const appDbVerb = defineVerb({
    path: ["app", "db"],
    summary: "create, preview or apply database migrations and take encrypted backups; drift checks the TypeORM entities against the migrated schema (BE_ENTITY_SCHEMA_DRIFT)",
    editions: BOTH_EDITIONS,
    effect: "remote",
    roles: ["owner", "release", "supervisor"],
    schema: "starci/app-db@1",
    forward: true,
    flags: FORWARDED,
    run: (context, flags) => runHfs(context, "db", flags.args, true),
})
