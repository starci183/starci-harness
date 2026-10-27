/**
 * Live updates: one EventSource on `/api/events`; each `LiveEvent` invalidates the queries it names, so a page re-reads only
 * what changed. EventSource cannot send headers, so the token rides as `?token=` on this one URL. Fixtures mode opens nothing.
 */
import { useQueryClient, type QueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { apiUrl, isFixturesMode, queryKeys, type Connection } from "./client"
import type { LiveEvent } from "@contract"

export type LiveState = "off" | "connecting" | "open" | "retrying"

const isLiveEvent = (value: unknown): value is LiveEvent => {
    if (typeof value !== "object" || value === null) return false
    const type = (value as { type?: unknown }).type
    return type === "overview" || type === "workflow" || type === "task" || type === "inbox" || type === "config"
}

/** Map one event to the queries it makes stale. */
export const invalidateFor = (client: QueryClient, event: LiveEvent): void => {
    switch (event.type) {
        case "overview":
            void client.invalidateQueries({ queryKey: queryKeys.overview })
            return
        case "workflow":
            void client.invalidateQueries({ queryKey: queryKeys.workflow(event.project, event.workflow) })
            void client.invalidateQueries({ queryKey: queryKeys.overview })
            return
        case "task":
            void client.invalidateQueries({ queryKey: queryKeys.task(event.project, event.task) })
            return
        case "inbox":
            void client.invalidateQueries({ queryKey: queryKeys.inbox })
            void client.invalidateQueries({ queryKey: queryKeys.overview })
            return
        case "config":
            void client.invalidateQueries({ queryKey: queryKeys.config })
            return
    }
}

/** Subscribe while mounted; returns the stream state for the sidebar footer. */
export const useLiveEvents = (connection: Connection | null): LiveState => {
    const client = useQueryClient()
    const [state, setState] = useState<LiveState>("off")

    useEffect(() => {
        if (connection === null || isFixturesMode() || typeof EventSource === "undefined") {
            setState("off")
            return
        }
        setState("connecting")
        const source = new EventSource(`${apiUrl("/events", connection)}?token=${encodeURIComponent(connection.token)}`)
        source.onopen = () => {
            setState("open")
            // Anything may have changed while the stream was down.
            void client.invalidateQueries()
        }
        source.onerror = () => setState(source.readyState === EventSource.CLOSED ? "off" : "retrying")
        source.onmessage = message => {
            try {
                const event: unknown = JSON.parse(message.data as string)
                if (isLiveEvent(event)) invalidateFor(client, event)
            } catch {
                // A malformed frame changes nothing; the next one or a reconnect catches up.
            }
        }
        return () => source.close()
    }, [client, connection])

    return state
}
