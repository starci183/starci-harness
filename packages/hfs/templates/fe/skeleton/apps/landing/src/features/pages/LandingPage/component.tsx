import { Button, Page } from "@starci/grammar/common"

/** Props for {@link LandingPageBase}. */
export type LandingPageBaseProps = {
    /** The words and the link the page shows, already resolved. */
    readonly props: {
        readonly title: string
        readonly lede: string
        readonly openApp: string
        /** The product app's origin: the landing hands the reader over to it. */
        readonly appHref: string
    }
}

/**
 * Draw the public front door as one Grammar Page (R325): the welcome heads the band with one sentence about the product
 * under it, and the body holds the way into the product app.
 */
export const LandingPageBase = (props: LandingPageBaseProps) => (
    <Page header={{ title: props.props.title, description: props.props.lede }}>
        <Button href={props.props.appHref} intent="commit">
            {props.props.openApp}
        </Button>
    </Page>
)
