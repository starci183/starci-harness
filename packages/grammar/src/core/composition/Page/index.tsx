import { cn } from "@heroui/react"
import type { ReactNode } from "react"
import { PageContainer, type PageContainerProps } from "../../primitive/PageContainer/index.js"
import { PageHeader, type PageHeaderProps } from "../PageHeader/index.js"

/** The page header Page draws: every `PageHeader` prop except the two Page owns, `measure` and `isSkeleton`. */
export type PageHeaderContent = Omit<PageHeaderProps, "measure" | "isSkeleton" | "className">

export type PageProps = {
    /**
     * The page header band, as `PageHeader`'s props (data, not an element): Page draws it full width with the body's
     * measure, so the header's content edges are the body's. Leave it out for a page with no header band (a sign-in
     * card, a landing hero); the body then starts one region step below the top.
     */
    readonly header?: PageHeaderContent
    /** The page body. It always sits inside the page measure and gutter; nothing in it reaches past the gutter. */
    readonly children: ReactNode
    /** The page measure, shared by the header's content and the body. Default `product`. */
    readonly measure?: PageContainerProps["measure"]
    /** Unresolved page subject (STATE-8): passed to the header, which keeps its slots' boxes. The body owns its own loading. */
    readonly isSkeleton?: boolean
    /** Layout only: the page's placement in the app's layout region. */
    readonly className?: string
}

/**
 * One route page: the header band across the region, then the body in the page measure and gutter, one region step
 * below it. Page is the single owner of the page inset and the page's vertical rhythm; layout frames (WorkspaceShell,
 * PrimaryRailLayout, ChatWorkspace) only place regions and never wrap a page in a PageContainer. Page tabs are the
 * header's `tabs`, never a Tabs at the top of the body (lint `page-tabs-in-header`), and a route page renders nothing
 * beside its Page (lint `route-page-is-one-page`).
 */
export const Page = ({ header, children, measure = "product", isSkeleton = false, className }: PageProps) => (
    <div
        className={cn("starci-core-page", className)}
        data-component="Page"
        data-tier="composition"
        data-contract="MARGIN-5 MEASURE-1"
        data-grammar-page-header={header === undefined ? "false" : "true"}
    >
        {header === undefined ? null : <PageHeader {...header} measure={measure} isSkeleton={isSkeleton} />}
        <PageContainer className="starci-core-page-body" data-grammar-page-body="true" measure={measure}>
            {children}
        </PageContainer>
    </div>
)
