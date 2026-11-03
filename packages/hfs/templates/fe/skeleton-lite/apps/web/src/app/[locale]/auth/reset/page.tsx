import { AppResetPage } from "@/features/pages/AppResetPage"

/** The document title of this page. */
export { appResetMetadata as generateMetadata } from "@/features/pages/AppResetPage"

/** The reset page slot: Next hands the query over as a promise, which the page reads for the token of the mail link. */
const Page = (props: Parameters<typeof AppResetPage>[0]) => <AppResetPage {...props} />

export default Page
