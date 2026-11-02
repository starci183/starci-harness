// The types of runtime/scripts/hfs/architecture/typescript.mjs, the parts the specs call.
import type ts from "typescript"
import type { ArchitectureConfig } from "./config.mjs"

/** The TypeScript programs of a repository's owners: handed on unread. */
export interface TypeScriptContext {
  readonly config: ArchitectureConfig
}

/** Build the TypeScript programs of the configured owners. */
export declare function buildTypeScriptContext(
  config: ArchitectureConfig,
  typescript: typeof ts,
  paths: readonly string[],
): TypeScriptContext

/** The forward-slash path of `file` relative to `root`. */
export declare function relativePath(root: string, file: string): string

/** Workspace public-source resolution shared with the architecture owner. */
export interface Workspace { readonly root: string; readonly workspace: boolean; readonly name: string | null; readonly manifest: unknown; readonly exports?: unknown }
export declare function workspaceSourceEntry(typescript: typeof ts, workspace: Workspace, specifier: string): string | null
