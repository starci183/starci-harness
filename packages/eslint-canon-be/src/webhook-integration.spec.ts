/** The complete provider door must satisfy the webhook and thin-feature laws together. */
import test from "node:test"
import { BE_DECLARATION, at, typedTester } from "../fixtures/typed/tester.ts"
import { featureThin } from "./feature-thin.ts"
import { webhookShape, webhookVerifyFirst } from "./webhooks.ts"
import type { Context, Node, Report, RuleModule } from "./lib/rule.ts"

const laws = { shape: webhookShape, proof: webhookVerifyFirst, thin: featureThin }
const tester = typedTester({ declaration: { ...BE_DECLARATION, patterns: ["webhooks"] } })
const filename = at("src/features/webhooks/meta/transport/http/meta.webhook.ts")

/** Compose the real visitors, retaining each law's distinct diagnostic identity. */
const combined: RuleModule = {
    meta: {
        type: "problem",
        schema: [],
        messages: Object.fromEntries(Object.entries(laws).flatMap(([name, law]) =>
            Object.entries(law.meta.messages).map(([id, message]) => [`${name}_${id}`, message]))),
    },
    create(context) {
        const visitors = new Map<string, unknown[]>()
        for (const [name, law] of Object.entries(laws)) {
            const report = (finding: Report): void => context.report({ ...finding, messageId: `${name}_${finding.messageId}` })
            // The law sees the real context with its own `report`; every other member is read from the context itself.
            const scoped = new Proxy<Context>({ ...context }, {
                get: (_target, key): unknown => key === "report" ? report : Reflect.get(context, key),
                has: (_target, key) => key in context,
            })
            for (const [event, visitor] of Object.entries(law.create(scoped))) {
                const callbacks = visitors.get(event) ?? []
                callbacks.push(visitor)
                visitors.set(event, callbacks)
            }
        }
        return Object.fromEntries([...visitors].map(([event, callbacks]) => [event, (node: Node) => {
            for (const callback of callbacks) if (typeof callback === "function") Reflect.apply(callback, undefined, [node])
        }]))
    },
}

const metaDoor = (ack: string, challenge = "const echo = this.verifier.challenge(query)\n        return echo") => `
import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post, Query } from "@nestjs/common"
import { Public, PublicReason } from "@modules/domain/identity"
import { PaymentService } from "@modules/domain/payment"
import { MetaWebhookVerifier } from "@modules/domain/payment/meta-verifier.service"
import { RateLimit, RateTier } from "@modules/platform/http-security"

${ack}

@Controller("webhooks/meta")
export class MetaWebhook {
    constructor(private readonly verifier: MetaWebhookVerifier, private readonly deliveries: PaymentService) {}

    @Get()
    @Public({ reason: PublicReason.SignedWebhook })
    @RateLimit(RateTier.Strict)
    async challenge(@Query() query: object): Promise<string> {
        ${challenge}
    }

    @Post()
    @HttpCode(HttpStatus.OK)
    @Public({ reason: PublicReason.SignedWebhook })
    @RateLimit(RateTier.Strict)
    async receive(@Headers("x-hub-signature-256") signature: string, @Body() body: object): Promise<typeof PROVIDER_ACK> {
        this.verifier.verifyDelivery({ body, signature })
        await this.deliveries.acceptNotification(body)
        return PROVIDER_ACK
    }
}`

test("a full Meta GET/POST door passes R182, R183 and R203 together", () => {
    tester.run("webhook-integration", combined, {
        valid: [
            { filename, code: metaDoor('export const PROVIDER_ACK = "EVENT_RECEIVED" as const') },
            { filename, code: metaDoor("export const PROVIDER_ACK = { success: true } as const", "return await this.verifier.asyncChallenge(query)") },
            { filename, code: metaDoor("export const PROVIDER_ACK: { readonly success: true } = { success: true }") },
            { filename, code: metaDoor("export const PROVIDER_ACK: { readonly code: -1 } = { code: -1 }") },
            { filename, code: metaDoor("export const PROVIDER_ACK = { success: true, details: { code: -1, values: [null, false, 2] } } as const") },
        ],
        invalid: [],
    })
})
