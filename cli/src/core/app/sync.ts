import { BOTH_EDITIONS, defineVerb, WRITERS } from "../../shared/verb.js"
import { FORWARDED, runHfs } from "./hfs.js"

/** `starci app sync`: compare every managed app file (and the Sonar block) with its canonical template, writing them under --execute; @starci/hfs runs it in-process in the app. */
export const appSyncVerb = defineVerb({
    path: ["app", "sync"],
    summary: "compare every managed app file and the Sonar block with their canonical template (exit 1 on drift); --execute writes them",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/app-sync@1",
    forward: true,
    flags: FORWARDED,
    run: (context, flags) => runHfs(context, "sync", flags.args, false),
})
