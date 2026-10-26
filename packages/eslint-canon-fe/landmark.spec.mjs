import assert from "node:assert/strict"
import test from "node:test"
import { rules } from "./landmark.mjs"

test("landmark ownership declares no component-specific source rule", () => {
  assert.deepEqual(rules, {})
})
