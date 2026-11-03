import type { ReactElement } from "react"
import type { Metadata } from "next"
import { Page } from "@starci/grammar/common"
import { getTranslations } from "next-intl/server"
import { EmailDoorForm } from "@/components/blocks/EmailDoorForm"

/** The document title of the resend page. */
export const appResendMetadata = async (): Promise<Metadata> => {
    const t = await getTranslations("app.emailAuth.resend")
    return { title: t("title") }
}

/** The resend door of the lite sign-in, drawn as one Grammar Page (R325). */
export const AppResendPage = async (_props: Record<string, never>): Promise<ReactElement> => {
    const t = await getTranslations("app.emailAuth.resend")
    return (
        <Page header={{ title: t("title") }} measure="reading">
            <EmailDoorForm door="resend" />
        </Page>
    )
}
