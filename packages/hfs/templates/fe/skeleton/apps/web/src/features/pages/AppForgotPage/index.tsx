import type { ReactElement } from "react"
import type { Metadata } from "next"
import { Page } from "@starci/grammar/common"
import { getTranslations } from "next-intl/server"
import { EmailDoorForm } from "@/components/blocks/EmailDoorForm"

/** The document title of the forgot page. */
export const appForgotMetadata = async (): Promise<Metadata> => {
    const t = await getTranslations("app.emailAuth.forgot")
    return { title: t("title") }
}

/** The forgot door of the lite sign-in, drawn as one Grammar Page (R325). */
export const AppForgotPage = async (_props: Record<string, never>): Promise<ReactElement> => {
    const t = await getTranslations("app.emailAuth.forgot")
    return (
        <Page header={{ title: t("title") }} measure="reading">
            <EmailDoorForm door="forgot" />
        </Page>
    )
}
