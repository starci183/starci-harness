// The types of runtime/scripts/hfs/architecture/frontend-grammar.mjs, the part the specs call.
import type * as ts from "typescript"
import type { ArchitectureConfig } from "./config.mjs"
import type { TypeScriptContext } from "./typescript.mjs"

/** An owner of the repository, the field the specs read. */
export interface ArchitectureOwner {
  readonly root: string
}

/** The Grammar findings of a repository, each built by `makeViolation`. */
export declare function checkGrammar<V>(
  config: ArchitectureConfig,
  context: TypeScriptContext,
  makeViolation: (
    owner: ArchitectureOwner,
    file: ts.SourceFile,
    node: ts.Node,
    ruleId: string,
    message: string,
    extra?: Readonly<Record<string, unknown>>,
  ) => V,
): V[]
