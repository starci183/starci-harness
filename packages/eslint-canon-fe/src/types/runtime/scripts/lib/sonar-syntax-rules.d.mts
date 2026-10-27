// The types of runtime/scripts/lib/sonar-syntax-rules.mjs.
import type { TSESLint } from "@typescript-eslint/utils"

/** The flat-config globs of the files the example scans leave out (unit and end-to-end specs). */
export declare const OUTSIDE_THE_SCAN_FILES: readonly string[]

/** The rules both canons publish, by published name. */
export declare const SONAR_SYNTAX_RULES: Readonly<Record<string, TSESLint.RuleModule<string, readonly unknown[]>>>
