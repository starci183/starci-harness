import type { ReactNode } from "react"
import { Tabs, type SecondaryTabsProps } from "../../branch/Tabs/index.js"
import { Breadcrumbs, type BreadcrumbItem } from "../../composite/Breadcrumbs/index.js"
import { TabsLineHost } from "../../zoneContext.js"
import { PageContainerPart, type PageContainerProps } from "../PageContainer/index.js"
import { SkeletonPlaceholder } from "../../leaf/Skeleton/index.js"

/** The trail above the page heading: the `Breadcrumbs` the header draws in its first row. */
export type PageHeaderBreadcrumbs = {
    /** Names the trail landmark, e.g. "Breadcrumb". */
    readonly label: string
    readonly items: ReadonlyArray<BreadcrumbItem>
    /** Same-document navigation for router-owned trails. */
    readonly onAction?: (id: string) => void
}

/**
 * The page's own tabs, drawn on the header's bottom separator: the page tabs of `tabs.choose.level:page`. The header
 * owns their look (the underline) and their inset, so neither is passed.
 */
export type PageHeaderTabs = Omit<SecondaryTabsProps, "appearance" | "inset">

/** The header's tab rows: sub tabs only stand under page tabs, so `subTabs` without `tabs` is a type error. */
type PageHeaderTabRows =
    | { readonly tabs?: undefined; readonly subTabs?: never }
    | {
        readonly tabs: PageHeaderTabs
        /**
         * The second tab row: region tabs of the page's current view, inside the white band under the page tabs, on their own full-width
         * separator, the first label on the content edge like the page tabs'. Underline tabs, the second and last underline layer; the
         * band's bottom border is the line under them. They take `panelId` and `label` like the page tabs (the page body is their panel unless `panelId` names another).
         */
        readonly subTabs?: PageHeaderTabs
    }

export type PageHeaderProps = PageHeaderTabRows & {
    /** The page heading, the document's one `h1` (FONT-4). */
    readonly title: ReactNode
    /** `id` of the `h1`, for a region `aria-labelledby` that names the page by its heading. */
    readonly titleId?: string
    /** `title` draws the page title at the middle 24px step (a lobby or first-run head); the default is the standard page title. */
    readonly titleScale?: "standard" | "title"
    /**
     * The trail above the heading, or `"root"`: the page is the root of its console (a module's home, the dashboard), so it has no
     * trail by design. An app console page states one of the two (lint `page-breadcrumbs`); `"root"` draws nothing.
     */
    readonly breadcrumbs?: PageHeaderBreadcrumbs | "root"
    /** The one supporting line under the heading (FONT-2, muted). */
    readonly description?: ReactNode
    /** A short summary line of facts about the page's subject (FONT-1, muted), e.g. "SePay · Vietcombank · ****6789". */
    readonly meta?: ReactNode
    /** Status chips beside the heading (`Badge`, `StatusDot`): settled facts about the page's subject. */
    readonly status?: ReactNode
    /** The subject's identity mark left of the heading: an `Avatar`, an `IconTile` or a provider mark. */
    readonly mark?: ReactNode
    /** The page's commands, at the end of the heading row; at phone width they wrap under the heading. */
    readonly actions?: ReactNode
    /** The measure of the page content below, so the header's content edges align with it. Default `product`. */
    readonly measure?: PageContainerProps["measure"]
    /**
     * Draw the header as inert geometry while the subject is unresolved (STATE-8). Skeleton parity: `title`,
     * `description`, `meta`, `status`, `mark` and `actions` keep their slots and are laid out unseen as measured
     * placeholders under a shimmer, so the loading band has the ready band's box. The breadcrumbs and the tabs stay real
     * (a crumb whose label is unknown takes its own `isLoading`); the root is `aria-busy`.
     */
    readonly isLoading?: boolean
}

/** One slot, real or as its measured placeholder. */
const slot = (content: ReactNode, isLoading: boolean, shape: "text" | "block" = "text") =>
    isLoading ? <SkeletonPlaceholder shape={shape}>{content}</SkeletonPlaceholder> : content

/**
 * The page header band: the trail, the page heading with its mark, status and summary, the page's commands, and the
 * page tabs, on a surface band across the primary region with a full-width border at its bottom edge.
 *
 * The band's content sits in a `PageContainer` of the page's measure, so its edges are the content's edges by
 * construction. The band's bottom border is the one line under the page tabs (the strip is hosted: it draws none of its own); the
 * selected tab's underline lies over it, on the same bottom edge. Place the header first in the primary region, outside the page's
 * `PageContainer`; it is a plain `div`, never `<header>`, because the page banner belongs to the app bar.
 */
export const PageHeader = ({
    title,
    titleId,
    titleScale = "standard",
    breadcrumbs,
    description,
    meta,
    status,
    mark,
    actions,
    tabs,
    subTabs,
    measure = "product",
    isLoading = false,
}: PageHeaderProps) => (
    <div
        className="starci-core-page-header"
        data-component="PageHeader"
        data-tier="frame"
        data-contract={isLoading ? "MARGIN-5 STATE-8" : "MARGIN-5"}
        data-grammar-page-header="true"
        data-grammar-page-header-tabs={tabs === undefined ? "false" : "true"}
        {...(subTabs === undefined ? {} : { "data-grammar-page-header-subtabs": "true" })}
        {...(breadcrumbs === "root" ? { "data-grammar-page-root": "true" } : {})}
        {...(isLoading ? { "data-grammar-skeleton": "true", "data-loading": "true", "aria-busy": true } : {})}
    >
        <PageContainerPart className="starci-core-page-header-body" data-contract="GAP-3 PADDING-5" measure={measure}>
            {breadcrumbs === undefined || breadcrumbs === "root" ? null : (
                <Breadcrumbs
                    label={breadcrumbs.label}
                    items={breadcrumbs.items}
                    {...(breadcrumbs.onAction === undefined ? {} : { onAction: breadcrumbs.onAction })}
                />
            )}
            <div className="starci-core-page-header-row" data-contract="GAP-5">
                <div className="starci-core-page-header-lead" data-contract="GAP-3">
                    {mark === undefined ? null : <div className="starci-core-page-header-mark" aria-hidden={isLoading || undefined}>{slot(mark, isLoading, "block")}</div>}
                    <div className="starci-core-page-header-copy" data-contract="GAP-1">
                        <div className="starci-core-page-header-title-line" data-contract="GAP-2">
                            <h1
                                className="starci-core-section-title starci-core-page-header-title"
                                data-contract="FONT-4 MARGIN-0"
                                {...(titleScale === "title" ? { "data-grammar-title-scale": "title" } : {})}
                                {...(titleId === undefined ? {} : { id: titleId })}
                                {...(isLoading ? { "aria-hidden": true } : {})}
                            >
                                {slot(title, isLoading)}
                            </h1>
                            {status === undefined ? null : <div className="starci-core-page-header-status" data-contract="GAP-2" aria-hidden={isLoading || undefined}>{slot(status, isLoading)}</div>}
                        </div>
                        {meta === undefined ? null : <div className="starci-core-page-header-meta" data-contract="FONT-1 TONE-2" aria-hidden={isLoading || undefined}>{slot(meta, isLoading)}</div>}
                        {description === undefined ? null : <div className="starci-core-page-header-description" data-contract="FONT-2 TONE-2" aria-hidden={isLoading || undefined}>{slot(description, isLoading)}</div>}
                    </div>
                </div>
                {actions === undefined ? null : <div className="starci-core-page-header-actions" data-contract="GAP-2" aria-hidden={isLoading || undefined}>{slot(actions, isLoading, "block")}</div>}
            </div>
            {tabs === undefined || subTabs !== undefined ? null : (
                <div className="starci-core-page-header-tabs">
                    <TabsLineHost><Tabs {...tabs} inset="none" /></TabsLineHost>
                </div>
            )}
        </PageContainerPart>
        {tabs === undefined || subTabs === undefined ? null : (
            <>
                <div className="starci-core-page-header-tabrow" data-grammar-page-header-tabrow="page">
                    <PageContainerPart data-contract="PADDING-5" measure={measure}>
                        <div className="starci-core-page-header-tabs">
                            <TabsLineHost><Tabs {...tabs} inset="none" /></TabsLineHost>
                        </div>
                    </PageContainerPart>
                </div>
                <PageContainerPart data-contract="PADDING-5" measure={measure}>
                    <div className="starci-core-page-header-tabs" data-grammar-page-header-tabrow="sub">
                        <TabsLineHost><Tabs {...subTabs} inset="none" /></TabsLineHost>
                    </div>
                </PageContainerPart>
            </>
        )}
    </div>
)
