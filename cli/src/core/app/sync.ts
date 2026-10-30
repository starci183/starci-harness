import { BOTH_EDITIONS, defineVerb, WRITERS } from "../../shared/verb.js"
import { FORWARDED, runHfs } from "./hfs.js"

/** `starci app sync`: compare (--check) or write (--write) every managed app file from its canonical template; @starci/hfs runs it in-process in the app. */
export const appSyncVerb = defineVerb({
    path: ["app", "sync"],
    summary: "compare (--check) or write (--write) every managed app file from its canonical template",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/app-sync@1",
    forward: true,
    flags: FORWARDED,
    run: (context, flags) => runHfs(context, "sync", flags.args, false),
})
