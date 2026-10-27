import { PageContainer, Spinner } from "@starci/grammar/core"
import { CONNECT } from "../../../modules/i18n"

/** While the session gate looks for `starci ui` (launch URL, `?token=`, the stored connection). */
export const ResolvingPage = () => (
    <PageContainer measure="reading" className="app-connect">
        <Spinner label={CONNECT.resolving} />
    </PageContainer>
)
