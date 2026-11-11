import { QueryHandler } from "@nestjs/cqrs"
import type { ObjectStorage } from "@starci/object-storage"
import { InjectObjectStorage, InjectObjectStorageBucket } from "@modules/integrations/object-storage"
import { ICQRSHandler } from "@modules/platform/cqrs"
import { InjectReadiness, type ReadinessReport, type ReadinessService } from "@modules/platform/http-security"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { CheckReadinessQuery } from "./check-readiness.query"

@QueryHandler(CheckReadinessQuery)
/** Answers readiness only after the bounded database probe and the object store answer. */
export class CheckReadinessHandler extends ICQRSHandler<CheckReadinessQuery, ReadinessReport> {
    constructor(
        @InjectLogger() logger: Logger,
        @InjectReadiness() private readonly readiness: ReadinessService,
        @InjectObjectStorage() private readonly storage: ObjectStorage,
        @InjectObjectStorageBucket() private readonly bucket: string,
    ) {
        super(logger)
    }

    /** The database first, then the app's bucket: a head that creates the bucket a fresh store lacks; an unreachable store answers 503. */
    protected override async process(): Promise<ReadinessReport> {
        const report = await this.readiness.probeRequired()
        await this.storage.ensureBucket(this.bucket)
        return report
    }
}
