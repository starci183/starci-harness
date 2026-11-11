import { Controller, Get } from "@nestjs/common"
import type { QueryBus } from "@nestjs/cqrs"
import { ApiDefaultResponse, ApiExtension, ApiOkResponse, ApiOperation } from "@nestjs/swagger"
import { Public, PublicReason } from "@modules/domain/identity"
import type { LivenessReport } from "@modules/domain/liveness"
import { InjectQueryBus } from "@modules/platform/cqrs"
import { CheckLivenessQuery } from "../../application/check-liveness.query"
import { ErrorResponse, LivenessResponse } from "./dto/health.response"

@Controller("health")
@ApiDefaultResponse({ type: ErrorResponse })
/** Liveness probe: answers the liveness report from process-local state and never touches a dependency. */
export class LiveController {
    constructor(@InjectQueryBus() private readonly queryBus: QueryBus) {}

    /** Reports the process alive while its event loop still answers requests. */
    @Get("live")
    @ApiOperation({ operationId: "health.live", security: [] })
    @ApiExtension("x-public-reason", "health")
    @ApiOkResponse({ type: LivenessResponse })
    @Public({ reason: PublicReason.Health })
    live(): Promise<LivenessReport> {
        return this.queryBus.execute(new CheckLivenessQuery({ request: {} }))
    }
}
