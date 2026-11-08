import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { InjectIds, type Ids } from "@modules/platform/ids"
import { InjectQueueOutbox, type QueueOutbox } from "@modules/platform/queue"
import { JobsError, JobsErrorCode } from "./errors/jobs.error"
import { PARKED_JOBS_SWEEP_QUEUE } from "./jobs.contracts"
import { InjectJobsManagers } from "./jobs.decorators"

@Injectable()
/**
 * Asks the running app to resume parked jobs (BE-RESILIENCE-2): one job by id (the owner's "resume now") or every parked job, as one
 * row on the sweep queue written through the outbox, so a process with no Redis (the cli) can ask and the app's workers resume.
 */
export class ParkedJobResumeRequestsService {
    constructor(
        @InjectJobsManagers() private readonly managers: ReadonlyArray<EntityManager>,
        @InjectQueueOutbox() private readonly outbox: QueueOutbox,
        @InjectIds() private readonly ids: Ids,
    ) {}

    /** Writes the resume of `jobId`, or of every parked job when no id is given, on the sweep queue. */
    async request(jobId?: string): Promise<void> {
        const [manager] = this.managers
        if (manager === undefined) throw new JobsError({ code: JobsErrorCode.ConnectionMissing })
        const payload = jobId === undefined || jobId === "" ? {} : { jobId }
        await manager.transaction((tx) => this.outbox.write(tx, PARKED_JOBS_SWEEP_QUEUE, payload, `resume:${this.ids.next()}`))
    }
}
