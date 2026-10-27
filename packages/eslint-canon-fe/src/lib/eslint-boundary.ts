/**
 * Where a canon rule meets ESLint's own types.
 *
 * The canon writes its rules against typescript-eslint's `RuleModule` (lib/rule.ts): its AST carries the JSX and
 * TypeScript nodes the rules read, which ESLint's ESTree types lack. ESLint's `RuleTester`, `Linter` and flat-config types
 * describe the same runtime objects with ESLint's own context and visitor types, and neither declaration is assignable to
 * the other (typescript-eslint's context still declares the scope readers ESLint 9 removed). The objects are identical at
 * run time, so the two views are joined here, in one place, and nowhere else.
 */
import type { ESLint, Rule as EslintRule } from "eslint"
import type { Rule, Rules } from "./rule.ts"

/** A canon rule (or a rule already written at ESLint's type, as the Grammar families write theirs) as ESLint's rule type: the same object. */
export const eslintRule = (rule: Rule<string, readonly unknown[]> | EslintRule.RuleModule): EslintRule.RuleModule =>
  rule as unknown as EslintRule.RuleModule

/** The canon's rules as an ESLint plugin: the same objects, under ESLint's plugin type. */
export const eslintPlugin = (plugin: { readonly meta: { readonly name: string }; readonly rules: Rules }): ESLint.Plugin =>
  plugin as unknown as ESLint.Plugin
