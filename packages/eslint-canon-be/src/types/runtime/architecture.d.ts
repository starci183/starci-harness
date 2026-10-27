/**
 * The architecture machine of the bundled runtime (`scripts/hfs/architecture/**`, untyped JavaScript), by the entry points this
 * package's specs drive: they compare the machine's verdict with the lint rule that reports the same code.
 */
declare module "*/runtime/scripts/hfs/architecture/config.mjs" {
    /** The resolved layout contract of a repository (opaque to this package). */
    export interface ArchitectureConfig {
        readonly root: string
    }
    /** Resolve the layout contract from hfs.json and the slot manifest. */
    export function loadArchitectureConfig(repositoryRoot: string, options?: { hfs?: object }): ArchitectureConfig
}

declare module "*/runtime/scripts/hfs/architecture/typescript.mjs" {
    import type ts from "typescript"
    /** The TypeScript programs of a repository (opaque to this package). */
    export interface TypeScriptContext {
        readonly ts: typeof ts
    }
    /** Parse the configured tsconfigs and build the selected programs. */
    export function buildTypeScriptContext(config: { readonly root: string }, injectedTypeScript?: typeof ts, paths?: readonly string[]): TypeScriptContext
}

declare module "*/runtime/scripts/hfs/architecture/hfs-graph.mjs" {
    /** The owner graph of a repository (opaque to this package). */
    export interface HfsGraph {
        readonly profile: string
    }
    /** Build the owner graph of a repository. */
    export function buildHfsGraph(config: { readonly root: string }, context: object): HfsGraph
}

declare module "*/runtime/scripts/hfs/architecture/tiers.mjs" {
    /** The tier-direction check of the owner graph. */
    export function checkTiers(graph: object): { readonly violations: readonly { readonly ruleId: string; readonly message?: string }[] }
}

declare module "*/runtime/scripts/hfs/architecture/feature-shape.mjs" {
    /** The feature-shape check of a repository. */
    export function checkFeatureShape(input: { config: { root: string }; graph: { resolver: object } }): {
        readonly violations: readonly { readonly ruleId: string; readonly message?: string }[]
    }
}
