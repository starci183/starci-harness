/** Infra doubles follow the genuine port; business names containing Inbox do not change collaborator semantics. */
// proves: BE_SPEC_FORM_ALL_ROLES@lite BE_SPEC_FORM_ALL_ROLES@full
import test from "node:test"
import { BE_DECLARATION, TYPED_ROOT, at, ruleTester } from "../fixtures/typed/tester.ts"
import { appDeclaration } from "../fixtures/app.ts"
import { hfsFromDeclaration } from "./lib/hfs.ts"
import { specInfraDoubleFromKit } from "./unit-spec.ts"

const SPEC = at("src/features/cli/retention/subs/tick.cli.spec.ts")
const HEAD = `import { mock, fakeInbox, FakeClock } from "@starci/jest-preset"
import { INBOX as RECEIPTS } from "@modules/platform/inbox"
import type { Inbox } from "@modules/platform/inbox"
import { CLOCK as CLIENT_INBOX_TIMER } from "@modules/platform/clock"
import { ClientInboxRetentionService, ClientInboxRetentionService as Retention } from "@modules/domain/retention/inbox-retention.service"
import { ClientInboxRetentionQueue } from "@modules/queues/inbox-retention/inbox-retention.queue"
`

for (const edition of ["lite", "full"]) test(`spec-infra-double-from-kit: ${edition} distinguishes Inbox from domain services and queue producers by origin`, () => {
    const hfs = hfsFromDeclaration({ ...appDeclaration("be", BE_DECLARATION), edition }, TYPED_ROOT)
    ruleTester({ root: TYPED_ROOT, hfs }).run("spec-infra-double-from-kit", specInfraDoubleFromKit, {
        valid: [
            { filename: SPEC, code: `${HEAD}const p = { provide: ClientInboxRetentionService, useValue: mock<ClientInboxRetentionService>() }` },
            { filename: SPEC, code: `${HEAD}const p = { provide: Retention, useValue: mock<Retention>() }` },
            { filename: SPEC, code: `${HEAD}const p = { provide: ClientInboxRetentionQueue, useValue: mock<ClientInboxRetentionQueue>() }` },
            { filename: SPEC, code: `${HEAD}const retention = mock<ClientInboxRetentionService>(); const p = { provide: ClientInboxRetentionService, useValue: retention }` },
            { filename: SPEC, code: `${HEAD}const p = { provide: RECEIPTS, useValue: fakeInbox() }` },
            { filename: SPEC, code: `${HEAD}const TOKEN = RECEIPTS; const p = { provide: TOKEN, useValue: fakeInbox() }` },
            { filename: SPEC, code: `${HEAD}const p = { provide: CLIENT_INBOX_TIMER, useValue: new FakeClock(0) }` },
            { filename: SPEC, code: `${HEAD}const CLIENT_INBOX_RETENTION_OPTIONS: unique symbol = Symbol("options"); const p = { provide: CLIENT_INBOX_RETENTION_OPTIONS, useValue: {retentionMs: 1000} }` },
        ],
        invalid: [
            { filename: SPEC, code: `${HEAD}const p = { provide: RECEIPTS, useValue: mock<Inbox>() }`, errors: [{ messageId: "wrong" }] },
            { filename: SPEC, code: `${HEAD}const TOKEN = RECEIPTS; const p = { provide: TOKEN, useValue: mock<Inbox>() }`, errors: [{ messageId: "wrong" }] },
            { filename: SPEC, code: `${HEAD}const p = { provide: CLIENT_INBOX_TIMER, useValue: fakeInbox() }`, errors: [{ messageId: "wrong" }] },
            { filename: SPEC, code: `${HEAD}const p = { provide: Retention, useValue: fakeInbox() }`, errors: [{ messageId: "wrong" }] },
            { filename: SPEC, code: `${HEAD}const p = { provide: ClientInboxRetentionService, useValue: fakeInbox() }`, errors: [{ messageId: "wrong" }] },
            { filename: SPEC, code: `${HEAD}const p = { provide: ClientInboxRetentionQueue, useValue: fakeInbox() }`, errors: [{ messageId: "wrong" }] },
            { filename: SPEC, code: `${HEAD}const p = { provide: "INBOX", useValue: mock<Inbox>() }`, errors: [{ messageId: "wrong" }] },
        ],
    })
})
