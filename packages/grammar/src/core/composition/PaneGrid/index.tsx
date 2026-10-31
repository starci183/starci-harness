"use client"

import { cn, Drawer } from "@heroui/react"
import {
    Children,
    createContext,
    isValidElement,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    type ComponentPropsWithoutRef,
    type CSSProperties,
    type ReactElement,
    type ReactNode,
} from "react"
import { VerticalScrollRegion } from "../../composite/VerticalScrollRegion/index.js"
import { SurfaceNesting } from "../../surfaceContext.js"
import { PaneContext, usePaneContext, type PaneContextValue, type PaneInset } from "../../paneContext.js"
import {
    buildResponsivePaneGridModels,
    paneBreakpoints,
    parseAreas,
    trackToCss,
    type PaneBreakpoint,
    type PaneEdges,
    type PaneGridModel,
    type PaneResponsive,
    type PaneTrack,
} from "./layout.js"

export type { PaneInset } from "../../paneContext.js"
export type { PaneBreakpoint, PaneByBreakpoint, PaneResponsive, PaneTrack } from "./layout.js"

type CustomProperties = CSSProperties & { readonly [name: `--${string}`]: string | undefined }
type Models = Readonly<Record<PaneBreakpoint, PaneGridModel>>

const PaneModelsContext = createContext<Models | undefined>(undefined)

type PaneBaseProps = {
    /** The name of this pane in the grid's `areas`. */
    readonly area: string
    /** `true`: the pane stands on the grammar surface ground (flat: no border, radius or shadow). Default: transparent on the host canvas. */
    readonly surface?: boolean
    /**
     * `content` (default): the pane publishes the Grammar pane inset to its PaneSections. `flush`: zero inset, for a
     * nested PaneGrid or a full-bleed canvas.
     */
    readonly inset?: PaneInset
    /** PaneSection elements, or one PaneGrid. */
    readonly children?: ReactNode
}

type PaneScrollProps =
    | {
        /** The pane is its own vertical scroll owner; it then needs an accessible name. */
        readonly scroll: true
        readonly label: string
    }
    | {
        readonly scroll?: false
        /** Accessible name; a pane with a label is exposed as a region. */
        readonly label?: string
    }

type PaneCollapseProps =
    | {
        /** Wherever the pane's area is not arranged (below 48rem for a single `areas`) the pane becomes a Drawer opened from a trigger above the grid. */
        readonly collapse: "drawer"
        /** Accessible name of the drawer. */
        readonly collapseLabel: string
        /** Visible and accessible label of the trigger. */
        readonly openLabel: string
        /** Accessible label of the drawer's close control. */
        readonly closeLabel: string
        /** Controlled drawer state. */
        readonly isOpen: boolean
        /** Receives trigger, backdrop, close-control and Escape changes. */
        readonly onOpenChange: (isOpen: boolean) => void
    }
    | {
        readonly collapse?: undefined
        readonly collapseLabel?: never
        readonly openLabel?: never
        readonly closeLabel?: never
        readonly isOpen?: never
        readonly onOpenChange?: never
    }

export type PaneProps = PaneBaseProps & PaneScrollProps & PaneCollapseProps

const isDevelopment = process.env.NODE_ENV !== "production"

/** A pane's section registry: PaneSection and a nested PaneGrid register on mount; a content pane with none is reported in development. */
const usePaneRegistry = (area: string, inset: PaneInset, checks: boolean): PaneContextValue => {
    const count = useRef(0)
    const register = useCallback(() => {
        count.current += 1
        return () => {
            count.current -= 1
        }
    }, [])
    useEffect(() => {
        if (isDevelopment && checks && inset === "content" && count.current === 0) {
            console.error(`PANE_WITHOUT_SECTION: ${area}`)
        }
    }, [area, inset, checks])
    return useMemo(() => ({ area, inset, register }), [area, inset, register])
}

/**
 * One pane of a PaneGrid, placed by `area`. Panes sit flush; the divider on its start edges is drawn from the grid's
 * layout at each breakpoint, and the pane paints nothing else unless `surface` is set. The pane owns its content inset:
 * it never pads itself, it publishes the inline and block insets (and whether its block end is the grid's outer edge or
 * a divider) to its PaneSections, so dividers and scrollbars stay full-bleed. A pane takes no app class.
 */
export const Pane = (props: PaneProps) => {
    const { area, surface = false, inset = "content", label, scroll = false, children } = props
    const models = useContext(PaneModelsContext)
    const pane = usePaneRegistry(area, inset, true)
    const shown = "flex"
    const vars: Record<string, string> = {}
    let hasEdge = false
    if (models !== undefined) {
        for (const breakpoint of paneBreakpoints) {
            const edges: PaneEdges | undefined = models[breakpoint].edges[area]
            vars[`--starci-core-pane-d-${breakpoint}`] = edges === undefined ? "none" : shown
            vars[`--starci-core-pane-i-${breakpoint}`] = edges?.inline === true ? "1px" : "0px"
            vars[`--starci-core-pane-b-${breakpoint}`] = edges?.block === true ? "1px" : "0px"
            hasEdge = hasEdge || edges?.inline === true || edges?.block === true
            vars[`--starci-core-pane-be-${breakpoint}`] = edges?.blockEnd === "divider"
                ? "var(--grammar-pane-inset-block-end-divider, 0.75rem)"
                : "var(--grammar-pane-inset-block-end-outer, 1rem)"
        }
    }
    const style: CustomProperties = { gridArea: area, ...vars }
    const stack = <div className="starci-core-pane-stack" data-grammar-pane-stack="true">{children}</div>
    const body = scroll
        ? (
            <VerticalScrollRegion
                aria-label={label}
                className="starci-core-pane-scroll"
                data-contract="OVERFLOW-4 OVERFLOW-5"
                isScrollable
            >
                {stack}
            </VerticalScrollRegion>
        )
        : stack
    const surfaced = surface ? <SurfaceNesting>{body}</SurfaceNesting> : body
    const content = <PaneContext.Provider value={pane}>{surfaced}</PaneContext.Provider>
    const shared = {
        className: "starci-core-pane",
        "data-component": "Pane",
        "data-tier": "composition",
        "data-grammar-pane-area": area,
        "data-grammar-pane-surface": surface ? "true" : undefined,
        "data-grammar-pane-scroll": scroll ? "true" : undefined,
        "data-grammar-pane-inset": inset,
        "data-contract": [hasEdge ? "BOUNDARY-1" : undefined, inset === "content" ? "PADDING-4 PADDING-3" : "PADDING-0"].filter((part) => part !== undefined).join(" "),
        style,
    }
    return label === undefined || scroll
        ? <div {...shared}>{content}</div>
        : <section {...shared} aria-label={label}>{content}</section>
}

export type PaneGridProps = Omit<ComponentPropsWithoutRef<"section">, "aria-label" | "children"> & {
    /** Accessible name for the whole grid landmark. */
    readonly label: string
    /**
     * `grid-template-areas` rows, for example `["a b c", "d d d"]`; `.` is an empty cell. Give an object keyed by
     * breakpoint (`base`, `medium` from 48rem, `wide` from 70rem) to rearrange: a pane whose area is missing at a
     * breakpoint is hidden there, or becomes a drawer when it has `collapse="drawer"`. A single array arranges the
     * grid from `base` up, except that a pane with `collapse="drawer"` leaves it below 48rem.
     */
    readonly areas: PaneResponsive<ReadonlyArray<string>>
    /** Column tracks, left to right (also per breakpoint); a missing track is `fill`. */
    readonly columns?: PaneResponsive<ReadonlyArray<PaneTrack>>
    /** Row tracks, top to bottom (also per breakpoint); a missing track is `fill`. */
    readonly rows?: PaneResponsive<ReadonlyArray<PaneTrack>>
    /** `Pane` elements as direct children (`null`, `false` and arrays of Panes are legal; anything else throws in development). */
    readonly children?: ReactNode
}

const isPane = (child: ReactNode): child is ReactElement<PaneProps> =>
    isValidElement(child) && child.type === Pane

/** A readable name for a child that is not a Pane, for `PANE_GRID_CHILD_NOT_PANE`. */
const childTypeName = (child: ReactNode): string => {
    if (!isValidElement(child)) return typeof child
    const { type } = child
    if (typeof type === "string") return type
    if (typeof type === "function") return type.name === "" ? "component" : type.name
    return typeof type === "symbol" ? "Fragment" : "component"
}

/** Whether the area is in the first grid column wherever it appears: its drawer then opens from the start side. */
const isStartColumn = (models: Models, area: string): boolean =>
    paneBreakpoints.some((breakpoint) => parseAreas(models[breakpoint].areas).some((row) => row[0] === area))

const gridVars = (models: Models, hasTrigger: (breakpoint: PaneBreakpoint) => boolean): CustomProperties => {
    const vars: Record<string, string> = {}
    for (const breakpoint of paneBreakpoints) {
        const model = models[breakpoint]
        vars[`--starci-core-pane-grid-areas-${breakpoint}`] = model.areas.map((row) => `"${row}"`).join(" ")
        vars[`--starci-core-pane-grid-columns-${breakpoint}`] = model.columns.map(trackToCss).join(" ")
        vars[`--starci-core-pane-grid-rows-${breakpoint}`] = model.rows.map(trackToCss).join(" ")
        vars[`--starci-core-pane-grid-triggers-${breakpoint}`] = hasTrigger(breakpoint) ? "flex" : "none"
    }
    return vars
}

/**
 * Generic bounded pane grid: named areas laid out flush, a divider between adjacent panes, each pane optionally on the
 * surface ground and optionally its own scroll owner.
 *
 * The host supplies a height; the grid fills it and owns the height chain below. Panes sit with no gap and one
 * divider line (n-1, never doubled, none on an outer edge) separates neighbours: vertical between columns, horizontal
 * between rows. The arrangement is chosen per breakpoint by CSS container queries on the
 * grid's own width, so there is no layout shift. A pane with `collapse="drawer"` becomes a Drawer opened from a
 * trigger above the grid wherever its area is not arranged. Grammar supplies layout only and no business meaning:
 * the app composes its own pieces into the panes. While a drawer is open its pane renders a second time inside it.
 */
export const PaneGrid = (props: PaneGridProps) => {
    const { label, areas, columns, rows, className, children, ...sectionProps } = props
    const flat = Children.toArray(children)
    const parent = usePaneContext()
    useEffect(() => parent?.register(), [parent])
    if (isDevelopment) {
        const stray = flat.find((child) => !isPane(child))
        if (stray !== undefined) throw new Error(`PANE_GRID_CHILD_NOT_PANE: ${childTypeName(stray)}`)
    }
    const panes = flat.filter(isPane)
    const drawers = panes.filter((pane) => pane.props.collapse === "drawer")
    const collapsedKey = drawers.map((pane) => pane.props.area).join(" ")
    const models = useMemo(
        () => buildResponsivePaneGridModels(
            areas,
            columns,
            rows,
            new Set(collapsedKey === "" ? [] : collapsedKey.split(" ")),
        ),
        [areas, columns, rows, collapsedKey],
    )
    const style: CustomProperties = gridVars(models, (breakpoint) =>
        drawers.some((pane) => models[breakpoint].edges[pane.props.area] === undefined))

    return (
        <section
            {...sectionProps}
            aria-label={label}
            className={cn("starci-core-pane-grid", className)}
            data-component="PaneGrid"
            data-tier="composition"
            data-grammar-pane-grid="true"
        >
            {drawers.length === 0 ? null : (
                <div className="starci-core-pane-grid-triggers" data-contract="BOUNDARY-1 PADDING-4 PADDING-2" style={style}>
                    {drawers.map((pane) => (
                        <PaneDrawer
                            key={pane.props.area}
                            pane={pane}
                            placement={isStartColumn(models, pane.props.area) ? "left" : "right"}
                            models={models}
                        />
                    ))}
                </div>
            )}
            <PaneModelsContext.Provider value={models}>
                <div className="starci-core-pane-grid-tracks" data-contract="GAP-0" style={style}>
                    {panes}
                </div>
            </PaneModelsContext.Provider>
        </section>
    )
}

/** The drawer's pane context: the content inset with the block end on the outer edge; nothing to register against. */
const drawerRegister = () => () => {}

const PaneDrawer = ({ pane, placement, models }: {
    readonly pane: ReactElement<PaneProps>
    readonly placement: "left" | "right"
    readonly models: Models
}) => {
    const { props } = pane
    const drawerPane = useMemo<PaneContextValue>(
        () => ({ area: props.area, inset: "content", register: drawerRegister }),
        [props.area],
    )
    if (props.collapse !== "drawer") return null
    const drawerVars: CustomProperties = { "--starci-core-pane-be": "var(--grammar-pane-inset-block-end-outer, 1rem)" }
    const drawerHeaderStyle: CSSProperties = { paddingInline: "var(--grammar-pane-inset-inline, 1rem)" }
    const triggerStyle: CustomProperties = {}
    const vars: Record<string, string> = {}
    for (const breakpoint of paneBreakpoints) {
        vars[`--starci-core-pane-trigger-${breakpoint}`] = models[breakpoint].edges[props.area] === undefined ? "inline-flex" : "none"
    }
    Object.assign(triggerStyle, vars)
    return (
        <Drawer isOpen={props.isOpen} onOpenChange={props.onOpenChange}>
            <Drawer.Trigger className="starci-core-pane-trigger" style={triggerStyle} data-contract="PADDING-3 SURFACE-2 FONT-2 TONE-1">
                {props.openLabel}
            </Drawer.Trigger>
            <Drawer.Backdrop>
                <Drawer.Content className="starci-core-pane-drawer-content" placement={placement}>
                    <Drawer.Dialog className="starci-core-pane-drawer-dialog" data-grammar-nesting="surface">
                        <SurfaceNesting>
                            <Drawer.Header className="starci-core-pane-drawer-header" style={drawerHeaderStyle}>
                                <Drawer.Heading>{props.collapseLabel}</Drawer.Heading>
                            </Drawer.Header>
                            <Drawer.CloseTrigger
                                aria-label={props.closeLabel}
                                className="starci-core-pane-drawer-close"
                                data-contract="SURFACE-2 TONE-1"
                            />
                            <Drawer.Body className="starci-core-pane-drawer-body" data-contract="OVERFLOW-2 PADDING-0">
                                <VerticalScrollRegion
                                    aria-label={props.collapseLabel}
                                    className="starci-core-pane-drawer-scroll"
                                    data-contract="OVERFLOW-4 OVERFLOW-5"
                                    data-grammar-pane-area={props.area}
                                    data-grammar-pane-inset="content"
                                    isScrollable
                                    style={drawerVars}
                                >
                                    <PaneContext.Provider value={drawerPane}>
                                        <div className="starci-core-pane-stack" data-grammar-pane-stack="true">{props.children}</div>
                                    </PaneContext.Provider>
                                </VerticalScrollRegion>
                            </Drawer.Body>
                        </SurfaceNesting>
                    </Drawer.Dialog>
                </Drawer.Content>
            </Drawer.Backdrop>
        </Drawer>
    )
}
