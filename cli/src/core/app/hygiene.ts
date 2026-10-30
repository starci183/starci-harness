import { BOTH_EDITIONS, defineVerb, EVERYONE } from "../../shared/verb.js"
import { FORWARDED, runHfs } from "./hfs.js"

/** `starci app hygiene`: judge staged worktree metadata, stack files, plaintext secrets and new logic files without a spec; @starci/hfs runs it in-process in the app. */
export const appHygieneVerb = defineVerb({
    path: ["app", "hygiene"],
    summary: "judge staged worktree metadata, stack files, plaintext secrets and new logic files without a spec",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/app-hygiene@1",
    forward: true,
    flags: FORWARDED,
    run: (context, flags) => runHfs(context, "hygiene", flags.args, false),
})
