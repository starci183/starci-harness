// The types of runtime/scripts/hfs/architecture/surface.mjs.

/** A rule of the architecture machine served through ESLint, and the finding codes it reports. */
export interface LintEnforcer {
  readonly id: string
  readonly plugins: readonly ("be" | "fe")[]
  readonly codes: readonly string[]
  readonly description: string
  readonly origin?: string
  readonly via?: string
}

/** Every enforcer, both sides. */
export declare const LINT_ENFORCERS: readonly LintEnforcer[]

/** A finding of the machine: a violation spells its code `ruleId`, a repository finding `code`. */
export interface GraphViolation {
  readonly ruleId?: string
  readonly code?: string
  readonly path?: string
  readonly line?: number
  readonly column?: number
  readonly message: string
  readonly origin?: string
  readonly check?: string
}

/** The finding's code. */
export declare const codeOf: (finding: GraphViolation) => string | undefined

/** Whether `finding` belongs to `enforcer`. */
export declare const belongsTo: (enforcer: LintEnforcer, finding: GraphViolation) => boolean
