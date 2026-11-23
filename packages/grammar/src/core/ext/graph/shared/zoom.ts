"use client"

import { Panel, useReactFlow, type FitViewOptions } from "@xyflow/react"
import { createElement as h, type ReactElement } from "react"
import { IconButton } from "../../../index.js"
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
