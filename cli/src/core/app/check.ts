import { BOTH_EDITIONS, defineVerb, EVERYONE } from "../../shared/verb.js"
import { FORWARDED, runHfs } from "./hfs.js"

/** `starci app check`: run the app ESLint canons and judge the tree, managed output, contracts, formatting and architecture, or with --staged the pre-commit guard; @starci/hfs runs it in-process in the app. */
export const appCheckVerb = defineVerb({
    path: ["app", "check"],
    summary: "run the app ESLint canons and judge the tree, managed output, contracts, formatting and architecture; --staged is the pre-commit guard",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/app-check@1",
    forward: true,
    flags: FORWARDED,
    run: (context, flags) => runHfs(context, "check", flags.args, true),
})
