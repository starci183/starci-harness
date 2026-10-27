// The types of runtime/scripts/lib/sonar-way.mjs.

/** One Sonar rule and the ESLint rule that carries it. */
export interface SonarWayRow {
  readonly sonar: string
  readonly rule: string
}

/** The Sonar way rule levels of a side, and every mapped row. */
export declare function sonarWayRules(
  sonarjs: unknown,
  side?: "be" | "fe",
): { readonly rules: Record<string, ["error", ...unknown[]]>; readonly mapped: SonarWayRow[] }
