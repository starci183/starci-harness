import { isValidElement, type ReactElement, type ReactNode } from "react"
import { Breadcrumbs } from "../../composite/Breadcrumbs/index.js"
import { PageContainerPart, type PageContainerProps } from "../PageContainer/index.js"
import { PaneGrid, type PaneGridProps } from "../PaneGrid/index.js"
import { FillBox } from "./FillBox.js"
import { PageHeader, type PageHeaderBreadcrumbs, type PageHeaderProps } from "../PageHeader/index.js"

/** The page header Page draws: every `PageHeader` prop except the two Page owns, `measure` and `isLoading`. */
export type PageHeaderContent = Omit<PageHeaderProps, "measure" | "isLoading">

/**
 * A bleed page's trail without a band: the breadcrumbs alone, no heading and no other slot. A header that carries a
 * `title` is a band (`PageHeaderContent`), in bleed as in standard.
 */
export type PageTrailContent = { readonly breadcrumbs: PageHeaderBreadcrumbs } & {
    readonly [Slot in Exclude<keyof PageHeaderContent, "breadcrumbs">]?: never
}

/** The smallest height a filled body keeps on a short window: `sm` 20rem, `md` 28rem (default), `lg` 36rem, `none` no floor. */
export type PageMinHeight = "none" | "sm" | "md" | "lg"

/**
 * How Page sits in its region. `standard`: the body in the page measure and gutter, a region step above the bottom, clipped
 * at the gutter. `bleed`: an app surface (a chat, a split editor) that fills the region edge to edge: no inline gutter, no
 * block padding, no clip, and the body is the viewport height left below the trail or the band (less any Grammar bottom
 * chrome), so a card or a split in it fills the region.
 */
export type PageChrome = "standard" | "bleed" | "panes"

type PageCommonProps = {
    /** The page body. In `standard` it sits inside the page measure and gutter; in `bleed` it fills the region. */
    readonly children: ReactNode
    /** The page measure, shared by the header's content and (in `standard`) the body. Default `product`. */
    readonly measure?: PageContainerProps["measure"]
    /** Unresolved page subject (STATE-8): passed to the header, which keeps its slots' boxes. The body owns its own loading. */
    readonly isLoading?: boolean
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
 * One route page: the header band across the region, then the body in the page measure and gutter, one region step
 * below it. Page is the single owner of the page inset and the page's vertical rhythm; layout frames (WorkspaceShell,
 * Grid, PaneGrid) only place regions and never wrap a page in a measure of their own. PageHeader, PageContainer and
 * Breadcrumbs are Page's internals: an app reaches them only through `header`, `measure` and `header.breadcrumbs`. Page tabs are the
 * header's `tabs`, never a Tabs at the top of the body (lint `page-tabs-in-header`), and a route page renders nothing
 * beside its Page (lint `route-page-is-one-page`). `chrome="bleed"` is the app surface: the body fills the region edge to
 * edge, under the trail alone or under a band.
 */
export const Page = (props: PageProps) => {
    const { chrome = "standard", header, children, measure = "product", isLoading = false } = props
    if (props.chrome === "panes" && !(isValidElement(children) && children.type === PaneGrid)) {
        throw new Error("PAGE_PANES_CHILD_NOT_PANE_GRID")
    }
    const band = header !== undefined && isBand(chrome, header) ? header : undefined
    const trail = header !== undefined && !isBand(chrome, header) ? header.breadcrumbs : undefined
    return (
        <div
            className={"starci-core-page"}
            data-component="Page"
            data-tier="frame"
            data-contract={chrome === "panes" ? "LAYOUT-1 BOUNDARY-1 GAP-0" : chrome === "bleed" ? "LAYOUT-1" : "MARGIN-5 MEASURE-1"}
            data-grammar-page-chrome={chrome}
            data-grammar-page-header={band === undefined ? "false" : "true"}
            data-grammar-page-trail={trail === undefined ? "false" : "true"}
        >
            {band === undefined ? null : <PageHeader {...band} measure={chrome === "panes" ? "full" : measure} isLoading={isLoading} />}
            {trail === undefined ? null : (
                <div className="starci-core-page-trail" data-grammar-page-trail-row="true">
                    <Breadcrumbs label={trail.label} items={trail.items} {...(trail.onAction === undefined ? {} : { onAction: trail.onAction })} />
                </div>
            )}
            {props.chrome === "panes" || props.chrome === "bleed" ? (
                <FillBox minHeight={props.minHeight ?? "md"}>{children}</FillBox>
            ) : (
                <PageContainerPart className="starci-core-page-body" data-grammar-page-body="true" measure={measure}>
                    {children}
                </PageContainerPart>
            )}
        </div>
    )
}
