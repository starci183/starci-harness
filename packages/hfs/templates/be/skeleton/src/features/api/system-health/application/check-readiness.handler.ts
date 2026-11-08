import { QueryHandler } from "@nestjs/cqrs"
import { ICQRSHandler } from "@modules/platform/cqrs"
import { InjectReadiness, type ReadinessReport, type ReadinessService } from "@modules/platform/http-security"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { CheckReadinessQuery } from "./check-readiness.query"

@QueryHandler(CheckReadinessQuery)
/** Answers readiness only after the bounded required-dependency probe succeeds. */
export class CheckReadinessHandler extends ICQRSHandler<CheckReadinessQuery, ReadinessReport> {
    constructor(
        @InjectLogger() logger: Logger,
        @InjectReadiness() private readonly readiness: ReadinessService,
    ) {
        super(logger)
    }

    protected override process(): Promise<ReadinessReport> {
        return this.readiness.probeRequired()
    }
}
