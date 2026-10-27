/** The bundled Grammar catalog declares exactly two families, core and offset-pop (owner ruling two-grammars). */
import assert from "node:assert/strict"
import test from "node:test"
import { grammarContractFor, grammarLintFor, resolveGrammarFamily } from "./runtime/scripts/lib/grammar-lint.mjs"

test("core resolves its lint family and the shared component contract", () => {
  assert.deepEqual(resolveGrammarFamily("core"), { id: "core" })
  assert.deepEqual(grammarLintFor("core"), {
    family: "core", package: "@starci/eslint-grammar-core", factory: "coreGrammarConfig", prefix: "starci-grammar",
  })
  assert.equal(grammarContractFor("core").entry, "@starci/grammar/common")
})

test("offset-pop is the other family; any other id, starci and starci-core included, is refused", () => {
  assert.equal(grammarLintFor("offset-pop").factory, "offsetPopGrammarConfig")
  for (const other of ["starci", "starci-core", "paper"]) {
    assert.throws(() => resolveGrammarFamily(other), /no declared lint contract/)
  }
})
