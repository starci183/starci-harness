// The types of runtime/scripts/lib/jsdoc.mjs.
import type { TSESLint, TSESTree } from "@typescript-eslint/utils"

/** The final adjacent JSDoc block of a declaration when it describes it, else null. */
export declare const jsdocBefore: (sourceCode: Readonly<TSESLint.SourceCode>, node: TSESTree.Node) => TSESTree.Comment | null
