import { Badge, Text } from "@starci/grammar/core"
import type { ToneLabel } from "../../../modules/types"

/** Input of StatusWord. */
export interface StatusWordProps {
    readonly status: ToneLabel
    readonly isLoading?: boolean
}

/**
 * Leaf: a state as a `Badge isDot` (a dot and its words). The Grammar dot has no resting shape of its own, so it rests
 * inside a `Text` line of the same size: one tree, and the line takes its place while the read waits.
 */
export const StatusWord = (props: StatusWordProps) => (
    <Text as="span" size="sm" isLoading={props.isLoading === true}>
        <Badge isDot tone={props.status.tone}>
            {props.status.label}
        </Badge>
    </Text>
)
