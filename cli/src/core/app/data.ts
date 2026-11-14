import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { FORWARDED, runHfs } from "./hfs.js"

/** `starci app data`: read a seed-backup copy (status, verify) and sync a snapshot into the same environment (dry until `--execute`); @starci/hfs runs it in-process in the app. */
export const appDataVerb = defineVerb({
    path: ["app", "data"],
    summary: "status and verify the seed-backup copies of an environment and sync a snapshot into the same environment (dry until --execute, merge mode); refuses another environment's snapshot (DATA_SYNC_OTHER_ENVIRONMENT) and a non-empty target without a young backup (DATA_SYNC_TARGET_UNPROTECTED)",
    editions: BOTH_EDITIONS,
    effect: "remote",
    roles: ["owner", "release", "supervisor"],
    schema: "starci/app-data@1",
    forward: true,
    flags: FORWARDED,
    run: (context, flags) => runHfs(context, "data", flags.args, true),
})
