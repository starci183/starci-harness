/**
 * Twin tests for the mail owner law (R90 `BE_INFRA_OWNER`, judged by `infra-import-owner`): `nodemailer` is a dependency of
 * `@starci/mail` and no app file imports it, and the package is imported only by `integrations/mail`.
 *
 *   node --test src/mail-package.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import tsParser from "@typescript-eslint/parser"
import { canonRuleTester } from "../fixtures/rule-tester.ts"
import { at, fixtureHfs } from "../fixtures/typed/tester.ts"
import { infraImportOwner } from "./infra-owner.ts"

const tester = canonRuleTester({
    languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module" },
    settings: { starci: { hfs: fixtureHfs() } },
})

const GLUE = at("src/modules/integrations/mail/mail.module.ts")
const GLUE_SPEC = at("src/modules/integrations/mail/mail.config.spec.ts")
const DOMAIN = at("src/modules/domain/identity/auth-mail.service.ts")
const OTHER_INTEGRATION = at("src/modules/integrations/passport/passport.kit.ts")

const PACKAGE = `import { MailModule } from "@starci/mail"; export const m = MailModule`
const TESTING = `import { createMemoryMailer } from "@starci/mail/testing"; export const s = createMemoryMailer`

test("the slot manifest gives the package to integrations/mail and nodemailer to nobody", () => {
    const table = fixtureHfs().ruleParams.infraOwners
    assert.deepEqual(table["@starci/mail"], ["integrations/mail"])
    assert.deepEqual(table.nodemailer, [])
})

test("infra-import-owner: the package belongs to integrations/mail and nodemailer to nobody", () => {
    tester.run("infra-import-owner", infraImportOwner, {
        valid: [
            { filename: GLUE, code: PACKAGE },
            { filename: GLUE, code: `import type { Mailer } from "@starci/mail"; export type M = Mailer` },
            { filename: GLUE_SPEC, code: TESTING },
        ],
        invalid: [
            { filename: DOMAIN, code: PACKAGE, errors: [{ messageId: "foreign" }] },
            { filename: DOMAIN, code: TESTING, errors: [{ messageId: "foreign" }] },
            { filename: OTHER_INTEGRATION, code: PACKAGE, errors: [{ messageId: "foreign" }] },
            { filename: GLUE, code: `import nodemailer from "nodemailer"; export const t = nodemailer`, errors: [{ messageId: "nowhere" }] },
            { filename: GLUE, code: `import type { SendMailOptions } from "nodemailer/lib/mailer"; export type S = SendMailOptions`, errors: [{ messageId: "nowhere" }] },
            { filename: DOMAIN, code: `const mail = require("nodemailer"); export { mail }`, errors: [{ messageId: "nowhere" }] },
            { filename: DOMAIN, code: `export const load = () => import("nodemailer")`, errors: [{ messageId: "nowhere" }] },
        ],
    })
})
