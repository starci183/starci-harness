import type { EnvSource } from "@modules/platform/config"
import type { JobsOptions } from "./jobs.options"

/** What the app's `main.ts` reads for the jobs; the connection token is the app root's choice. */
export type JobsConfig = Omit<JobsOptions, "connection">

/** Reads the jobs options: tunables with literal defaults, and the build the image stamps (`APP_BUILD_VERSION`). */
export const parseJobsConfig = (env: EnvSource): JobsConfig => ({
    workerId: env.optional("JOBS_WORKER_ID") ?? "worker",
    leaseMs: env.duration("JOBS_LEASE", 60000),
    build: env.optional("APP_BUILD_VERSION") ?? "unversioned",
})
