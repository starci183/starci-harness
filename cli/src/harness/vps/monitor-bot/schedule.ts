/**
 * The daily report's schedule: 08:00 of a fixed-offset zone (Asia/Ho_Chi_Minh is UTC+7 with no daylight saving), computed from epoch
 * milliseconds without the container's zone data.
 */

const DAY_MS = 86_400_000

/** The next time (epoch ms) strictly after `nowMs` at `hour`:00 of the zone `offsetMinutes` from UTC. */
export const nextDaily = (nowMs: number, hour: number, offsetMinutes: number): number => {
    const offsetMs = offsetMinutes * 60_000
    const localNow = nowMs + offsetMs
    const localMidnight = Math.floor(localNow / DAY_MS) * DAY_MS
    let next = localMidnight + hour * 3_600_000
    if (next <= localNow) next += DAY_MS
    return next - offsetMs
}

/** The local date (YYYY-MM-DD) of an instant in the zone, which names the report's day. */
export const localDate = (ms: number, offsetMinutes: number): string => new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 10)

/**
 * Runs `task` at every next daily time, forever, with the injected timer (the specs pass a fake clock). A task that throws is reported and the
 * schedule goes on. Returns the stop function.
 */
export const everyDay = (hour: number, offsetMinutes: number, task: (atMs: number) => Promise<void>, clock: { readonly now: () => number; readonly setTimer: (ms: number, run: () => void) => { cancel: () => void } }, report: (error: unknown) => void): (() => void) => {
    let timer: { cancel: () => void } | null = null
    let stopped = false
    const arm = (): void => {
        if (stopped) return
        const at = nextDaily(clock.now(), hour, offsetMinutes)
        timer = clock.setTimer(Math.max(0, at - clock.now()), () => {
            task(at).catch(report).finally(arm)
        })
    }
    arm()
    return () => {
        stopped = true
        timer?.cancel()
    }
}
