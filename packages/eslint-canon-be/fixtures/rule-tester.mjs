/**
 * ESLint's RuleTester as the canon specs drive it. A canon rule is typed against typescript-eslint's rule context (the parser
 * every canon lints with), while ESLint's own RuleTester declares ESLint's context; at run time the two are one object. This is
 * the one place a spec builds an untyped-parser RuleTester, so ./rule-tester.d.mts states that contract once.
 */
import { RuleTester } from "eslint"

/** A RuleTester over `config` (languageOptions, settings), as `new RuleTester(config)` builds it. */
export const canonRuleTester = (config) => new RuleTester(config)

/** The rule a gathered map publishes under `name`; a spec naming a rule the map lacks fails here, before the tester runs. */
export const ruleNamed = (rules, name) => {
    const rule = rules[name]
    if (!rule) throw new Error(`no rule named ${name}`)
    return rule
}
