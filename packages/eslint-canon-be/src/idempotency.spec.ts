import test from "node:test"
import { at, typedTester } from "../fixtures/typed/tester.mjs"
import { inboxDedupeRequired } from "./idempotency.ts"

const tester = typedTester()
const SERVICE = at("src/modules/domain/order/billing.service.ts")
const BUS = at("src/modules/platform/event-bus/event-bus.service.ts")
const CONSUMER = at("src/features/api/checkout/transport/message/payment-captured.consumer.ts")
const SPEC = at("src/modules/domain/order/billing.service.spec.ts")
const PRELUDE = [
    'import type { Inbox } from "@modules/platform/inbox/inbox.port"',
    'import type { Inbox as Lookalike } from "@modules/domain/order/lookalike.service"',
    "interface Delivery { eventId: string; amount: number }",
].join("\n")
const withPrelude = (body: string) => `${PRELUDE}\n${body}`

test("a service method that takes a delivery claims the event on the Inbox port first and returns on false", () => {
    tester.run("inbox-dedupe-required", inboxDedupeRequired, {
        valid: [
            // the event bus publishes an event (its shape carries an eventId); it receives no delivery
            {
                name: "event bus publishes", filename: BUS,
                code: withPrelude("class C { async publish(event: Delivery) { await this.send(event) }\n private async send(e: Delivery) { return e } }"),
            },
            // the claim as the negated test of an early return
            {
                name: "case 1", filename: SERVICE,
                code: withPrelude("class C { constructor(private readonly inbox: Inbox) {}\n async handle(m: Delivery) { if (!(await this.inbox.claim('billing', m.eventId))) return\n await this.work() }\n private async work() { await this.inbox.claim('x', 'y') } }"),
            },
            // the claim stored, then refused on the next statement; the receiver's name is irrelevant
            {
                name: "case 2", filename: SERVICE,
                code: withPrelude("class C { constructor(private readonly seen: Inbox) {}\n async handle(m: Delivery) { const fresh = await this.seen.claim('billing', m.eventId)\n if (!fresh) { return }\n await this.work() }\n private async work() {} }"),
            },
            // compared to false, in a block that logs then returns
            {
                name: "case 3", filename: SERVICE,
                code: withPrelude("class C { constructor(private readonly inbox: Inbox) {}\n async handle(m: Delivery) { if ((await this.inbox.claim('billing', m.eventId)) === false) { console.log('dup'); return }\n await this.work() }\n private async work() {} }"),
            },
            // a claim that also takes the transaction manager
            {
                name: "case 4", filename: SERVICE,
                code: withPrelude("class C { constructor(private readonly inbox: Inbox) {}\n async handle(m: Delivery, manager: object) { if (!(await this.inbox.claim('billing', m.eventId, manager))) return\n await this.work() }\n private async work() {} }"),
            },
            // a method whose first parameter has no eventId is not a delivery
            { name: "case 5", filename: SERVICE, code: withPrelude("class C { async total(input: { amount: number }) { await this.work() }\n private async work() {} }") },
            // the delivery must be the FIRST parameter
            { name: "case 6", filename: SERVICE, code: withPrelude("class C { async total(scale: number, m: Delivery) { await this.work() }\n private async work() {} }") },
            // private and protected helpers of a service are not entry points
            { name: "case 7", filename: SERVICE, code: withPrelude("class C { private async apply(m: Delivery) { await this.work() }\n protected async step(m: Delivery) { await this.work() }\n private async work() {} }") },
            // doors are judged by transport-is-thin, not here
            { name: "case 8", filename: CONSUMER, code: withPrelude("class C { async handle(m: Delivery) { await this.work() }\n private async work() {} }") },
            // a spec is not a service
            { name: "case 9", filename: SPEC, code: withPrelude("class C { async handle(m: Delivery) { await this.work() }\n private async work() {} }") },
        ],
        invalid: [
            // no claim at all
            { name: "case 10", filename: SERVICE, code: withPrelude("class C { async handle(m: Delivery) { await this.work() }\n private async work() {} }"), errors: [{ messageId: "noClaim" }] },
            // a method that never awaits
            { name: "case 11", filename: SERVICE, code: withPrelude("class C { handle(m: Delivery) { this.work() }\n private work() {} }"), errors: [{ messageId: "noClaim" }] },
            // keyword-only: the words inbox and claim appear, the type is not the port
            {
                name: "case 12", filename: SERVICE,
                code: withPrelude("class C { constructor(private readonly inbox: Lookalike) {}\n async handle(m: Delivery) { if (!(await this.inbox.claim('billing', m.eventId))) return\n await this.work() }\n private async work() {} }"),
                errors: [{ messageId: "noClaim" }],
            },
            // a claim exists but not as the first awaited expression
            {
                name: "case 13", filename: SERVICE,
                code: withPrelude("class C { constructor(private readonly inbox: Inbox) {}\n async handle(m: Delivery) { await this.work()\n if (!(await this.inbox.claim('billing', m.eventId))) return }\n private async work() {} }"),
                errors: [{ messageId: "noClaim" }],
            },
            // the claim is awaited and ignored
            {
                name: "case 14", filename: SERVICE,
                code: withPrelude("class C { constructor(private readonly inbox: Inbox) {}\n async handle(m: Delivery) { await this.inbox.claim('billing', m.eventId)\n await this.work() }\n private async work() {} }"),
                errors: [{ messageId: "noEarlyReturn" }],
            },
            // the answer is tested but the branch does not return
            {
                name: "case 15", filename: SERVICE,
                code: withPrelude("class C { constructor(private readonly inbox: Inbox) {}\n async handle(m: Delivery) { const fresh = await this.inbox.claim('billing', m.eventId)\n if (!fresh) { console.log('dup') }\n await this.work() }\n private async work() {} }"),
                errors: [{ messageId: "noEarlyReturn" }],
            },
            // a claim with the wrong arity is not `claim(source, eventId)`
            {
                name: "case 16", filename: SERVICE,
                code: withPrelude("class C { constructor(private readonly inbox: Inbox) {}\n async handle(m: Delivery) { if (!(await this.inbox.claim(m.eventId))) return }\n }"),
                errors: [{ messageId: "noClaim" }],
            },
            // a delivery typed as a union, a destructured parameter and a default all still carry eventId
            { name: "case 17", filename: SERVICE, code: withPrelude("class C { async handle(m: Delivery | undefined) { await this.work() }\n private async work() {} }"), errors: [{ messageId: "noClaim" }] },
            { name: "case 18", filename: SERVICE, code: withPrelude("class C { async handle({ eventId }: Delivery) { await this.work() }\n private async work() {} }"), errors: [{ messageId: "noClaim" }] },
        ],
    })
})

const transactionService = (body: string, { asynchronous = false, managerType = "EntityManager", inboxType = "Inbox", declarations = "" } = {}) =>
    PRELUDE + '\nimport type { EntityManager } from "typeorm"\n' + declarations
    + "\nclass C {\n    constructor(private readonly em: " + managerType + ", private readonly other: EntityManager, private readonly inbox: " + inboxType + ") {}"
    + "\n    " + (asynchronous ? "async " : "") + "handle(m: Delivery) { " + body + " }\n    private async work(): Promise<void> {}\n}"

test("delivery claims first with the actual EntityManager callback and cannot escape its duplicate refusal", () => {
    tester.run("inbox-dedupe-required/transaction", inboxDedupeRequired, {
        valid: [
            {
                name: "returned invoice transaction reads a duplicate and writes only after the bound claim", filename: SERVICE,
                code: transactionService("return this.em.transaction(async (tx) => { if (!(await this.inbox.claim('billing', m.eventId, tx))) return await tx.query('read duplicate'); return await tx.save({ amount: m.amount }) })"),
            },
            {
                name: "sole awaited payment transaction returns before work on a duplicate", filename: SERVICE,
                code: transactionService("await this.em.transaction(async (tx) => { if (!(await this.inbox.claim('billing', m.eventId, tx))) return; await tx.save({ amount: m.amount }) })", { asynchronous: true }),
            },
            {
                name: "returned awaited transaction stores its claim and immediately refuses false", filename: SERVICE,
                code: transactionService("return await this.em.transaction(async (tx) => { const fresh = await this.inbox.claim('billing', m.eventId, tx); if (!fresh) return; await tx.save({ amount: m.amount }) })", { asynchronous: true }),
            },
            {
                name: "actual isolation overload uses the second callback", filename: SERVICE,
                code: transactionService("return this.em.transaction('SERIALIZABLE', async (tx) => { if ((await this.inbox.claim('billing', m.eventId, tx)) === false) return; await tx.save({ amount: m.amount }) })"),
            },
            {
                name: "renamed typed ports and manager parameter preserve their origin and binding", filename: SERVICE,
                code: withPrelude('import type { EntityManager as BillingManager } from "typeorm"\nclass C { constructor(private readonly database: BillingManager, private readonly seen: Inbox) {} handle(m: Delivery) { return this.database.transaction(async (unit) => { if (!(await this.seen.claim("billing", m.eventId, unit))) return; await unit.save({ amount: m.amount }) }) } }'),
            },
            {
                name: "function callback selected by TypeORM uses its own parameter and a captured port", filename: SERVICE,
                code: transactionService("return this.em.transaction(async function (tx) { if (!(await mailbox.claim('billing', m.eventId, tx))) return; await tx.save({ amount: m.amount }) })", { declarations: "declare const mailbox: Inbox" }),
            },
        ],
        invalid: [
            { name: "claim missing from selected callback", filename: SERVICE, code: transactionService("return this.em.transaction(async (tx) => { await tx.save({ amount: m.amount }) })"), errors: [{ messageId: "noClaim" }] },
            { name: "claim after the first callback await", filename: SERVICE, code: transactionService("return this.em.transaction(async (tx) => { await tx.save({ amount: m.amount }); if (!(await this.inbox.claim('billing', m.eventId, tx))) return })"), errors: [{ messageId: "noClaim" }] },
            { name: "synchronous callback work before claim", filename: SERVICE, code: transactionService("return this.em.transaction(async (tx) => { this.work(); if (!(await this.inbox.claim('billing', m.eventId, tx))) return })"), errors: [{ messageId: "noClaim" }] },
            { name: "argument effect before the claim call", filename: SERVICE, code: transactionService("return this.em.transaction(async (tx) => { if (!(await this.inbox.claim(String(this.work()), m.eventId, tx))) return })"), errors: [{ messageId: "noClaim" }] },
            { name: "same parameter reassigned while evaluating claim arguments", filename: SERVICE, code: transactionService("return this.em.transaction(async (tx) => { if (!(await this.inbox.claim((tx = this.other, 'billing'), m.eventId, tx))) return })"), errors: [{ messageId: "noClaim" }] },
            { name: "claim hidden under a conditional path", filename: SERVICE, code: transactionService("return this.em.transaction(async (tx) => { if (m.amount > 0) { if (!(await this.inbox.claim('billing', m.eventId, tx))) return } await tx.save({ amount: m.amount }) })"), errors: [{ messageId: "noClaim" }] },
            { name: "claim hidden in another callback", filename: SERVICE, code: transactionService("return this.em.transaction(async (tx) => { const later = async () => { if (!(await this.inbox.claim('billing', m.eventId, tx))) return }; await tx.save({ amount: m.amount }); await later() })"), errors: [{ messageId: "noClaim" }] },
            { name: "TypeORM runs the first callback and ignores the convincing second one", filename: SERVICE, code: transactionService("return this.em.transaction(async (tx) => { await tx.save({ amount: m.amount }) }, async (tx) => { if (!(await this.inbox.claim('billing', m.eventId, tx))) return })"), errors: [{ messageId: "noClaim" }] },
            { name: "non-inline callback is not inspected", filename: SERVICE, code: transactionService("return this.em.transaction(handler)", { declarations: "declare const handler: (tx: EntityManager) => Promise<void>" }), errors: [{ messageId: "noClaim" }] },
            { name: "unknown isolation argument cannot choose a proof callback", filename: SERVICE, code: transactionService("return this.em.transaction('NOT-AN-ISOLATION', async (tx) => { if (!(await this.inbox.claim('billing', m.eventId, tx))) return })"), errors: [{ messageId: "noClaim" }] },
            { name: "claim omits transaction manager", filename: SERVICE, code: transactionService("return this.em.transaction(async (tx) => { if (!(await this.inbox.claim('billing', m.eventId))) return; await tx.save({ amount: m.amount }) })"), errors: [{ messageId: "noClaim" }] },
            { name: "claim uses outer shared manager", filename: SERVICE, code: transactionService("return this.em.transaction(async (tx) => { if (!(await this.inbox.claim('billing', m.eventId, this.em))) return; await tx.save({ amount: m.amount }) })"), errors: [{ messageId: "noClaim" }] },
            { name: "same typed manager from another binding is not the transaction parameter", filename: SERVICE, code: transactionService("return this.em.transaction(async (tx) => { if (!(await this.inbox.claim('billing', m.eventId, other))) return; await tx.save({ amount: m.amount }) })", { declarations: "declare const other: EntityManager" }), errors: [{ messageId: "noClaim" }] },
            { name: "same spelling in a nested shadow is not the selected parameter", filename: SERVICE, code: transactionService("return this.em.transaction(async (tx) => { { const tx = this.other; if (!(await this.inbox.claim('billing', m.eventId, tx))) return }; await tx.save({ amount: m.amount }) })"), errors: [{ messageId: "noClaim" }] },
            { name: "lookalike Inbox cannot claim for the platform owner", filename: SERVICE, code: transactionService("return this.em.transaction(async (tx) => { if (!(await this.inbox.claim('billing', m.eventId, tx))) return })", { inboxType: "Lookalike" }), errors: [{ messageId: "noClaim" }] },
            { name: "lookalike transaction receiver cannot grant a transaction", filename: SERVICE, code: transactionService("return this.em.transaction(async (tx) => { if (!(await this.inbox.claim('billing', m.eventId, tx))) return })", { managerType: "PretendManager", declarations: "declare class PretendManager { transaction<T>(work: (tx: EntityManager) => Promise<T>): Promise<T> }" }), errors: [{ messageId: "noClaim" }] },
            { name: "outer awaited work before returned transaction", filename: SERVICE, code: transactionService("await this.work(); return this.em.transaction(async (tx) => { if (!(await this.inbox.claim('billing', m.eventId, tx))) return })", { asynchronous: true }), errors: [{ messageId: "noClaim" }] },
            { name: "duplicate callback refusal cannot fall through to outer work", filename: SERVICE, code: transactionService("await this.em.transaction(async (tx) => { if (!(await this.inbox.claim('billing', m.eventId, tx))) return }); await this.work()", { asynchronous: true }), errors: [{ messageId: "noClaim" }] },
            { name: "unawaited transaction cannot detach delivery completion", filename: SERVICE, code: transactionService("this.em.transaction(async (tx) => { if (!(await this.inbox.claim('billing', m.eventId, tx))) return })"), errors: [{ messageId: "noClaim" }] },
            { name: "claim answer ignored in the correct transaction", filename: SERVICE, code: transactionService("return this.em.transaction(async (tx) => { await this.inbox.claim('billing', m.eventId, tx); await tx.save({ amount: m.amount }) })"), errors: [{ messageId: "noEarlyReturn" }] },
            { name: "stored claim cannot run work before testing false", filename: SERVICE, code: transactionService("return this.em.transaction(async (tx) => { const fresh = await this.inbox.claim('billing', m.eventId, tx); await tx.save({ amount: m.amount }); if (!fresh) return })"), errors: [{ messageId: "noEarlyReturn" }] },
        ],
    })
})

const CLAIM_FIRST = "const key = keyOf(m.eventId); if (!(await this.inbox.claim('billing', key, manager))) return this.read(manager); return this.work(manager)"
const delegatedService = (delivery: string, helper = CLAIM_FIRST, {
    runner = "EntityManager", asynchronous = false, helperAccess = "private", declarations = "",
    helperName = "handleInTransaction", helperParams = "m: Delivery, manager: EntityManager", helperAsync = true,
    members = "", subclasses = "", constructorBody = "",
    transactionImport = 'import type { WriteTransaction } from "@modules/platform/database/transaction.port"',
} = {}) =>
    PRELUDE + '\nimport type { EntityManager } from "typeorm"\n' + transactionImport + "\n"
    + "declare function keyOf(eventId: string): string\n" + declarations
    + "\nclass C {\n    constructor(private readonly em: " + runner + ", private readonly other: EntityManager, private readonly inbox: Inbox) { " + constructorBody + " }"
    + "\n    " + (asynchronous ? "async " : "") + "handle(m: Delivery) { " + delivery + " }"
    + "\n    " + members
    + "\n    " + helperAccess + " " + (helperAsync ? "async " : "") + helperName + "(" + helperParams + ") { " + helper + " }"
    + "\n    private async read(manager: EntityManager): Promise<void> {}\n    private async work(manager: EntityManager): Promise<void> {}\n}"
    + "\n" + subclasses
const DELEGATE = "return this.em.transaction((tx) => this.handleInTransaction(m, tx))"
const PRETEND_RUNNER = "declare class PretendRunner { transaction<T>(work: (tx: EntityManager) => Promise<T>): Promise<T> }"

test("delivery delegates its claim to a typed helper inside the one write transaction a typed runner runs", () => {
    tester.run("inbox-dedupe-required/delegated", inboxDedupeRequired, {
        valid: [
            { name: "own EntityManager transaction hands the delivery and its manager to a public claiming helper", filename: SERVICE, code: delegatedService(DELEGATE, CLAIM_FIRST, { helperAccess: "public" }) },
            { name: "public delivery helper prepares a template key with a free function and returns the repeated read", filename: SERVICE, code: delegatedService(DELEGATE, "const key = `billing:${keyOf(m.eventId)}`; if (!(await this.inbox.claim('billing', key, manager))) return this.read(manager); return this.work(manager)", { helperAccess: "public" }) },
            { name: "public helper override with a wider parameter still claims before writing", filename: SERVICE, code: delegatedService(DELEGATE, CLAIM_FIRST, { helperAccess: "public", declarations: "declare const mailbox: Inbox", subclasses: "class D extends C { async handleInTransaction(m: unknown, manager: EntityManager) { if (!(await mailbox.claim('billing', 'event', manager))) return; await manager.save({ amount: 1 }) } }" }) },
            { name: "public helper arrow property override with a wider parameter claims with its manager", filename: SERVICE, code: delegatedService(DELEGATE, CLAIM_FIRST, { helperAccess: "public", declarations: "declare const mailbox: Inbox", subclasses: "class D extends C { handleInTransaction = async (m: unknown, manager: EntityManager) => { if (!(await mailbox.claim('billing', 'event', manager))) return; await manager.save({ amount: 1 }) } }" }) },
            { name: "owned platform database port runs the delegated claim", filename: SERVICE, code: delegatedService(DELEGATE, CLAIM_FIRST, { runner: "WriteTransaction" }) },
            { name: "owned platform database port runs an inline claim", filename: SERVICE, code: delegatedService("return this.em.transaction(async (tx) => { if (!(await this.inbox.claim('billing', m.eventId, tx))) return; await this.work(tx) })", CLAIM_FIRST, { runner: "WriteTransaction" }) },
            { name: "owned platform database port runs an inline function callback", filename: SERVICE, code: delegatedService("return this.em.transaction(async function (tx) { if (!(await mailbox.claim('billing', m.eventId, tx))) return; await tx.save({ amount: m.amount }) })", CLAIM_FIRST, { runner: "WriteTransaction", declarations: "declare const mailbox: Inbox" }) },
            { name: "isolation overload runs the delegated callback", filename: SERVICE, code: delegatedService("return this.em.transaction('SERIALIZABLE', (tx) => this.handleInTransaction(m, tx))") },
            { name: "delegated helper returns when the claim equals false", filename: SERVICE, code: delegatedService(DELEGATE, "if ((await this.inbox.claim('billing', m.eventId, manager)) === false) { return } await this.work(manager)") },
            { name: "private identifier helper cannot be overridden", filename: SERVICE, code: delegatedService("return this.em.transaction((tx) => this.#handleInTransaction(m, tx))", CLAIM_FIRST, { helperName: "#handleInTransaction", helperAccess: "" }) },
            { name: "erased this parameter preserves the real manager position", filename: SERVICE, code: delegatedService(DELEGATE, CLAIM_FIRST, { helperParams: "this: C, m: Delivery, manager: EntityManager" }) },
            { name: "optional manager keeps its EntityManager origin", filename: SERVICE, code: delegatedService(DELEGATE, "if (!(await this.inbox.claim('billing', m.eventId, manager))) return", { helperParams: "m: Delivery, manager?: EntityManager" }) },
            { name: "awaited transaction with a block callback returning the awaited helper that stores its claim", filename: SERVICE, code: delegatedService("await this.em.transaction(async (tx) => { return await this.handleInTransaction(m, tx) })", "const fresh = await this.inbox.claim('billing', m.eventId, manager); if (!fresh) return; await this.work(manager)", { asynchronous: true }) },
        ],
        invalid: [
            { name: "helper never claims", filename: SERVICE, code: delegatedService(DELEGATE, "await this.work(manager)"), errors: [{ messageId: "noClaim" }] },
            { name: "helper awaits work before the claim", filename: SERVICE, code: delegatedService(DELEGATE, "await this.work(manager); if (!(await this.inbox.claim('billing', m.eventId, manager))) return"), errors: [{ messageId: "noClaim" }] },
            { name: "helper runs a statement before the claim", filename: SERVICE, code: delegatedService(DELEGATE, "void this.work(manager); if (!(await this.inbox.claim('billing', m.eventId, manager))) return"), errors: [{ messageId: "noClaim" }] },
            { name: "const prelude starts a manager write before the claim", filename: SERVICE, code: delegatedService(DELEGATE, "const pending = manager.save({ amount: m.amount }); if (!(await this.inbox.claim('billing', m.eventId, manager))) return; await pending"), errors: [{ messageId: "noClaim" }] },
            { name: "const prelude starts helper work before the claim", filename: SERVICE, code: delegatedService(DELEGATE, "const pending = this.work(manager); if (!(await this.inbox.claim('billing', m.eventId, manager))) return; await pending"), errors: [{ messageId: "noClaim" }] },
            { name: "const prelude invokes an async function before the claim", filename: SERVICE, code: delegatedService(DELEGATE, "const started = (async () => { await this.work(manager) })(); if (!(await this.inbox.claim('billing', m.eventId, manager))) return; await started"), errors: [{ messageId: "noClaim" }] },
            { name: "const prelude passes the manager into a free function", filename: SERVICE, code: delegatedService(DELEGATE, "const key = managerKey(manager); if (!(await this.inbox.claim('billing', key, manager))) return", { declarations: "declare function managerKey(manager: EntityManager): string" }), errors: [{ messageId: "noClaim" }] },
            { name: "const prelude constructs an effectful object", filename: SERVICE, code: delegatedService(DELEGATE, "const key = new Key(m.eventId); if (!(await this.inbox.claim('billing', key.value, manager))) return", { declarations: "declare class Key { constructor(id: string); value: string }" }), errors: [{ messageId: "noClaim" }] },
            { name: "const prelude writes a delivery property", filename: SERVICE, code: delegatedService(DELEGATE, "const amount = (m.amount = 0); if (!(await this.inbox.claim('billing', m.eventId, manager))) return"), errors: [{ messageId: "noClaim" }] },
            { name: "const prelude updates a delivery property", filename: SERVICE, code: delegatedService(DELEGATE, "const amount = m.amount++; if (!(await this.inbox.claim('billing', m.eventId, manager))) return"), errors: [{ messageId: "noClaim" }] },
            { name: "helper claims under a conditional path", filename: SERVICE, code: delegatedService(DELEGATE, "if (m.amount > 0) { if (!(await this.inbox.claim('billing', m.eventId, manager))) return } await this.work(manager)"), errors: [{ messageId: "noClaim" }] },
            { name: "helper claims with the shared manager", filename: SERVICE, code: delegatedService(DELEGATE, "if (!(await this.inbox.claim('billing', m.eventId, this.other))) return; await this.work(manager)"), errors: [{ messageId: "noClaim" }] },
            { name: "helper claims without a manager", filename: SERVICE, code: delegatedService(DELEGATE, "if (!(await this.inbox.claim('billing', m.eventId))) return; await this.work(manager)"), errors: [{ messageId: "noClaim" }] },
            { name: "helper reassigns its manager before the claim", filename: SERVICE, code: delegatedService(DELEGATE, "const swap = (manager = this.other); if (!(await this.inbox.claim('billing', swap ? m.eventId : '', manager))) return"), errors: [{ messageId: "noClaim" }] },
            { name: "callback hands the helper another manager", filename: SERVICE, code: delegatedService("return this.em.transaction((tx) => this.handleInTransaction(m, this.other))"), errors: [{ messageId: "noClaim" }] },
            { name: "erased this parameter cannot shift proof to the shared manager", filename: SERVICE, code: delegatedService("return this.em.transaction((tx) => this.handleInTransaction(m, this.other, tx))", "if (!(await this.inbox.claim('billing', m.eventId, manager))) return; await this.work(tx)", { helperParams: "this: C, m: Delivery, manager: EntityManager, tx: EntityManager" }), errors: [{ messageId: "noClaim" }] },
            { name: "spread tuple cannot shift proof to the shared manager", filename: SERVICE, code: delegatedService("return this.em.transaction((tx) => this.handleInTransaction(...([m, this.other] as const), tx))", "if (!(await this.inbox.claim('billing', m.eventId, manager))) return; await this.work(tx)", { helperParams: "m: Delivery, manager: EntityManager, tx: EntityManager" }), errors: [{ messageId: "noClaim" }] },
            { name: "empty spread cannot prove a fixed manager position", filename: SERVICE, code: delegatedService("return this.em.transaction((tx) => this.handleInTransaction(...([] as []), m, tx))"), errors: [{ messageId: "noClaim" }] },
            { name: "protected helper may be overridden without a delivery check", filename: SERVICE, code: delegatedService(DELEGATE, CLAIM_FIRST, { helperAccess: "protected", subclasses: "class D extends C { protected async handleInTransaction(m: Delivery, manager: EntityManager) { await manager.save({ amount: m.amount }) } }" }), errors: [{ messageId: "noClaim" }] },
            { name: "public helper whose first parameter is not a delivery may be overridden unjudged", filename: SERVICE, code: delegatedService("return this.em.transaction((tx) => this.handleInTransaction(1, m, tx))", CLAIM_FIRST, { helperAccess: "public", helperParams: "scale: number, m: Delivery, manager: EntityManager", subclasses: "class D extends C { async handleInTransaction(scale: number, m: Delivery, manager: EntityManager) { await manager.save({ amount: m.amount * scale }) } }" }), errors: [{ messageId: "noClaim" }] },
            { name: "public helper override cannot hide the delivery by widening its parameter", filename: SERVICE, code: delegatedService(DELEGATE, CLAIM_FIRST, { helperAccess: "public", subclasses: "class D extends C { async handleInTransaction(m: unknown, manager: EntityManager) { await manager.save({ amount: 1 }) } }" }), errors: [{ messageId: "noClaim" }] },
            { name: "grandchild override inherits the delivery obligation through a wider parent parameter", filename: SERVICE, code: delegatedService(DELEGATE, CLAIM_FIRST, { helperAccess: "public", declarations: "declare const mailbox: Inbox", subclasses: "class D extends C { async handleInTransaction(m: unknown, manager: EntityManager) { if (!(await mailbox.claim('billing', 'event', manager))) return; await manager.save({ amount: 1 }) } }\nclass E extends D { async handleInTransaction(m: unknown, manager: EntityManager) { await manager.save({ amount: 2 }) } }" }), errors: [{ messageId: "noClaim" }] },
            { name: "public helper arrow property override must claim the delivery", filename: SERVICE, code: delegatedService(DELEGATE, CLAIM_FIRST, { helperAccess: "public", subclasses: "class D extends C { handleInTransaction = async (m: Delivery, manager: EntityManager) => { await manager.save({ amount: m.amount }) } }" }), errors: [{ messageId: "noClaim" }] },
            { name: "public helper arrow property override cannot hide the delivery with unknown", filename: SERVICE, code: delegatedService(DELEGATE, CLAIM_FIRST, { helperAccess: "public", subclasses: "class D extends C { handleInTransaction = async (m: unknown, manager: EntityManager) => { await manager.save({ amount: 1 }) } }" }), errors: [{ messageId: "noClaim" }] },
            { name: "public helper override cannot claim on a shared manager before transaction work", filename: SERVICE, code: delegatedService(DELEGATE, CLAIM_FIRST, { helperAccess: "public", declarations: "declare const mailbox: Inbox", subclasses: "class D extends C { constructor(private readonly shared: EntityManager) { super(shared, shared, mailbox) } async handleInTransaction(m: unknown, manager: EntityManager) { if (!(await mailbox.claim('billing', 'event', this.shared))) return; await manager.save({ amount: 1 }) } }" }), errors: [{ messageId: "noClaim" }] },
            { name: "public helper override cannot omit the transaction manager from its claim", filename: SERVICE, code: delegatedService(DELEGATE, CLAIM_FIRST, { helperAccess: "public", declarations: "declare const mailbox: Inbox", subclasses: "class D extends C { async handleInTransaction(m: unknown, manager: EntityManager) { if (!(await mailbox.claim('billing', 'event'))) return; await manager.save({ amount: 1 }) } }" }), errors: [{ messageId: "noClaim" }] },
            { name: "public helper override cannot start a const write before its bound claim", filename: SERVICE, code: delegatedService(DELEGATE, CLAIM_FIRST, { helperAccess: "public", declarations: "declare const mailbox: Inbox", subclasses: "class D extends C { async handleInTransaction(m: unknown, manager: EntityManager) { const pending = manager.save({ amount: 1 }); if (!(await mailbox.claim('billing', 'event', manager))) return; await pending } }" }), errors: [{ messageId: "noClaim" }] },
            { name: "constructor replaces the judged helper on the instance", filename: SERVICE, code: delegatedService(DELEGATE, CLAIM_FIRST, { constructorBody: "this.handleInTransaction = async (m: Delivery, manager: EntityManager) => { await this.work(manager) }" }), errors: [{ messageId: "noClaim" }] },
            { name: "another method replaces the judged helper on the instance", filename: SERVICE, code: delegatedService(DELEGATE, CLAIM_FIRST, { members: "init() { this.handleInTransaction = async (m: Delivery, manager: EntityManager) => { await this.work(manager) } }" }), errors: [{ messageId: "noClaim" }] },
            { name: "promise-returning helper is not an async claim body", filename: SERVICE, code: delegatedService(DELEGATE, "return this.inbox.claim('billing', m.eventId, manager).then((fresh) => { if (!fresh) return; return this.work(manager) })", { helperAsync: false }), errors: [{ messageId: "noClaim" }] },
            { name: "overloaded helper cannot be resolved to one declaration", filename: SERVICE, code: delegatedService(DELEGATE, CLAIM_FIRST, { members: "private handleInTransaction(m: Delivery, manager: EntityManager): Promise<void>;" }), errors: [{ messageId: "noClaim" }] },
            { name: "database port called with two arguments cannot select a callback", filename: SERVICE, code: delegatedService("return this.em.transaction((tx) => this.handleInTransaction(m, tx), 1 as never)", CLAIM_FIRST, { runner: "WriteTransaction" }), errors: [{ messageId: "noClaim" }] },
            { name: "lookalike runner declared by no package or database owner", filename: SERVICE, code: delegatedService(DELEGATE, CLAIM_FIRST, { runner: "PretendRunner", declarations: PRETEND_RUNNER }), errors: [{ messageId: "noClaim" }] },
            { name: "local interface named WriteTransaction is not the database port", filename: SERVICE, code: delegatedService(DELEGATE, CLAIM_FIRST, { runner: "WriteTransaction", transactionImport: "", declarations: "interface WriteTransaction { transaction<T>(work: (tx: EntityManager) => Promise<T>): Promise<T> }" }), errors: [{ messageId: "noClaim" }] },
            { name: "WriteTransaction declared by platform cache is not the database port", filename: SERVICE, code: delegatedService(DELEGATE, CLAIM_FIRST, { runner: "CacheTransaction", declarations: 'import type { WriteTransaction as CacheTransaction } from "@modules/platform/cache/transaction.port"' }), errors: [{ messageId: "noClaim" }] },
            { name: "database port union includes a lookalike runner", filename: SERVICE, code: delegatedService(DELEGATE, CLAIM_FIRST, { runner: "WriteTransaction | PretendRunner", declarations: PRETEND_RUNNER }), errors: [{ messageId: "noClaim" }] },
            { name: "EntityManager union includes a lookalike runner", filename: SERVICE, code: delegatedService(DELEGATE, CLAIM_FIRST, { runner: "EntityManager | PretendRunner", declarations: PRETEND_RUNNER }), errors: [{ messageId: "noClaim" }] },
            { name: "callback manager union includes a lookalike", filename: SERVICE, code: delegatedService("return this.em.transaction((tx: EntityManager | PretendRunner) => this.handleInTransaction(m, tx))", CLAIM_FIRST, { declarations: PRETEND_RUNNER }), errors: [{ messageId: "noClaim" }] },
            { name: "helper manager union includes a lookalike", filename: SERVICE, code: delegatedService(DELEGATE, "if (!(await this.inbox.claim('billing', m.eventId, manager))) return", { helperParams: "m: Delivery, manager: EntityManager | PretendRunner", declarations: PRETEND_RUNNER }), errors: [{ messageId: "noClaim" }] },
            { name: "callback hands the work to another object", filename: SERVICE, code: delegatedService("return this.em.transaction((tx) => peer.handleInTransaction(m, tx))", CLAIM_FIRST, { declarations: "declare const peer: { handleInTransaction(m: Delivery, manager: EntityManager): Promise<void> }" }), errors: [{ messageId: "noClaim" }] },
            { name: "callback detaches the helper promise", filename: SERVICE, code: delegatedService("return this.em.transaction(async (tx) => { void this.handleInTransaction(m, tx) })"), errors: [{ messageId: "noClaim" }] },
            { name: "function callback rebinds this", filename: SERVICE, code: delegatedService("return this.em.transaction(function (tx) { return this.handleInTransaction(m, tx) })"), errors: [{ messageId: "noClaim" }] },
            { name: "outer work after the delegated transaction", filename: SERVICE, code: delegatedService("await this.em.transaction((tx) => this.handleInTransaction(m, tx)); await this.work(this.other)", CLAIM_FIRST, { asynchronous: true }), errors: [{ messageId: "noClaim" }] },
            { name: "helper ignores the claim answer", filename: SERVICE, code: delegatedService(DELEGATE, "await this.inbox.claim('billing', m.eventId, manager); await this.work(manager)"), errors: [{ messageId: "noEarlyReturn" }] },
            { name: "helper runs work before testing its stored claim", filename: SERVICE, code: delegatedService(DELEGATE, "const fresh = await this.inbox.claim('billing', m.eventId, manager); await this.work(manager); if (!fresh) return"), errors: [{ messageId: "noEarlyReturn" }] },
        ],
    })
})
