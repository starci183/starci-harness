/** R321 fixtures prove that an app never re-exports a Grammar export under its own name, independently of a Grammar family or app edition. */
// proves: FE_GRAMMAR_SHIM@full
// proves: FE_GRAMMAR_SHIM@lite
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test, { after } from "node:test"
import { RuleTester } from "eslint"
import tsParser from "@typescript-eslint/parser"
import { rules, recommended } from "./grammar-shim.mjs"
import { recommended as universal, ruleOwners, rules as published, why } from "./index.mjs"

/** A package folder named like the Grammar: its own entries re-export by design. */
const grammarRoot = mkdtempSync(join(tmpdir(), "grammar-shim-"))
writeFileSync(join(grammarRoot, "package.json"), JSON.stringify({ name: "@starci/grammar" }))
after(() => rmSync(grammarRoot, { recursive: true, force: true }))

const tester = () => new RuleTester({ languageOptions: { parser: tsParser, ecmaVersion: "latest", sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } } })
const shim = (name, source) => ({ messageId: "FE_GRAMMAR_SHIM", data: { name, source } })
const invalid = (code, ...errors) => ({ code, filename: "src/components/blocks/Card/index.tsx", errors })

test("R321 is registered universally at error with its finding code", () => {
  assert.equal(published["no-grammar-shim"], rules["no-grammar-shim"])
  assert.equal(ruleOwners["no-grammar-shim"], "grammar-shim")
  assert.equal(recommended["starci-fe/no-grammar-shim"], "error")
  assert.equal(universal["starci-fe/no-grammar-shim"], "error")
  assert.equal(why["no-grammar-shim"].code, "FE_GRAMMAR_SHIM")
})

for (const edition of ["lite", "full"]) {
  test(`R321 ${edition}: a Grammar component is imported where it renders, never re-exported from an app path`, () => {
    tester().run("no-grammar-shim", rules["no-grammar-shim"], {
      valid: [
        "import { SurfaceCard } from \"@starci/grammar/common\"; export const Panel = () => <SurfaceCard>body</SurfaceCard>",
        "import * as G from \"@starci/grammar/core\"; export const Panel = ({ children }) => <G.SurfaceCard>{children}</G.SurfaceCard>",
        "import { SurfaceCard } from \"@starci/grammar\"; const Card = SurfaceCard; export const Panel = () => <Card>body</Card>",
        "export type { ButtonProps } from \"@starci/grammar\"",
        "export { type ButtonProps } from \"@starci/grammar\"",
        "import type { ButtonProps } from \"@starci/grammar\"; export type { ButtonProps }",
        "export { Panel } from \"./Panel\"; export * from \"../Feed\"",
        "export { Grid } from \"@starci/grammarly\"",
        "const SurfaceCard = () => null; export { SurfaceCard }",
        { code: "export { SurfaceCard } from \"@starci/grammar/common\"; export * from \"@starci/grammar/core\"", filename: join(grammarRoot, "src", "index.ts") },
      ],
      invalid: [
        invalid("\"use client\"\n\nexport { SurfaceCard } from \"@starci/grammar/common\"", shim("`SurfaceCard`", "@starci/grammar/common")),
        invalid("export { SurfaceCard as Card, Button } from \"@starci/grammar\"", shim("`SurfaceCard`", "@starci/grammar"), shim("`Button`", "@starci/grammar")),
        invalid("export { type ButtonProps, Button } from \"@starci/grammar/offset-pop\"", shim("`Button`", "@starci/grammar/offset-pop")),
        invalid("export * from \"@starci/grammar/core\"", shim("every export", "@starci/grammar/core")),
        invalid("export * as Grammar from \"@starci/grammar\"", shim("`Grammar`", "@starci/grammar")),
        invalid("import { SurfaceCard } from \"@starci/grammar/common\"; export { SurfaceCard }", shim("`SurfaceCard`", "@starci/grammar/common")),
        invalid("import { SurfaceCard as Base } from \"@starci/grammar\"; export { Base as SurfaceCard }", shim("`SurfaceCard`", "@starci/grammar")),
        invalid("import * as G from \"@starci/grammar/core\"; export const Card = G.SurfaceCard", shim("`SurfaceCard`", "@starci/grammar/core")),
        invalid("import { SurfaceCard } from \"@starci/grammar\"; export default SurfaceCard", shim("`SurfaceCard`", "@starci/grammar")),
      ],
    })
  })
}
