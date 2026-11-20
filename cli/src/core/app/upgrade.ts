import { defineVerb, WRITERS } from "../../shared/verb.js"
import { FORWARDED, runHfs } from "./hfs.js"

/** `starci app upgrade`: add the test world an app lacks; @starci/hfs runs it in-process in the app. */
export const appUpgradeVerb = defineVerb({
    path: ["app", "upgrade"],
    summary: "add the test world an app lacks (on request; R12)",
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/app-upgrade@1",
    forward: true,
    flags: FORWARDED,
    run: (context, flags) => runHfs(context, "upgrade", flags.args, false),
})
