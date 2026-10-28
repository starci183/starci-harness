import { Badge } from "@starci/grammar/common"

/** One resolved label and the waiting flag of the block that draws it. */
type {{Name}}Props = {
    readonly label: string
    readonly isSkeleton: boolean
}

/** A fixed semantic unit over one Grammar leaf; it rests as itself by passing `isSkeleton` on. */
export const {{Name}} = (props: {{Name}}Props) => <Badge isSkeleton={props.isSkeleton}>{props.label}</Badge>
