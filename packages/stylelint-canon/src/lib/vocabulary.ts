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

/** True for a token the app's theme layer may set: HeroUI's whole token list and the grammar's published names, plus the `--info*` family (HeroUI declares `--font-sans` and `--font-mono`, which NAMES holds; any other `--font-*` is the app's own type and stays foreign); never a family-prefixed private token. */
export const isThemeToken = (name: string): boolean => NAMES.has(name) || /^--info(?:-[\w-]+)?$/.test(name)
