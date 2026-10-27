/** Core Grammar API rules, versioned with the Grammar family that owns their concrete vocabulary. */
import tsParser from "@typescript-eslint/parser"
import { SOURCE_FILES, linterOptions } from "@starci/eslint-canon-fe/lib/config.mjs"
import { rules as appShellRules } from "./app-shell.mjs"
import { rules as drawingRules } from "./drawing.mjs"
import { rules as grammarBoundaryRules } from "./grammar-boundary.mjs"
import { rules as iconRules } from "./icon.mjs"
import { rules as menuEntriesRules } from "./menu-entries.mjs"
import { rules as statusColorsRules } from "./status-colors.mjs"
import { rules as tokensRules } from "./tokens.mjs"
import { rules as typographyRules } from "./typography.mjs"
import { rules as vendorRules } from "./vendor-boundary.mjs"

const CONTRIBUTIONS = [
  { law: "app-shell", rules: appShellRules },
  { law: "drawing", rules: drawingRules },
  { law: "grammar-boundary", rules: grammarBoundaryRules },
  { law: "icon", rules: iconRules },
  { law: "menu-entries", rules: menuEntriesRules },
  { law: "status-colors", rules: statusColorsRules },
  { law: "tokens", rules: tokensRules },
  { law: "typography", rules: typographyRules },
  { law: "vendor-boundary", rules: vendorRules },
]

/** Each concrete Grammar law has one gathered owner. */
export const lawOwners = CONTRIBUTIONS.map(({ law }) => law)

/** Preserve declarations before gathering so duplicate rule names remain observable. */
export const ruleDeclarations = CONTRIBUTIONS.flatMap(({ law, rules }) => Object.keys(rules).map((name) => ({ law, name })))

/** The law that owns each published rule ID. */
export const ruleOwners = Object.fromEntries(ruleDeclarations.map(({ law, name }) => [name, law]))

/** Every rule of the selected family contract. */
export const rules = Object.fromEntries(CONTRIBUTIONS.flatMap(({ rules }) => Object.entries(rules)))

/** Every family rule runs at error, with no consumer override surface. */
export const recommended = Object.fromEntries(Object.keys(rules).map((name) => [`starci-grammar/${name}`, "error"]))

export { why } from "./lib/why.mjs"
export { linterOptions }

const plugin = { meta: { name: "@starci/eslint-grammar-core" }, rules }
export default plugin

/** The families this factory serves: core, and offset-pop through its own package entry. */
const SERVED_FAMILIES = Object.freeze(["core", "offset-pop"])

/**
 * Add the complete selected-family contract to the universal front-end flat config.
 * Offset Pop uses the inherited Common renderer contract through its own package entry.
 * @param {{ hfs: object, family?: "core" | "offset-pop" }} input - The selected FE slot view and family.
 * @returns {object[]} A typed source block with every family rule at error.
 */
export const coreGrammarConfig = ({ hfs, family = "core" } = {}) => {
  if (!hfs || typeof hfs.slotOf !== "function" || typeof hfs.repoRoot !== "string" || hfs.profile !== "fe") {
    throw new Error("coreGrammarConfig needs the FE view from loadHfs(import.meta.url)")
  }
  if (!SERVED_FAMILIES.includes(family) || hfs.grammar !== family) {
    throw new Error(`coreGrammarConfig family ${family} does not match the selected Grammar ${hfs.grammar}`)
  }
  const missing = Object.keys(rules).filter((name) => recommended[`starci-grammar/${name}`] !== "error")
  if (missing.length) throw new Error(`coreGrammarConfig requires every family rule at error: ${missing.join(", ")}`)
  return [{
    files: [...SOURCE_FILES],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { projectService: true, tsconfigRootDir: hfs.repoRoot, ecmaFeatures: { jsx: true } },
    },
    linterOptions: { ...linterOptions },
    plugins: { "starci-grammar": plugin },
    settings: { starci: { hfs } },
    rules: { ...recommended },
  }]
}
