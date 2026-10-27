import { z } from "zod"
import { BOTH_EDITIONS, defineVerb, WRITERS } from "../../shared/verb.js"
import type { FlagSpec } from "../../shared/verb.js"
import { hfsArgv, QUIET_FLAG, runHfs } from "./hfs.js"

const FLAGS = {
    changed: { kind: "list", summary: "an app-relative file to judge, once per file (not with --workspace)" },
    workspace: { kind: "string", summary: "one front-end workspace to judge" },
    side: { kind: "string", summary: "judge one side, be or fe (root findings belong to be; not with --sonar)" },
    fix: { kind: "boolean", summary: "let ESLint and stylelint apply safe fixes" },
    format: { kind: "string", summary: "report format: text or json (default text)" },
    sonar: { kind: "string", summary: "write the Sonar Generic Issue Import report" },
    ...QUIET_FLAG,
} as const satisfies Readonly<Record<string, FlagSpec>>

const CHOICES = {
    side: z.enum(["be", "fe"]),
    format: z.enum(["text", "json"]),
} as const

/** `starci app lint`: lint both app sides and report repository, ESLint and stylelint findings together (--fix writes); @starci/hfs runs it in-process in the app. */
export const appLintVerb = defineVerb({
    path: ["app", "lint"],
    summary: "lint both app sides and report repository, ESLint and stylelint findings together (--fix writes)",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/app-lint@1",
    flags: FLAGS,
    run: (context, flags) => runHfs(context, "lint", hfsArgv(FLAGS, flags, CHOICES), true),
})
