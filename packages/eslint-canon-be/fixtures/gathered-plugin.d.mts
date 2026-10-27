/** The declared contract of ./gathered-plugin.mjs: the shared spec of a gathered canon plugin. */

/** Register the gathered-plugin contract against one side's index. */
export declare function gatheredPluginSpec(input: {
    side: string
    dir: string
    plugin: { readonly rules: Readonly<Record<string, unknown>> }
    lawOwners: readonly string[]
    recommended: Readonly<Record<string, unknown>>
    ruleDeclarations: readonly { readonly name: string; readonly law: string }[]
    rules: Readonly<Record<string, unknown>>
}): void
