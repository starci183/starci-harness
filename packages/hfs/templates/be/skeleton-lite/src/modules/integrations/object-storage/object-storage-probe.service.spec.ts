import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { OBJECT_STORAGE, type ObjectStorage } from "@starci/object-storage"
import { REQUIRED_PROBES, type RequiredProbesService } from "@modules/platform/http-security"
import { OBJECT_STORAGE_BUCKET } from "./object-storage.decorators"
import { ObjectStorageProbeService } from "./object-storage-probe.service"

const build = async () => {
    const storage = mock<ObjectStorage>()
    const required = mock<RequiredProbesService>()
    const moduleRef = await Test.createTestingModule({
        providers: [
            ObjectStorageProbeService,
            { provide: OBJECT_STORAGE, useValue: storage },
            { provide: OBJECT_STORAGE_BUCKET, useValue: "demo-dev" },
            { provide: REQUIRED_PROBES, useValue: required },
        ],
    }).compile()
    return { service: moduleRef.get(ObjectStorageProbeService), storage, required }
}

describe("ObjectStorageProbeService", () => {
    it("adds itself to the dependencies readiness waits for at boot", async () => {
        const { service, required } = await build()

        service.onModuleInit()

        expect(required.add).toHaveBeenCalledWith(service)
    })

    it("answers once the app's bucket answers", async () => {
        const { service, storage } = await build()
        storage.ensureBucket.mockResolvedValue(undefined)

        await expect(service.probe()).resolves.toBeUndefined()

        expect(storage.ensureBucket).toHaveBeenCalledWith("demo-dev")
    })

    it("rejects with the store's failure when the store does not answer", async () => {
        const { service, storage } = await build()
        const failure = new Error("object store unreachable")
        storage.ensureBucket.mockRejectedValue(failure)

        await expect(service.probe()).rejects.toBe(failure)
    })
})
