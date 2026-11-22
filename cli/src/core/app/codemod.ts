import { defineVerb, WRITERS } from "../../shared/verb.js"
import { FORWARDED, runHfs } from "./hfs.js"

/**
 * `starci app codemod`: the app's migrations, run in-process in the app by @starci/hfs. A Grammar codemod is named after the Grammar
 * version that needs it (`v0540` for 0.54.0) and loaded from the Grammar the app installed: `starci app codemod --list`, `starci app
 * codemod v0540 [--execute]`, `starci app codemod --from <installed> --to <target> [--execute]`; the harness's own migrations keep their
 * names (`spacing-roles`, `theme-tokens`, ...). Dry until --execute; a case left for a person is marked and listed.
 */
export const appCodemodVerb = defineVerb({
    path: ["app", "codemod"],
    summary: "run an app migration: a Grammar codemod by version (v0540; --list; --from <installed> --to <target> runs every one between) or a harness codemod by name; dry until --execute, cases left for a person are marked and listed",
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/app-codemod@1",
    forward: true,
    flags: FORWARDED,
    run: (context, flags) => runHfs(context, "codemod", flags.args, true),
})
