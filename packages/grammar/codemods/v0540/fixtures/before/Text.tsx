import { Text } from "@starci/grammar/core"

export const Row = ({ name, when, note, id, count, size }: Props) => (
    <div>
        <Text isStrong>{name}</Text>
        <Text size="xs">{when}</Text>
        <Text size="xs" isStrong>{count}</Text>
        <Text size="sm" tone="muted">{note}</Text>
        <Text size="figure">{count}</Text>
        <Text size="xs" mono>{id}</Text>
        <Text>{note}</Text>
        <Text size={size}>{note}</Text>
        <Text isStrong tone="muted">{name}</Text>
    </div>
)
