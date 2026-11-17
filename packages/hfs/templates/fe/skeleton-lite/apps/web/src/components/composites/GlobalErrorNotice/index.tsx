import { EmptyNotice, GrammarRoot, StaticsProvider } from "@starci/grammar/common"

/** The document language, the words of the failure, its way home and its retry. */
type GlobalErrorNoticeProps = {
    readonly lang: string
    /** The catalog's words of the failure: the title, the description, the way home and the retry. */
    readonly words: { readonly title: string; readonly description: string; readonly home: string; readonly retry: string }
    /** Re-render the whole app. */
    readonly onRetry: () => void
    /** Where the statics are served from (statics/ at the repository root, mirrored to object storage). */
    readonly staticsBaseUrl?: string
}

/** The last-resort failure: the whole document, drawn here because this boundary replaces the layout that would have drawn it. */
export const GlobalErrorNotice = (props: GlobalErrorNoticeProps) => (
    <html lang={props.lang}>
        <body>
            <GrammarRoot>
                <StaticsProvider baseUrl={props.staticsBaseUrl ?? "/statics"}>
                    <EmptyNotice
                        scope="page"
                        message={props.words.title}
                        description={props.words.description}
                        media={{ illustration: { staticsKey: "illustrations/errors/server-error.webp" } }}
                        actionLabel={props.words.home}
                        actionHref="/"
                        secondary={{ label: props.words.retry, onPress: props.onRetry }}
                    />
                </StaticsProvider>
            </GrammarRoot>
        </body>
    </html>
)
