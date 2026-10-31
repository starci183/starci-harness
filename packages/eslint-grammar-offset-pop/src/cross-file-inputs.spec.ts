/** Offset Pop runs the Common rules of the matching Grammar lint release, so it reads the disk exactly where that release declares it does. */
import assert from "node:assert/strict"
import test from "node:test"
import { crossFileInputs as common, rules as commonRules } from "@starci/eslint-grammar-core"
import { crossFileInputs, rules } from "./index.ts"

test("the crossFileInputs of Offset Pop are those of the Common release, and name only rules it publishes", () => {
  assert.equal(crossFileInputs, common)
  assert.ok(crossFileInputs.length > 0)
  for (const input of crossFileInputs) assert.ok(rules[input.rule] !== undefined && rules[input.rule] === commonRules[input.rule], `${input.rule} is the Common release's rule`)
})
