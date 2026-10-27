import { BOTH_EDITIONS, defineVerb, WRITERS } from "../../shared/verb.js"
import type { FlagSpec } from "../../shared/verb.js"
import { hfsArgv, QUIET_FLAG, runHfs } from "./hfs.js"

const FLAGS = {
    check: { kind: "boolean", summary: "compare managed output without writing" },
    write: { kind: "boolean", summary: "rewrite managed output that drifted" },
    ...QUIET_FLAG,
} as const satisfies Readonly<Record<string, FlagSpec>>

/** `starci app sync`: compare (--check) or write (--write) every managed app file from its canonical template; @starci/hfs runs it in-process in the app. */
export const appSyncVerb = defineVerb({
    path: ["app", "sync"],
    summary: "compare (--check) or write (--write) every managed app file from its canonical template",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/app-sync@1",
    flags: FLAGS,
    run: (context, flags) => runHfs(context, "sync", hfsArgv(FLAGS, flags), false),
})
