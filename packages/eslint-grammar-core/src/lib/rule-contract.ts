import type { Rule } from "eslint"
import type { Context, RuleDefinition } from "./types.ts"

/** The ordered ownership test that governs every Grammar-specific lint rule. */
export const RULE_OWNERSHIP = "knowledge/patterns/fe/index.yaml#FE-RULE-OWNERSHIP"

/**
 * A rule written against the typescript-eslint tree, as the ESLint rule module that publishes it. Every rule of this
 * package is linted by `@typescript-eslint/parser` (`coreGrammarConfig` sets it), so the context it receives and the
 * visitor it returns carry that parser's node types; this is the one place that states so to ESLint's declarations.
 */
export const defineRule = (definition: RuleDefinition): Rule.RuleModule => ({
  meta: definition.meta,
  create: (context) => definition.create(context as Context) as Rule.RuleListener,
})

/** Attach the governing ownership rule and the rule's behavioral source without changing enforcement. */
export const defineFamilyRules = (rules: Readonly<Record<string, Rule.RuleModule>>, knowledge: string): Readonly<Record<string, Rule.RuleModule>> => {
  for (const rule of Object.values(rules)) {
    const meta = rule.meta
    if (meta === undefined) throw new Error("A family rule declares its meta")
    const source = meta.docs?.url ?? knowledge
    const docs = { ...meta.docs, url: source, knowledge: source, ownership: RULE_OWNERSHIP }
    meta.docs = docs
  }
  return rules
}
