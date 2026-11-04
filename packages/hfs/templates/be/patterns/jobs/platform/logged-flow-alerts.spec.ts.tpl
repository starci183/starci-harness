import { mock } from "@starci/jest-preset"
import type { Logger } from "@modules/platform/logging"
import type { ParkedFlowAlert } from "./jobs.contracts"
import { JobsLogEvent } from "./jobs.log-events"
import { LoggedFlowAlerts } from "./logged-flow-alerts"

describe("LoggedFlowAlerts", () => {
    it("logs the work item of a parked job until the app binds its own alerts", async () => {
        const logger = mock<Logger>()
        const alert: ParkedFlowAlert = {
            kind: "flow-parked",
            jobId: "j-1",
            flowKind: "mail",
            failureClass: "config",
            reason: "smtp host missing",
            correlationId: "request-1",
            build: "b-2",
            action: "resume",
        }

        await new LoggedFlowAlerts(logger).raise(alert)

        expect(logger.warn).toHaveBeenCalledWith(JobsLogEvent.Parked, { ...alert })
    })
})
