import assert from "node:assert/strict"
import test from "node:test"
import { RuleTester } from "eslint"
import { monorepoTierBelongsToItsSide } from "./file-layout.ts"
import { serverModuleMarksServerOnly } from "./client-boundary.ts"
import { defineRule } from "./lib/rule.ts"
import { isOutcomeModule } from "./lib/scope.ts"
import { at, canonTester, FE_DECLARATION, slotTester, typedTester } from "../fixtures/typed/tester.ts"

const ONE_APP = {
  ...FE_DECLARATION,
  apps: [{ name: "web", kind: "next" }],
}

test("one app may own shell composites while two apps must share them", () => {
  assert.doesNotThrow(() => {
  slotTester({ declaration: ONE_APP }).run("one-app composite", monorepoTierBelongsToItsSide, {
    valid: [{
      filename: at("apps/web/src/components/composites/SiteShell/index.tsx"),
      code: "export const SiteShell = () => null",
    }],
    invalid: [],
  })
  slotTester().run("two-app composite", monorepoTierBelongsToItsSide, {
    valid: [],
    invalid: [{
      filename: at("apps/web/src/components/composites/SiteShell/index.tsx"),
      code: "export const SiteShell = () => null",
      errors: [{ messageId: "vocabularyInApp" }],
    }],
  })

  })
})

test("the result vocabulary home follows slot data rather than a remembered slot id", () => {
  // The question is asked from a real rule context whose settings carry a slot view that answers from its own slot data.
  const outcomeHomeOf = (slot: string | null, outcomeHome: boolean): boolean | undefined => {
    let answer: boolean | undefined
    const probe = defineRule({
      meta: { type: "problem", schema: [], messages: {} },
      create(context) {
        answer = isOutcomeModule(context)
        return {}
      },
    })
    const hfs = { slotOf: () => slot, slot: (id: string) => id === slot ? { outcomeHome } : null }
    canonTester(new RuleTester({ settings: { starci: { hfs } } })).run("outcome-home", probe, {
      valid: [{ filename: at("apps/web/src/modules/custom/result.ts"), code: "" }],
      invalid: [],
    })
    return answer
  }

  assert.equal(outcomeHomeOf("fe.custom.result", true), true)
  assert.equal(outcomeHomeOf("fe.transport.outcome", false), false)
  assert.equal(outcomeHomeOf(null, true), false)
})

test("the server-only marker follows a BOM/CRLF directive prologue", () => {
  assert.doesNotThrow(() => {
  typedTester().run("server marker after directives", serverModuleMarksServerOnly, {
    valid: [{
      filename: at("apps/web/src/modules/orders/order-headers.ts"),
      code: '\uFEFF"use strict";\r\nimport "server-only";\r\nimport { headers } from "next/headers";\r\nexport const orderHeaders = async () => headers();\r\n',
    }],
    invalid: [{
      filename: at("apps/web/src/modules/orders/order-headers.ts"),
      code: 'import { headers } from "next/headers";\r\n"use strict";\r\nimport "server-only";\r\nexport const orderHeaders = async () => headers();\r\n',
      errors: [{ messageId: "mark" }],
    }],
  })

  })
})
