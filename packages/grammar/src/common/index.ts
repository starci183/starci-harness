export { PRESENTATION_STATES, assertPresentationState, isPresentationState, type PresentationState } from "./state.js"
export { COMMON_GAP_ROLES, COMMON_SPACING_SCALE, COMMON_SPACING_TOKENS, type CommonGapRole, type CommonSpacingStep, type CommonSpacingValue, type GapRole } from "./spacing.js"
export { COMMON_UI_RULE_IDS, defineGrammarRuleConformance, type GrammarRuleConformance } from "./conformance.js"
export * from "./renderers.js"
export {
    COMMON_GRAMMAR_COMPONENTS,
    defineGrammarFamily,
    type CommonGrammarComponentName,
    type GrammarComponentRenderer,
    type GrammarFamilyContract,
    type GrammarFamilyStyles,
} from "./registry.js"
export type { LabelChild, NoChildren } from "../core/tier.js"
export { assertToneDeclared, customToneProps, isCustomTone, TONE_TOKEN_SUFFIXES, TONE_VARIABLES, type CustomTone } from "./tones.js"

/**
 * The tones an app added to Core's built-in ones. Declared HERE (not re-exported) so an app can merge into it from "@starci/grammar/common":
 * `declare module "@starci/grammar/common" { interface GrammarToneRegistry { info: true } }`. Empty until an app does.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface GrammarToneRegistry {}
