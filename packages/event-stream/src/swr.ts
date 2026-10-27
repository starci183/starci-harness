import type { EventFrame, EventStreamHandle, FollowOptions, FollowCallbacks, ParseData, RequestOptions } from "./types.js"

/** The part of an event stream instance the adapter needs. */
export interface Followable {
  follow<T>(path: string, options: FollowOptions<T> & { parse: ParseData<T> }): EventStreamHandle
}

/** The `next` of `useSWRSubscription`: an error, or the data (or an updater of the current data). */
export type SubscriptionNext<T> = (error?: Error | null, data?: T | ((current: T | undefined) => T)) => void

/** What `subscribeEventStream` takes besides the instance and the path. */
export interface SubscribeOptions<T> extends RequestOptions, Pick<FollowCallbacks<T>, "onOpen" | "onFrame" | "onEvent"> {
  /** Turns the data text into `T`. */
  parse?: ParseData<T>
  /** Picks what SWR receives for each frame. Default: the data of the frame. */
  select?: (frame: EventFrame<T>) => T
}

/** The subscribe function `useSWRSubscription` takes. */
export type SwrSubscribe<T> = (key: unknown, context: { next: SubscriptionNext<T> }) => () => void

/**
 * Adapts a stream to `useSWRSubscription`. The data of every default frame is handed to SWR's `next`, a failed attempt as its error
 * (the next frame clears it), and the cleanup closes the stream. `onOpen` is where the snapshot is revalidated.
 *
 * ```ts
 * const { data } = useSWRSubscription(["booking-status", id], subscribeEventStream(events, "/booking-status/stream", {
 *   parse: parseStatus,
 *   onOpen: () => mutate(["booking", id]),
 * }))
 * ```
 */
export function subscribeEventStream(
  instance: Followable,
  path: string,
  options?: SubscribeOptions<string>,
): SwrSubscribe<string>
export function subscribeEventStream<T>(
  instance: Followable,
  path: string,
  options: SubscribeOptions<T> & { parse: ParseData<T> },
): SwrSubscribe<T>
export function subscribeEventStream<T>(
  instance: Followable,
  path: string,
  options: SubscribeOptions<T> = {},
): SwrSubscribe<T> {
  return (_key, { next }) => {
    const handle = instance.follow<T>(path, {
      ...options,
      parse: options.parse ?? ((data) => data as T),
      onFrame: (frame) => {
        options.onFrame?.(frame)
        next(null, options.select ? options.select(frame) : frame.data)
      },
      onError: (error) => next(error),
    })
    return () => handle.close()
  }
}
