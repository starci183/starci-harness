import { useEffect, useRef, useState } from "react"
import type { Middleware, SWRResponse } from "swr"

/** How long a load may run before its skeleton shows, and how long a shown skeleton stays at least, in milliseconds. */
export interface SkeletonGateTiming {
    readonly delayMs?: number
    readonly minMs?: number
}

/** The clock and timers a gate runs on; the defaults are `Date.now`, `setTimeout` and `clearTimeout`, injected in specs. */
export interface SkeletonGateClock {
    readonly now?: () => number
    readonly setTimer?: (callback: () => void, ms: number) => unknown
    readonly clearTimer?: (handle: unknown) => void
}

/** Everything `createSkeletonGate` takes: the timing, the clock and the callback told each time the skeleton shows or hides. */
export type SkeletonGateOptions = SkeletonGateTiming & SkeletonGateClock & { readonly onChange?: (visible: boolean) => void }

/** A running gate: feed it the loading flag, read whether the skeleton shows, dispose it to clear its timer. */
export interface SkeletonGate {
    readonly update: (isLoading: boolean) => void
    readonly visible: () => boolean
    readonly dispose: () => void
}

/** The delay before a skeleton shows: a load shorter than this never flashes one. */
export const SKELETON_DELAY_MS = 250

/** The least time a shown skeleton stays, so it never blinks in and out. */
export const SKELETON_MIN_MS = 500

/**
 * The pure timing of a skeleton over a loading flag, with no React and no SWR. A load shows its skeleton only once it has run
 * `delayMs`; a shown skeleton holds at least `minMs` from the moment it showed, and loading again while it holds keeps it up
 * without a flicker. States: hidden, waiting (loading, the delay timer runs), shown (loading, or held by the hide timer).
 */
export const createSkeletonGate = (options: SkeletonGateOptions = {}): SkeletonGate => {
    const delayMs = options.delayMs ?? SKELETON_DELAY_MS
    const minMs = options.minMs ?? SKELETON_MIN_MS
    const now = options.now ?? (() => Date.now())
    const setTimer = options.setTimer ?? ((callback: () => void, ms: number): unknown => setTimeout(callback, ms))
    const clearTimer = options.clearTimer ?? ((handle: unknown): void => {
        clearTimeout(handle as ReturnType<typeof setTimeout>)
    })
    let loading = false
    let shown = false
    let shownAt = 0
    let timer: unknown = undefined
    let hasTimer = false

    const cancel = (): void => {
        if (!hasTimer) return
        clearTimer(timer)
        hasTimer = false
    }
    const schedule = (callback: () => void, ms: number): void => {
        cancel()
        hasTimer = true
        timer = setTimer(() => {
            hasTimer = false
            callback()
        }, ms)
    }
    const setShown = (next: boolean): void => {
        if (shown === next) return
        shown = next
        if (next) shownAt = now()
        options.onChange?.(next)
    }

    const update = (isLoading: boolean): void => {
        if (isLoading === loading) return
        loading = isLoading
        if (isLoading) {
            // Shown and held: the hold timer is dropped and the skeleton simply stays. Hidden: wait out the delay first.
            if (shown) cancel()
            else schedule(() => { setShown(true) }, delayMs)
            return
        }
        if (!shown) {
            cancel()
            return
        }
        const left = shownAt + minMs - now()
        if (left <= 0) setShown(false)
        else schedule(() => { setShown(false) }, left)
    }

    return { update, visible: () => shown, dispose: cancel }
}

/**
 * Whether the skeleton of a load shows: only once `isLoading` has lasted `delayMs`, then for at least `minMs`. Pure timing over
 * the flag, usable by any load, SWR or not.
 */
export const useSkeletonGate = (isLoading: boolean, delayMs = SKELETON_DELAY_MS, minMs = SKELETON_MIN_MS): boolean => {
    const [visible, setVisible] = useState(false)
    const gate = useRef<SkeletonGate | undefined>(undefined)
    const latest = useRef(isLoading)
    latest.current = isLoading
    useEffect(() => {
        const created = createSkeletonGate({ delayMs, minMs, onChange: setVisible })
        gate.current = created
        setVisible(false)
        created.update(latest.current)
        return () => {
            created.dispose()
        }
    }, [delayMs, minMs])
    useEffect(() => {
        gate.current?.update(isLoading)
    }, [isLoading])
    return visible
}

/** An SWR response with the gated skeleton flag `skeletonGate` adds. */
export type SkeletonGatedResponse<Data = unknown, Error = unknown> = SWRResponse<Data, Error> & { readonly showSkeleton: boolean }

/**
 * SWR middleware that adds `showSkeleton` to every response: `isLoading` through `useSkeletonGate`. Register it once in the `use`
 * list of the app's `SWRConfig`; a read then draws its skeleton from `showSkeleton` instead of `isLoading`. The response's own
 * getters are carried over as they are, so SWR still tracks only the fields the component reads.
 */
export const skeletonGate = (timing: SkeletonGateTiming = {}): Middleware => (useSWRNext) => (key, fetcher, config) => {
    const response = useSWRNext(key, fetcher, config)
    const showSkeleton = useSkeletonGate(response.isLoading, timing.delayMs, timing.minMs)
    return Object.defineProperties({}, {
        ...Object.getOwnPropertyDescriptors(response),
        showSkeleton: { value: showSkeleton, enumerable: true },
    }) as typeof response & { readonly showSkeleton: boolean }
}
