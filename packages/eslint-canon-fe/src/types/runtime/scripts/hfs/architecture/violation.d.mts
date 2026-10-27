// A finding of the architecture machine (runtime/scripts/hfs/architecture/*), the fields the specs read.

/** One finding. */
export interface ArchitectureViolation {
  readonly ruleId: string
  readonly path: string
  readonly message: string
  readonly line?: number
  readonly [field: string]: unknown
}
