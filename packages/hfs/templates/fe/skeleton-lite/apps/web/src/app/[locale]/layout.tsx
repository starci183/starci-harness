import { createReadLocaleSegment } from "@starci/next-i18n/layout"
import type { Metadata } from "next"
import type { ReactElement, ReactNode } from "react"
import { AppLayout, appLayoutMetadata } from "@/features/layouts/AppLayout"
import { i18n } from "@/modules/i18n"
import { Providers } from "./providers"
import "../globals.css"
import "@/modules/brand"

type LayoutProps = {
    readonly children: ReactNode
    readonly params: Promise<{ readonly locale: string }>
}

/** The localized document title of this route segment. */
export const generateMetadata = async (props: LayoutProps): Promise<Metadata> =>
    appLayoutMetadata((await props.params).locale)

/** The locale segment's document, providers and app chrome; an unknown locale is a 404. */
const Layout = async (props: LayoutProps): Promise<ReactElement> => {
    const { locale, messages, timeZone } = await createReadLocaleSegment(i18n)(props.params)
    return (
        <AppLayout
            locale={locale}
            content={
                <Providers locale={locale} messages={messages} timeZone={timeZone}>
                    {props.children}
                </Providers>
            }
        />
    )
}

export default Layout
