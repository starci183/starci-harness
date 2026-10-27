/** The ordered ownership test that governs every Grammar-specific lint rule. */
export const RULE_OWNERSHIP = "knowledge/patterns/fe/index.yaml#FE-RULE-OWNERSHIP"

/** Attach the governing ownership rule and the rule's behavioral source without changing enforcement. */
export const defineFamilyRules = (rules, knowledge) => {
  for (const rule of Object.values(rules)) {
    const source = rule.meta.docs?.url ?? knowledge
    rule.meta.docs = { ...rule.meta.docs, url: source, knowledge: source, ownership: RULE_OWNERSHIP }
  }
  return rules
}
