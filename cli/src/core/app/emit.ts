import { BOTH_EDITIONS, defineVerb, WRITERS } from "../../shared/verb.js"
import type { FlagSpec } from "../../shared/verb.js"
import { hfsArgv, QUIET_FLAG, runHfs } from "./hfs.js"

const FLAGS = {
    ...QUIET_FLAG,
} as const satisfies Readonly<Record<string, FlagSpec>>

/** `starci app emit`: emit back-end GraphQL, operation and event contract snapshots; @starci/hfs runs it in-process in the app. */
export const appEmitVerb = defineVerb({
    path: ["app", "emit"],
    summary: "emit back-end GraphQL, operation and event contract snapshots",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/app-emit@1",
    flags: FLAGS,
    run: (context, flags) => runHfs(context, "emit", hfsArgv(FLAGS, flags), false),
})
