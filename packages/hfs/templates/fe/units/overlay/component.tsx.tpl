import { {{grammarImports}} } from "@starci/grammar/common"

/** The copy, the open state and the actions the connected {{Name}} supplies; atoms only. */
export interface {{Name}}BaseProps {
    readonly props: {
        readonly isOpen: boolean
        readonly triggerLabel: string
        readonly title: string
{{labelMembers}}        readonly cancelLabel: string
        readonly submitLabel: string
    }
    readonly on: {
        readonly openChange: (isOpen: boolean) => void
{{submitMember}}    }
}

/** {{doc}} */
export const {{Name}}Base = (props: {{Name}}BaseProps) => (
    <{{shell}}
        isOpen={props.props.isOpen}
        onOpenChange={props.on.openChange}
        title={props.props.title}
{{shellAttributes}}        trigger={<Button intent="neutral">{props.props.triggerLabel}</Button>}
{{footer}}    >
{{body}}
    </{{shell}}>
)
