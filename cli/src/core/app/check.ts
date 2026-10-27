import { BOTH_EDITIONS, defineVerb, EVERYONE } from "../../shared/verb.js"
import type { FlagSpec } from "../../shared/verb.js"
import { EDITION, EDITION_FLAG, hfsArgv, QUIET_FLAG, runHfs } from "./hfs.js"

const FLAGS = {
    fast: { kind: "boolean", summary: "judge only paths changed since the merge base" },
    base: { kind: "string", summary: "merge-base ref used by --fast (refused without it)" },
    wiring: { kind: "boolean", summary: "compile the lite back-end module graph with test doubles" },
    "coverage-from": { kind: "string", summary: "judge measured logic-file coverage from an LCOV report" },
    ...EDITION_FLAG,
    ...QUIET_FLAG,
} as const satisfies Readonly<Record<string, FlagSpec>>

const CHOICES = {
    edition: EDITION,
} as const

/** `starci app check`: run the app ESLint canons and judge the tree, managed output, contracts, formatting and architecture; @starci/hfs runs it in-process in the app. */
export const appCheckVerb = defineVerb({
    path: ["app", "check"],
    summary: "run the app ESLint canons and judge the tree, managed output, contracts, formatting and architecture",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/app-check@1",
    flags: FLAGS,
    run: (context, flags) => runHfs(context, "check", hfsArgv(FLAGS, flags, CHOICES), true),
})
