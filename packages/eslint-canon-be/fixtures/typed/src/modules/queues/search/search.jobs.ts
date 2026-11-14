import { defineJob, type JobDefinition, type JobProgressTopic } from "@modules/platform/jobs"

/** Fixture payload of the search job. */
export interface SearchPayload {
    readonly sourceId: string
}

/** Fixture: the names of the jobs of the search queue. */
export enum SearchJob {
    Run = "search.run",
    Facts = "search.facts",
}

const isSearchPayload = (value: unknown): value is SearchPayload => typeof value === "object" && value !== null

/** Fixture: builds the progress topic of a search job, principal first. */
export const searchTopicOf = (payload: SearchPayload): JobProgressTopic => ({ principalId: payload.sourceId, root: `source:${payload.sourceId}` })

/** Fixture: the last job of the chain. */
export const FACTS_JOB: JobDefinition<SearchPayload> = defineJob<SearchPayload>({
    name: SearchJob.Facts,
    queue: "search",
    ladder: "background",
    payload: isSearchPayload,
    onceKey: (payload) => `${SearchJob.Facts}:${payload.sourceId}`,
    next: [],
    effects: [],
})

/** Fixture: the first job of the chain. */
export const RUN_JOB: JobDefinition<SearchPayload> = defineJob<SearchPayload>({
    name: SearchJob.Run,
    queue: "search",
    ladder: "waited",
    payload: isSearchPayload,
    onceKey: (payload) => `${SearchJob.Run}:${payload.sourceId}`,
    next: [SearchJob.Facts],
    effects: [{ name: "search.embed", settle: "repeatable" }],
    progress: { topic: searchTopicOf },
})
