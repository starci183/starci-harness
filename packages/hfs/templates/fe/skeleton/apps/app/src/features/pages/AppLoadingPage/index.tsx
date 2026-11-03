import type { ReactElement } from "react"
import { getTranslations } from "next-intl/server"
import { LoadingNotice } from "@{{project}}/ui"

/** Shown while a route of the product app resolves. */
export const AppLoadingPage = async (): Promise<ReactElement> => {
    const t = await getTranslations("app.loading")
    return <LoadingNotice label={t("message")} />
}
