import { BOTH_EDITIONS, defineVerb, WRITERS } from "../../shared/verb.js"
import { FORWARDED, runHfs } from "./hfs.js"

/** `starci app remove`: remove one module package of the app and its registrations; @starci/hfs runs it in-process in the app. */
export const appRemoveVerb = defineVerb({
    path: ["app", "remove"],
    summary: "remove one module package (`module <name>`), its registrations and its entry in the module registry",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/app-remove@1",
    forward: true,
    flags: FORWARDED,
    run: (context, flags) => runHfs(context, "remove", flags.args, false),
})
