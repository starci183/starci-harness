import { Test } from "@nestjs/testing"
import { fakeIds } from "@starci/jest-preset"
import { IDS } from "@modules/platform/ids"
import { CorrelationService, createCorrelationRunner } from "./correlation.service"
import { stampLogFields } from "./correlation.policy"

describe("CorrelationService", () => {
    it("resolves headers, creates identities, and runs work with an explicit identity", async () => {
        const ids = fakeIds()
        const moduleRef = await Test.createTestingModule({
            providers: [CorrelationService, { provide: IDS, useValue: ids }],
        }).compile()
        const service = moduleRef.get<CorrelationService>(CorrelationService)

        expect(service.fromHeaders({ "x-request-id": "request-1" })).toBe("request-1")
        expect(service.fromHeaders({})).toBe("00000000-0000-4000-8000-000000000001")
        expect(service.create()).toBe("00000000-0000-4000-8000-000000000002")
        expect(service.run("explicit-id", () => stampLogFields({}, "root-id"))).toEqual({
            correlationId: "explicit-id",
        })
        expect(createCorrelationRunner(ids).run("bootstrap-id", () => stampLogFields({}, "root-id"))).toEqual({
            correlationId: "bootstrap-id",
        })
    })
})
