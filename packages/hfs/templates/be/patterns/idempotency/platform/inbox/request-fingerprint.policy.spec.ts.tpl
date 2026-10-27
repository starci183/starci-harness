import { Test } from "@nestjs/testing"
import { IdempotencyError, IdempotencyErrorCode } from "@modules/platform/idempotency"
import { requestFingerprint } from "./request-fingerprint.policy"

const FINGERPRINT = Symbol("fingerprint")
const build = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [{ provide: FINGERPRINT, useValue: requestFingerprint }],
    }).compile()
    return moduleRef.get<typeof requestFingerprint>(FINGERPRINT)
}

describe("requestFingerprint", () => {
    it("hashes nested objects independently of property insertion order", async () => {
        const fingerprint = await build()

        expect(fingerprint({ personId: "person-1", body: { quantity: 2, productId: "product-1" } })).toBe(
            fingerprint({ body: { productId: "product-1", quantity: 2 }, personId: "person-1" }),
        )
        expect(fingerprint({ a: 1 })).toMatch(/^[a-f0-9]{64}$/)
    })

    it("keeps binary UTF-16 key order for non-ASCII and supplementary Unicode keys", async () => {
        const fingerprint = await build()
        const body = { "\uE000": 5, "\u{1F600}": 4, "\u00E9": 1, a: 3, Z: 2 }

        expect(fingerprint(body)).toBe(fingerprint({ Z: 2, a: 3, "\u00E9": 1, "\u{1F600}": 4, "\uE000": 5 }))
        expect(fingerprint(body)).toBe("6eb3469044da5c7df68404ba05b90306384fc773ad605d4de06321a2092ff365")
    })

    it("preserves array order, JSON types and nested values", async () => {
        const fingerprint = await build()

        expect(fingerprint([1, 2])).not.toBe(fingerprint([2, 1]))
        expect(fingerprint({ value: 1 })).not.toBe(fingerprint({ value: "1" }))
        expect(fingerprint({ body: { quantity: 2 } })).not.toBe(fingerprint({ body: { quantity: 3 } }))
        expect(new Set([null, true, false, "", 0].map(fingerprint)).size).toBe(5)
        expect(fingerprint([])).not.toBe(fingerprint({}))
    })

    it("accepts an object without a prototype and repeated noncyclic references", async () => {
        const fingerprint = await build()
        const shared = { quantity: 2 }
        const withoutPrototype: unknown = Object.assign(Object.create(null), { quantity: 2 })

        expect(fingerprint(withoutPrototype)).toBe(fingerprint(shared))
        expect(fingerprint([shared, shared])).toBe(fingerprint([{ quantity: 2 }, { quantity: 2 }]))
    })

    it.each([
        [undefined],
        [() => 1],
        [Symbol("unsupported")],
        [BigInt(1)],
        [Number.NaN],
        [Number.POSITIVE_INFINITY],
        [Number.NEGATIVE_INFINITY],
        [{ missing: undefined }],
        [[undefined]],
        [Array(1)],
        [new Date("2026-10-24T00:00:00.000Z")],
        [new Map([["quantity", 2]])],
    ])("refuses values that cannot represent a JSON request: %p", async (request: unknown) => {
        const fingerprint = await build()

        expect(() => fingerprint(request)).toThrow(new IdempotencyError({ code: IdempotencyErrorCode.RequestInvalid }))
    })

    it("refuses cyclic requests before a claim can be written", async () => {
        const fingerprint = await build()
        const cyclic: Record<string, unknown> = { quantity: 2 }
        cyclic.body = cyclic

        expect(() => fingerprint(cyclic)).toThrow(new IdempotencyError({ code: IdempotencyErrorCode.RequestInvalid }))
    })
})
