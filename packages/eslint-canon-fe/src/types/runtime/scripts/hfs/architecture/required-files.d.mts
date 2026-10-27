// The types of runtime/scripts/hfs/architecture/required-files.mjs, the part the specs call.
import type { OpenedHfs } from "../slots.mjs"
import type { ArchitectureViolation } from "./violation.mjs"

/** The required-file findings of a repository. */
export declare function checkRequiredFiles(input: {
  readonly config: { readonly root: string; readonly hfs: OpenedHfs }
}): { readonly violations: readonly ArchitectureViolation[] }
