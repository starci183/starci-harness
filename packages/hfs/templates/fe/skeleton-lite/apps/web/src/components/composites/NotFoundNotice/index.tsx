import { Link, Page } from "@starci/grammar/common"

/** The words of a missing page and the way home. */
type NotFoundNoticeProps = {
    readonly title: string
    readonly homeLabel: string
    readonly homeHref: string
}

/** A missing page with one destination back to the app's front door. */
export const NotFoundNotice = (props: NotFoundNoticeProps) => (
    <Page header={{ title: props.title }} measure="reading">
        <Link href={props.homeHref}>{props.homeLabel}</Link>
    </Page>
)
