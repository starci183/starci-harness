import type { ESLint, Linter, Rule } from "eslint"

export type GrammarFamilyId = "core" | "offset-pop"

export type GrammarHfsView = {
  readonly repoRoot: string
  readonly profile: "fe"
  /** The selected family id: `core` or `offset-pop`. */
  readonly grammar: GrammarFamilyId
  readonly slotOf: (file: string) => string | null
}

export declare const lawOwners: readonly string[]
export declare const ruleOwners: Readonly<Record<string, string>>
export declare const ruleDeclarations: readonly { readonly law: string; readonly name: string }[]
export declare const rules: Readonly<Record<string, Rule.RuleModule>>
export declare const recommended: Readonly<Record<string, "error">>
export declare const linterOptions: Readonly<Linter.LinterOptions>
export declare const why: Readonly<Record<string, { readonly code: string; readonly en: string; readonly fix: string }>>

/** Add every selected-family rule to the shared universal flat config. */
export declare const coreGrammarConfig: (input: {
  readonly hfs: GrammarHfsView
  readonly family?: GrammarFamilyId
}) => Linter.Config[]

declare const plugin: ESLint.Plugin
export default plugin
