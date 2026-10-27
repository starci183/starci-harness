import { coreGrammarConfig } from "@starci/eslint-grammar-core"

/**
 * Attach the inherited Common API laws for a front end selecting Offset Pop.
 *
 * @param input - The front-end HFS view from the universal canon's loadHfs.
 * @returns Family rules at error under the shared starci-grammar namespace.
 */
export const offsetPopGrammarConfig = ({ hfs }: { hfs: Parameters<typeof coreGrammarConfig>[0]["hfs"] }): ReturnType<typeof coreGrammarConfig> => coreGrammarConfig({ hfs, family: "offset-pop" })
