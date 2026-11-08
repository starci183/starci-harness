// The types of runtime/scripts/hfs/rule-catalog.mjs (the rule catalog of @starci/hfs, untyped JavaScript at run time), read through
// `@starci/hfs/runtime/*`; only the part the edition gate (src/lib/edition.ts) reads is declared.

/** Which catalog loadRuleCatalog reads: `root` is the hfs runtime folder holding knowledge/hfs/rules.yaml. */
export interface RuleCatalogOptions {
    readonly root?: string | undefined
}

/** The part of the frozen rule catalog the plugin reads. */
export interface RuleCatalog {
    /** Whether the enforcer `id` of `kind` is judged in `edition`. */
    readonly enforcerJudgedIn: (kind: string, id: string, edition?: string) => boolean
}

/** The parsed and validated rule catalog under `root`. */
export declare function loadRuleCatalog(options?: RuleCatalogOptions): RuleCatalog
