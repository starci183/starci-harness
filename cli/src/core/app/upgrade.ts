import { BOTH_EDITIONS, defineVerb, WRITERS } from "../../shared/verb.js"
import { FORWARDED, runHfs } from "./hfs.js"

/** `starci app upgrade`: add the test world a full app lacks; a lite app is refused because editions are fixed at scaffold; @starci/hfs runs it in-process in the app. */
export const appUpgradeVerb = defineVerb({
    path: ["app", "upgrade"],
    summary: "add the test world a full app lacks; a lite app is refused because editions are fixed at scaffold",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/app-upgrade@1",
    forward: true,
    flags: FORWARDED,
    run: (context, flags) => runHfs(context, "upgrade", flags.args, false),
})
