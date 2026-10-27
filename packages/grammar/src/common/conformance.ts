import { CANONICAL_RULE_IDS } from "./rule-catalog.js"

/**
 * The rule catalog the conformance tables are audited against: `rule-catalog.ts`, committed source of this package.
 * It changes in the same commit as the rule families it counts.
 */
export { RULE_FAMILY_COUNTS } from "./rule-catalog.js"

/** Every canonical Common UI rule id, exactly as the knowledge tree spells it. */
export const COMMON_UI_RULE_IDS = CANONICAL_RULE_IDS

export type GrammarRuleConformance = {
    readonly familyId: string
    readonly inheritedCommonRules: ReadonlyArray<string>
    readonly familyEvidence: Readonly<Record<string, ReadonlyArray<string>>>
}

/** Machine-checkable family coverage against the canonical knowledge/ui X-n catalog. */
export const defineGrammarRuleConformance = (definition: GrammarRuleConformance) => {
    const inherited = new Set(definition.inheritedCommonRules)
    const evidence = new Set(Object.keys(definition.familyEvidence))
    const missing = COMMON_UI_RULE_IDS.filter((rule) => !inherited.has(rule) && !evidence.has(rule))
    const unknown = [...inherited, ...evidence].filter((rule) => !COMMON_UI_RULE_IDS.includes(rule))
    if (missing.length > 0 || unknown.length > 0) {
        throw new TypeError(`Invalid ${definition.familyId} Grammar conformance: missing=[${missing.join(", ")}], unknown=[${unknown.join(", ")}]`)
    }
    return Object.freeze({
        familyId: definition.familyId,
        inheritedCommonRules: Object.freeze([...definition.inheritedCommonRules]),
        familyEvidence: Object.freeze({ ...definition.familyEvidence }),
    })
}
