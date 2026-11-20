import { Button, Form, Input, Link, Text } from "@starci/grammar/common"

/** One destination under the form: a sibling door or the sign-in page. */
export interface EmailDoorLink {
    readonly href: string
    readonly label: string
}

/** Copy, fields, state and action supplied by the connected email-door block. */
export interface EmailDoorFormBaseProps {
    readonly props: {
        readonly title: string
        readonly description: string
        /** The label of the optional full-name field, or undefined when the door takes none. */
        readonly nameLabel: string | undefined
        /** The label of the email field, or undefined when the door takes none. */
        readonly emailLabel: string | undefined
        /** The label of the password field, or undefined when the door takes none. */
        readonly passwordLabel: string | undefined
        readonly submitLabel: string
        readonly pending: boolean
        /** The resolved message of the last refusal, or undefined. */
        readonly errorMessage: string | undefined
        /** The message shown once the back end accepted the request, or undefined while it has not. */
        readonly doneMessage: string | undefined
        readonly links: readonly EmailDoorLink[]
    }
    readonly on: { readonly submit: (input: FormData) => void }
}

/** Draws one email door (sign up, resend, forgot, reset) without reading navigation, copy or request state. */
export const EmailDoorFormBase = (props: EmailDoorFormBaseProps) => (
    <>
        {props.props.doneMessage === undefined ? (
            <Form label={props.props.title} isPending={props.props.pending} onSubmit={props.on.submit}>
                <Text>{props.props.description}</Text>
                {props.props.nameLabel === undefined ? null : (
                    <Input id="email-door-name" name="name" label={props.props.nameLabel} kind="text" />
                )}
                {props.props.emailLabel === undefined ? null : (
                    <Input id="email-door-email" name="email" label={props.props.emailLabel} kind="email" isRequired />
                )}
                {props.props.passwordLabel === undefined ? null : (
                    <Input
                        id="email-door-password"
                        name="password"
                        label={props.props.passwordLabel}
                        kind="password"
                        isRequired
                    />
                )}
                {props.props.errorMessage === undefined ? null : (
                    <Text live="assertive">{props.props.errorMessage}</Text>
                )}
                <Button type="submit" intent="commit" isPending={props.props.pending}>
                    {props.props.submitLabel}
                </Button>
            </Form>
        ) : (
            <Text live="polite">{props.props.doneMessage}</Text>
        )}
        {props.props.links.map((link) => (
            <Link key={link.href} href={link.href}>
                {link.label}
            </Link>
        ))}
    </>
)
