/**
 * Twin tests for the lite event-bus law (R336 `BE_EVENT_BUS_LITE_SHAPE`): an event payload carries a business dedupe key, and a
 * subscription is static data. The @starci/hfs lite templates of the receipt event and the event bus pass both rules.
 *
 *   node --test src/event-bus-lite.spec.ts
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import tsParser from "@typescript-eslint/parser"
import { canonRuleTester } from "../fixtures/rule-tester.ts"
import { appDeclaration } from "../fixtures/app.ts"
import { at, BE_DECLARATION, TYPED_ROOT } from "../fixtures/typed/tester.ts"
import { hfsFromDeclaration } from "./lib/hfs.ts"
import { eventDedupeKey, eventSubscriptionStatic, rules } from "./event-bus-lite.ts"

const testerFor = (edition: "lite" | "full") => canonRuleTester({
    languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module" },
    settings: { starci: { hfs: hfsFromDeclaration({ ...appDeclaration("be", BE_DECLARATION), edition }, TYPED_ROOT) } },
})
const lite = testerFor("lite")
const full = testerFor("full")

const EVENT = at("src/modules/events/billing/order-paid.event.ts")
const REACTOR = at("src/features/reactors/mailer/transport/message/order-paid.consumer.ts")
const HEAD = "import { BaseEvent } from \"@modules/platform/event-bus\"\nimport type { EventPayload } from \"@modules/platform/event-bus\"\n"
const eventWith = (payload: string, declarations = "") => `${HEAD}${declarations}\nexport class OrderPaidEvent extends BaseEvent {\n    readonly eventId = "e"\n    readonly eventName = "billing.order-paid"\n    constructor(readonly payload: ${payload}) { super() }\n}\n`

const RECEIPT_TEMPLATE = new URL("../../hfs/templates/be/inbox/delivery-recorded.event.ts.tpl", import.meta.url)
const receiptEvent = readFileSync(RECEIPT_TEMPLATE, "utf8").replaceAll("@@Provider@@", "Stripe").replaceAll("@@provider@@", "stripe")

const SUBSCRIBE_HEAD = "import { InjectEventConsumerRegistry, BILLING_ORDER_PAID_MAILER_TOPIC_QUEUE } from \"@modules/platform/event-bus\"\ndeclare const registry: { subscribe(queue: string, consumer: unknown, options?: object): void }\ndeclare const consumer: unknown\n"

test("the law publishes its rules under their names", () => {
    assert.equal(rules["event-dedupe-key"], eventDedupeKey)
    assert.equal(rules["event-subscription-static"], eventSubscriptionStatic)
})

test("event-dedupe-key: a lite event payload declares dedupeKey", () => {
    lite.run("event-dedupe-key", eventDedupeKey, {
        valid: [
            { filename: EVENT, code: eventWith("OrderPaidPayload", "export interface OrderPaidPayload { readonly dedupeKey: string; readonly orderId: string }") },
            { filename: EVENT, code: eventWith("OrderPaidPayload", "interface OrderPaidPayload extends EventPayload { readonly orderId: string }") },
            { filename: EVENT, code: eventWith("{ readonly dedupeKey: string }") },
            { filename: EVENT, code: eventWith("EventPayload & { readonly orderId: string }") },
            { filename: EVENT, code: eventWith("Paid", "interface Keyed { readonly dedupeKey: string }\ntype Paid = Keyed & { readonly orderId: string }") },
            { filename: at("src/modules/events/stripe/stripe-delivery-recorded.event.ts"), code: receiptEvent },
            { filename: at("src/modules/domain/billing/order.contracts.ts"), code: eventWith("{ readonly orderId: string }") },
        ],
        invalid: [
            { filename: EVENT, code: eventWith("OrderPaidPayload", "export interface OrderPaidPayload { readonly orderId: string }"), errors: [{ messageId: "missing" }] },
            { filename: EVENT, code: eventWith("{ readonly orderId: string }"), errors: [{ messageId: "missing" }] },
            { filename: EVENT, code: eventWith("ImportedPayload"), errors: [{ messageId: "missing" }] },
            { filename: EVENT, code: `${HEAD}export class OrderPaidEvent extends BaseEvent {\n    readonly eventId = "e"\n    readonly eventName = "billing.order-paid"\n    readonly payload = { orderId: "o" }\n}\n`, errors: [{ messageId: "missing" }] },
        ],
    })
})

test("event-subscription-static: a lite subscription names an imported topic-queue constant and literal options", () => {
    lite.run("event-subscription-static", eventSubscriptionStatic, {
        valid: [
            { filename: REACTOR, code: `${SUBSCRIBE_HEAD}registry.subscribe(BILLING_ORDER_PAID_MAILER_TOPIC_QUEUE, consumer)` },
            { filename: REACTOR, code: `${SUBSCRIBE_HEAD}registry.subscribe(BILLING_ORDER_PAID_MAILER_TOPIC_QUEUE, consumer, { maxDeliveries: 8 })` },
            { filename: REACTOR, code: "declare const emitter: { subscribe(topic: string, handler: unknown): void }\nemitter.subscribe(\"anything\", () => undefined)" },
        ],
        invalid: [
            { filename: REACTOR, code: `${SUBSCRIBE_HEAD}registry.subscribe("billing_order_paid__mailer", consumer)`, errors: [{ messageId: "queue" }] },
            { filename: REACTOR, code: `${SUBSCRIBE_HEAD}const LOCAL_TOPIC_QUEUE = "q"\nregistry.subscribe(LOCAL_TOPIC_QUEUE, consumer)`, errors: [{ messageId: "queue" }] },
            { filename: REACTOR, code: `${SUBSCRIBE_HEAD}declare const name: string\nregistry.subscribe(\`\${name}__mailer\`, consumer)`, errors: [{ messageId: "queue" }] },
            { filename: REACTOR, code: `${SUBSCRIBE_HEAD}declare const budget: number\nregistry.subscribe(BILLING_ORDER_PAID_MAILER_TOPIC_QUEUE, consumer, { maxDeliveries: budget })`, errors: [{ messageId: "options" }] },
        ],
    })
})

test("both rules leave a full app to its Kafka bus", () => {
    full.run("event-dedupe-key", eventDedupeKey, { valid: [{ filename: EVENT, code: eventWith("{ readonly orderId: string }") }], invalid: [] })
    full.run("event-subscription-static", eventSubscriptionStatic, { valid: [{ filename: REACTOR, code: `${SUBSCRIBE_HEAD}registry.subscribe("q", consumer)` }], invalid: [] })
})
