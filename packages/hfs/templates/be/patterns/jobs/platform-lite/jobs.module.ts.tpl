import { Module, type DynamicModule } from "@nestjs/common"
import { ScheduleModule } from "@nestjs/schedule"
import type { EntityManager } from "typeorm"
import { FLOW_ALERTS, JOB_CLAIMS, JOB_PROCESSOR_REGISTRY, JOBS_MANAGERS } from "./jobs.decorators"
import { ConfigurableModuleClass, OPTIONS_TYPE } from "./jobs.module-definition"
import { JobClaimService } from "./job-claim.service"
import { JobRunnerService } from "./job-runner.service"
import { LoggedFlowAlerts } from "./logged-flow-alerts"
import { ParkedJobResumeRequestsService } from "./parked-job-resume-requests.service"
import { ParkedJobResumerService } from "./parked-job-resumer.service"
import { ParkedJobsSweepProcessor } from "./parked-jobs-sweep.processor"
import { JobTickService } from "./job-tick.service"

@Module({})
/**
 * The fenced jobs of a service: the claim service that owns the job row, the runner that subscribes processors to their queues and
 * the one tick scheduler (R335), which composes @nestjs/schedule here and nowhere else. Needs the queue capability registered in
 * the same app.
 */
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
            return { ...base, providers: [...(base.providers ?? []), managers, ParkedJobResumeRequestsService], exports: [ParkedJobResumeRequestsService] }
        }
        return {
            ...base,
            imports: [...(base.imports ?? []), ScheduleModule.forRoot()],
            providers: [
                ...(base.providers ?? []),
                managers,
                JobClaimService,
                JobRunnerService,
                LoggedFlowAlerts,
                ParkedJobResumerService,
                ParkedJobResumeRequestsService,
                ParkedJobsSweepProcessor,
                JobTickService,
                { provide: JOB_CLAIMS, useExisting: JobClaimService },
                { provide: JOB_PROCESSOR_REGISTRY, useExisting: JobRunnerService },
                { provide: FLOW_ALERTS, useExisting: options.alerts ?? LoggedFlowAlerts },
            ],
            exports: [JOB_CLAIMS, JOB_PROCESSOR_REGISTRY, ParkedJobResumerService, ParkedJobResumeRequestsService],
        }
    }
}
