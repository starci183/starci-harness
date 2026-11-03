import type { DatabaseConnectionOptions } from "@modules/platform/database"
import { JobEntity } from "./entities/job.entity"
import { CreateJobs@@epochMs13@@ } from "./migrations/@@epochMs13@@-create-jobs"

/** The entities of the jobs, for every connection that runs jobs. */
export const jobsEntities: DatabaseConnectionOptions["entities"] = [JobEntity]

/** The migrations of the jobs, in the order they run. */
export const jobsMigrations: DatabaseConnectionOptions["migrations"] = [CreateJobs@@epochMs13@@]
