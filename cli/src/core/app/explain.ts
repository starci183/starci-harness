import { BOTH_EDITIONS, defineVerb, EVERYONE } from "../../shared/verb.js"
import type { FlagSpec } from "../../shared/verb.js"
import { hfsArgv, QUIET_FLAG, runHfs } from "./hfs.js"

const FLAGS = {
    path: { kind: "string", summary: "the app-relative path", required: true, positional: true },
    ...QUIET_FLAG,
} as const satisfies Readonly<Record<string, FlagSpec>>

/** `starci app explain`: explain which HFS slot owns one app-relative path; @starci/hfs runs it in-process in the app. */
export const appExplainVerb = defineVerb({
    path: ["app", "explain"],
    summary: "explain which HFS slot owns one app-relative path",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/app-explain@1",
    flags: FLAGS,
    run: (context, flags) => runHfs(context, "explain", hfsArgv(FLAGS, flags), true),
})
