import { Link, Page } from "@starci/grammar/common"
import { SignInForm } from "@/components/blocks/SignInForm"
import { SignOutButton } from "@/components/blocks/SignOutButton"

/** Props for the home page: its title and the two doors beside the sign-in form. */
export type AppHomePageBaseProps = {
    readonly props: {
        readonly title: string
        readonly signupLabel: string
        readonly signupHref: string
        readonly forgotLabel: string
        readonly forgotHref: string
    }
}

/** Draws the front door as one Grammar Page (R325): the title heads the band, the body the sign-in form or the reader and sign-out. */
export const AppHomePageBase = (props: AppHomePageBaseProps) => (
    <Page header={{ title: props.props.title }}>
        <SignInForm />
        <Link href={props.props.signupHref}>{props.props.signupLabel}</Link>
        <Link href={props.props.forgotHref}>{props.props.forgotLabel}</Link>
        <SignOutButton />
    </Page>
)
