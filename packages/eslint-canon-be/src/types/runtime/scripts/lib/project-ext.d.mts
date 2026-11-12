// The types of runtime/scripts/lib/project-ext.mjs, the part a canon factory calls (PROJECT-LINT-3).

/** One ESLint block of the project's extension: the files a rule's appliesTo names inside the config, the extension's plugin and the rule at its severity. */
export interface ExtEslintConfig {
  files: string[]
  plugins: Record<string, { rules: Record<string, unknown> }>
  rules: Record<string, "error" | "warn">
}

/**
 * The flat-config blocks that load the lint rules of the project's extension (ext/manifest.json, ext/lint/) in the config at `start` (the folder of
 * the eslint.config.mjs), for one scope. Throws HFS_EXT_INVALID or HFS_EXT_API_MISMATCH when the extension is refused.
 */
export declare function extEslintConfigs(start: string, scope: "be" | "fe" | "packages"): ExtEslintConfig[]
