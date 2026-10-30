import { BOTH_EDITIONS, defineVerb, WRITERS } from "../../shared/verb.js"
import { FORWARDED, runHfs } from "./hfs.js"

/** `starci app coverage`: merge the sharded unit coverage into one lcov report, or prove that report at 100 per file; @starci/hfs runs it in-process in the app. */
export const appCoverageVerb = defineVerb({
    path: ["app", "coverage"],
    summary: "merge the sharded unit coverage into one lcov report, or prove that report at 100 per file",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/app-coverage@1",
    forward: true,
    flags: FORWARDED,
    run: (context, flags) => runHfs(context, "coverage", flags.args, false),
})
