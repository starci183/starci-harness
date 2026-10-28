import { Page } from "@starci/grammar/common"
import { SignInForm } from "@/components/blocks/SignInForm"
import { SignOutButton } from "@/components/blocks/SignOutButton"

/** Props for the home page: its title. */
export type AppHomePageBaseProps = {
    readonly props: { readonly title: string }
}

/** Draws the front door as one Grammar Page (R325): the title heads the band, the body the sign-in form or the reader and sign-out. */
export const AppHomePageBase = (props: AppHomePageBaseProps) => (
    <Page header={{ title: props.props.title }}>
        <SignInForm />
        <SignOutButton />
    </Page>
)
