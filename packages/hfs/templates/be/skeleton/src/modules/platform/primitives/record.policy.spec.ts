import { Test } from "@nestjs/testing"
import { isRecord } from "./record.policy"

const RECORD_POLICY: unique symbol = Symbol("primitives.record")

describe("isRecord", () => {
    let subject: typeof isRecord

    beforeEach(async () => {
        const moduleRef = await Test.createTestingModule({
            providers: [{ provide: RECORD_POLICY, useFactory: () => isRecord }],
        }).compile()
        subject = moduleRef.get<typeof isRecord>(RECORD_POLICY)
    })

    it("narrows non-null objects before provider fields are read", () => {
        expect(subject({ status: 200 })).toBe(true)
        expect(subject([])).toBe(true)
        expect(subject(null)).toBe(false)
        expect(subject(undefined)).toBe(false)
        expect(subject("response")).toBe(false)
        expect(subject(200)).toBe(false)
    })
})
