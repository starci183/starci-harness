import { AppConfirmPage } from "@/features/pages/AppConfirmPage"

/** The document title of this page. */
export { appConfirmMetadata as generateMetadata } from "@/features/pages/AppConfirmPage"

/** The confirm page slot: Next hands the query over as a promise, which the page reads for the token of the mail link. */
const Page = (props: Parameters<typeof AppConfirmPage>[0]) => <AppConfirmPage {...props} />

export default Page
