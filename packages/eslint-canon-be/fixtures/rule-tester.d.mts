/** The declared contract of ./rule-tester.mjs: ESLint's RuleTester under the canon's rule type. */
import type { Linter } from "eslint"
import type { CanonRule, CanonRuleTester } from "./typed/tester.mjs"

/** A RuleTester over `config`, as `new RuleTester(config)` builds it. */
export declare const canonRuleTester: (config?: Linter.Config) => CanonRuleTester

/** The rule a gathered map publishes under `name` (throws when the map lacks it). */
export declare const ruleNamed: (rules: Readonly<Record<string, CanonRule | undefined>>, name: string) => CanonRule
