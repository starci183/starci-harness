import { defineConfig } from "eslint/config"
import tseslint from "typescript-eslint"
import grammar from "./scripts/lint/eslint-plugin.mts"

/**
 * The grammar publishes components an app cannot restyle, so a hardcoded colour, length or utility class in a component
 * reaches every app. A component names a role (a data attribute, a token); the stylesheet gives it a value. Every rule
 * is an error and an inline disable switches nothing off.
 */
export default defineConfig(
    {
        ignores: [
            "dist/**", "node_modules/**", "storybook-static/**", "scripts/**", "*.mjs", "*.mts", "*.cts",
            // Showcase code, never published (package.json files).
            "src/stories/**", "src/**/*.stories.*",
            // The scale, the DNA data and the conformance prose own their numbers: that is what they are for.
            "src/common/spacing.ts", "src/*/dna.ts", "src/*/conformance.ts",
        ],
    },
    {
        files: ["src/**/*.{ts,tsx}"],
        languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
        plugins: { "@typescript-eslint": tseslint.plugin, "starci-grammar": grammar },
        linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "error" },
        rules: {
            "@typescript-eslint/ban-ts-comment": "error",
            "starci-grammar/no-literal-look": "error",
            "starci-grammar/tier-props": "error",
        },
    },
)
