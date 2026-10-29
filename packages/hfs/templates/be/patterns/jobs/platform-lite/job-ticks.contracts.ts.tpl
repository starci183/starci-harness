/** One recurring tick of platform/jobs: at each minute its cron expression names, one job of `queue` is enqueued with `payload` (R335). */
export interface JobTick {
    /** The stable name: the advisory lock key, the minute claim and the correlation id carry it. */
    readonly name: string
    /** The five-field cron expression of the minutes the tick fires at. */
    readonly cron: string
    /** The time zone the expression is read in; ticks run in UTC. */
    readonly timeZone: "UTC"
    /** The queue the tick enqueues one job of. */
    readonly queue: string
    /** The payload of that job: ids and literals only. */
    readonly payload: object
}

/** The ticks of this app, as data: JobTickService registers one cron job per entry. */
export const JOB_TICKS: ReadonlyArray<JobTick> = []
