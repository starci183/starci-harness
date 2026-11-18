import type { ReactElement } from "react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { NotFoundNotice } from "@/components/composites/NotFoundNotice"
import { APP_ROUTES } from "@/modules/routes"

/** The document title of the not-found page, from the catalog of the requested locale. */
export const appNotFoundMetadata = async (): Promise<Metadata> => ({ title: (await getTranslations("app.notFound"))("title") })

/** Shown when a route calls `notFound()`: the page-level empty state, its words in the app's locale. */
export const AppNotFoundPage = async (): Promise<ReactElement> => {
    const t = await getTranslations("app.notFound")
    return <NotFoundNotice title={t("title")} description={t("description")} homeLabel={t("home")} homeHref={APP_ROUTES.home} />
}
