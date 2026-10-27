// The types of runtime/scripts/hfs/architecture/index.mjs, the part the specs call.
import type * as ts from "typescript"
import type { ArchitectureViolation } from "./violation.mjs"

/** Run the architecture machine over a repository. */
export declare function checkArchitecture(options?: {
  readonly repositoryRoot: string
  readonly injectedTypeScript?: typeof ts
  readonly surface?: "all" | "lint" | "check"
}): { readonly violations: readonly ArchitectureViolation[] }
