import { Injectable } from "@nestjs/common"
import type { OnApplicationBootstrap } from "@nestjs/common"
import { SchedulerRegistry } from "@nestjs/schedule"
import { CronJob } from "cron"
import type { EntityManager } from "typeorm"
import { InjectClock } from "@modules/platform/clock"
import type { Clock } from "@modules/platform/clock"
import { advisoryXactLock, callDbFunction } from "@modules/platform/database"
import { InjectLogger } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { InjectQueueOutbox } from "@modules/platform/queue"
import type { QueueOutbox } from "@modules/platform/queue"
import { JobsError, JobsErrorCode } from "./errors/jobs.error"
import { JOB_TICKS } from "./job-ticks.contracts"
import type { JobTick } from "./job-ticks.contracts"
import { InjectJobsManagers } from "./jobs.decorators"
import { JobsLogEvent } from "./jobs.log-events"

/** The record job_tick_claim returns. */
interface TickClaim {
    /** True when this firing moved the tick to its minute and must enqueue. */
    readonly claimed: boolean
}

/** The UTC minute of `at` (`YYYY-MM-DDTHH:MM`): the slot a tick fires once in. */
export const tickMinute = (at: Date): string => at.toISOString().slice(0, 16)

@Injectable()
/**
 * The one scheduler of the app (R335): @nestjs/schedule fires every tick of JOB_TICKS on every replica, and each firing takes
 * advisoryXactLock("tick:<name>"), claims the tick's minute through job_tick_claim and, only when it moved the tick, writes one
 * job into the queue outbox in the same transaction, so the deployment enqueues the tick once per minute.
 */
export class JobTickService implements OnApplicationBootstrap {
    constructor(
        private readonly registry: SchedulerRegistry,
        @InjectJobsManagers() private readonly managers: ReadonlyArray<EntityManager>,
        @InjectQueueOutbox() private readonly outbox: QueueOutbox,
        @InjectClock() private readonly clock: Clock,
        @InjectLogger() private readonly logger: Logger,
    ) {}

    /** Registers one cron job per tick, read in the tick's time zone; a failed firing is logged and the next one runs. */
    onApplicationBootstrap(): void {
        for (const tick of JOB_TICKS) {
            this.registry.addCronJob(tick.name, CronJob.from({
                cronTime: tick.cron,
                timeZone: tick.timeZone,
                onTick: async () => {
                    await this.fire(tick)
                },
                errorHandler: (cause: unknown) => {
                    this.logger.error(JobsLogEvent.TickFailed, cause, { tick: tick.name })
                },
                start: true,
            }))
        }
    }

    /** Fires the tick for the current minute; true when this replica enqueued its job, false when another one already had. */
    async fire(tick: JobTick): Promise<boolean> {
        const minute = tickMinute(this.clock.now())
        return this.writer().transaction(async (tx) => {
            await advisoryXactLock(tx, `tick:${tick.name}`)
            const [claim] = await callDbFunction<TickClaim>(tx, "public.job_tick_claim", [tick.name, minute])
            if (claim?.claimed !== true) return false
            await this.outbox.write(tx, tick.queue, tick.payload, `tick:${tick.name}:${minute}`)
            return true
        })
    }

    /** The entity manager of the connection that holds the tick table. */
    private writer(): EntityManager {
        const [manager] = this.managers
        if (manager === undefined) throw new JobsError({ code: JobsErrorCode.ConnectionMissing })
        return manager
    }
}
