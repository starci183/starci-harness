import { Badge } from "@starci/grammar/common"

/** One resolved label and the waiting flag of the block that draws it. */
type {{Name}}Props = {
    readonly label: string
    readonly isLoading: boolean
}

/** A fixed semantic unit over one Grammar leaf; it rests as itself by passing `isLoading` on. */
export const {{Name}} = (props: {{Name}}Props) => <Badge isLoading={props.isLoading}>{props.label}</Badge>
