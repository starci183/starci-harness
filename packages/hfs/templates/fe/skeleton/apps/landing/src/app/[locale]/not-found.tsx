import { LandingNotFoundPage } from "@/features/pages/LandingNotFoundPage"

/** The document title of an unknown address, from the catalog of the requested locale. */
export { landingNotFoundMetadata as generateMetadata } from "@/features/pages/LandingNotFoundPage"

/** The locale segment's not-found slot, outside the loading group: it mounts the not-found page and nothing else. */
const NotFound = () => <LandingNotFoundPage />

export default NotFound
