import { coreGrammarConfig, coreGrammarPackagesConfig } from "@starci/eslint-grammar-core"

/**
 * Attach the inherited Common API laws for a front end selecting Offset Pop.
 *
 * @param input - The front-end HFS view from the universal canon's loadHfs.
 * @returns Family rules at error under the shared starci-grammar namespace.
 */
export const offsetPopGrammarConfig = ({ hfs }: { hfs: Parameters<typeof coreGrammarConfig>[0]["hfs"] }): ReturnType<typeof coreGrammarConfig> => coreGrammarConfig({ hfs, family: "offset-pop" })

/**
 * The same family rules for the front-end subpaths of an app's root workspace packages (`packages/<pkg>/src/workbench/**` and `src/public/**`).
 *
 * @param input - The package view of the app root from the universal canon's loadPackagesHfs.
 * @returns Family rules at error under the shared starci-grammar namespace, over the package subpaths.
 */
export const offsetPopGrammarPackagesConfig = ({ hfs }: { hfs: Parameters<typeof coreGrammarConfig>[0]["hfs"] }): ReturnType<typeof coreGrammarConfig> => coreGrammarPackagesConfig({ hfs, family: "offset-pop" })
