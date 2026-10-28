import { cn } from "@heroui/react"
import type { ReactNode } from "react"
import { Tabs, type TabsProps } from "../../branch/Tabs/index.js"
import { Breadcrumbs, type BreadcrumbItem } from "../../composite/Breadcrumbs/index.js"
import { Divider } from "../../primitive/Divider/index.js"
import { PageContainer, type PageContainerProps } from "../../primitive/PageContainer/index.js"
import { SkeletonPlaceholder } from "../../primitive/Skeleton/index.js"

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
export type PageHeaderTabs = Omit<TabsProps, "variant" | "inset">

export type PageHeaderProps = {
    /** The page heading, the document's one `h1` (FONT-4). */
    readonly title: ReactNode
    /** `id` of the `h1`, for a region `aria-labelledby` that names the page by its heading. */
    readonly titleId?: string
    readonly breadcrumbs?: PageHeaderBreadcrumbs
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
    readonly tabs?: PageHeaderTabs
    /** The measure of the page content below, so the header's content edges align with it. Default `product`. */
    readonly measure?: PageContainerProps["measure"]
    /**
     * Draw the header as inert geometry while the subject is unresolved (STATE-8). Skeleton parity: `title`,
     * `description`, `meta`, `status`, `mark` and `actions` keep their slots and are laid out unseen as measured
     * placeholders under a shimmer, so the loading band has the ready band's box. The breadcrumbs and the tabs stay real
     * (a crumb whose label is unknown takes its own `isSkeleton`); the root is `aria-busy`.
     */
    readonly isSkeleton?: boolean
    /** Layout only: the band's placement in the app's layout. */
    readonly className?: string
}

/** One slot, real or as its measured placeholder. */
const slot = (content: ReactNode, isSkeleton: boolean, shape: "text" | "block" = "text") =>
    isSkeleton ? <SkeletonPlaceholder shape={shape}>{content}</SkeletonPlaceholder> : content

/**
 * The page header band: the trail, the page heading with its mark, status and summary, the page's commands, and the
 * page tabs, on a surface band across the primary region with a full-width separator at its bottom edge.
 *
 * The band's content sits in a `PageContainer` of the page's measure, so its edges are the content's edges by
 * construction. The separator is the header's own `Divider`, drawn whether or not tabs are present; page tabs sit on
 * it and the selected tab's underline lies over it. Place the header first in the primary region, outside the page's
 * `PageContainer`; it is a plain `div`, never `<header>`, because the page banner belongs to the app bar.
 */
export const PageHeader = ({
    title,
    titleId,
    breadcrumbs,
    description,
    meta,
    status,
    mark,
    actions,
    tabs,
    measure = "product",
    isSkeleton = false,
    className,
}: PageHeaderProps) => (
    <div
        className={cn("starci-core-page-header", className)}
        data-component="PageHeader"
        data-tier="composition"
        data-contract={isSkeleton ? "MARGIN-5 STATE-8" : "MARGIN-5"}
        data-grammar-page-header="true"
        data-grammar-page-header-tabs={tabs === undefined ? "false" : "true"}
        {...(isSkeleton ? { "data-grammar-skeleton": "true", "data-loading": "true", "aria-busy": true } : {})}
    >
        <PageContainer className="starci-core-page-header-body" data-contract="GAP-3 PADDING-5" measure={measure}>
            {breadcrumbs === undefined ? null : (
                <Breadcrumbs
                    label={breadcrumbs.label}
                    items={breadcrumbs.items}
                    {...(breadcrumbs.onAction === undefined ? {} : { onAction: breadcrumbs.onAction })}
                />
            )}
            <div className="starci-core-page-header-row" data-contract="GAP-5">
                <div className="starci-core-page-header-lead" data-contract="GAP-3">
                    {mark === undefined ? null : <div className="starci-core-page-header-mark" aria-hidden={isSkeleton || undefined}>{slot(mark, isSkeleton, "block")}</div>}
                    <div className="starci-core-page-header-copy" data-contract="GAP-1">
                        <div className="starci-core-page-header-title-line" data-contract="GAP-2">
                            <h1
                                className="starci-core-section-title starci-core-page-header-title"
                                data-contract="FONT-4 MARGIN-0"
                                {...(titleId === undefined ? {} : { id: titleId })}
                                {...(isSkeleton ? { "aria-hidden": true } : {})}
                            >
                                {slot(title, isSkeleton)}
                            </h1>
                            {status === undefined ? null : <div className="starci-core-page-header-status" data-contract="GAP-2" aria-hidden={isSkeleton || undefined}>{slot(status, isSkeleton)}</div>}
                        </div>
                        {meta === undefined ? null : <div className="starci-core-page-header-meta" data-contract="FONT-1 TONE-2" aria-hidden={isSkeleton || undefined}>{slot(meta, isSkeleton)}</div>}
                        {description === undefined ? null : <div className="starci-core-page-header-description" data-contract="FONT-2 TONE-2" aria-hidden={isSkeleton || undefined}>{slot(description, isSkeleton)}</div>}
                    </div>
                </div>
                {actions === undefined ? null : <div className="starci-core-page-header-actions" data-contract="GAP-2" aria-hidden={isSkeleton || undefined}>{slot(actions, isSkeleton, "block")}</div>}
            </div>
            {tabs === undefined ? null : (
                <div className="starci-core-page-header-tabs">
                    <Tabs {...tabs} variant="primary" inset="none" />
                </div>
            )}
        </PageContainer>
        <div className="starci-core-page-header-separator" data-grammar-page-header-separator="true">
            <Divider semantics="presentation" />
        </div>
    </div>
)
