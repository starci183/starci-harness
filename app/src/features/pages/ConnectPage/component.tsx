import { Alert, Button, Form, Heading, IdentityLockup, Input, PageContainer, SurfaceCard, Text } from "@starci/grammar/core"

/** Copy the connect page resolves. */
export interface ConnectPageLabels {
    readonly product: string
    readonly subtitle: string
    readonly card: string
    readonly title: string
    readonly intro: string
    readonly refused: string
    readonly form: string
    readonly url: string
    readonly urlPlaceholder: string
    readonly connect: string
    readonly fixtures: string
}

/** Complete input of ConnectPageBase. */
export interface ConnectPageBaseProps {
    readonly props: {
        readonly logoSrc: string
        /** Why the server refused the last token, if it did. */
        readonly problem: string | null
        /** The pasted text is not a `starci ui` URL. */
        readonly error: string | null
        readonly labels: ConnectPageLabels
    }
    readonly on: {
        readonly submit: (url: string) => void
        readonly edit: () => void
        readonly fixtures: () => void
    }
}

/** Pure half: first run, or after the server refused the token; the owner pastes the URL `starci ui` printed. */
export const ConnectPageBase = (props: ConnectPageBaseProps) => {
    const { labels, problem, error } = props.props
    return (
        <PageContainer measure="reading" className="app-connect">
            <IdentityLockup title={labels.product} subtitle={labels.subtitle} logoSrc={props.props.logoSrc} />
            <SurfaceCard ariaLabel={labels.card}>
                <div className="app-stack">
                    <Heading level={1}>{labels.title}</Heading>
                    <Text tone="muted">{labels.intro}</Text>
                    {problem === null ? null : <Alert tone="negative" title={labels.refused} description={problem} />}
                    <Form label={labels.form} onSubmit={(data) => props.on.submit(String(data.get("url") ?? ""))}>
                        <div className="app-stack">
                            <Input
                                id="connect-url"
                                name="url"
                                label={labels.url}
                                placeholder={labels.urlPlaceholder}
                                isRequired
                                autoFocus
                                isError={error !== null}
                                errorMessage={error ?? undefined}
                                onValueChange={props.on.edit}
                            />
                            <div className="app-row">
                                <Button intent="commit" type="submit">
                                    {labels.connect}
                                </Button>
                                <Button intent="alternative" onPress={props.on.fixtures}>
                                    {labels.fixtures}
                                </Button>
                            </div>
                        </div>
                    </Form>
                </div>
            </SurfaceCard>
        </PageContainer>
    )
}
