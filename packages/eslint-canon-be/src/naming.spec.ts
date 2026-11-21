/**
 * Twin tests for the naming rules.
 *
 *   node --test src/naming.spec.ts
 *
 * `no-version-in-name` is the one with room to be wrong: a capital V followed by digits appears
 * inside perfectly good names, and it appears inside STRING values constantly (`claude-sonnet-5`,
 * an API version in a URL). The rule reads identifiers only, and the valid cases below are what
 * pins that down.
 */
import assert from "node:assert/strict"
import test from "node:test"
import tsParser from "@typescript-eslint/parser"
import { noDefaultExport, noVersionInName, rules } from "./naming.ts"
import { at, fixtureHfs } from "../fixtures/typed/tester.ts"
import { canonRuleTester } from "../fixtures/rule-tester.ts"

const tester = canonRuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: "module",
  },
})

test("every rule this law declares is exported under its published name", () => {
  for (const [name, rule] of Object.entries(rules)) {
    assert.ok(rule && rule.meta && rule.create, `${name} is not a rule`)
  }
})

test("NAME-2: a schema generation does not go in a name", () => {
  assert.doesNotThrow(() => {
      tester.run("no-version-in-name", noVersionInName, {
        valid: [
          "class ContentParserService { async hasVerifiedMarker() { return true } }",
          "export interface ContentLookupParams { relativePath: string }",
          // a version in a STRING is data, not a name
          "const model = 'claude-sonnet-5'",
          // a name that merely contains a capital V followed by a letter
          "export class VerifiedMarkerService {}",
        ],
        invalid: [
          {
            code: "class ContentParserService { async isV2() { return true } }",
            errors: [{ messageId: "versioned" }],
          },
          {
            code: "export interface IsContentV2Params { relativePath: string }",
            errors: [{ messageId: "versioned" }],
          },
          {
            code: "export class SchemaV3Reader {}",
            errors: [{ messageId: "versioned" }],
          },
        ],
      })
  })
})

test("R89: named exports only; the Jest global setup of the e2e setup folder is the one default export", () => {
  const slotTester = canonRuleTester({
    languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module" },
    settings: { starci: { hfs: fixtureHfs() } },
  })
  const SERVICE = at("src/modules/domain/order/order.service.ts")
  const SETUP = at("src/tests/world/global-setup.ts")
  assert.doesNotThrow(() => {
      slotTester.run("no-default-export", noDefaultExport, {
        valid: [
          { filename: SERVICE, code: "export const answer = 42\nexport class OrderService {}" },
          { filename: SERVICE, code: "const a = 1\nexport { a as first }" },
          // the Jest API for a global setup is a default function
          { filename: SETUP, code: "export default async function setup() {}" },
          // a JavaScript tool config is not TypeScript source (the managed eslint.config.mjs default-exports by design)
          { filename: at("eslint.config.mjs"), code: "export default []" },
        ],
        invalid: [
          { filename: SERVICE, code: "export default class OrderService {}", errors: [{ messageId: "default" }] },
          { filename: SERVICE, code: "const a = 1\nexport default a", errors: [{ messageId: "default" }] },
          { filename: SERVICE, code: "const a = 1\nexport { a as default }", errors: [{ messageId: "default" }] },
          { filename: SERVICE, code: "export { default } from \"./other\"", errors: [{ messageId: "default" }] },
          { filename: SERVICE, code: "export { default as Other } from \"./other\"", errors: [{ messageId: "default" }] },
          { filename: SERVICE, code: "const a = 1\nexport = a", errors: [{ messageId: "default" }] },
          // a global-setup name outside the test world, and a world file that is not the global setup
          { filename: at("src/modules/domain/order/global-setup.ts"), code: "export default async function setup() {}", errors: [{ messageId: "default" }] },
          { filename: at("src/tests/world/use-test-world.ts"), code: "export default {}", errors: [{ messageId: "default" }] },
          // a spec is not exempt
          { filename: at("src/modules/domain/order/order.service.spec.ts"), code: "export default {}", errors: [{ messageId: "default" }] },
        ],
      })
  })
})
