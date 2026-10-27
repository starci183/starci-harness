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
