import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { FORWARDED, runHfs } from "./hfs.js"

/** `starci app scaffold`: create a full or lite StarCi app in its own Git repository (unborn main); @starci/hfs runs it in-process in the app. */
export const appScaffoldVerb = defineVerb({
    path: ["app", "scaffold"],
    summary: "create a full or lite StarCi app in its own Git repository (unborn main)",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: ["owner", "supervisor"],
    schema: "starci/app-scaffold@1",
    forward: true,
    flags: FORWARDED,
    run: (context, flags) => runHfs(context, "scaffold", flags.args, false),
})
