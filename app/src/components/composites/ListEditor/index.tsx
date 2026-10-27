import { Button, Code, Input, Select, TagGroup, Text } from "@starci/grammar/core"
import { useState } from "react"

/** A list of strings to edit, resolved by its block. */
export interface ListEditorView {
    readonly configKey: string
    readonly label: string
    readonly items: readonly string[]
    /** Values the add control offers; null lets the owner type a new value. */
    readonly pool: readonly string[] | null
    readonly addLabel: string
    readonly addPlaceholder: string
    readonly emptyText: string
    /** The add Select's placeholder once every pooled value is in the list. */
    readonly exhaustedText: string
    /** The order means something (lane steps run in order, tier members break ties in order): tags reorder. */
    readonly isOrdered: boolean
    /** Inside a table cell the column header names the list, so the add control keeps its label for assistive tech only. */
    readonly isAddLabelHidden: boolean
    readonly error: string | null
}

/** The shared words every list editor uses; `{label}`, `{position}` and `{total}` are filled per tag. */
export interface ListEditorWords {
    readonly add: string
    readonly removeTag: string
    readonly reorderInstructions: string
    readonly reorderAnnouncement: string
}

/** Input of ListEditor. */
export interface ListEditorProps {
    readonly list: ListEditorView
    readonly words: ListEditorWords
    readonly isDisabled: boolean
    readonly isSkeleton?: boolean
    readonly onChange: (items: readonly string[]) => void
}

const fill = (template: string, values: Readonly<Record<string, string | number>>): string =>
    template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole))

/**
 * Composite: a list of strings as removable tags, reorderable when the order matters, plus one control that adds a value:
 * a Select over the known values when there is a pool, else a text field and an add button. New values go to the end.
 */
export const ListEditor = (props: ListEditorProps) => {
    const { list, words } = props
    const [text, setText] = useState("")
    const isSkeleton = props.isSkeleton === true
    const available = (list.pool ?? []).filter((item) => !list.items.includes(item))
    const add = (value: string) => {
        const next = value.trim()
        if (next !== "" && !list.items.includes(next)) props.onChange([...list.items, next])
    }
    const reorder = list.isOrdered
        ? {
              onReorder: (ids: readonly string[]) => props.onChange([...ids]),
              reorderInstructions: words.reorderInstructions,
              reorderAnnouncement: (label: string, position: number, total: number) => fill(words.reorderAnnouncement, { label, position, total }),
          }
        : {}
    const error = list.error === null ? {} : { errorMessage: list.error }
    return (
        <div className="app-stack">
            <TagGroup
                label={list.label}
                size="sm"
                items={list.items.map((item) => ({ id: item, label: item }))}
                onRemove={(ids) => props.onChange(list.items.filter((item) => !ids.includes(item)))}
                removeLabel={(label) => fill(words.removeTag, { label })}
                {...reorder}
                emptyContent={
                    <Text size="sm" tone="muted" isSkeleton={isSkeleton}>
                        {list.emptyText}
                    </Text>
                }
            />
            {list.pool === null ? (
                <div className="app-pair">
                    <Input
                        id={`config-add-${list.configKey}`}
                        name={`${list.configKey}-add`}
                        label={list.addLabel}
                        placeholder={list.addPlaceholder}
                        value={text}
                        onValueChange={setText}
                        isDisabled={props.isDisabled}
                        isSkeleton={isSkeleton}
                        description={<Code>{list.configKey}</Code>}
                        {...(list.error === null ? {} : { errorMessage: list.error, isError: true })}
                    />
                    <span className="app-row">
                        <Button
                            intent="neutral"
                            size="sm"
                            isDisabled={props.isDisabled || text.trim() === ""}
                            isSkeleton={isSkeleton}
                            onPress={() => {
                                add(text)
                                setText("")
                            }}
                        >
                            {words.add}
                        </Button>
                    </span>
                </div>
            ) : (
                <Select
                    label={list.addLabel}
                    isLabelHidden={list.isAddLabelHidden}
                    placeholder={available.length === 0 ? list.exhaustedText : list.addPlaceholder}
                    options={available.map((item) => ({ id: item, label: item }))}
                    value={null}
                    onValueChange={(value) => {
                        if (value !== null) add(value)
                    }}
                    isDisabled={props.isDisabled || available.length === 0}
                    isSkeleton={isSkeleton}
                    {...(list.isAddLabelHidden ? {} : { description: <Code>{list.configKey}</Code> })}
                    {...error}
                />
            )}
        </div>
    )
}
