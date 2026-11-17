import { DEFAULT_LOCALE } from "@{{project}}/i18n/routing"
import { GlobalErrorNotice } from "@{{project}}/ui"
import messages from "@/modules/i18n/messages/vi.json"

/** The public props of the last-resort error page: the boundary hands it the retry. */
type LandingGlobalErrorPageProps = { readonly onRetry: () => void }

/** The last-resort boundary above the locale layout: it has no provider, so it reads the default catalog directly. */
export const LandingGlobalErrorPage = (props: LandingGlobalErrorPageProps) => (
    <GlobalErrorNotice lang={DEFAULT_LOCALE} words={messages.landing.errors.global} onRetry={props.onRetry} />
)
