import { AppNotFoundPage } from "@/features/pages/AppNotFoundPage"

/** The document title of an unknown address, from the catalog of the requested locale. */
export { appNotFoundMetadata as generateMetadata } from "@/features/pages/AppNotFoundPage"

/** The locale segment's not-found slot, outside the loading group: it mounts the not-found page and nothing else. */
const NotFound = () => <AppNotFoundPage />

export default NotFound
