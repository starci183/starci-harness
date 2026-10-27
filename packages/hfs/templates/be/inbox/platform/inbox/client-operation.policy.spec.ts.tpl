import { Test } from "@nestjs/testing"
import { IdempotencyError, IdempotencyErrorCode } from "@modules/platform/idempotency"
import { clientSource } from "./client-operation.policy"

const CLIENT_SOURCE = Symbol("client-source")
const build = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [{ provide: CLIENT_SOURCE, useValue: clientSource }],
    }).compile()
    return moduleRef.get<typeof clientSource>(CLIENT_SOURCE)
}

const REQUEST = { principalId: "person-1", operation: "checkout.place", idempotencyKey: "key-1", request: {} }

describe("clientSource", () => {
    it("binds the exact authenticated principal and operation and accepts a 64-character key", async () => {
        const sourceOf = await build()
        expect(sourceOf({ ...REQUEST, idempotencyKey: "a".repeat(64) })).toBe("client:person-1:checkout.place")
    })

    it.each([
        { ...REQUEST, principalId: " " },
        { ...REQUEST, principalId: "a:b" },
        { ...REQUEST, operation: " " },
        { ...REQUEST, operation: "a:b" },
        { ...REQUEST, idempotencyKey: " " },
        { ...REQUEST, idempotencyKey: "a".repeat(65) },
    ])("refuses ambiguous scopes and unbounded or empty keys %p", async (request) => {
        const sourceOf = await build()
        expect(() => sourceOf(request)).toThrow(new IdempotencyError({ code: IdempotencyErrorCode.RequestInvalid }))
    })
})
