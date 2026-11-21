import { ContentZoneLoading } from "../../regionScope.js"
import { isValidElement, type ReactElement, type ReactNode } from "react"
import { Breadcrumbs } from "../../composite/Breadcrumbs/index.js"
import { PageContainerPart, type PageContainerProps } from "../PageContainer/index.js"
import { PaneGrid, type PaneGridProps } from "../PaneGrid/index.js"
import { FillBox } from "./FillBox.js"
import { PageHeader, type PageHeaderBreadcrumbs, type PageHeaderProps } from "../PageHeader/index.js"

/** The page header Page draws: every `PageHeader` prop except the two Page owns, `measure` and `isLoading`. */
export type PageHeaderContent = PageHeaderProps extends infer Props ? Props extends unknown ? Omit<Props, "measure" | "isLoading"> : never : never

/**
 * A bleed page's trail without a band: the breadcrumbs alone, no heading and no other slot. A header that carries a
 * `title` is a band (`PageHeaderContent`), in bleed as in standard.
 */
export type PageTrailContent = { readonly breadcrumbs: PageHeaderBreadcrumbs } & {
    readonly [Slot in Exclude<keyof PageHeaderContent, "breadcrumbs">]?: never
}

/** The id of the page body when page tabs control it: a route draws exactly one Page, so one id is unique. */
const PAGE_PANEL_ID = "grammar-page-panel"

/** The smallest height a filled body keeps on a short window: `sm` 20rem, `md` 28rem (default), `lg` 36rem, `none` no floor. */
export type PageMinHeight = "none" | "sm" | "md" | "lg"

/**
 * How Page sits in its region. `standard`: the body in the page measure and gutter, a region step above the bottom, clipped
 * at the gutter. `bleed`: an app surface (a chat, a split editor) that fills the region edge to edge: no inline gutter, no
 * block padding, no clip, and the body is the viewport height left below the trail or the band (less any Grammar bottom
 * chrome), so a card or a split in it fills the region.
 */
export type PageChrome = "standard" | "bleed" | "panes"

/**
 * The page's frame type, declared once (the layout law). `report`: the pink well, card surfaces in one vertical column, `chrome="standard"`.
 * `workspace`: a grid of panes split by dividers (`chrome="panes"`) or a full-height chat or editor (`chrome="bleed"`). Omitted, it follows
 * `chrome`; given, it must agree with it (`PAGE_LAYOUT_CHROME_MISMATCH`).
 */
export type PageLayout = "report" | "workspace"

type PageCommonProps = {
    /** The frame type: `report` or `workspace`. Grammar owns every breakpoint of both (desktop from 1280, tablet 768 to 1279, phone below 768); an app writes no media query. */
    readonly layout?: PageLayout,
    /** The page body. In `standard` it sits inside the page measure and gutter; in `bleed` it fills the region. */
    readonly children: ReactNode
    /** The page measure, shared by the header's content and (in `standard`) the body. Default `product`. */
    readonly measure?: PageContainerProps["measure"]
    /**
     * `narrow`: below 48rem the header band and the trail are not drawn, so the pane that fills the phone (a record's own head with its back control) is
     * the page's only head. Pass it only while a narrow grid shows a detail pane; wide screens and a list pane keep the band.
     */
    readonly headerCollapse?: "narrow"
    /** Unresolved page subject (STATE-8): passed to the header, which keeps its slots' boxes. The body owns its own loading. */
    readonly isLoading?: boolean
    /**
     * The content zone is loading (0.52.3; owner, 2026-11-21): everything below the page header is skeleton edge to edge, section headings, labels and copy
     * included, with no tone and no empty copy; the shell, the breadcrumbs and the header's static parts stay real. Pass the already-gated flag (next-data
     * `useSkeletonGate`, `skeletonGate`): Page has no timer.
     */
    readonly isContentLoading?: boolean
}

/** A standard page: its header, when given, is the band with its heading. */
export type PageStandardProps = PageCommonProps & {
    readonly chrome?: "standard"
    /**
     * The page header band, as `PageHeader`'s props (data, not an element): Page draws it full width with the body's
     * measure, so the header's content edges are the body's. Leave it out for a page with no header band (a sign-in
     * card, a landing hero); the body then starts one region step below the top.
     */
    readonly header?: PageHeaderContent
}

/** A bleed page: no header, the trail alone (`{ breadcrumbs }`), or a band when the header carries a `title`. */
export type PageBleedProps = PageCommonProps & {
    readonly chrome: "bleed"
    readonly header?: PageHeaderContent | PageTrailContent
    /** Floor height of the body on a short window (default `md`). */
    readonly minHeight?: PageMinHeight
}

/**
 * A tabbed app page: the header band (with or without `tabs`) or the trail, then exactly one PaneGrid attached flush to
 * the band's separator, reaching both content edges and the viewport bottom (less any Grammar bottom chrome): no gap, no
 * block padding, no card, no radius. Page measures the fill box itself.
 */
export type PagePanesProps = PageCommonProps & {
    readonly chrome: "panes"
    readonly header?: PageHeaderContent | PageTrailContent
    /** Floor height of the grid on a short window (default `md`). */
    readonly minHeight?: PageMinHeight
    /** Exactly one PaneGrid. */
    readonly children: ReactElement<PaneGridProps>
}

export type PageProps = PageStandardProps | PageBleedProps | PagePanesProps

/** True when the header is a band: every standard header is, and a bleed header is when it carries the page heading. */
const isBand = (chrome: PageChrome, header: PageHeaderContent | PageTrailContent): header is PageHeaderContent =>
    chrome === "standard" || header.title !== undefined

/**
 * Whether a child is the pane grid (0.48.0). The identity check alone failed across the RSC boundary: a server component that renders `<PaneGrid>` hands Page
 * a client reference (`$$id` ending in `#PaneGrid`) on the server and, on the client, a lazy element until its chunk loads, never the function itself, so
 * `PAGE_PANES_CHILD_NOT_PANE_GRID` fired on a valid page. The grid carries a static marker and a `displayName`; a reference is read by its export name, and a lazy
 * element (unresolved yet) is let through, since what it resolves to renders its own frame.
 */
const PANE_GRID_EXPORT = "PaneGrid"
const isPaneGridElement = (child: ReactNode): boolean => {
    if (!isValidElement(child)) return false
    const type = child.type as unknown
    if (type === PaneGrid) return true
    if (type === null || (typeof type !== "function" && typeof type !== "object")) return false
    // A client reference (the server side of the boundary) is read by its id only: dotting into any other property of the proxy throws on the server.
    const reference = type as { readonly $$typeof?: unknown; readonly $$id?: unknown }
    if (reference.$$typeof === Symbol.for("react.client.reference")) return typeof reference.$$id === "string" && reference.$$id.endsWith(`#${PANE_GRID_EXPORT}`)
    if (reference.$$typeof === Symbol.for("react.lazy")) return true
    const marked = type as { readonly grammarFrame?: unknown; readonly displayName?: unknown }
    return marked.grammarFrame === PANE_GRID_EXPORT || marked.displayName === PANE_GRID_EXPORT
}

/**
 * One route page: the header band across the region, then the body in the page measure and gutter, one region step
 * below it. Page is the single owner of the page inset and the page's vertical rhythm; layout frames (WorkspaceShell,
 * Grid, PaneGrid) only place regions and never wrap a page in a measure of their own. PageHeader, PageContainer and
 * Breadcrumbs are Page's internals: an app reaches them only through `header`, `measure` and `header.breadcrumbs`. Page tabs are the
 * header's `tabs`, never a Tabs at the top of the body (lint `page-tabs-in-header`), and a route page renders nothing
 * beside its Page (lint `route-page-is-one-page`). `chrome="bleed"` is the app surface: the body fills the region edge to
 * edge, under the trail alone or under a band.
 *
 * THE LAYOUT LAW. `layout` (`report` | `workspace`) declares the frame type, which `chrome` carries (`standard` is a report; `panes` and `bleed` are workspaces), so a page has one frame type. A REPORT page is `chrome="standard"`: the pink well,
 * card surfaces stacked in ONE vertical column 24 apart (side by side only for sibling cards of one role and height; lint
 * `layout-two-axis`). A WORKSPACE page is `chrome="panes"` (a grid of panes split by dividers; side panes are white surfaces at full height,
 * never cards; the main pane may hold a pink well that follows the report law) or `chrome="bleed"` (a full-height chat or editor). Ask:
 * is there a persistent selection column or a full-height chat/editor? Then a workspace, else a report.
 */
export const Page = (props: PageProps) => {
    const { chrome = "standard", header, children: content, measure = "product", isLoading = false, isContentLoading = false } = props
    const children = isContentLoading ? <ContentZoneLoading isLoading>{content}</ContentZoneLoading> : content
    if (props.chrome === "panes" && !isPaneGridElement(content)) {
        throw new Error("PAGE_PANES_CHILD_NOT_PANE_GRID")
    }
    const layout: PageLayout = chrome === "standard" ? "report" : "workspace"
    if (props.layout !== undefined && props.layout !== layout) throw new Error("PAGE_LAYOUT_CHROME_MISMATCH")
    const headerBand = header !== undefined && isBand(chrome, header) ? header : undefined
    // Page tabs switch the page's main area, so the body is the one panel each tab controls, named by the tab list; an app that passes its own `panelId` owns its panels.
    const tabs = headerBand?.tabs
    const ownsPanel = tabs !== undefined && tabs.panelId === undefined
    const subTabs = headerBand?.subTabs
    const subTabsOwnPanel = ownsPanel && subTabs !== undefined && subTabs.panelId === undefined
    const band = headerBand === undefined || tabs === undefined ? headerBand : {
        ...headerBand,
        ...(ownsPanel ? { tabs: { ...tabs, panelId: PAGE_PANEL_ID } } : {}),
        ...(subTabsOwnPanel ? { subTabs: { ...subTabs, panelId: PAGE_PANEL_ID } } : {}),
    }
    const panel = ownsPanel ? { id: PAGE_PANEL_ID, role: "tabpanel", "aria-label": tabs.label } : {}
    const trail = header !== undefined && !isBand(chrome, header) ? header.breadcrumbs : undefined
    return (
        <div
            className={"starci-core-page"}
            data-component="Page"
            data-tier="frame"
            data-contract={chrome === "panes" ? "LAYOUT-1 BOUNDARY-1 GAP-0" : chrome === "bleed" ? "LAYOUT-1" : "MARGIN-5 MEASURE-1"}
            data-grammar-page-chrome={chrome}
            data-grammar-page-layout={layout}
            data-grammar-page-header={band === undefined ? "false" : "true"}
            data-grammar-page-trail={trail === undefined ? "false" : "true"}
            {...(props.headerCollapse === undefined ? {} : { "data-grammar-page-header-collapse": props.headerCollapse })}
            {...(isContentLoading ? { "data-grammar-content-loading": "true" } : {})}
        >
            {band === undefined ? null : <PageHeader {...band} measure={chrome === "panes" ? "full" : measure} isLoading={isLoading} />}
            {trail === undefined ? null : (
                <div className="starci-core-page-trail" data-grammar-page-trail-row="true">
                    <Breadcrumbs label={trail.label} items={trail.items} {...(trail.onAction === undefined ? {} : { onAction: trail.onAction })} />
                </div>
            )}
            {props.chrome === "panes" || props.chrome === "bleed" ? (
                <FillBox minHeight={props.minHeight ?? "md"} {...panel}>{children}</FillBox>
            ) : (
                <PageContainerPart className="starci-core-page-body" data-grammar-page-body="true" measure={measure} {...panel}>
                    {children}
                </PageContainerPart>
            )}
        </div>
    )
}
