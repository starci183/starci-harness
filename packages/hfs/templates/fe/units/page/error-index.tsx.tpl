import { useTranslations } from "next-intl"
import { {{ErrorName}}Base } from "./component"

/** The public props of the {{route}} error page: the boundary hands it the retry. */
type {{ErrorName}}Props = { readonly onRetry: () => void }

/** A render failure under the {{route}} route shows this page instead of a blank one; retry renders the segment again. */
export const {{ErrorName}} = (props: {{ErrorName}}Props) => {
    const t = useTranslations("{{nameCamel}}")
    return <{{ErrorName}}Base props={{ title: t("title"), message: t("failed"), retryLabel: t("retry") }} on={{ retry: props.onRetry }} />
}
