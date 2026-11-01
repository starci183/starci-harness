import { Page, Spinner } from "@starci/grammar/core"
import { CONNECT } from "../../../modules/i18n"

/** While the session gate looks for `starci ui` (launch URL, `?token=`, the stored connection). */
export const ResolvingPage = () => (
    <Page measure="reading">
        <Spinner label={CONNECT.resolving} />
    </Page>
)
