// proves: BE_TEST_TOPOLOGY@lite BE_TEST_TOPOLOGY@full
/**
 * A slot may declare which of its own files carry logic (`logic` in the slot manifest). The spec beside a declared logic file
 * (`passport.tokens.spec.ts` beside the declared `passport.tokens.ts` of be.integrations.passport) is a legitimate unit spec for
 * `unit-test-colocated` (R47) and is held to the unit-spec form (R48, R281) like a logic-role spec; a spec beside a file that is neither
 * declared nor of a logic role stays a finding.
 *
 *   node --test src/unit-spec-declared-logic.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { projectFixture } from "../fixtures/project/tester.ts"
import { BE_DECLARATION, TYPED_ROOT, at, ruleTester } from "../fixtures/typed/tester.ts"
import { appDeclaration } from "../fixtures/app.ts"
import { hfsFromDeclaration } from "./lib/hfs.ts"
import { unitRoleOfSpec } from "./lib/unit-spec.ts"
import { unitTestColocated } from "./testing.ts"
import { specBuildsWithTestingModule } from "./unit-spec.ts"

const PASSPORT = "src/modules/integrations/passport/"
const code = "export {};"
const subjects = Object.fromEntries(["passport.tokens.ts", "passport.password.ts", "passport.cookie.ts", "passport.config.ts"].map((file) => [`${PASSPORT}${file}`, code]))

test("lite: the spec beside each declared passport logic file is a unit spec; beside an undeclared file of no logic role it is not", (t) => {
    const fixture = projectFixture({ edition: "lite", files: { ...subjects, "src/modules/integrations/mail/mail.tokens.ts": code } })
    t.after(fixture.cleanup)
    fixture.tester.run("unit-test-colocated", unitTestColocated, {
        valid: ["passport.tokens", "passport.password", "passport.cookie"].map((stem) => ({ filename: fixture.at(`${PASSPORT}${stem}.spec.ts`), code })),
        invalid: [
            { filename: fixture.at(`${PASSPORT}passport.config.spec.ts`), code, errors: [{ messageId: "notService" }] },
            { filename: fixture.at(`${PASSPORT}passport.options.spec.ts`), code, errors: [{ messageId: "notService" }] },
            // the declaration names one file, not a role: another integration's `*.tokens.ts` gains no spec
            { filename: fixture.at("src/modules/integrations/mail/mail.tokens.spec.ts"), code, errors: [{ messageId: "notService" }] },
        ],
    })
})

test("full: no passport slot exists, so the same spec is a finding", (t) => {
    const fixture = projectFixture({ edition: "full", files: subjects })
    t.after(fixture.cleanup)
    fixture.tester.run("unit-test-colocated", unitTestColocated, {
        valid: [],
        invalid: [{ filename: fixture.at(`${PASSPORT}passport.tokens.spec.ts`), code, errors: [{ messageId: "notService" }] }],
    })
})

test("the view gives the declared-logic spec its subject's part as an optional spec role", () => {
    const hfs = hfsFromDeclaration({ ...appDeclaration("be", BE_DECLARATION), edition: "lite" }, TYPED_ROOT)
    assert.deepEqual(unitRoleOfSpec(hfs, at(`${PASSPORT}passport.tokens.spec.ts`)), { role: "tokens", spec: "tokens.spec", optional: true })
    assert.equal(unitRoleOfSpec(hfs, at(`${PASSPORT}passport.config.spec.ts`)), null)
})

test("a declared-logic spec is held to the unit-spec form: its subject comes out of a compiled testing module", () => {
    const tester = ruleTester({ root: TYPED_ROOT, hfs: hfsFromDeclaration({ ...appDeclaration("be", BE_DECLARATION), edition: "lite" }, TYPED_ROOT) })
    const filename = at(`${PASSPORT}passport.password.spec.ts`)
    assert.doesNotThrow(() => { tester.run("spec-builds-with-testing-module", specBuildsWithTestingModule, {
        valid: [{ filename, code: 'import { Test } from "@nestjs/testing"\nconst PASSWORD = Symbol("password")\nit("x", async () => {\n  const moduleRef = await Test.createTestingModule({ providers: [{ provide: PASSWORD, useValue: 1 }] }).compile()\n  expect(moduleRef.get(PASSWORD)).toBe(1)\n})' }],
        invalid: [{ filename, code: 'it("x", () => { expect(1).toBe(1) })', errors: [{ messageId: "noModule" }] }],
    }) })
})
