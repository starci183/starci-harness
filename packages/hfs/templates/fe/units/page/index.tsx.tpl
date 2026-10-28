import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { APP_ROUTES } from "@/modules/routes"
import { {{Name}}Base } from "./component"
import type { {{Name}}BaseProps } from "./component"

/** The document title of {{Name}}, from the catalog of the requested locale. */
export const {{nameCamel}}Metadata = async (): Promise<Metadata> => {
    const t = await getTranslations("{{nameCamel}}")
    return { title: t("title") }
}

/** The copy of {{Name}}, resolved once on the server for the page and for its loading view. */
const copyOf = async (isSkeleton: boolean): Promise<{{Name}}BaseProps["props"]> => {
    const t = await getTranslations("{{nameCamel}}")
    return {
        title: t("title"),
        breadcrumbLabel: t("breadcrumb"),
        homeLabel: t("home"),
        homeHref: APP_ROUTES.home,
{{emptyResolved}}{{tabsResolved}}        isSkeleton,
    }
}

/** The {{route}} page: a server owner that resolves its copy and composes its blocks; it reads no data. */
export const {{Name}} = async () => <{{Name}}Base props={await copyOf(false)} />

/** The {{route}} route's loading view: the same page drawn in skeleton mode, never a separate layout (STATE-8). */
export const {{LoadingName}} = async () => <{{Name}}Base props={await copyOf(true)} />
