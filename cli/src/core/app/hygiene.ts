import { BOTH_EDITIONS, defineVerb, EVERYONE } from "../../shared/verb.js"
import type { FlagSpec } from "../../shared/verb.js"
import { hfsArgv, QUIET_FLAG, runHfs } from "./hfs.js"

const FLAGS = {
    ...QUIET_FLAG,
} as const satisfies Readonly<Record<string, FlagSpec>>

/** `starci app hygiene`: judge staged worktree metadata, stack files, plaintext secrets and new logic files without a spec; @starci/hfs runs it in-process in the app. */
export const appHygieneVerb = defineVerb({
    path: ["app", "hygiene"],
    summary: "judge staged worktree metadata, stack files, plaintext secrets and new logic files without a spec",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/app-hygiene@1",
    flags: FLAGS,
    run: (context, flags) => runHfs(context, "hygiene", hfsArgv(FLAGS, flags), false),
})
