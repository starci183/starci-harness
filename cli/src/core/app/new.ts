import { BOTH_EDITIONS, defineVerb, WRITERS } from "../../shared/verb.js"
import { FORWARDED, runHfs } from "./hfs.js"

/** `starci app new`: create a canonical service, unit spec or app image definition; @starci/hfs runs it in-process in the app. */
export const appNewVerb = defineVerb({
    path: ["app", "new"],
    summary: "create a canonical service, unit spec or app image definition",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/app-new@1",
    forward: true,
    flags: FORWARDED,
    run: (context, flags) => runHfs(context, "new", flags.args, false),
})
