import { BOTH_EDITIONS, defineVerb, WRITERS } from "../../shared/verb.js"
import { FORWARDED, runHfs } from "./hfs.js"

/** `starci app codemod`: migrate front-end button variants to declared intent and report cases requiring a human decision; @starci/hfs runs it in-process in the app. */
export const appCodemodVerb = defineVerb({
    path: ["app", "codemod"],
    summary: "migrate front-end button variants to declared intent and report cases requiring a human decision",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/app-codemod@1",
    forward: true,
    flags: FORWARDED,
    run: (context, flags) => runHfs(context, "codemod", flags.args, true),
})
