import { Button, Checkbox, Input, NumberField, Select, TagGroup, Text, Textarea } from "@starci/grammar/core"
import { useState, type ReactNode } from "react"
import type { ConfigEntry } from "@contract"
import { EFFORT_OPTIONS, SETTINGS, configFieldLabel } from "../../app/labels"

/** What every editor needs from the page: the current (draft or saved) value, its error, and how to change it. */
export interface Draft {
    readonly valueOf: (key: string) => unknown
    readonly errorOf: (key: string) => string | undefined
    readonly jsonTextOf: (key: string) => string | undefined
    readonly set: (key: string, value: unknown) => void
    readonly setJson: (key: string, text: string) => void
    readonly isDisabled: boolean
}

export const isStringList = (value: unknown): value is readonly string[] =>
    Array.isArray(value) && value.every((item) => typeof item === "string")

const isEffortKey = (key: string) => /(^|\.)effort$/i.test(key)

/** A field's helper text: its one-line description, then its config key, quiet. */
export const helper = (key: string, description?: string): ReactNode =>
    description === undefined ? (
        key
    ) : (
        <span className="app-lines">
            <span>{description}</span>
            <span>{key}</span>
        </span>
    )

/** Distinct values in first-seen order. */
export const unique = (lists: readonly (readonly string[])[]): readonly string[] => [...new Set(lists.flat())]

interface ListEditorProps {
    readonly configKey: string
    readonly label: string
    readonly items: readonly string[]
    /** Values the add control offers; without it the owner types a new value. */
    readonly pool?: readonly string[]
    readonly addLabel: string
    readonly addPlaceholder: string
    readonly emptyText: string
    /** The add Select's placeholder once every pooled value is in the list. */
    readonly exhaustedText?: string
    /** A control that shares the add control's row (the tier's effort), so both labels sit on one line. */
    readonly aside?: ReactNode
    readonly draft: Draft
}

/**
 * A list of strings as removable tags, plus one control that adds a value: a Select over the known values when there is a
 * pool, else a text field and an add button. New values go to the end.
 */
export const ListEditor = ({ configKey, label, items, pool, addLabel, addPlaceholder, emptyText, exhaustedText, aside, draft }: ListEditorProps) => {
    const [text, setText] = useState("")
    const error = draft.errorOf(configKey)
    const available = (pool ?? []).filter((item) => !items.includes(item))
    const add = (value: string) => {
        const next = value.trim()
        if (next !== "" && !items.includes(next)) draft.set(configKey, [...items, next])
    }
    return (
        <div className="app-stack">
            <TagGroup
                label={label}
                items={items.map((item) => ({ id: item, label: item }))}
                onRemove={(ids) => draft.set(configKey, items.filter((item) => !ids.includes(item)))}
                removeLabel={SETTINGS.removeTag}
                emptyContent={
                    <Text size="sm" tone="muted">
                        {emptyText}
                    </Text>
                }
            />
            <div className="app-tier">
                {pool === undefined ? (
                    <div className="app-pair">
                        <Input
                            id={`config-add-${configKey}`}
                            name={`${configKey}-add`}
                            label={addLabel}
                            placeholder={addPlaceholder}
                            value={text}
                            onValueChange={setText}
                            isDisabled={draft.isDisabled}
                            hint={configKey}
                            {...(error === undefined ? {} : { errorMessage: error, isError: true })}
                        />
                        <span className="app-row">
                            <Button
                                intent="neutral"
                                size="sm"
                                isDisabled={draft.isDisabled || text.trim() === ""}
                                onPress={() => {
                                    add(text)
                                    setText("")
                                }}
                            >
                                {SETTINGS.add}
                            </Button>
                        </span>
                    </div>
                ) : (
                    <Select
                        label={addLabel}
                        placeholder={available.length === 0 ? (exhaustedText ?? addPlaceholder) : addPlaceholder}
                        options={available.map((item) => ({ id: item, label: item }))}
                        value={null}
                        onValueChange={(value) => {
                            if (value !== null) add(value)
                        }}
                        description={configKey}
                        isDisabled={draft.isDisabled || available.length === 0}
                        {...(error === undefined ? {} : { errorMessage: error })}
                    />
                )}
                {aside}
            </div>
        </div>
    )
}

/** One editor per value type: number field, checkbox, effort select, text field, tag list, and JSON only for the rest. */
export const FieldEditor = ({ entry, draft }: { readonly entry: ConfigEntry; readonly draft: Draft }) => {
    const { label, description } = configFieldLabel(entry.key)
    const value = draft.valueOf(entry.key)
    const error = draft.errorOf(entry.key)
    const field = {
        label,
        description: helper(entry.key, description),
        isDisabled: draft.isDisabled,
        ...(error === undefined ? {} : { errorMessage: error }),
    }
    if (typeof entry.value === "number") {
        return (
            <NumberField
                {...field}
                minValue={0}
                value={typeof value === "number" ? value : entry.value}
                onValueChange={(next) => {
                    if (!Number.isNaN(next)) draft.set(entry.key, next)
                }}
            />
        )
    }
    if (typeof entry.value === "boolean") {
        return <Checkbox {...field} isSelected={value === true} onSelectedChange={(next) => draft.set(entry.key, next)} />
    }
    if (typeof entry.value === "string" && isEffortKey(entry.key)) {
        return (
            <Select
                {...field}
                options={EFFORT_OPTIONS}
                value={String(value)}
                onValueChange={(next) => {
                    if (next !== null) draft.set(entry.key, next)
                }}
            />
        )
    }
    if (typeof entry.value === "string") {
        return (
            <Input
                id={`config-${entry.key}`}
                name={entry.key}
                label={label}
                hint={field.description}
                isDisabled={draft.isDisabled}
                value={String(value)}
                onValueChange={(next) => draft.set(entry.key, next)}
                {...(error === undefined ? {} : { errorMessage: error, isError: true })}
            />
        )
    }
    if (isStringList(entry.value)) {
        return (
            <ListEditor
                configKey={entry.key}
                label={label}
                items={isStringList(value) ? value : []}
                addLabel={SETTINGS.add}
                addPlaceholder={SETTINGS.newItem}
                emptyText={SETTINGS.noItems}
                draft={draft}
            />
        )
    }
    return (
        <Textarea
            {...field}
            description={SETTINGS.jsonHint(entry.key)}
            rows={4}
            value={draft.jsonTextOf(entry.key) ?? JSON.stringify(value, null, 2)}
            onValueChange={(text) => draft.setJson(entry.key, text)}
        />
    )
}
