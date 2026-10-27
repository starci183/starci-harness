import { z } from "zod"
import { BOTH_EDITIONS, defineVerb, WRITERS } from "../../shared/verb.js"
import type { FlagSpec } from "../../shared/verb.js"
import { hfsArgv, QUIET_FLAG, runHfs } from "./hfs.js"

const FLAGS = {
    migration: { kind: "string", summary: "the migration: button-intent", required: true, positional: true },
    write: { kind: "boolean", summary: "apply safe source edits; otherwise preview without changing source" },
    format: { kind: "string", summary: "migration report format: json or markdown (default markdown)" },
    report: { kind: "string", summary: "also save the complete report to a .json or .md file" },
    ...QUIET_FLAG,
} as const satisfies Readonly<Record<string, FlagSpec>>

const CHOICES = {
    migration: z.enum(["button-intent"]),
    format: z.enum(["json", "markdown"]),
} as const

/** `starci app codemod`: migrate front-end button variants to declared intent and report cases requiring a human decision; @starci/hfs runs it in-process in the app. */
export const appCodemodVerb = defineVerb({
    path: ["app", "codemod"],
    summary: "migrate front-end button variants to declared intent and report cases requiring a human decision",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/app-codemod@1",
    flags: FLAGS,
    run: (context, flags) => runHfs(context, "codemod", hfsArgv(FLAGS, flags, CHOICES), true),
})
