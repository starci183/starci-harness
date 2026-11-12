/**
 * The law that keeps the code clear of the smells SonarCloud measures (R235 `SCAN_SMELL`).
 *
 * Each rule is the syntax-tree form of one Sonar rule, shared with the back-end canon (scripts/lib/sonar-syntax-rules.mjs,
 * bundled under `runtime/`): `no-await-in-loop` (S9382), `prefer-code-point` (S7758),
 * `prefer-string-raw` (S7780), `no-nested-conditional` (S3358), `no-void-operator` (S3735), `no-unused-import` (S1128),
 * `prefer-export-from` (S7763), `no-unused-prop-types` (S6767), `media-has-caption` (S4084), `no-duplicate-import` (S3863, fixable), `no-useless-fragment` (S6749, fixable), `no-nested-component` (S6478), `no-children-prop` (S6748), `use-state-destructured` (S6754), `prefer-tag-over-role` (S6819) `todo-tag` (S1135) and `no-bidirectional-character` (text:S6389). The rest of Sonar way is the factory's
 * Sonar way block (scripts/lib/sonar-way.mjs). The three Sonar rules that need the type checker, S1874 (a deprecated
 * API), S6551 (an object turned into text) and S7503 (an `async` function that never awaits), are the typescript-eslint rules
 * `no-deprecated`, `no-base-to-string` and `require-await` the factory turns on.
 */
import { SONAR_SYNTAX_RULES } from "#runtime/scripts/lib/sonar-syntax-rules.mjs"
import type { Recommended, Rule, Rules } from "./lib/rule.ts"

/** A rule of the shared Sonar syntax set; one this law names and the set lacks is a broken runtime copy. */
const syntaxRule = (name: string): Rule => {
  const rule = SONAR_SYNTAX_RULES[name]
  if (rule === undefined) throw new TypeError(`the runtime Sonar syntax rules publish no ${name}`)
  return rule
}

const NAMES = ["no-await-in-loop", "prefer-code-point", "prefer-string-raw", "no-nested-conditional", "no-void-operator", "no-unused-import", "prefer-export-from", "no-unused-prop-types", "media-has-caption", "max-params", "no-line-separator-literal", "no-bidirectional-character", "todo-tag", "no-duplicate-import", "no-useless-fragment", "no-nested-component", "no-children-prop", "use-state-destructured", "prefer-tag-over-role"]

/** The rules this law contributes to the plugin. */
export const rules: Rules = Object.fromEntries(NAMES.map((name) => [name, syntaxRule(name)]))

/** Starts at error: a repository's fix lane clears the debt before the rule ships. */
export const recommended: Recommended = Object.fromEntries(NAMES.map((name) => [`starci-fe/${name}`, "error" as const]))
