import { BOTH_EDITIONS, defineVerb, EVERYONE } from "../../shared/verb.js"
import { FORWARDED, runHfs } from "./hfs.js"

/** `starci app explain`: explain which HFS slot owns one app-relative path; @starci/hfs runs it in-process in the app. */
export const appExplainVerb = defineVerb({
    path: ["app", "explain"],
    summary: "explain which HFS slot owns one app-relative path",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/app-explain@1",
    forward: true,
    flags: FORWARDED,
    run: (context, flags) => runHfs(context, "explain", flags.args, true),
})
