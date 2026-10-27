// The types of runtime/scripts/lib/grammar-lint.mjs, the parts the specs call.

/** Resolve a selection to its declared family id. */
export declare function resolveGrammarFamily(family: string): { readonly id: string }

/** The declared family's lint contract. */
export declare function grammarLintFor(family: string): {
  readonly family: string
  readonly package: string | null
  readonly factory?: string
  readonly prefix?: string
}

/** The declared family's shared component and export contract. */
export declare function grammarContractFor(family: string): { readonly entry: string; readonly [field: string]: unknown }
