import { useState } from "react"
import { useConnection } from "../../../hooks/connection"
import { parseConnection } from "../../../modules/api"
import { logoSrc } from "../../../modules/brand"
import { CONNECT, NAV } from "../../../modules/i18n"
import { ConnectPageBase } from "./component"

/** The session gate's door: connects to the pasted `starci ui` URL, or opens the sample data. */
export const ConnectPage = () => {
    const { connect, problem, enterFixtures } = useConnection()
    const [error, setError] = useState<string | null>(null)
    return (
        <ConnectPageBase
            props={{
                logoSrc,
                problem,
                error,
                labels: {
                    product: NAV.product,
                    subtitle: CONNECT.subtitle,
                    card: CONNECT.card,
                    title: CONNECT.title,
                    intro: CONNECT.intro,
                    refused: CONNECT.refused,
                    form: CONNECT.form,
                    url: CONNECT.url,
                    urlPlaceholder: CONNECT.urlPlaceholder,
                    connect: CONNECT.connect,
                    fixtures: CONNECT.fixtures,
                },
            }}
            on={{
                submit: (url) => {
                    const parsed = parseConnection(url)
                    if (parsed === null) setError(CONNECT.urlInvalid)
                    else connect(parsed)
                },
                edit: () => setError(null),
                fixtures: enterFixtures,
            }}
        />
    )
}
