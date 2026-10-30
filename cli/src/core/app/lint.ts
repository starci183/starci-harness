import { BOTH_EDITIONS, defineVerb, WRITERS } from "../../shared/verb.js"
import { FORWARDED, runHfs } from "./hfs.js"

/** `starci app lint`: lint both app sides and report repository, ESLint and stylelint findings together (--fix writes); @starci/hfs runs it in-process in the app. */
export const appLintVerb = defineVerb({
    path: ["app", "lint"],
    summary: "lint both app sides and report repository, ESLint and stylelint findings together (--fix writes)",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/app-lint@1",
    forward: true,
    flags: FORWARDED,
    run: (context, flags) => runHfs(context, "lint", flags.args, true),
})
