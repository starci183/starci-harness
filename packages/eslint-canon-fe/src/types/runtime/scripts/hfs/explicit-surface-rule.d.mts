// The types of runtime/scripts/hfs/explicit-surface-rule.mjs.
import type { TSESLint } from "@typescript-eslint/utils"
import type ts from "typescript"

/** The rule reporting each export of a TypeScript source whose type the isolated declaration emit cannot write explicitly. */
export declare const explicitSurfaceRule: (input: { readonly ts: typeof ts }) => TSESLint.RuleModule<"inferred", readonly unknown[]>
