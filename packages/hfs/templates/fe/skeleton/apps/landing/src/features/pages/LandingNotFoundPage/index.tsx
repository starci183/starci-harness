import type { ReactElement } from "react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { NotFoundNotice } from "@{{project}}/ui"
import { LANDING_ROUTES } from "@/modules/routes"

/** The document title of the not-found page, from the catalog of the requested locale. */
export const landingNotFoundMetadata = async (): Promise<Metadata> => ({ title: (await getTranslations("landing.notFound"))("title") })

/** Shown when a route calls `notFound()`: the page-level empty state, its words in the app's locale. */
export const LandingNotFoundPage = async (): Promise<ReactElement> => {
    const t = await getTranslations("landing.notFound")
    return <NotFoundNotice title={t("title")} description={t("description")} homeLabel={t("home")} homeHref={LANDING_ROUTES.home} />
}
