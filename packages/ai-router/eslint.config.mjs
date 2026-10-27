import js from "@eslint/js"
import { defineConfig } from "eslint/config"
import tseslint from "typescript-eslint"

/** The package source and specs are linted at the strictest typed level; nothing is disabled inline. */
export default defineConfig(
    { ignores: ["dist/**", "node_modules/**", "eslint.config.mjs"] },
    js.configs.recommended,
    tseslint.configs.strictTypeChecked,
    tseslint.configs.stylisticTypeChecked,
    {
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        linterOptions: {
            noInlineConfig: true,
            reportUnusedDisableDirectives: "error",
        },
        rules: {
            "@typescript-eslint/explicit-module-boundary-types": "error",
            "@typescript-eslint/consistent-type-imports": "error",
            "@typescript-eslint/switch-exhaustiveness-check": "error",
            "no-console": "error",
            "@typescript-eslint/no-floating-promises": [
                "error",
                { allowForKnownSafeCalls: [{ from: "package", package: "node:test", name: ["test", "describe", "suite", "it"] }] },
            ],
        },
    },
)
