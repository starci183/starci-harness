/**
 * The grammar token vocabulary as the rules use it. `vocabulary.generated.ts` is read from the grammar
 * package's CSS (`extract-vocabulary.ts`); a family prefix admits every token under it.
 */
import { DECLARED, VENDOR } from "./vocabulary.generated.ts"
import { FAMILY_PREFIXES } from "./extract-vocabulary.ts"

export { FAMILY_PREFIXES }

const NAMES = new Set([...DECLARED, ...VENDOR])

/** True for a custom property the grammar publishes: a listed name or anything under a family prefix. */
export const isGrammarToken = (name: string): boolean => NAMES.has(name) || FAMILY_PREFIXES.some((prefix) => name.startsWith(prefix))

/** True for a grammar token or an app token the repository declared to the factory. */
export const isKnownToken = (name: string, appTokens: readonly string[] = []): boolean => isGrammarToken(name) || appTokens.includes(name)
