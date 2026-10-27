/** Edition proofs for the Grammar structural-element contract. */
// proves: FE_NATIVE_FORM_CONTROL@lite FE_NATIVE_FORM_CONTROL@full
import assert from "node:assert/strict"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import tsParser from "@typescript-eslint/parser"
import { RuleTester } from "eslint"
import { appDeclaration } from "../eslint-canon-be/fixtures/app.mjs"
import { noRawStructuralElement } from "./grammar-boundary.mjs"
import { hfsFromDeclaration } from "@starci/eslint-canon-fe/lib/hfs.mjs"
import { why } from "./lib/why.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "fe", "fixtures", "typed")
const BLOCK = join(ROOT, "apps", "web", "src", "components", "blocks", "Feed", "component.tsx")

for (const edition of ["lite", "full"]) {
  test(`R62 Grammar accepts canonical structure and rejects raw elements in ${edition}`, () => {
    const declaration = appDeclaration("fe", { apps: [{ name: "web", kind: "next" }] })
    const hfs = hfsFromDeclaration({ ...declaration, edition }, ROOT)
    assert.equal(hfs.edition, edition)
    const tester = new RuleTester({
      languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
      settings: { starci: { hfs } },
    })
    tester.run("no-raw-structural-element", noRawStructuralElement, {
      valid: [{ filename: BLOCK, code: "export const Feed = () => <Region><Text>{message}</Text></Region>" }],
      invalid: [
        { filename: BLOCK, code: "export const Feed = () => <section />", errors: [{ messageId: "raw" }] },
        { filename: BLOCK, code: "export const Feed = () => <p>{message}</p>", errors: [{ messageId: "raw" }] },
      ],
    })
    assert.equal(why["no-raw-structural-element"].code, "FE_NATIVE_FORM_CONTROL")
  })
}
