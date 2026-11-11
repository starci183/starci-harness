import { Injectable, type OnModuleInit } from "@nestjs/common"
import type { ObjectStorage } from "@starci/object-storage"
import { InjectRequiredProbes, type RequiredProbe, type RequiredProbesService } from "@modules/platform/http-security"
import { InjectObjectStorage, InjectObjectStorageBucket } from "./object-storage.decorators"

@Injectable()
/** The object store as a required dependency of readiness: it adds itself at boot, and it answers once the app's bucket does. */
export class ObjectStorageProbeService implements RequiredProbe, OnModuleInit {
    constructor(
        @InjectObjectStorage() private readonly storage: ObjectStorage,
        @InjectObjectStorageBucket() private readonly bucket: string,
        @InjectRequiredProbes() private readonly required: RequiredProbesService,
    ) {}

    /** Adds the object store to the dependencies readiness waits for. */
    onModuleInit(): void {
        this.required.add(this)
    }

    /** Heads the app's bucket, creating it when a fresh store lacks it; rejects with the coded unavailable error when the store does not answer. */
    probe(): Promise<void> {
        return this.storage.ensureBucket(this.bucket)
    }
}
