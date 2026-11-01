/** One lazily subscribed clock for every RelativeTime instance in this module graph. */
const listeners = new Set<() => void>()
let snapshot: number | null = null
let ticker: ReturnType<typeof setInterval> | undefined

const tick = () => {
    snapshot = Date.now()
    for (const listener of listeners) listener()
}

export const subscribeClock = (listener: () => void) => {
    listeners.add(listener)
    if (listeners.size === 1) {
        snapshot = Date.now()
        ticker = setInterval(tick, 1000)
    }
    return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
            clearInterval(ticker)
            ticker = undefined
            snapshot = null
        }
    }
}

export const getClockSnapshot = () => snapshot

/** Server rendering and the first hydration render always use the same deterministic fallback. */
export const getServerClockSnapshot = () => null
