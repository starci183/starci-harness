import { Test } from "@nestjs/testing"
import { BaseEvent } from "./event-bus.contracts"
import { readEnvelope, readEnvelopeText, readEventOf } from "./event-envelope.policy"

interface PingPayload {
    readonly note: string
}

class PingEvent extends BaseEvent {
    readonly eventName = "probe.ping"

    constructor(
        readonly eventId: string,
        readonly payload: PingPayload,
    ) {
        super()
    }
}

const isPingPayload = (payload: Record<string, unknown>): payload is PingPayload & Record<string, unknown> =>
    typeof payload.note === "string"
const buildPing = (eventId: string, payload: PingPayload): PingEvent => new PingEvent(eventId, payload)

const POLICY = Symbol("policy")
const policyFunctions = { readEnvelope, readEnvelopeText, readEventOf }
const build = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [{ provide: POLICY, useFactory: () => policyFunctions }],
    }).compile()
    return moduleRef.get<typeof policyFunctions>(POLICY)
}

describe("event envelope policies readEnvelope", () => {
    it("reads the event id and payload of an envelope", async () => {
        const policy = await build()

        expect(policy.readEnvelope({ eventId: "event-1", payload: { note: "hello" }, ignored: true })).toEqual({
            eventId: "event-1",
            payload: { note: "hello" },
        })
    })

    it.each([
        [null, "a non-record"],
        [{ eventId: 1, payload: {} }, "a non-text event id"],
        [{ eventId: "event-1", payload: 1 }, "a non-record payload"],
    ])("refuses %s because it is %s", async (envelope: unknown, _why: string) => {
        const policy = await build()

        expect(policy.readEnvelope(envelope)).toBeNull()
    })
})

describe("event envelope policies current correlation metadata", () => {
    it("parses an envelope and names its event", async () => {
        const policy = await build()

        const envelope = {
            metadata: { correlationId: "request-1" },
            eventId: "event-1",
            eventName: "probe.ping",
            payload: { note: "hello" },
        }

        expect(policy.readEnvelopeText(JSON.stringify(envelope))).toEqual({
            eventName: "probe.ping",
            correlationId: "request-1",
            envelope,
            cause: null,
        })
    })

    it.each([
        {},
        { metadata: {} },
        { metadata: { correlationId: 1 } },
        { metadata: { correlationId: "" } },
        { metadata: { correlationId: "request\nspoof" } },
        { metadata: { correlationId: "a".repeat(129) } },
    ])("refuses missing or unsafe correlation metadata", async (envelope) => {
        const policy = await build()

        expect(policy.readEnvelopeText(JSON.stringify(envelope)).correlationId).toBeNull()
    })
})

describe("event envelope policies legacy promotion", () => {
    it("promotes a legacy envelope at its safe event id without changing business fields", async () => {
        const policy = await build()
        const legacy = { eventId: "legacy-1", eventName: "probe.ping", payload: { note: "hello" }, causeId: "prior" }

        expect(policy.readEnvelopeText(JSON.stringify(legacy))).toEqual({
            eventName: "probe.ping",
            correlationId: "legacy-1",
            envelope: { ...legacy, metadata: { correlationId: "legacy-1" } },
            cause: null,
        })
    })

    it.each([
        { eventId: "unsafe\nid", eventName: "probe.ping", payload: {} },
        { eventId: "legacy-1", eventName: 1, payload: {} },
        { eventId: "legacy-1", eventName: "", payload: {} },
        { eventId: "legacy-1", eventName: "probe.ping", payload: null },
        { eventId: "legacy-1", eventName: "probe.ping", payload: [] },
        { eventId: "legacy-1", eventName: "probe.ping", payload: {}, metadata: null },
        { eventId: "legacy-1", eventName: "probe.ping", payload: {}, metadata: {} },
    ])("rejects an unsafe or ambiguous legacy envelope", async (envelope) => {
        const policy = await build()

        expect(policy.readEnvelopeText(JSON.stringify(envelope)).correlationId).toBeNull()
    })
})

describe("event envelope policies JSON shape and decoding", () => {
    it.each([
        { value: "null", envelope: null },
        { value: "42", envelope: 42 },
        { value: '"provider text"', envelope: "provider text" },
        { value: "false", envelope: false },
    ])("refuses valid JSON without an envelope record: $value", async ({ value, envelope }) => {
        const policy = await build()

        expect(policy.readEnvelopeText(value)).toEqual({
            eventName: "",
            correlationId: null,
            envelope,
            cause: null,
        })
    })

    it.each([JSON.stringify([]), JSON.stringify({ eventName: 1 })])(
        "keeps a parsed JSON value without a text event name unnamed",
        async (value) => {
            const policy = await build()

            expect(policy.readEnvelopeText(value)).toMatchObject({ eventName: "", cause: null })
        },
    )

    it("returns the parse failure for text that is not JSON", async () => {
        const policy = await build()

        const result = policy.readEnvelopeText("not json")

        expect(result.eventName).toBe("")
        expect(result.envelope).toBeNull()
        expect(result.cause).toBeInstanceOf(SyntaxError)
    })
})

describe("event envelope policies readEventOf", () => {
    it("builds an event after the envelope and its payload are proven", async () => {
        const policy = await build()

        expect(
            policy.readEventOf({ eventId: "event-1", payload: { note: "hello" } }, isPingPayload, buildPing),
        ).toEqual(new PingEvent("event-1", { note: "hello" }))
    })

    it("refuses a value that is not an envelope without checking its payload", async () => {
        const policy = await build()

        let checked = false
        const guard = (payload: Record<string, unknown>): payload is PingPayload & Record<string, unknown> => {
            checked = true
            return isPingPayload(payload)
        }

        expect(policy.readEventOf(null, guard, buildPing)).toBeNull()
        expect(checked).toBe(false)
    })

    it("refuses an envelope whose payload does not have the event fields", async () => {
        const policy = await build()

        expect(policy.readEventOf({ eventId: "event-1", payload: {} }, isPingPayload, buildPing)).toBeNull()
    })
})
