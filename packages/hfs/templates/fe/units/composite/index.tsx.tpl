import { Text } from "@starci/grammar/common"

/** The resolved fields {{Name}} draws; its block resolves the copy and passes the waiting flag down. */
type {{Name}}Props = {
    readonly term: string
    readonly value: string
    readonly isLoading: boolean
}

/** A closed arrangement of Grammar parts: a term and its value, each resting as itself while its block waits. */
export const {{Name}} = (props: {{Name}}Props) => (
    <>
        <Text tone="muted" isLoading={props.isLoading}>
            {props.term}
        </Text>
        <Text isLoading={props.isLoading}>{props.value}</Text>
    </>
)
