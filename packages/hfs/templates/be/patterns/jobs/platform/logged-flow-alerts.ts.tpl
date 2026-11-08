import { Injectable } from "@nestjs/common"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import type { ParkedFlowAlert } from "./jobs.contracts"
import { JobsLogEvent } from "./jobs.log-events"
import type { FlowAlerts } from "./jobs.port"

@Injectable()
/** The alert port until the app binds its owner work items (`JobsOptions.alerts`): the one alert of a park is a log line the operator watches. */
export class LoggedFlowAlerts implements FlowAlerts {
    constructor(@InjectLogger() private readonly logger: Logger) {}

    /** Logs the work item of the parked job. */
    raise(alert: ParkedFlowAlert): Promise<void> {
        this.logger.warn(JobsLogEvent.Parked, { ...alert })
        return Promise.resolve()
    }
}
