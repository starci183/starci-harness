import { DEFAULT_LOCALE } from "@/modules/i18n"
import { GlobalErrorNotice } from "@/components/composites/GlobalErrorNotice"
import messages from "@/modules/i18n/messages/vi.json"

/** The public props of the last-resort error page: the boundary hands it the retry. */
type AppGlobalErrorPageProps = { readonly onRetry: () => void }

/** The last-resort boundary above the locale layout: it has no provider, so it reads the default catalog directly. */
export const AppGlobalErrorPage = (props: AppGlobalErrorPageProps) => (
    <GlobalErrorNotice lang={DEFAULT_LOCALE} words={messages.app.errors.global} onRetry={props.onRetry} />
)
