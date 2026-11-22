import { CheckCircleIcon, CheckIcon, XCircleIcon, XMarkIcon } from "@heroicons/react/24/outline"
import type { ComponentType, ReactNode, SVGProps } from "react"

/**
 * The state of one step, run or node (0.55.0, the status-mark rule, owner "chốt"). One closed set for every status mark in Grammar:
 * `done`, `running`, `waiting`, `error`, `skipped` and `notRun`. The tone of a mark is the state's (`MARK_STATE_TONE`), never the app's choice.
 */
export const MARK_STATES = ["done", "running", "waiting", "error", "skipped", "notRun"] as const
export type MarkState = (typeof MARK_STATES)[number]

/**
 * The plate tone of each state: success = done, INFO = running (owner 2026-11-22: in progress is info, the blue tone; accent stays the brand for
 * selection, links and the primary action), warning = waiting, danger = error, neutral = skipped or not run.
 */
export const MARK_STATE_TONE: Readonly<Record<MarkState, "success" | "info" | "warning" | "danger" | "neutral">> = {
    done: "success", running: "info", waiting: "warning", error: "danger", skipped: "neutral", notRun: "neutral",
}

export const isMarkState = (value: unknown): value is MarkState => typeof value === "string" && (MARK_STATES as readonly string[]).includes(value)

type Glyph = ComponentType<SVGProps<SVGSVGElement>>

/** The plain circle (waiting, skipped, not run: the colour tells them apart), in the Heroicons 24 outline geometry (stroke 1.5, r 9). */
export const CircleIcon: Glyph = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <circle cx="12" cy="12" r="9" />
    </svg>
)

/** The bare circle inside the 40px plate: a smaller ring, so the plate's own circle and the glyph never read as one circle in a circle. */
export const BareCircleIcon: Glyph = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <circle cx="12" cy="12" r="5.25" />
    </svg>
)

/** Running: the same plain circle as a faint track with a quarter arc that spins (`.starci-core-status-spin`; still under reduced motion). */
const SpinnerCircle = ({ r, className, kind }: { readonly r: number; readonly className: string; readonly kind: string }): ReactNode => {
    const length = 2 * Math.PI * r
    return (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true" focusable="false" className={`${className} starci-core-status-spin`} data-grammar-status-glyph={kind}>
            <circle cx="12" cy="12" r={r} opacity="0.3" />
            <circle cx="12" cy="12" r={r} strokeLinecap="round" strokeDasharray={`${(length / 4).toFixed(2)} ${length.toFixed(2)}`} />
        </svg>
    )
}

/**
 * The status glyphs: THREE and the spinner (owner 2026-11-22, overview-v2): circle-check is done; circle-x is error (stopped, cancelled,
 * overdue); the plain circle is waiting (warning), skipped and not run (muted); running is the same circle as a spinning ring. No pause,
 * clock, minus, dashed or info glyph is a status. Two maps of the same three:
 * - `inline` (A), no plate: circle-check, circle-x, the plain circle.
 * - `tile` (B), inside the round 40px plate: their BARE equivalents, so no circle sits in a circle: check, x, a small ring.
 */
export const STATUS_GLYPH: {
    readonly tile: Readonly<Record<Exclude<MarkState, "running">, Glyph>>
    readonly inline: Readonly<Record<Exclude<MarkState, "running">, Glyph>>
} = {
    tile: { done: CheckIcon, waiting: BareCircleIcon, error: XMarkIcon, skipped: BareCircleIcon, notRun: BareCircleIcon },
    inline: { done: CheckCircleIcon, waiting: CircleIcon, error: XCircleIcon, skipped: CircleIcon, notRun: CircleIcon },
}
const TILE_GLYPH = STATUS_GLYPH.tile
const INLINE_GLYPH = STATUS_GLYPH.inline

export type TileGlyphKind = MarkState

/** The status glyph inside a 40px round tile; decorative, the words say the state. */
export const StatusGlyph = ({ kind }: { readonly kind: TileGlyphKind }): ReactNode => {
    if (kind === "running") return <SpinnerCircle r={5.25} className="starci-core-status-glyph starci-core-status-spinner" kind="running" />
    const Source = TILE_GLYPH[kind]
    return <Source aria-hidden="true" focusable="false" className="starci-core-status-glyph" data-grammar-status-glyph={kind} />
}

/** The bare glyph of an inline status (A); decorative. */
export const InlineStatusGlyph = ({ state }: { readonly state: MarkState }): ReactNode => {
    if (state === "running") return <SpinnerCircle r={9} className="starci-core-inline-status-spinner" kind="running" />
    const Source = INLINE_GLYPH[state]
    return <Source aria-hidden="true" focusable="false" className="starci-core-inline-status-glyph" data-grammar-status-glyph={state} />
}

/**
 * (B) The round 40px status tile (`.starci-core-icon-tile`, one 40px plate: there is no 32px status mark). `children` is what the
 * plate carries: a status glyph (case 1), the subject icon the app passes in (case 2), or a step number (the reader's own step of a flow).
 * A running subject tile wears a spinning ring on its edge. Internal: apps reach it through `IconTile state`, `Timeline`, `Stepper`, `EmptyNotice`.
 */
export const StatusTile = ({ tone, state, children, hasSubject = false, label }: {
    readonly tone: string
    readonly state?: MarkState | undefined
    readonly children: ReactNode
    readonly hasSubject?: boolean
    /** Names the mark when it stands alone; omitted, the mark is decorative and the words beside it say the state. */
    readonly label?: string | undefined
}): ReactNode => (
    <span
        {...(label === undefined ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
        className="starci-core-icon-tile"
        data-tier="leaf"
        data-component="IconTile"
        data-tone={tone}
        data-artwork="false"
        data-loading="false"
        data-grammar-mark="status"
        {...(state === undefined ? {} : { "data-grammar-mark-state": state })}
        data-grammar-mark-subject={hasSubject ? "true" : "false"}
        data-contract="OVERFLOW-2 A11Y-2"
    >
        {children}
        {hasSubject && state === "running" ? <span className="starci-core-icon-tile-ring" data-grammar-mark-ring="true" /> : null}
    </span>
)
