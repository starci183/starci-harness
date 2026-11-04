import { Module } from "@nestjs/common"
import type { DynamicModule } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { FLOW_ALERTS, JOB_CLAIMS, JOB_PROCESSOR_REGISTRY, JOBS_MANAGERS } from "./jobs.decorators"
import { ConfigurableModuleClass, OPTIONS_TYPE } from "./jobs.module-definition"
import { JobClaimService } from "./job-claim.service"
import { JobRunnerService } from "./job-runner.service"
import { LoggedFlowAlerts } from "./logged-flow-alerts"
import { ParkedJobResumeRequests } from "./parked-job-resume-requests.service"
import { ParkedJobResumer } from "./parked-job-resumer.service"
import { ParkedJobsSweepProcessor } from "./parked-jobs-sweep.processor"

@Module({})
/** The fenced jobs of a service: the claim service that owns the job row and the runner that subscribes processors to their queues. Needs the queue capability registered in the same app. */
export class JobsModule extends ConfigurableModuleClass {
    /** Registers the capability once per app that runs jobs, or (`requestsOnly`) only the resume requests a one-off process writes. */
    static register(options: typeof OPTIONS_TYPE): DynamicModule {
        const base = super.register(options)
        const managers = {
            provide: JOBS_MANAGERS,
            useFactory: (manager: EntityManager) => [manager],
            inject: [options.connection],
        }
        if (options.requestsOnly === true) {
            return { ...base, providers: [...(base.providers ?? []), managers, ParkedJobResumeRequests], exports: [ParkedJobResumeRequests] }
        }
        return {
            ...base,
            providers: [
                ...(base.providers ?? []),
                managers,
                JobClaimService,
                JobRunnerService,
                LoggedFlowAlerts,
                ParkedJobResumer,
                ParkedJobResumeRequests,
                ParkedJobsSweepProcessor,
                { provide: JOB_CLAIMS, useExisting: JobClaimService },
                { provide: JOB_PROCESSOR_REGISTRY, useExisting: JobRunnerService },
                { provide: FLOW_ALERTS, useExisting: options.alerts ?? LoggedFlowAlerts },
            ],
            exports: [JOB_CLAIMS, JOB_PROCESSOR_REGISTRY, ParkedJobResumer, ParkedJobResumeRequests],
        }
    }
}
