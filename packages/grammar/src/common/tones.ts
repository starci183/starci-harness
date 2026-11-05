import type { CSSProperties } from "react"
import type { GrammarToneRegistry } from "./tone-registry.js"

/**
 * App-added tones (owner ruling `grammar-own-style`: Core keeps HeroUI's palette as its built-in tones, an app may ADD its own).
 *
 * An app names an extra tone and supplies its four tokens, with no default from the Grammar:
 *
 *   CSS    `--<tone>`, `--<tone>-foreground`, `--<tone>-soft`, `--<tone>-soft-foreground` in its theme
 *   types  `declare module "@starci/grammar/common" { interface GrammarToneRegistry { info: true } }`
 *
 * `tone="info"` then type-checks only where it is declared. The registry is empty here, so `CustomTone` is `never` until an app augments it.
 */

/** The tones an app declared, by name. `never` in an app that declares none. */
export type CustomTone = Extract<keyof GrammarToneRegistry, string>

const TONE_NAME = /^[a-z][a-z0-9-]*$/

/** The four tokens a declared tone must provide, in the order the component variables carry them. */
export const TONE_TOKEN_SUFFIXES = ["", "-foreground", "-soft", "-soft-foreground"] as const

/** The component-level variables a custom tone paints through (one generic rule per component reads these four). */
export const TONE_VARIABLES = ["--grammar-tone", "--grammar-tone-foreground", "--grammar-tone-soft", "--grammar-tone-soft-foreground"] as const

/** True when `tone` is not one of the component's built-in tones: it is an app-declared one. */
export const isCustomTone = (tone: string, builtIn: readonly string[]): boolean => !builtIn.includes(tone)

/**
 * The attributes a component spreads on its root for an app-declared tone: the stamp and the four variables read from the app's tokens.
 * A name that is not a lower-case token name throws (it would build an invalid `var()`).
 */
export const customToneProps = (tone: string): { readonly "data-grammar-tone-custom": "true"; readonly "data-grammar-tone-name": string; readonly style: CSSProperties } => {
    if (!TONE_NAME.test(tone)) throw new Error(`GRAMMAR_TONE_NAME_INVALID: "${tone}" is not a lower-case tone name`)
    const style: Record<string, string> = {}
    TONE_VARIABLES.forEach((variable, index) => { style[variable] = `var(--${tone}${TONE_TOKEN_SUFFIXES[index] ?? ""})` })
    return { "data-grammar-tone-custom": "true", "data-grammar-tone-name": tone, style: style as CSSProperties }
}

/**
 * Development only (never in production): a declared tone whose tokens are missing from the theme throws, naming the tone and the token. A
 * variable that reads an undefined token computes to the empty string, which is how the gap shows.
 */
export const assertToneDeclared = (element: Element | null, tone: string): void => {
    if (process.env.NODE_ENV === "production" || element === null || typeof getComputedStyle === "undefined") return
    const computed = getComputedStyle(element)
    TONE_VARIABLES.forEach((variable, index) => {
        if (computed.getPropertyValue(variable).trim() === "") {
            throw new Error(`GRAMMAR_TONE_TOKEN_MISSING: tone "${tone}" is declared but the theme does not define --${tone}${TONE_TOKEN_SUFFIXES[index] ?? ""}`)
        }
    })
}
