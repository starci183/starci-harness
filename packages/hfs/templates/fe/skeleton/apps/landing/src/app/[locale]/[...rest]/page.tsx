import { notFound } from "next/navigation"

/** The document title of an unknown address: the not-found page's own, so the tab never shows the default title. */
export { landingNotFoundMetadata as generateMetadata } from "@/features/pages/LandingNotFoundPage"

/** The catch-all slot, outside the loading group: an address under a locale that no route matches is a missing page, drawn by the locale's own not-found with a real 404. */
const Page = (): never => notFound()

export default Page
