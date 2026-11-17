import { EmptyNotice, StaticsProvider } from "@starci/grammar/common"

/** The words of a missing page and the way home, with the statics folder its illustration is served from. */
type NotFoundNoticeProps = {
    readonly title: string
    readonly description: string
    readonly homeLabel: string
    /** The app's front door. */
    readonly homeHref: string
    /** Where the statics are served from (statics/ at the repository root, mirrored to object storage). */
    readonly staticsBaseUrl?: string
}

/** A missing page (404): the one page-level empty state, an illustration, the words and one way back to the front door. */
export const NotFoundNotice = (props: NotFoundNoticeProps) => (
    <StaticsProvider baseUrl={props.staticsBaseUrl ?? "/statics"}>
        <EmptyNotice
            scope="page"
            message={props.title}
            description={props.description}
            media={{ illustration: { staticsKey: "illustrations/errors/not-found.webp" } }}
            actionLabel={props.homeLabel}
            actionHref={props.homeHref}
        />
    </StaticsProvider>
)
