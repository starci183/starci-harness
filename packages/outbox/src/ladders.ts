/** How a transient failure is tried again: the starts a job gets in all, and the pause before each start after the first. */
export interface JobLadder {
    /** The starts a job gets, the first included; a start past this count is parked without running. */
    readonly starts: number
    /** The pause before start n+2 after start n+1 failed, in seconds (index 0 is the pause after the first start); the last repeats. */
    readonly pausesSeconds: readonly number[]
}

/**
 * The ladders an outbox declares when the app declares none, one per class of flow by who waits on it (BE-JOBS-7): `background`, nobody
 * waits, 4 starts after 5, 10 and 20 seconds; `waited`, a person waits, 5 starts after 1, 2, 4 and 8 minutes. The numbers are the app's
 * to change, in its `ladders` option, never in a handler.
 */
export const DEFAULT_LADDERS: Readonly<Record<string, JobLadder>> = {
    background: { starts: 4, pausesSeconds: [5, 10, 20] },
    waited: { starts: 5, pausesSeconds: [60, 120, 240, 480] },
}

/** What the runner does with a failure on a job's `start`-th start. */
export type LadderVerdict =
    | { readonly kind: "retry"; readonly afterSeconds: number }
    | { readonly kind: "park"; readonly why: "class" | "exhausted" }

/**
 * The verdict of the ladder: a transient failure with starts left is tried again after the ladder's pause; any other class, or a
 * transient failure on (or past) the last start, parks. The start count is the durable one (`attempts` counts a start before the work
 * runs), so a worker that crashes on every start ends here too.
 */
export const ladderVerdictOf = (ladder: JobLadder, start: number, transient: boolean): LadderVerdict => {
    if (!transient) return { kind: "park", why: "class" }
    if (start >= ladder.starts) return { kind: "park", why: "exhausted" }
    const pause = ladder.pausesSeconds[Math.max(0, start - 1)] ?? ladder.pausesSeconds.at(-1) ?? 1
    return { kind: "retry", afterSeconds: pause }
}

/** True when a job started more often than its ladder allows: every earlier start died without settling (a crash loop). */
export const isPastLadder = (ladder: JobLadder, start: number): boolean => start > ladder.starts
