import { BOTH_EDITIONS, defineVerb, WRITERS } from "../../shared/verb.js"
import { FORWARDED, runHfs } from "./hfs.js"

/** `starci app emit`: emit back-end GraphQL, operation and event contract snapshots; @starci/hfs runs it in-process in the app. */
export const appEmitVerb = defineVerb({
    path: ["app", "emit"],
    summary: "emit back-end GraphQL, operation and event contract snapshots",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/app-emit@1",
    forward: true,
    flags: FORWARDED,
    run: (context, flags) => runHfs(context, "emit", flags.args, false),
})
