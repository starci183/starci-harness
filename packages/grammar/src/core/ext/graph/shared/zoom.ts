"use client"

import { Panel, useReactFlow, useStore, type FitViewOptions } from "@xyflow/react"
import { createElement as h, type ReactElement } from "react"
import { Button, IconButton } from "../../../index.js"
import { TablerArrowsMaximize, TablerMinus, TablerPlus, TablerRefresh } from "../../../leaf/Icon/tabler.js"

/** The words of the zoom buttons, in the app's language. */
export interface ZoomWords {
    readonly zoomIn: string
    readonly zoomOut: string
    readonly fit: string
}

/** xyflow's own words for its controls, the ones an app overrides through `ariaLabelConfig`. */
export const zoomWords = (config: Readonly<Record<string, string>> | undefined): ZoomWords => ({
    zoomIn: config?.["controls.zoomIn.ariaLabel"] ?? "Zoom In",
    zoomOut: config?.["controls.zoomOut.ariaLabel"] ?? "Zoom Out",
    fit: config?.["controls.fitView.ariaLabel"] ?? "Fit View",
})

export interface ZoomButtonsProps {
    readonly words: ZoomWords
    readonly onZoomIn: () => void
    readonly onZoomOut: () => void
    readonly onFit: () => void
    /** A fourth button that puts every moved node back (an editable graph), with its words. */
    readonly reset?: { readonly label: string; readonly onPress: () => void }
}

/** The zoom of every graph mode: Grammar's 40px IconButtons in a column (zoom in, zoom out, fit, and reset while editable). */
export const ZoomButtons = ({ words, onZoomIn, onZoomOut, onFit, reset }: ZoomButtonsProps): ReactElement =>
    h(
        "div",
        { className: "starci-graph-zoom", role: "group" },
        h(IconButton, { key: "in", source: TablerPlus, label: words.zoomIn, onPress: onZoomIn }),
        h(IconButton, { key: "out", source: TablerMinus, label: words.zoomOut, onPress: onZoomOut }),
        h(IconButton, { key: "fit", source: TablerArrowsMaximize, label: words.fit, onPress: onFit }),
        reset === undefined ? null : h(IconButton, { key: "reset", source: TablerRefresh, label: reset.label, onPress: reset.onPress }),
    )

/** The zoom buttons of an xyflow canvas, at its bottom left; `onFit` replaces xyflow's own fit (a graph that keeps clear of the buttons). */
export const FlowZoom = ({ words, onFit, fitOptions, reset }: { readonly words: ZoomWords; readonly onFit?: () => void; readonly fitOptions?: FitViewOptions; readonly reset?: ZoomButtonsProps["reset"] }): ReactElement => {
    const flow = useReactFlow()
    return h(
        Panel,
        { position: "bottom-left", className: "starci-graph-zoom-panel" },
        h(ZoomButtons, {
            words,
            onZoomIn: () => void flow.zoomIn(),
            onZoomOut: () => void flow.zoomOut(),
            onFit: onFit ?? (() => void flow.fitView(fitOptions)),
            ...(reset === undefined ? {} : { reset }),
        }),
    )
}

export interface ZoomBarProps {
    /** The words: zoom in, zoom out, and the fit button's word ("Vừa khung"), which the bar follows with the zoom in percent ("Vừa khung · 76%"). */
    readonly words: ZoomWords
    /** How the fit button fits (the canvas's own fit options: the whole graph in the frame). */
    readonly fitOptions?: FitViewOptions
    /** Replaces xyflow's fit (a canvas that fits clear of its own controls). */
    readonly onFit?: () => void
}

/** The zoom as a whole percent, read from the canvas so the bar follows the wheel, the pinch and the fit. */
const zoomPercent = (state: { readonly transform: readonly [number, number, number] }): number => Math.round(state.transform[2] * 100)

/**
 * The zoom bar of a workflow graph (the approved canvas, 2026-11-27): one row at the bottom left inside the frame, "+", "−" and the fit button that names
 * the zoom ("Vừa khung · 76%"), every part whole (the row takes its content's width, never cut by the frame). It reads xyflow's store, so it stands inside
 * a `ReactFlow` (in a `Panel`, or the app's own controls group).
 */
export const ZoomBar = ({ words, fitOptions, onFit }: ZoomBarProps): ReactElement => {
    const flow = useReactFlow()
    const percent = useStore(zoomPercent)
    return h(
        "div",
        { className: "starci-graph-zoom-bar", role: "group", "aria-label": words.fit },
        h(IconButton, { key: "in", size: "sm", source: TablerPlus, label: words.zoomIn, onPress: () => void flow.zoomIn() }),
        h(IconButton, { key: "out", size: "sm", source: TablerMinus, label: words.zoomOut, onPress: () => void flow.zoomOut() }),
        h(Button, { key: "fit", size: "sm", onPress: onFit ?? (() => void flow.fitView(fitOptions)), children: `${words.fit} · ${String(percent)}%` }),
    )
}
