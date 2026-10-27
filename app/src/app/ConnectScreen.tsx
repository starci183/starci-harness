import { Alert, Button, Form, Heading, IdentityLockup, Input, PageContainer, SurfaceCard, Text } from "@starci/grammar/core"
import { useState } from "react"
import { parseConnection } from "../api/client"
import { useConnection } from "./connection"
import { CONNECT, NAV } from "./labels"
import { logoSrc } from "./logo"

/** First run, or after the server refused the token: the owner pastes the URL `starci ui` printed. */
export const ConnectScreen = () => {
    const { connect, problem, enterFixtures } = useConnection()
    const [error, setError] = useState<string | null>(null)

    const submit = (data: FormData) => {
        const parsed = parseConnection(String(data.get("url") ?? ""))
        if (parsed === null) {
            setError(CONNECT.urlInvalid)
            return
        }
        connect(parsed)
    }

    return (
        <PageContainer measure="reading" className="app-connect">
            <IdentityLockup title={NAV.product} subtitle={CONNECT.subtitle} logoSrc={logoSrc} />
            <SurfaceCard ariaLabel={CONNECT.card}>
                <div className="app-stack">
                    <Heading level={1}>{CONNECT.title}</Heading>
                    <Text tone="muted">{CONNECT.intro}</Text>
                    {problem === null ? null : <Alert tone="negative" title={CONNECT.refused} description={problem} />}
                    <Form label={CONNECT.form} onSubmit={submit}>
                        <div className="app-stack">
                            <Input
                                id="connect-url"
                                name="url"
                                label={CONNECT.url}
                                placeholder={CONNECT.urlPlaceholder}
                                isRequired
                                autoFocus
                                isError={error !== null}
                                errorMessage={error ?? undefined}
                                onValueChange={() => setError(null)}
                            />
                            <div className="app-row">
                                <Button intent="commit" type="submit">
                                    {CONNECT.connect}
                                </Button>
                                <Button intent="alternative" onPress={enterFixtures}>
                                    {CONNECT.fixtures}
                                </Button>
                            </div>
                        </div>
                    </Form>
                </div>
            </SurfaceCard>
        </PageContainer>
    )
}
