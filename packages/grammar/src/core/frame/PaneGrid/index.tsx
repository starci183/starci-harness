"use client"

import { Drawer } from "@heroui/react"
import {
    Children,
    cloneElement,
    createContext,
    isValidElement,
    useCallback,
    useContext,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ComponentPropsWithoutRef,
    type CSSProperties,
    type ReactElement,
    type ReactNode,
} from "react"
import { PaneSection } from "../PaneSection/index.js"
import { PaneHeader } from "../../composite/PaneHeader/index.js"
import { VerticalScrollRegionPart } from "../VerticalScrollRegion/index.js"
import { SurfaceNesting } from "../../surfaceContext.js"
import { useOverlayContainer } from "../../overlayScope.js"
import { PaneContext, PaneOpenerContext, usePaneContext, type PaneContextValue, type PaneInset, type PaneOpenerValue } from "../../paneContext.js"
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

/** What a pane holds: a well of capped `cards`, or `full` bleed (a chat, a graph canvas, an editor). */
export type PaneContent = "cards" | "full"

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
    /**
     * What the pane holds (0.36.0, MEASURE-8). `cards`: a pink well of cards; its content is capped at `--grammar-content-max` (80rem) and centred INSIDE the pane,
     * while the pane itself spans its grid track. `full`: a chat, a graph canvas or an editor, full-bleed, never capped. Default: `cards` for a pane on the
     * canvas, `full` for a pane on the surface (a side pane); a pane that holds a chat thread (`PaneSection scroll role="log"`) or a `FlowGraph` is `full`
     * unless this prop says `cards`.
     */
    readonly content?: PaneContent
    /** PaneSection elements, or one PaneGrid. */
    readonly children?: ReactNode
    /**
     * A band fixed at the bottom of the pane (0.37.5): a chat composer, a form's action bar. Give it a `PaneSection as="footer"` (or several PaneSections). The pane body above it
     * is the pane's own scroll region (no visible scrollbar) and only the body scrolls; the footer never leaves the pane's bottom edge. The footer shares the pane's inset.
     */
    readonly footer?: ReactNode
    /**
     * A sticky one-row head for an aside or detail pane (0.37.5): the title, a muted sublabel under it and, when `onClose` is given, a small close icon button at the end. It is the
     * first band of the pane's stack (a `PaneSection align="center"` holding a `PaneHeader`), so the shared head-row mode and the head height token apply; it stays at the top while the body scrolls.
     */
    readonly head?: PaneHeadSlot
}

/** What the `head` slot of a Pane draws. */
export type PaneHeadSlot = {
    readonly title: string
    /** The muted sublabel under the title. */
    readonly description?: string
    /** Draws the close icon button at the end of the head. */
    readonly onClose?: () => void
    /** The close button's accessible name; required with `onClose`. */
    readonly closeLabel?: string
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
        /** `bar` (default): the grid draws the opener above itself. `none`: see the next variant. */
        readonly trigger?: "bar"
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
        /** The app owns `isOpen` and draws the opener itself (an icon in a pane head): the grid draws no trigger bar, at any width. */
        readonly collapse: "drawer"
        readonly trigger: "none"
        readonly collapseLabel: string
        readonly openLabel?: never
        readonly closeLabel: string
        readonly isOpen: boolean
        readonly onOpenChange: (isOpen: boolean) => void
    }
    | {
        /**
         * The grid owns the open state and the opener is a `PaneHeader` `drawerOpener={{ pane: area, ... }}` in the same grid: the page holds
         * no state (a server page can render it). The grid draws no trigger bar; the head shows the icon button below the collapse width.
         */
        readonly collapse: "drawer"
        readonly trigger: "head"
        readonly collapseLabel: string
        readonly openLabel?: never
        readonly closeLabel: string
        readonly isOpen?: never
        readonly onOpenChange?: never
    }
    | {
        readonly collapse?: undefined
        readonly trigger?: never
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
    const { area, surface = false, inset = "content", label, scroll = false, content: contentKind, children, footer, head } = props
    const models = useContext(PaneModelsContext)
    const pane = usePaneRegistry(area, inset, true)
    const shown = "flex"
    const vars: Record<string, string> = {}
    let hasEdge = false
    if (models !== undefined) {
        for (const breakpoint of paneBreakpoints) {
            const edges: PaneEdges | undefined = models[breakpoint].edges[area]
            vars[`--starci-core-pane-d-${breakpoint}`] = edges === undefined ? "none" : shown
            vars[`--starci-core-pane-i-${breakpoint}`] = edges?.inline === true ? "var(--grammar-hairline)" : "0px"
            vars[`--starci-core-pane-b-${breakpoint}`] = edges?.block === true ? "var(--grammar-hairline)" : "0px"
            hasEdge = hasEdge || edges?.inline === true || edges?.block === true
            vars[`--starci-core-pane-be-${breakpoint}`] = edges?.blockEnd === "divider"
                ? "var(--grammar-pane-inset-block-end-divider)"
                : "var(--grammar-pane-inset-block-end-outer)"
        }
    }
    const style: CustomProperties = { gridArea: area, ...vars }
    const headBand = head === undefined ? null : (
        <PaneSection align="center">
            <PaneHeader
                title={head.title}
                {...(head.description === undefined ? {} : { description: head.description })}
                {...(head.onClose === undefined ? {} : { close: { label: head.closeLabel ?? "", onPress: head.onClose } })}
            />
        </PaneSection>
    )
    const stack = <div className="starci-core-pane-stack" data-grammar-pane-stack="true">{headBand}{children}</div>
    const body = scroll
        ? (
            <VerticalScrollRegionPart
                aria-label={label}
                className="starci-core-pane-scroll"
                data-contract="OVERFLOW-4 OVERFLOW-5"
                isScrollable
            >
                {stack}
            </VerticalScrollRegionPart>
        )
        : stack
    const footed = footer === undefined ? body : (
        <>
            {scroll ? body : <div className="starci-core-pane-body" data-grammar-pane-body="true">{body}</div>}
            <div className="starci-core-pane-footer" data-grammar-pane-footer-slot="true">
                <div className="starci-core-pane-stack">{footer}</div>
            </div>
        </>
    )
    const surfaced = surface ? <SurfaceNesting host="pane">{footed}</SurfaceNesting> : footed
    const content = <PaneContext.Provider value={pane}>{surfaced}</PaneContext.Provider>
    const shared = {
        className: "starci-core-pane",
        "data-component": "Pane",
        "data-tier": "frame",
        "data-grammar-pane-area": area,
        "data-grammar-pane-surface": surface ? "true" : undefined,
        "data-grammar-pane-scroll": scroll ? "true" : undefined,
        "data-grammar-pane-head": head === undefined ? undefined : "true",
        "data-grammar-pane-footer": footer === undefined ? undefined : "true",
        "data-grammar-pane-inset": inset,
        "data-grammar-pane-content": contentKind ?? (surface ? "full" : "cards"),
        "data-grammar-pane-content-explicit": contentKind === undefined ? undefined : "true",
        "data-contract": [hasEdge ? "BOUNDARY-1" : undefined, inset === "content" ? "PADDING-4 PADDING-3" : "PADDING-0"].filter((part) => part !== undefined).join(" "),
        style,
    }
    return label === undefined || scroll
        ? <div {...shared}>{content}</div>
        : <section {...shared} aria-label={label}>{content}</section>
}

export type PaneGridProps = Omit<ComponentPropsWithoutRef<"section">, "aria-label" | "children" | "className"> & {
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
    /** `Pane` elements as direct children (`null`, `false` and arrays of Panes are legal; anything else throws, in production too). A `Pane` built in a server component is recognised. */
    readonly children?: ReactNode
}

const LAZY_TYPE = Symbol.for("react.lazy")

/**
 * Whether an element type is `Pane`. A `Pane` built in a React Server Component reaches the client as a lazy client reference
 * (`$$typeof: react.lazy`), not as the `Pane` function: its lazy is read here (a pending one suspends, as React reads any lazy) and
 * compared with `Pane`, so a server-built pane is a pane.
 */
const isPaneType = (type: unknown): boolean => {
    if (type === Pane) return true
    if (typeof type !== "object" || type === null || (type as { readonly $$typeof?: symbol }).$$typeof !== LAZY_TYPE) return false
    const lazy = type as { readonly _init?: (payload: unknown) => unknown; readonly _payload?: unknown }
    if (typeof lazy._init !== "function") return false
    const resolved = lazy._init(lazy._payload)
    return resolved === Pane || (typeof resolved === "object" && resolved !== null && (resolved as { readonly default?: unknown }).default === Pane)
}

const isPane = (child: ReactNode): child is ReactElement<PaneProps> =>
    isValidElement(child) && isPaneType(child.type)

/** A readable name for a child that is not a Pane, for `PANE_GRID_CHILD_NOT_PANE`. */
const childTypeName = (child: ReactNode): string => {
    if (!isValidElement(child)) return typeof child
    const { type } = child
    if (typeof type === "string") return type
    if (typeof type === "function") return type.name === "" ? "component" : type.name
    if (typeof type === "symbol") return "Fragment"
    // A lazy or a client reference that is not a Pane: the shape of a child built in a server component.
    return "a client reference that is not a Pane (a Pane built in a server component: mark the module that builds the PaneGrid children \"use client\")"
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

/** Whether a pane's stack opens with a head: a first band that is a `header`, or one whose first element is a `PaneHeader`. */
const paneHasHead = (pane: Element): boolean => {
    const first = pane.querySelector(".starci-core-pane-stack")?.firstElementChild
    if (first === null || first === undefined) return false
    return first.tagName === "HEADER" || first.firstElementChild?.classList.contains("starci-core-pane-header") === true
}

/**
 * The shared head row (0.37.3) is decided per outermost grid: `row` when EVERY leaf pane (a pane that holds no PaneGrid) has a head, `lone` when only some do,
 * `none` when none does. CSS cannot ask "does every pane have a head" (no nested `:has`), so the grid writes the answer on its tracks and keeps it current.
 */
const useHeadRowMode = () => {
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => {
        const tracks = ref.current
        if (tracks === null || tracks.closest(".starci-core-pane") !== null) return undefined
        const decide = () => {
            const leaves = Array.from(tracks.querySelectorAll(".starci-core-pane")).filter((pane) => pane.querySelector(".starci-core-pane-grid") === null)
            const heads = leaves.filter(paneHasHead).length
            const mode = heads === 0 ? "none" : heads === leaves.length ? "row" : "lone"
            if (tracks.getAttribute("data-grammar-head-row") !== mode) tracks.setAttribute("data-grammar-head-row", mode)
        }
        decide()
        const observer = new MutationObserver(decide)
        observer.observe(tracks, { childList: true, subtree: true })
        return () => observer.disconnect()
    }, [])
    return ref
}

/** The grid's own width under which its panes stack (the compact boundary, 48rem of 16px). */
const STACKED_UNDER_PX = 768

/**
 * PANE-GRID-STACKED (0.37.14): CSS container queries pick the arrangement, but they cannot restyle the grid's own box, so the grid writes `data-grammar-pane-stacked="grow"`
 * on itself while it is narrower than the stacking breakpoint and holds no chat thread or footer; the stylesheet then lets the grid, its tracks and its panes grow with their content (the page scrolls once).
 */
const useStackedMode = () => {
    const ref = useRef<HTMLElement>(null)
    useLayoutEffect(() => {
        const grid = ref.current
        if (grid === null) return undefined
        const decide = () => {
            // A grid with a chat thread (a scrolling band) or a pane footer keeps its bounded height: only those scroll inside their pane. A `Pane scroll` is no such band (0.37.21): stacked, it grows too and the page scrolls once.
            const hasBounded = grid.querySelector('.starci-core-pane[data-grammar-pane-footer="true"], .starci-core-pane-section[data-grammar-pane-section-scroll="true"]') !== null
            const isGrowing = grid.getBoundingClientRect().width < STACKED_UNDER_PX && !hasBounded
            if (isGrowing) grid.setAttribute("data-grammar-pane-stacked", "grow")
            else grid.removeAttribute("data-grammar-pane-stacked")
        }
        decide()
        const mutations = new MutationObserver(decide)
        mutations.observe(grid, { childList: true, subtree: true })
        if (typeof ResizeObserver === "undefined") return () => mutations.disconnect()
        const observer = new ResizeObserver(decide)
        observer.observe(grid)
        return () => { observer.disconnect(); mutations.disconnect() }
    }, [])
    return ref
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
    const { label, areas, columns, rows, children, ...sectionProps } = props
    const flat = Children.toArray(children)
    const parent = usePaneContext()
    useEffect(() => parent?.register(), [parent])
    // A child that is not a Pane is refused in production too: dropping it would draw an empty grid with no sign of why.
    const stray = flat.find((child) => !isPane(child))
    if (stray !== undefined) throw new Error(`PANE_GRID_CHILD_NOT_PANE: ${childTypeName(stray)}`)
    const panes = flat.filter(isPane)
    const tracksRef = useHeadRowMode()
    const gridRef = useStackedMode()
    const drawers = panes.filter((pane) => pane.props.collapse === "drawer")
    const hasBar = (pane: ReactElement<PaneProps>) => pane.props.trigger === undefined || pane.props.trigger === "bar"
    const [openHeads, setOpenHeads] = useState<ReadonlySet<string>>(() => new Set())
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
        drawers.some((pane) => hasBar(pane) && models[breakpoint].edges[pane.props.area] === undefined))

    const headAreas = drawers.filter((pane) => pane.props.trigger === "head").map((pane) => pane.props.area).join(" ")
    const opener = useMemo<PaneOpenerValue>(() => ({
        has: (area) => headAreas.split(" ").includes(area),
        open: (area) => setOpenHeads((current) => new Set(current).add(area)),
        displays: (area) => ({
            base: models.base.edges[area] === undefined ? "inline-flex" : "none",
            medium: models.medium.edges[area] === undefined ? "inline-flex" : "none",
            wide: models.wide.edges[area] === undefined ? "inline-flex" : "none",
        }),
    }), [headAreas, models])
    // A head-opened drawer pane gets the grid's own open state; PaneDrawer then treats it like a pane the app controls.
    const drawerFor = (pane: ReactElement<PaneProps>): ReactElement<PaneProps> => pane.props.trigger === "head"
        ? cloneElement(pane, {
            trigger: "none",
            isOpen: openHeads.has(pane.props.area),
            onOpenChange: (isOpen: boolean) => setOpenHeads((current) => {
                const next = new Set(current)
                if (isOpen) next.add(pane.props.area)
                else next.delete(pane.props.area)
                return next
            }),
        } as Partial<PaneProps>)
        : pane

    return (
        <section
            {...sectionProps}
            ref={gridRef}
            aria-label={label}
            className={"starci-core-pane-grid"}
            data-component="PaneGrid"
            data-tier="frame"
            data-grammar-pane-grid="true"
        >
            {drawers.length === 0 ? null : (
                <div className="starci-core-pane-grid-triggers" data-grammar-triggers={drawers.some(hasBar) ? "bar" : "none"} data-contract="BOUNDARY-1 PADDING-4 PADDING-2" style={style}>
                    {drawers.map((pane) => (
                        <PaneDrawer
                            key={pane.props.area}
                            pane={drawerFor(pane)}
                            placement={isStartColumn(models, pane.props.area) ? "left" : "right"}
                            models={models}
                        />
                    ))}
                </div>
            )}
            <PaneModelsContext.Provider value={models}>
                <PaneOpenerContext.Provider value={opener}>
                    <div ref={tracksRef} className="starci-core-pane-grid-tracks" data-contract="GAP-0" style={style}>
                        {panes}
                    </div>
                </PaneOpenerContext.Provider>
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
    // The drawer portals into the nearest Grammar root, never the body: outside it no family selector, token or spacing rule applies.
    const { anchor, container } = useOverlayContainer("Drawer")
    if (props.collapse !== "drawer") return null
    const drawerVars: CustomProperties = { "--starci-core-pane-be": "var(--grammar-pane-inset-block-end-outer)" }
    const drawerHeaderStyle: CSSProperties = { paddingInline: "var(--grammar-pane-inset-inline)" }
    const triggerStyle: CustomProperties = {}
    const vars: Record<string, string> = {}
    for (const breakpoint of paneBreakpoints) {
        vars[`--starci-core-pane-trigger-${breakpoint}`] = models[breakpoint].edges[props.area] === undefined ? "inline-flex" : "none"
    }
    Object.assign(triggerStyle, vars)
    return (
        <Drawer {...(props.isOpen === undefined ? {} : { isOpen: props.isOpen })} {...(props.onOpenChange === undefined ? {} : { onOpenChange: props.onOpenChange })}>
            {props.trigger === "none" || props.trigger === "head" ? null : (
                <Drawer.Trigger className="starci-core-pane-trigger" style={triggerStyle} data-contract="PADDING-3 SURFACE-2 FONT-2 TONE-1">
                    {props.openLabel}
                </Drawer.Trigger>
            )}
            {anchor}
            {container === null ? null : <Drawer.Backdrop UNSTABLE_portalContainer={container}>
                <Drawer.Content className="starci-core-pane-drawer-content" placement={placement}>
                    <Drawer.Dialog className="starci-core-pane-drawer-dialog" data-grammar-nesting="surface">
                        <SurfaceNesting host="overlay">
                            <Drawer.Header className="starci-core-pane-drawer-header" style={drawerHeaderStyle}>
                                <Drawer.Heading>{props.collapseLabel}</Drawer.Heading>
                            </Drawer.Header>
                            <Drawer.CloseTrigger
                                aria-label={props.closeLabel}
                                className="starci-core-pane-drawer-close"
                                data-contract="SURFACE-2 TONE-1"
                            />
                            <Drawer.Body className="starci-core-pane-drawer-body" data-contract="OVERFLOW-2 PADDING-0">
                                <VerticalScrollRegionPart
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
                                </VerticalScrollRegionPart>
                            </Drawer.Body>
                        </SurfaceNesting>
                    </Drawer.Dialog>
                </Drawer.Content>
            </Drawer.Backdrop>}
        </Drawer>
    )
}
