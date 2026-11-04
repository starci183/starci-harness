import type { InjectionToken } from "@nestjs/common"

/** What the jobs of one app need: the connection that holds the job table, who this worker is, and how long a claim lasts. */
export interface JobsOptions {
    /** The runtime registration owns the runner, the claims, the resume and the sweep. */
    readonly requestsOnly?: false
    /** The token of the shared entity manager of the connection that holds the job table of the app. */
    readonly connection: InjectionToken
    /** The name this worker writes into `claimed_by`; it tells operators who held a job, the fence never reads it. */
    readonly workerId: string
    /** How long a claim lasts: after it a stalled job may be claimed again, and the old worker is fenced out. */
    readonly leaseMs: number
    /** The build this process runs: a job parked under another build is resumed at boot (BE-RESILIENCE-2). */
    readonly build: string
    /** The token of the app's FlowAlerts provider (its owner work items); without it a park alerts through the log. */
    readonly alerts?: InjectionToken
}

/** A one-off process (the cli) only asks the running app to resume parked jobs: it writes the request and exits. */
export interface JobsRequestsOnlyOptions {
    /** Registers only the resume requests, leaving the resume to the running app. */
    readonly requestsOnly: true
    /** The token of the shared entity manager of the connection that holds the outbox of the job table. */
    readonly connection: InjectionToken
}

/** Registers either the running jobs capability or only its resume requests. */
export type JobsRegistrationOptions = JobsOptions | JobsRequestsOnlyOptions
