import { Link, Page } from "@starci/grammar/common"

/** The words of a page that does not exist and the way back. */
type NotFoundNoticeProps = {
    readonly title: string
    readonly homeLabel: string
    /** The app's front door. */
    readonly homeHref: string
}

/** A missing page: the message and the way back to the app's front door. */
export const NotFoundNotice = (props: NotFoundNoticeProps) => (
    <Page header={{ title: props.title }} measure="reading">
        <Link href={props.homeHref}>{props.homeLabel}</Link>
    </Page>
)
