import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { FORWARDED, runHfs } from "./hfs.js"

/** `starci app ci`: set declared GitHub CI secrets and variables, verify their custody, or run the managed CI locally; @starci/hfs runs it in-process in the app. */
export const appCiVerb = defineVerb({
    path: ["app", "ci"],
    summary: "set declared GitHub CI secrets and variables, verify their custody, or run the managed CI locally",
    editions: BOTH_EDITIONS,
    effect: "remote",
    roles: ["owner", "supervisor"],
    schema: "starci/app-ci@1",
    forward: true,
    flags: FORWARDED,
    run: (context, flags) => runHfs(context, "ci", flags.args, true),
})
