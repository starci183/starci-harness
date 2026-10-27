import type { coreGrammarConfig } from "@starci/eslint-grammar-core"

export {
  default,
  rules,
  recommended,
  ruleOwners,
  lawOwners,
  ruleDeclarations,
  why,
} from "@starci/eslint-grammar-core"

/** Attach the inherited Common API checks for the selected Offset Pop family. */
export declare function offsetPopGrammarConfig(input: {
  hfs: Parameters<typeof coreGrammarConfig>[0]["hfs"]
}): ReturnType<typeof coreGrammarConfig>
