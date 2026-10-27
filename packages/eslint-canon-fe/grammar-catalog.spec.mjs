/** The bundled Grammar catalog resolves the canonical `core` id and its deprecated aliases (owner ruling two-grammars). */
import assert from "node:assert/strict"
import test from "node:test"
import { grammarContractFor, grammarLintFor, resolveGrammarFamily } from "./runtime/scripts/lib/grammar-lint.mjs"

test("core is the canonical family: it resolves its lint family and the shared component contract", () => {
  assert.deepEqual(resolveGrammarFamily("core"), { id: "core", alias: null, note: null })
  assert.deepEqual(grammarLintFor("core"), {
    family: "core", package: "@starci/eslint-grammar-starci", factory: "starciGrammarConfig", prefix: "starci-grammar",
  })
  assert.equal(grammarContractFor("core").entry, "@starci/grammar/common")
})

test("starci and starci-core are deprecated aliases of core; offset-pop stays its own family", () => {
  for (const alias of ["starci", "starci-core"]) {
    assert.equal(resolveGrammarFamily(alias).id, "core")
    assert.match(resolveGrammarFamily(alias).note, /deprecated alias of core/)
    assert.deepEqual(grammarLintFor(alias), grammarLintFor("core"))
  }
  assert.equal(grammarLintFor("offset-pop").factory, "offsetPopGrammarConfig")
  assert.throws(() => resolveGrammarFamily("paper"), /no declared lint contract/)
})
