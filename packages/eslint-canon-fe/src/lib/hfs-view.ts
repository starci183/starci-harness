/**
 * The shapes of the HFS view a rule reads from `settings.starci.hfs` (runtime/scripts/hfs/view.mjs builds it): the slot that
 * owns a file, the slot definitions of the manifest and the rule parameters of the side. Only the fields the canon reads are
 * named; the runtime objects carry more.
 */

/** A slot definition of the manifest (knowledge/hfs/slots.yaml), the fields the canon reads. */
export interface HfsSlot {
  readonly id: string
  readonly path: string
  readonly tier?: string
  readonly kinds?: readonly string[]
  readonly layers?: readonly string[]
  readonly roles?: Readonly<Record<string, string>>
  readonly budget?: Readonly<Record<string, number>>
  readonly allows?: readonly string[]
  readonly outcomeHome?: boolean
}

/** The slot that owns a path, or why none does (`status`). */
export interface HfsClassification {
  readonly path: string
  readonly status: "owned" | "forbidden" | "not-enabled" | "ambiguous" | "no-slot"
  readonly slot?: string
  readonly root?: string
  readonly bindings?: Readonly<Record<string, string>>
  readonly kind?: string
  readonly role?: string
  readonly nearest?: { readonly slot: string; readonly matchedPrefix: string } | null
}

/** What the slot that owns a file says about it under its `allows`. */
export interface HfsAllowance {
  readonly slot: string
  readonly root: string
  readonly relative: string
  readonly allowed: boolean
  readonly allows: readonly string[]
}

/** The line budget of a file: the soft limit and whether growth past it is refused. */
export interface HfsFileLines {
  readonly soft: number
  readonly hardGrowth?: boolean
}

/** The rule parameters of the side (ruleParams of the manifest, merged for the profile and edition). */
export interface HfsRuleParams {
  readonly fileLines: HfsFileLines
  readonly functionLines?: number
  readonly [name: string]: unknown
}

/** An app of the side (hfs.json sides.<side>.apps). */
export interface HfsApp {
  readonly name: string
  readonly kind: string
}

/** The frozen view of one side of an app the lint factories hand their rules. */
export interface HfsView {
  readonly repoRoot: string
  readonly profile: string
  readonly side: string | null
  readonly edition: string
  readonly grammar?: string
  readonly apps: readonly HfsApp[]
  readonly connections: readonly unknown[]
  readonly patterns: readonly string[]
  readonly ruleParams: HfsRuleParams
  relative(file: string): string
  classify(file: string): HfsClassification
  slotOf(file: string): string | null
  tierOf(file: string): string | null
  ownerOf(file: string): string | null
  allows(file: string): HfsAllowance | null
  slot(id: string): HfsSlot | null
}
