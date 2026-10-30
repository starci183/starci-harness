import { BOTH_EDITIONS, defineVerb, EVERYONE } from "../../shared/verb.js"
import { FORWARDED, runHfs } from "./hfs.js"

/** `starci app slot`: name the HFS slot that owns one app-relative path; @starci/hfs runs it in-process in the app. */
export const appSlotVerb = defineVerb({
    path: ["app", "slot"],
    summary: "name the HFS slot that owns one app-relative path",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/app-slot@1",
    forward: true,
    flags: FORWARDED,
    run: (context, flags) => runHfs(context, "slot", flags.args, true),
})
