import { Text } from "@starci/grammar/core"

export const Row = ({ name, when, note, id, count, size }: Props) => (
    <div>
        <Text role="label.item">{name}</Text>
        <Text role="caption">{when}</Text>
        <Text role="label.group">{count}</Text>
        <Text role="body" tone="muted">{note}</Text>
        <Text role="figure">{count}</Text>
        <Text role="code">{id}</Text>
        <Text>{note}</Text>
        <Text // TODO(type-role): non-literal size, isStrong or mono
             size={size}>{note}</Text>
        <Text // TODO(type-role): muted or dynamic-tone strong 14px: label.field or label.item
             isStrong tone="muted">{name}</Text>
    </div>
)
