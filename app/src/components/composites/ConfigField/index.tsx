import { Checkbox, Code, Input, NumberField, Select, Textarea } from "@starci/grammar/core"
import type { ReactNode } from "react"
import { ListEditor, type ListEditorView, type ListEditorWords } from "../ListEditor"

/** What every field view carries: its key, its words and its refusal. */
interface FieldBase {
    readonly configKey: string
    readonly label: string
    /** The one-line description; the key is always shown under it. */
    readonly description: string | null
    readonly error: string | null
}

/** One harness setting, resolved by its block into the editor its value type needs. */
export type ConfigFieldView =
    | (FieldBase & { readonly kind: "number"; readonly value: number; readonly min: number })
    | (FieldBase & { readonly kind: "boolean"; readonly value: boolean })
    | (FieldBase & { readonly kind: "effort"; readonly value: string | null })
    | (FieldBase & { readonly kind: "text"; readonly value: string })
    | (FieldBase & { readonly kind: "list"; readonly list: ListEditorView })
    | (FieldBase & { readonly kind: "json"; readonly text: string; readonly hint: string })

/** A value a field writes back. */
export type ConfigValue = number | boolean | string | readonly string[]

/** One effort level the effort select offers. */
export interface EffortOption {
    readonly id: string
    readonly label: string
    readonly description: string
}

/** Input of ConfigField. */
export interface ConfigFieldProps {
    readonly field: ConfigFieldView
    readonly efforts: readonly EffortOption[]
    readonly words: ListEditorWords
    readonly isDisabled: boolean
    readonly isSkeleton?: boolean
    /** A field hidden behind a column header keeps its label for assistive technology only. */
    readonly isLabelHidden?: boolean
    readonly onChange: (key: string, value: ConfigValue) => void
    readonly onJson: (key: string, text: string) => void
}

/** A field's helper text: its one-line description, then its config key as code. */
const helper = (key: string, description: string | null): ReactNode =>
    description === null ? (
        <Code>{key}</Code>
    ) : (
        <span className="app-lines">
            <span>{description}</span>
            <span>
                <Code>{key}</Code>
            </span>
        </span>
    )

/** Composite: one editor per value type (number, checkbox, effort select, text, tag list, and JSON only for the rest). */
export const ConfigField = (props: ConfigFieldProps) => {
    const { field } = props
    const isSkeleton = props.isSkeleton === true
    const error = field.error === null ? {} : { errorMessage: field.error }
    const common = { label: field.label, isDisabled: props.isDisabled, isSkeleton }
    const description = props.isLabelHidden === true ? undefined : helper(field.configKey, field.description)
    switch (field.kind) {
        case "number":
            return (
                <NumberField
                    {...common}
                    description={description}
                    minValue={field.min}
                    value={field.value}
                    onValueChange={(next) => {
                        if (!Number.isNaN(next)) props.onChange(field.configKey, next)
                    }}
                    {...error}
                />
            )
        case "boolean":
            return (
                <Checkbox
                    label={field.label}
                    description={description}
                    isDisabled={props.isDisabled}
                    isSelected={field.value}
                    onSelectedChange={(next) => props.onChange(field.configKey, next)}
                    {...error}
                />
            )
        case "effort":
            return (
                <Select
                    {...common}
                    isLabelHidden={props.isLabelHidden === true}
                    options={props.efforts}
                    value={field.value}
                    onValueChange={(next) => {
                        if (next !== null) props.onChange(field.configKey, next)
                    }}
                    {...(description === undefined ? {} : { description })}
                    {...error}
                />
            )
        case "text":
            return (
                <Input
                    {...common}
                    id={`config-${field.configKey}`}
                    name={field.configKey}
                    description={description}
                    value={field.value}
                    onValueChange={(next) => props.onChange(field.configKey, next)}
                    {...(field.error === null ? {} : { errorMessage: field.error, isError: true })}
                />
            )
        case "list":
            return (
                <ListEditor
                    list={field.list}
                    words={props.words}
                    isDisabled={props.isDisabled}
                    isSkeleton={isSkeleton}
                    onChange={(items) => props.onChange(field.configKey, items)}
                />
            )
        case "json":
            return (
                <Textarea
                    {...common}
                    description={field.hint}
                    rows={4}
                    value={field.text}
                    onValueChange={(text) => props.onJson(field.configKey, text)}
                    {...error}
                />
            )
    }
}
