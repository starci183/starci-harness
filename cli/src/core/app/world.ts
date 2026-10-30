import { BOTH_EDITIONS, defineVerb, WRITERS } from "../../shared/verb.js"
import { FORWARDED, runHfs } from "./hfs.js"

/** `starci app world`: bring the test world of an app up or down and read its status; @starci/hfs runs it in-process in the app. */
export const appWorldVerb = defineVerb({
    path: ["app", "world"],
    summary: "bring the test world of an app up or down and read its status (up, down, status)",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/app-world@1",
    forward: true,
    flags: FORWARDED,
    run: (context, flags) => runHfs(context, "world", flags.args, false),
})
