import { BOTH_EDITIONS, defineVerb, WRITERS } from "../../shared/verb.js"
import { FORWARDED, runHfs } from "./hfs.js"

/** `starci app add`: add one canonical back-end capability or front-end unit, service, spec or image and register its patterns; @starci/hfs runs it in-process in the app. */
export const appAddVerb = defineVerb({
    path: ["app", "add"],
    summary: "add one canonical back-end capability or front-end unit, service, spec or image and register its patterns",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/app-add@1",
    forward: true,
    flags: FORWARDED,
    run: (context, flags) => runHfs(context, "add", flags.args, false),
})
