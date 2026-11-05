// The types of runtime/scripts/lib/rule-packs.mjs, the part a canon factory calls (PROJECT-LINT-3).

/** One ESLint block of the app's rule packs: the files it covers, the pack's plugin and each rule at its severity. */
export interface PackEslintConfig {
  files: string[]
  plugins: Record<string, { rules: Record<string, unknown> }>
  rules: Record<string, "error" | "warn">
}

/**
 * The flat-config blocks that load the eslint rules of the app's rule packs (hfs.json rulePacks) for one side, found from `start` (the folder of
 * the eslint.config.mjs). Throws HFS_RULE_PACK_INVALID when a pack is refused.
 */
export declare function packEslintConfigs(start: string, side: "be" | "fe" | "packages", files?: readonly string[]): PackEslintConfig[]
