import { Button, Form, Input, SectionHeader, Text } from "@starci/grammar/common"

/** Copy, the pending flag, the first error message and the action supplied by the connected sign-in block. */
export interface SignInFormBaseProps {
    readonly props: {
        readonly title: string
        readonly emailLabel: string
        readonly passwordLabel: string
        readonly submitLabel: string
        /** True while the sign-in request runs. */
        readonly pending: boolean
        /** The resolved message of the last refused sign-in, or undefined. */
        readonly errorMessage: string | undefined
    }
    readonly on: { readonly submit: (input: FormData) => void }
}

/** Draws the sign-in form without reading navigation, copy or database state. */
export const SignInFormBase = (props: SignInFormBaseProps) => (
    <>
        <SectionHeader title={props.props.title} level={2} />
        <Form label={props.props.title} isPending={props.props.pending} onSubmit={props.on.submit}>
            <Input id="sign-in-email" name="email" label={props.props.emailLabel} kind="email" isRequired />
            <Input id="sign-in-password" name="password" label={props.props.passwordLabel} kind="password" isRequired />
            {props.props.errorMessage === undefined ? null : <Text live="assertive">{props.props.errorMessage}</Text>}
            <Button type="submit" intent="commit" isPending={props.props.pending}>
                {props.props.submitLabel}
            </Button>
        </Form>
    </>
)
