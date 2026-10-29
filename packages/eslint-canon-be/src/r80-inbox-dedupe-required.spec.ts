// proves: BE_INBOX_DEDUPE_MISSING@lite
// proves: BE_INBOX_DEDUPE_MISSING@full
import assert from "node:assert/strict"
import test from "node:test"
import { BE_DECLARATION, TYPED_ROOT, at, ruleTester } from "../fixtures/typed/tester.mjs"
import { appDeclaration } from "../fixtures/app.mjs"
import { hfsFromDeclaration } from "./lib/hfs.ts"
import { inboxDedupeRequired } from "./idempotency.ts"

const SERVICE = at("src/modules/domain/order/billing.service.ts")
const HEAD = [
    'import type { Inbox } from "@modules/platform/inbox/inbox.port"',
    'import type { EntityManager } from "typeorm"',
    "interface Delivery { eventId: string; amount: number }",
].join("\n")
const service = (body: string) => HEAD
    + "\nclass BillingService { constructor(private readonly inbox: Inbox, private readonly manager: EntityManager) {}"
    + "\nasync handle(delivery: Delivery) { " + body + " }"
    + "\nprivate async work(): Promise<void> {} }"
const ENTITY_HEAD = [
    'import type { EntityInbox } from "@modules/platform/inbox/inbox.port"',
    'import type { Inbox as Lookalike } from "@modules/domain/order/lookalike.service"',
    'import type { EntityManager } from "typeorm"',
    "interface Delivery { eventId: string; amount: number }",
    "class ReceiptEntity { id!: string; eventId!: string }",
].join("\n")
/** A delivery service whose inbox is the EntityInbox port (or, with `inbox`, another receiver type). */
const entityService = (body: string, inbox = "EntityInbox") => ENTITY_HEAD
    + `\nclass BillingService { constructor(private readonly inbox: ${inbox}, private readonly manager: EntityManager) {}`
    + "\nasync handle(delivery: Delivery) { " + body + " }"
    + "\nprivate async work(): Promise<void> {} }"
const RECEIPT = "{ entity: ReceiptEntity, row: { eventId: delivery.eventId } }"
const claimRow = (manager = "tx") => `await this.inbox.claimRow('billing', delivery.eventId, ${manager}, ${RECEIPT})`
const inTransaction = (body: string) => `return this.manager.transaction(async (tx) => { ${body} })`
const delegated = (helper: string) => HEAD
    + "\nclass BillingService { constructor(private readonly inbox: Inbox, private readonly manager: EntityManager) {}"
    + "\nhandle(delivery: Delivery) { return this.manager.transaction((tx) => this.handleInTransaction(delivery, tx)) }"
    + "\nprivate async handleInTransaction(delivery: Delivery, manager: EntityManager) { " + helper + " } }"

for (const edition of ["lite", "full"]) {
    test(`R80 valid inbox refusal and invalid unclaimed deliveries in ${edition}`, () => {
        const hfs = hfsFromDeclaration({ ...appDeclaration("be", BE_DECLARATION), edition }, TYPED_ROOT)
        assert.equal(hfs.edition, edition)
        ruleTester({ root: TYPED_ROOT, hfs }).run("inbox-dedupe-required", inboxDedupeRequired, {
            valid: [
                { filename: SERVICE, code: service("if (!(await this.inbox.claim('billing', delivery.eventId))) return; await this.work()") },
                { filename: SERVICE, code: service("return this.manager.transaction(async (tx) => { if (!(await this.inbox.claim('billing', delivery.eventId, tx))) return; await tx.save({ amount: delivery.amount }) })") },
                { filename: SERVICE, code: delegated("if (!(await this.inbox.claim('billing', delivery.eventId, manager))) return; await manager.save({ amount: delivery.amount })") },
                // claimRow on the EntityInbox port: the receipt id it answers is undefined on a repeat, and the method returns on it.
                { filename: SERVICE, code: entityService(inTransaction(`const receiptId = ${claimRow()}; if (receiptId === undefined) return; await tx.save({ receiptId })`)) },
                { filename: SERVICE, code: entityService(inTransaction(`const receiptId = ${claimRow()}; if (!receiptId) { return }; await tx.save({ receiptId })`)) },
                { filename: SERVICE, code: entityService(inTransaction(`if ((${claimRow()}) === undefined) return; await tx.save({ amount: delivery.amount })`)) },
                { filename: SERVICE, code: entityService(`const receiptId = ${claimRow("this.manager")}; if (receiptId === undefined) return; await this.work()`) },
                // An EntityInbox is an Inbox: its plain claim still satisfies the rule.
                { filename: SERVICE, code: entityService(inTransaction("if (!(await this.inbox.claim('billing', delivery.eventId, tx))) return; await tx.save({ amount: delivery.amount })")) },
            ],
            invalid: [
                { filename: SERVICE, code: service("await this.work()"), errors: [{ messageId: "noClaim" }] },
                { filename: SERVICE, code: service("await this.work(); if (!(await this.inbox.claim('billing', delivery.eventId))) return"), errors: [{ messageId: "noClaim" }] },
                { filename: SERVICE, code: service("await this.inbox.claim('billing', delivery.eventId); await this.work()"), errors: [{ messageId: "noEarlyReturn" }] },
                { filename: SERVICE, code: service("return this.manager.transaction(async (tx) => { await this.inbox.claim('billing', delivery.eventId, tx); await tx.save({ amount: delivery.amount }) })"), errors: [{ messageId: "noEarlyReturn" }] },
                { filename: SERVICE, code: delegated("await manager.save({ amount: delivery.amount })"), errors: [{ messageId: "noClaim" }] },
                { filename: SERVICE, code: delegated("const pending = manager.save({ amount: delivery.amount }); if (!(await this.inbox.claim('billing', delivery.eventId, manager))) return; await pending"), errors: [{ messageId: "noClaim" }] },
                // claimRow keeps the same guarantees: first await, the real port, and a return on the repeat answer.
                { filename: SERVICE, code: entityService(inTransaction(`await tx.save({ amount: delivery.amount }); const receiptId = ${claimRow()}; if (receiptId === undefined) return`)), errors: [{ messageId: "noClaim" }] },
                { filename: SERVICE, code: entityService(inTransaction(`const receiptId = ${claimRow()}; if (receiptId === undefined) return`), "Lookalike"), errors: [{ messageId: "noClaim" }] },
                { filename: SERVICE, code: entityService(inTransaction("const receiptId = await this.inbox.claimRow('billing', delivery.eventId, tx); if (receiptId === undefined) return")), errors: [{ messageId: "noClaim" }] },
                { filename: SERVICE, code: entityService(inTransaction(`const receiptId = ${claimRow()}; await tx.save({ receiptId })`)), errors: [{ messageId: "noEarlyReturn" }] },
                { filename: SERVICE, code: entityService(inTransaction(`const receiptId = ${claimRow()}; if (receiptId === false) return; await tx.save({ receiptId })`)), errors: [{ messageId: "noEarlyReturn" }] },
                { filename: SERVICE, code: entityService(inTransaction(`const receiptId = ${claimRow()}; await tx.save({ receiptId }); if (receiptId === undefined) return`)), errors: [{ messageId: "noEarlyReturn" }] },
            ],
        })
    })
}
