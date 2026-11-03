import type { ReactElement } from "react"
import type { Metadata } from "next"
import { Page } from "@starci/grammar/common"
import { getTranslations } from "next-intl/server"
import { EmailDoorForm } from "@/components/blocks/EmailDoorForm"

/** The document title of the reset page. */
export const appResetMetadata = async (): Promise<Metadata> => {
    const t = await getTranslations("app.emailAuth.reset")
    return { title: t("title") }
}

/** The query of the page: the link of the mail carries its token there. */
type AppResetPageProps = { readonly searchParams: Promise<{ readonly token?: string | readonly string[] }> }

/** The reset door of the lite sign-in, drawn as one Grammar Page (R325). */
export const AppResetPage = async (props: AppResetPageProps): Promise<ReactElement> => {
    const { token } = await props.searchParams
    const t = await getTranslations("app.emailAuth.reset")
    return (
        <Page header={{ title: t("title") }} measure="reading">
            <EmailDoorForm door="reset" token={typeof token === "string" ? token : token?.[0]} />
        </Page>
    )
}
