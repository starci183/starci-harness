/** Offset Pop inherits the Common component checks from the exact matching Grammar lint release. */
export {
  default,
  rules,
  recommended,
  ruleOwners,
  lawOwners,
  ruleDeclarations,
  why,
} from "@starci/eslint-grammar-core"
export { offsetPopGrammarConfig } from "./config.ts"
// Offset Pop runs the Common rules of the matching Grammar lint release, so it reads the disk exactly where that release declares it does.
export { crossFileInputs } from "@starci/eslint-grammar-core"
export type { CrossFileInput } from "@starci/eslint-grammar-core"
