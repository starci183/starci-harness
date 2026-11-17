import { EmptyNotice, StaticsProvider } from "@starci/grammar/common"

/** The words of a recoverable failure, its way home and its retry. */
type ErrorNoticeProps = {
    readonly title: string
    readonly description: string
    readonly homeLabel: string
    readonly homeHref: string
    readonly retryLabel: string
    /** Re-render the segment that failed. */
    readonly onRetry: () => void
    /** Where the statics are served from (statics/ at the repository root, mirrored to object storage). */
    readonly staticsBaseUrl?: string
}

/** A server failure (500): the one page-level empty state, the way home as its primary and the retry as its secondary. */
export const ErrorNotice = (props: ErrorNoticeProps) => (
    <StaticsProvider baseUrl={props.staticsBaseUrl ?? "/statics"}>
        <EmptyNotice
            scope="page"
            message={props.title}
            description={props.description}
            media={{ illustration: { staticsKey: "illustrations/errors/server-error.webp" } }}
            actionLabel={props.homeLabel}
            actionHref={props.homeHref}
            secondary={{ label: props.retryLabel, onPress: props.onRetry }}
        />
    </StaticsProvider>
)
