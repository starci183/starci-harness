import { Page } from "@starci/grammar/common"
import { SignInForm } from "@/components/blocks/SignInForm"
import { SignOutButton } from "@/components/blocks/SignOutButton"

/** Props for {@link AppHomePageBase}. */
export type AppHomePageBaseProps = {
    /** The words the page shows. */
    readonly props: { readonly title: string }
}

/**
 * Draw the front door of the product app as one Grammar Page (R325): the title heads the page band, and the body holds
 * the sign-in form for a signed-out reader, the reader and sign-out once signed in.
 */
export const AppHomePageBase = (props: AppHomePageBaseProps) => (
    <Page header={{ title: props.props.title }}>
        <SignInForm />
        <SignOutButton />
    </Page>
)
