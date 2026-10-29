/**
 * The shapes of the HFS view `runtime/scripts/hfs/view.mjs` builds (a bundled copy of @starci/hfs's runtime, untyped JavaScript):
 * the frozen object a lint factory puts in `settings.starci.hfs` and every path-scoped rule reads. The shapes are the slot
 * manifest's (`runtime/knowledge/hfs/slots.yaml`) as this package reads them; this module is emitted, so the published
 * declarations of `loadHfs` and `starciBeConfig` name a declared type.
 */
/** One app of a side (`hfs.json` sides.<side>.apps). */
export interface HfsApp {
    readonly name: string
    readonly kind: string
}

/** One declared database connection (`hfs.json` sides.be.connections). */
export interface HfsConnection {
    readonly name: string
    readonly envPrefix: string
    readonly owner?: string
    readonly isolation?: string
}

/** Where a path sits: its slot, root and bindings, or a status naming why no slot owns it. */
export interface HfsClassification {
    readonly path: string
    readonly status: string
    readonly slot?: string
    readonly root?: string
    readonly bindings?: Readonly<Record<string, string>>
    readonly kind?: string
    readonly role?: string
    readonly presence?: string
    readonly goesTo?: string
    readonly code?: string
    /** For a path no slot owns: the slot it sits nearest to. */
    readonly nearest?: { readonly slot?: string } | null
}

/** What the slot that owns a file says about it (its `allows` list). */
export interface HfsAllowsVerdict {
    readonly slot: string
    readonly root: string
    readonly relative: string
    readonly allowed: boolean
    readonly entry?: string
    readonly forbiddenBy?: string
    readonly allows: readonly string[]
}

/** A slot definition of the manifest, by the fields the rules read. */
export interface HfsSlot {
    readonly id: string
    readonly tier?: string
    readonly budget?: Readonly<Record<string, number>>
    readonly trigger?: string
    readonly coverage?: string
    readonly allows?: readonly string[]
    /** The one special part a file slot plays that a rule reads: `entity-registry` (persistence.md BE-PERSISTENCE-3). */
    readonly role?: string
    /** The side-relative path patterns of the only files that may import this file by deep path. */
    readonly importedBy?: readonly string[]
}

/** A unit-tested role (`ruleParams.be.unitRoles`). */
export interface HfsUnitRole {
    readonly role: string
    readonly spec: string
    readonly slot?: string
    readonly exempt?: readonly string[]
}

/** A parameter-name rule (`ruleParams.be.paramNames`). */
export type HfsParamName =
    | { readonly type: string; readonly typeSuffix?: undefined; readonly names: readonly string[]; readonly nameSuffix?: string }
    | { readonly type?: undefined; readonly typeSuffix: string; readonly names: readonly string[]; readonly nameSuffix?: string }

/** A spec double (`ruleParams.be.specDoubles.doubles`). */
export interface HfsSpecDouble {
    readonly token: string
    readonly double: string
    readonly forms: readonly string[]
}

/** The rule parameters of the be profile (`ruleParams.common` merged with `ruleParams.be`), by the keys the rules read. */
export interface HfsRuleParams {
    readonly functionLines?: number
    readonly fileLines: { readonly soft: number; readonly hardGrowth: boolean }
    readonly infraOwners: Readonly<Record<string, readonly string[]>>
    readonly eventBus: {
        readonly imports: Readonly<Record<string, readonly string[]>>
        readonly classes: Readonly<Record<string, readonly string[]>>
    }
    readonly specDoubles: { readonly kit: string; readonly doubles: readonly HfsSpecDouble[] }
    readonly paramNames: readonly HfsParamName[]
    readonly unitRoles?: readonly HfsUnitRole[]
    readonly logicRoles?: readonly string[]
    readonly valueRoles?: readonly string[]
    readonly thinRoles?: readonly string[]
    /** The database functions `callDbFunction` of platform/database may call, each with its reason (`ruleParams.be.dbFunctions` plus hfs.json `sides.be.dbFunctions`). */
    readonly dbFunctions?: readonly { readonly name: string; readonly reason: string }[]
}

/** The frozen view of one side of an app. */
export interface HfsView {
    readonly repoRoot: string
    readonly profile: string
    readonly side: string | null
    readonly edition: string
    readonly grammar?: string
    readonly apps: readonly HfsApp[]
    readonly connections?: readonly HfsConnection[]
    readonly patterns: readonly string[]
    readonly ruleParams: HfsRuleParams
    /** The repository-relative, forward-slash form of a linted filename. */
    relative(file: string): string
    /** The classification of a file. */
    classify(file: string): HfsClassification
    /** The slot id that owns a file, or null. */
    slotOf(file: string): string | null
    /** The tier of a file, or null. */
    tierOf(file: string): string | null
    /** The owner root of a file, or null. */
    ownerOf(file: string): string | null
    /** What the owning slot's `allows` says about a file, or null when it names none. */
    allows(file: string): HfsAllowsVerdict | null
    /** A slot definition by id. */
    slot(id: string): HfsSlot | undefined
}
