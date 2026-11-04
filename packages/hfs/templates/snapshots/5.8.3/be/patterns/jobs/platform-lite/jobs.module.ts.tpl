import { Module } from "@nestjs/common"
import type { DynamicModule } from "@nestjs/common"
import { ScheduleModule } from "@nestjs/schedule"
import type { EntityManager } from "typeorm"
import { JOB_CLAIMS, JOB_PROCESSOR_REGISTRY, JOBS_MANAGERS } from "./jobs.decorators"
import { ConfigurableModuleClass, OPTIONS_TYPE } from "./jobs.module-definition"
import { JobClaimService } from "./job-claim.service"
import { JobRunnerService } from "./job-runner.service"
import { JobTickService } from "./job-tick.service"

@Module({})
/**
 * The fenced jobs of a service: the claim service that owns the job row, the runner that subscribes processors to their queues and
 * the one tick scheduler (R335), which composes @nestjs/schedule here and nowhere else. Needs the queue capability registered in
 * the same app.
 */
export class JobsModule extends ConfigurableModuleClass {
    /** Registers the capability once per app that runs jobs. */
    static register(options: typeof OPTIONS_TYPE): DynamicModule {
        const base = super.register(options)
        return {
            ...base,
            imports: [...(base.imports ?? []), ScheduleModule.forRoot()],
            providers: [
                ...(base.providers ?? []),
                {
                    provide: JOBS_MANAGERS,
                    useFactory: (manager: EntityManager) => [manager],
                    inject: [options.connection],
                },
                JobClaimService,
                JobRunnerService,
                JobTickService,
                { provide: JOB_CLAIMS, useExisting: JobClaimService },
                { provide: JOB_PROCESSOR_REGISTRY, useExisting: JobRunnerService },
            ],
            exports: [JOB_CLAIMS, JOB_PROCESSOR_REGISTRY],
        }
    }
}
