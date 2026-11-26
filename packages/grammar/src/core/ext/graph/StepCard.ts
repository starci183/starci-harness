"use client"

import { createElement as h, type ReactElement, type ReactNode } from "react"
import { IconTile, InlineStatus, Text, type IconSource } from "../../index.js"
import type { IconTileTone } from "../../leaf/IconTile/index.js"

/**
 * What a step of a workflow is, which picks the glyph and the tint of its tile (`STEP_CARD_KINDS`):
 * - `trigger` starts the run; `action` does a step; `ai` asks a model; `wait` waits for an event or a time; `approval` waits for a person;
 *   `code` runs the workspace's own code; `end` closes a path.
 * - The control steps draw their ways out as rows (`rows`): `branch` (an if with exactly two rows, or a switch with three or more, the last one the
 *   "else"), `loop` (three rows: the body, the stop condition, the limit) and `parallel` (one row per branch that runs at the same time); `join` is the
 *   step the branches of a parallel meet at.
 */
export const STEP_CARD_KINDS = ["trigger", "action", "ai", "wait", "branch", "approval", "code", "end", "loop", "parallel", "join"] as const
export type StepCardKind = (typeof STEP_CARD_KINDS)[number]

/**
 * How a step runs, the owner's four modes. `auto` draws no badge (the default needs no word); `ask` ("ask first") is amber, `studio` (a person works it in
 * the studio) purple, `manual` (the person does it by hand) grey. The words are the app's (`modeLabels`).
 */
export type StepCardMode = "auto" | "ask" | "studio" | "manual"

/** The words of the three modes that carry a badge, in the app's language. */
export type StepCardModeLabels = Readonly<Record<Exclude<StepCardMode, "auto">, string>>

/**
 * What a row's way out means, which colours its dot and the edge that leaves its port (`STEP_CARD_EDGE`):
 * - `main` the main road (solid success green); `warning` a road that needs care (solid amber); `else` the road when nothing else matches, a timeout or
 *   the limit of a loop (grey dashes);
 * - `back` a loop's body, whose last step returns to the loop (red dashes); `stop` a loop's stop condition (solid green);
 * - `branch` one branch of a parallel step (solid neutral).
 */
export const STEP_CARD_ROW_TONES = ["main", "warning", "else", "back", "stop", "branch"] as const
export type StepCardRowTone = (typeof STEP_CARD_ROW_TONES)[number]

/**
 * Where the run is at a row, during a run or its replay:
 * - `taken` the run went this way: the row lights up (its dot and words in the tone, a soft ground);
 * - `dimmed` the run reached the step and went another way: the row fades;
 * - `done`, `running` and `error` a parallel branch's own state, shown at the row's end with its word (`stateLabel`).
 * Left out, the row is drawn plain.
 */
export type StepCardRowState = "taken" | "dimmed" | "done" | "running" | "error"

/** One way out of a control step: its words (the condition, "else → Gửi nhắc"), its tone and, in a run, its state. */
export interface StepCardRow {
    readonly id: string
    readonly label: string
    readonly tone: StepCardRowTone
    readonly state?: StepCardRowState
    /** The word of `done`, `running` or `error` (the app's: "Xong", "Lỗi"), read after the label. */
    readonly stateLabel?: string
}

export interface StepCardProps {
    readonly kind: StepCardKind
    /** The step's name: one line, cut with an ellipsis (the full name is its tooltip). */
    readonly title: string
    /** The muted line under the name: what it does, or for a control step its kind and count of ways ("Nếu · 2 đường", "Lặp · tối đa 5 vòng · vòng 2/5"). */
    readonly subtitle?: string
    /** The step's own glyph, over the kind's (a node's package icon). */
    readonly icon?: IconSource
    /** How the step runs; `auto` or left out draws no badge. */
    readonly mode?: StepCardMode
    /** The words of the mode badge. Required to draw one. */
    readonly modeLabels?: StepCardModeLabels
    /** The ways out of a control step (`branch`, `loop`, `parallel`), one row each, in order; the last row of a branch is its "else". */
    readonly rows?: readonly StepCardRow[]
    /**
     * The output port of a row: the app's handle (an xyflow `Handle` with the row's id), drawn on the card's right edge at the row's middle, so each row's
     * edge leaves from its own row. The card itself draws no handle: the canvas that holds it owns them.
     */
    readonly renderPort?: (row: StepCardRow, index: number) => ReactNode
}

/**
 * The geometry of the card, in graph units (px at zoom 1), for the canvas's layout: every card is `width` wide; a step without rows is `height` tall; a
 * control step is its head (`head`) plus one `row` per way out (`stepCardHeight`), each row the 8px block padding, a 16px line and its 0.5px seam.
 */
export const STEP_CARD = { width: 200, height: 96, head: 64, row: 32.5 } as const

/** The height a card draws at: 96, or the head plus its rows for a control step (never less than 96). */
export const stepCardHeight = (rows: number): number => (rows === 0 ? STEP_CARD.height : Math.max(STEP_CARD.height, STEP_CARD.head + rows * STEP_CARD.row))

/**
 * The look of the edge that leaves a row's port, for the canvas's edge: its stroke (a theme token) and whether it is dashed. Main green, warning amber,
 * else grey dashes, a loop's return red dashes, a loop's stop green, a parallel branch neutral.
 */
export const STEP_CARD_EDGE: Readonly<Record<StepCardRowTone, { readonly stroke: string; readonly dashed: boolean }>> = {
    main: { stroke: "var(--success)", dashed: false },
    warning: { stroke: "var(--warning)", dashed: false },
    else: { stroke: "var(--muted)", dashed: true },
    back: { stroke: "var(--danger)", dashed: true },
    stop: { stroke: "var(--success)", dashed: false },
    branch: { stroke: "var(--muted)", dashed: false },
}

/** The stroke dashes of a dashed row edge (a `stroke-dasharray`). */
export const STEP_CARD_DASH = "6 4"

/** The tint of each kind's tile. */
export const STEP_CARD_KIND_TONE: Readonly<Record<StepCardKind, IconTileTone>> = {
    trigger: "danger",
    action: "success",
    ai: "accent",
    wait: "warning",
    branch: "warning",
    approval: "danger",
    code: "info",
    end: "neutral",
    loop: "warning",
    parallel: "info",
    join: "neutral",
}

/** A Heroicons-24-outline-style glyph: one or more paths, stroke 1.5, round ends. */
const glyph =
    (...paths: readonly string[]): IconSource =>
    (props) =>
        h(
            "svg",
            { ...props, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" },
            ...paths.map((d, index) => h("path", { key: index, d })),
        )

/** The glyph of each kind, used when the app gives the step no icon of its own. */
export const STEP_CARD_GLYPHS: Readonly<Record<StepCardKind, IconSource>> = {
    trigger: glyph("m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z"),
    action: glyph("M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z"),
    ai: glyph("M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z", "M18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z"),
    wait: glyph("M12 6v6h4.5", "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"),
    branch: glyph("M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"),
    approval: glyph("M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z", "M9.75 9.75a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z", "M5.25 15.75c.4-1.3 1.6-2.25 3-2.25s2.6.95 3 2.25"),
    code: glyph("M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5"),
    end: glyph("M9 12.75 11.25 15 15 9.75", "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"),
    loop: glyph("M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"),
    parallel: glyph("M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"),
    join: glyph("M3.75 6.75h4.5l4.5 5.25-4.5 5.25h-4.5", "M12.75 12h7.5m0 0-3-3m3 3-3 3"),
}

/** The core status mark of a parallel branch's own state. */
const ROW_MARK = { done: "done", running: "running", error: "error" } as const

/** One way out: a dot in its tone, its words (cut with an ellipsis, the full words its tooltip), a parallel branch's state, and the app's port at the right edge. */
const row = (item: StepCardRow, index: number, renderPort: StepCardProps["renderPort"]): ReactElement => {
    const mark = item.state === "done" || item.state === "running" || item.state === "error" ? ROW_MARK[item.state] : undefined
    return h(
        "span",
        { key: item.id, className: "starci-step-card-row", "data-tone": item.tone, "data-state": item.state, "data-row": item.id, title: item.label },
        h("span", { className: "starci-step-card-row-dot", "aria-hidden": true }),
        h("span", { className: "starci-step-card-row-label" }, h(Text, { role: "caption", overflow: "truncate" }, item.label)),
        mark === undefined ? null : h("span", { className: "starci-step-card-row-state" }, h(InlineStatus, { state: mark, label: item.stateLabel ?? "" })),
        renderPort === undefined ? null : h("span", { className: "starci-step-card-row-port" }, renderPort(item, index)),
    )
}

/**
 * The card of one step of a workflow graph (the owner's node design, 2026-11-27): every card is 200 wide and 96 tall (`STEP_CARD`), the step's glyph on
 * its kind's tinted tile (`STEP_CARD_KIND_TONE`, `STEP_CARD_GLYPHS`), its name on one line and a muted line under it, and the mode badge at the
 * bottom-right corner (`ask` amber, `studio` purple, `manual` grey; `auto` none). A control step (`branch`, `loop`, `parallel`) lists its ways out
 * under the head, one row each with an 8px by 12px padding and a 0.5px seam above every row (the first too), its tone's dot and its own output port on the
 * right edge (`renderPort`); its height is `stepCardHeight(rows)`. During a run or a replay the row the run took lights up and the others dim
 * (`StepCardRow.state`), and a parallel branch shows its own done or error mark.
 *
 * It is the card's inside only: the canvas that holds it draws the border, the selection, the run status on the border and the handles, and passes the
 * port of each row. Import `@starci/grammar/core/ext/graph.css` once.
 */
export const StepCard = (props: StepCardProps): ReactElement => {
    const { kind, title, subtitle, icon, mode, modeLabels, rows = [], renderPort } = props
    const badge = mode === undefined || mode === "auto" || modeLabels === undefined ? undefined : modeLabels[mode]
    return h(
        "span",
        { className: "starci-step-card", "data-kind": kind, "data-rows": rows.length > 0 ? String(rows.length) : undefined, style: { inlineSize: STEP_CARD.width, minBlockSize: stepCardHeight(rows.length) } },
        h(
            "span",
            { className: "starci-step-card-head" },
            h(IconTile, { source: icon ?? STEP_CARD_GLYPHS[kind], tone: STEP_CARD_KIND_TONE[kind] }),
            h(
                "span",
                { className: "starci-step-card-text", title },
                h(Text, { role: "label.item", overflow: "truncate" }, title),
                subtitle === undefined || subtitle === "" ? null : h(Text, { role: "label.field", overflow: "truncate" }, subtitle),
            ),
        ),
        rows.length === 0 ? null : h("span", { className: "starci-step-card-rows" }, rows.map((item, index) => row(item, index, renderPort))),
        badge === undefined ? null : h("span", { className: "starci-step-card-mode starci-type-caption", "data-mode": mode }, badge),
    )
}
