import { ErrorNotice } from "@{{project}}/ui"
import { LANDING_ROUTES } from "@/modules/routes"

/** Props for {@link LandingErrorPageBase}. */
export type LandingErrorPageBaseProps = {
    /** The words the failure shows, already resolved. */
    readonly props: {
        readonly title: string
        readonly description: string
        readonly homeLabel: string
        readonly retryLabel: string
    }
    /** What the surface reports upward. */
    readonly on: {
        readonly retry: () => void
    }
}

/** Draw the failure of the locale segment as the page-level empty state: home as the primary, retry as the secondary. */
export const LandingErrorPageBase = (props: LandingErrorPageBaseProps) => (
    <ErrorNotice {...props.props} homeHref={LANDING_ROUTES.home} onRetry={props.on.retry} />
)
