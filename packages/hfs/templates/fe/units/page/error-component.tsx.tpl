import { Alert, Page } from "@starci/grammar/common"

/** The copy of the {{route}} route's failure and the retry its boundary hands over. */
export interface {{ErrorName}}BaseProps {
    readonly props: {
        readonly title: string
        readonly message: string
        readonly retryLabel: string
    }
    readonly on: { readonly retry: () => void }
}

/** A failed {{route}} route keeps its page and puts one negative Alert where the first region would be (STATE-8). */
export const {{ErrorName}}Base = (props: {{ErrorName}}BaseProps) => (
    <Page header={{ title: props.props.title }}>
        <Alert title={props.props.message} tone="negative" action={{ label: props.props.retryLabel, onAction: props.on.retry }} />
    </Page>
)
