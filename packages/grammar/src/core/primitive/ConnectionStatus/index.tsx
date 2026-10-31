import { StatusDotMark, type StatusDotTone } from "../StatusDot/index.js"

/** `live` data is arriving, `reconnecting` the link dropped and is being restored, `lost` it is down and no retry is running. */
export type ConnectionState = "live" | "reconnecting" | "lost"

export type ConnectionStatusProps = {
    readonly state: ConnectionState
    /** The state in the app's words, e.g. "Live", "Reconnecting", "Connection lost". It is drawn and announced; the dot adds nothing to read. */
    readonly label: string
}

const TONES: Record<ConnectionState, StatusDotTone> = {
    live: "success",
    reconnecting: "warning",
    lost: "danger",
}

/**
 * ATOM - `ConnectionStatus`: the state of a live feed (server-sent events, a socket) as a small dot and its words. It is a polite
 * live region, so a change from `live` to `reconnecting` or `lost` is spoken without moving focus. The dot echoes while `live` and
 * `reconnecting` (off under reduced motion) and stands still when `lost`; the words carry the state, never the colour alone.
 * Contract: DOT-NAMED by its label, STATE-1 by `data-grammar-connection-state`.
 */
export const ConnectionStatus = ({ state, label }: ConnectionStatusProps) => (
    <span
        aria-live="polite"
        className="starci-core-connection-status"
        data-component="ConnectionStatus"
        data-contract="STATE-1"
        data-grammar-connection-state={state}
        data-tier="atom"
        role="status"
    >
        <StatusDotMark echo={state !== "lost"} tone={TONES[state]} />
        <span className="starci-core-connection-status-label">{label}</span>
    </span>
)
