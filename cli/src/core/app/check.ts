import { BOTH_EDITIONS, defineVerb, WRITERS } from "../../shared/verb.js"
import { FORWARDED, runHfs } from "./hfs.js"

/** `starci app check`: run the app ESLint canons and judge the tree, managed output, contracts, formatting and architecture, or with --staged the pre-commit guard; --fix, --out and the result cache write; @starci/hfs runs it in-process in the app. */
export const appCheckVerb = defineVerb({
    path: ["app", "check"],
    summary: "run the app ESLint canons and judge the tree, managed output, contracts, formatting and architecture; --gate selects, --side limits the lint, --fix fixes it, --out writes the Sonar import, --staged is the pre-commit guard",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/app-check@1",
    forward: true,
    flags: FORWARDED,
    run: (context, flags) => runHfs(context, "check", flags.args, true),
})
