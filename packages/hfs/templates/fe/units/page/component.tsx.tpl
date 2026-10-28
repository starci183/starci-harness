import { {{grammarImports}} } from "@starci/grammar/common"
{{blockImports}}
/** The copy of {{Name}} and whether its subject is still unresolved, supplied by the page owner. */
export interface {{Name}}BaseProps {
    readonly props: {
        readonly title: string
        readonly breadcrumbLabel: string
        readonly homeLabel: string
        readonly homeHref: string
{{emptyMember}}        /** True for the route's loading view: the same page, its header resting in its own boxes (STATE-8). */
        readonly isSkeleton: boolean
    }
}

/**
 * Draws {{Name}} as one Grammar Page (R325): the header band carries the trail and the heading, and page commands go to
 * `header.actions`, page views to `header.tabs` (R324); the body composes the page's blocks, each owning its own data and loading.
 */
export const {{Name}}Base = (props: {{Name}}BaseProps) => (
    <Page
        header={{
            title: props.props.title,
            breadcrumbs: {
                label: props.props.breadcrumbLabel,
                items: [
                    { id: "home", label: props.props.homeLabel, href: props.props.homeHref },
                    { id: "{{routeId}}", label: props.props.title },
                ],
            },
        }}
        isSkeleton={props.props.isSkeleton}
    >
{{body}}
    </Page>
)
