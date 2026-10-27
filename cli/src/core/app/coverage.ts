import { z } from "zod"
import { BOTH_EDITIONS, defineVerb, WRITERS } from "../../shared/verb.js"
import type { FlagSpec } from "../../shared/verb.js"
import { hfsArgv, QUIET_FLAG, runHfs } from "./hfs.js"

const FLAGS = {
    action: { kind: "string", summary: "merge or verify", required: true, positional: true },
    paths: { kind: "rest", summary: "merge: coverage-final.json files or folders holding them; verify: the lcov.info to prove", required: true },
    out: { kind: "string", summary: "the merged lcov.info to write (the managed CI writes be/coverage/lcov.info)" },
    ...QUIET_FLAG,
} as const satisfies Readonly<Record<string, FlagSpec>>

const CHOICES = {
    action: z.enum(["merge", "verify"]),
} as const

/** `starci app coverage`: merge the sharded unit coverage into one lcov report, or prove that report at 100 per file; @starci/hfs runs it in-process in the app. */
export const appCoverageVerb = defineVerb({
    path: ["app", "coverage"],
    summary: "merge the sharded unit coverage into one lcov report, or prove that report at 100 per file",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/app-coverage@1",
    flags: FLAGS,
    run: (context, flags) => runHfs(context, "coverage", hfsArgv(FLAGS, flags, CHOICES), false),
})
