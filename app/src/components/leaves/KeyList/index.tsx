import { Code, Text } from "@starci/grammar/core"

/** Input of KeyList. */
export interface KeyListProps {
    readonly keys: readonly string[]
    /** The word for no keys at all. */
    readonly noneLabel: string
    readonly isSkeleton?: boolean
}

/** Leaf: keys (Op keys, dependencies, records) as inline code, comma separated, or the word for none. */
export const KeyList = (props: KeyListProps) => (
    <Text as="span" size="sm" isSkeleton={props.isSkeleton === true}>
        {props.keys.length === 0
            ? props.noneLabel
            : props.keys.map((key, index) => (
                  <span key={key}>
                      {index === 0 ? null : ", "}
                      <Code>{key}</Code>
                  </span>
              ))}
    </Text>
)
