import { coreGrammarConfig } from "@starci/eslint-grammar-core"

/**
 * Attach the inherited Common API laws for a front end selecting Offset Pop.
 *
 * @param {{ hfs: object }} input - The front-end HFS view from the universal canon's loadHfs.
 * @returns {Array<object>} Family rules at error under the shared starci-grammar namespace.
 */
export const offsetPopGrammarConfig = ({ hfs }) => coreGrammarConfig({ hfs, family: "offset-pop" })
