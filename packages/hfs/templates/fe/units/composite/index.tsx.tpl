import { Text } from "@starci/grammar/common"

/** The resolved fields {{Name}} draws; its block resolves the copy and passes the waiting flag down. */
type {{Name}}Props = {
    readonly term: string
    readonly value: string
    readonly isSkeleton: boolean
}

/** A closed arrangement of Grammar parts: a term and its value, each resting as itself while its block waits. */
export const {{Name}} = (props: {{Name}}Props) => (
    <>
        <Text tone="muted" isSkeleton={props.isSkeleton}>
            {props.term}
        </Text>
        <Text isSkeleton={props.isSkeleton}>{props.value}</Text>
    </>
)
