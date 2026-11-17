import type { ReactElement } from "react"
import { getTranslations } from "next-intl/server"
import { NotFoundNotice } from "@{{project}}/ui"
import { APP_ROUTES } from "@/modules/routes"

/** Shown when a route calls `notFound()`: the page-level empty state, its words in the app's locale. */
export const AppNotFoundPage = async (): Promise<ReactElement> => {
    const t = await getTranslations("app.notFound")
    return <NotFoundNotice title={t("title")} description={t("description")} homeLabel={t("home")} homeHref={APP_ROUTES.home} />
}
