/**
 * `starci/no-self-reference` (HFS R61 `FE_STYLE_TOKEN_ONLY`): no custom property takes `var(--itself)` as its value, in any stylesheet.
 *
 * A custom property that refers to itself is a cycle: it is invalid at computed-value time and resolves empty, so the colour it
 * was meant to carry vanishes without an error anywhere. A rename of a token onto its own name (`--starci-core-accent: var(--accent)`
 * written as `--accent: var(--accent)`) is how it happens; the token already holds the value, so the line is deleted.
 */
import { makeRule } from "./lib/make-rule.ts"

const SPECIAL = /[.*+?^${}()|[\]\\]/g

export const noSelfReference = makeRule(
  "no-self-reference",
  {
    cycle: (prop: string) =>
      `\`${prop}\` is declared as \`var(${prop})\`: a custom property that names itself is invalid at computed-value time and resolves empty. Delete the declaration; the token already holds the value.`,
  },
  ({ root, report }) => {
    root.walkDecls(/^--/, (decl) => {
      const name = decl.prop.replace(SPECIAL, String.raw`\$&`)
      if (new RegExp(String.raw`var\(\s*${name}\s*[,)]`, "u").test(decl.value)) report(decl, "cycle", [decl.prop], { word: decl.prop })
    })
  },
)
