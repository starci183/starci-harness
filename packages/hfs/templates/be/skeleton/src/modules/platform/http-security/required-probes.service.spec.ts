import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import type { RequiredProbe } from "./readiness.contracts"
import { RequiredProbesService } from "./required-probes.service"

const build = async () => {
    const moduleRef = await Test.createTestingModule({ providers: [RequiredProbesService] }).compile()
    return { registry: moduleRef.get(RequiredProbesService) }
}

describe("RequiredProbesService", () => {
    it("starts empty and lists the added dependencies in the order they were added", async () => {
        const { registry } = await build()
        const storage = mock<RequiredProbe>()
        const search = mock<RequiredProbe>()

        expect(registry.list()).toEqual([])
        registry.add(storage)
        registry.add(search)

        expect(registry.list()).toEqual([storage, search])
    })
})
