import type { ClaimedJob } from "./jobs.contracts"

/** Fixture: the topic of a job's progress, principal first, then the chain root. */
export interface JobProgressTopic {
    readonly principalId: string
    readonly root: string
}

/** Fixture: the progress declaration of a job. */
export interface JobProgressDeclaration<P extends object> {
    topic(payload: P): JobProgressTopic
}

/** Fixture: the port a domain method reports step progress through. */
export interface JobProgress {
    report(job: ClaimedJob, done: number, total: number, labelKey: string): Promise<void>
}
