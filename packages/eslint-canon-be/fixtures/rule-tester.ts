/**
 * ESLint's RuleTester as the canon specs drive it. A canon rule is typed against typescript-eslint's rule context (the parser
 * every canon lints with), while ESLint's own RuleTester declares ESLint's context; at run time the two are one object. This is
 * the one place a spec builds an untyped-parser RuleTester, so the casts below state that contract once.
 */
import { RuleTester, type Linter } from "eslint"
import type { CanonRule, CanonRuleTester } from "./typed/tester.ts"

/** A RuleTester over `config` (languageOptions, settings), as `new RuleTester(config)` builds it. */
export const canonRuleTester = (config?: Linter.Config): CanonRuleTester => new RuleTester(config) as unknown as CanonRuleTester

/** The rule a gathered map publishes under `name`; a spec naming a rule the map lacks fails here, before the tester runs. */
export const ruleNamed = (rules: Readonly<Record<string, CanonRule | undefined>>, name: string): CanonRule => {
    const rule = rules[name]
    if (!rule) throw new Error(`no rule named ${name}`)
    return rule
}
