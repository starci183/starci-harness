import plugins from "./scripts/lint/stylelint-plugin.mts"

/** Every rule is an error and an inline `stylelint-disable` switches nothing off: a literal cannot be published again. */
export default {
    plugins: [...plugins],
    defaultSeverity: "error",
    ignoreDisables: true,
    rules: {
        "starci-grammar/no-literal": true,
        "starci-grammar/spacing-scale": true,
    },
}
