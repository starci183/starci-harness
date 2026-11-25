"use client"

import { Fragment, useId, type ReactNode } from "react"
import { Input } from "../../branch/Input/index.js"
import { Select } from "../../branch/Select/index.js"
import { Textarea } from "../../branch/Textarea/index.js"
import { FileDropzone } from "../../branch/FileDropzone/index.js"
import { Button } from "../../leaf/Button/index.js"
import { Icon } from "../../leaf/Icon/index.js"
import { IconButton } from "../../leaf/IconButton/index.js"
import { Meter } from "../../leaf/Meter/index.js"
import { NumberField } from "../../leaf/NumberField/index.js"
import { Switch } from "../../leaf/Switch/index.js"
import { TypingDots } from "../../leaf/TypingDots/index.js"
import { TablerArrowDown, TablerArrowUp, TablerPencil, TablerTrash } from "../../leaf/Icon/tabler.js"
import { LoadingScope, useIsLoading } from "../../regionScope.js"
import type { NoChildren } from "../../tier.js"
import {
    emptyOf,
    isBlank,
    joinPath,
    kindOf,
    schemaFormMissing,
    sumOf,
    valueAt,
    withValueAt,
    type SchemaFormField,
    type SchemaFormPath,
    type SchemaFormValue,
} from "./schema.js"

export * from "./schema.js"

/** What the form says about a field besides its value: the person edited it by hand (the agent leaves it alone), or the agent is writing it now. */
export type SchemaFormMark = "edited" | "writing"

/** The decision on one of the agent's proposals. */
export type SchemaFormDecision = "accept" | "reject"

/** The words of the form, all the app's: Grammar writes none. */
export type SchemaFormLabels = {
    /** The marker on a field the person edited by hand, e.g. "You edited". */
    readonly edited: string
    /** The status on a field the agent is writing, e.g. "Claude is writing". */
    readonly writing: string
    /** The line under a required field left empty, e.g. "Needed". */
    readonly missing: string
    /** The title of the agent's proposed change under a field, e.g. "Claude suggests". */
    readonly proposes: string
    /** The name of the value now in the field, in the proposal's difference, e.g. "Now". */
    readonly current: string
    /** The name of the proposed value, e.g. "Suggested". */
    readonly suggested: string
    readonly accept: string
    readonly reject: string
    /** The accessible name of the remove button of one item, e.g. `Remove ${item}`. */
    readonly remove: (item: string) => string
    readonly moveUp: (item: string) => string
    readonly moveDown: (item: string) => string
    /** The note beside an add button that has reached `maxItems`, e.g. `At most ${max}`. */
    readonly atMost: (max: number) => string
    /** The prompt inside the default upload zone, e.g. "Drop a file or choose one". */
    readonly uploadPrompt: string
    /** What a field with no value reads in the view layout, e.g. "Not set". */
    readonly empty: string
}

/** A reading of the numbers under `valueKey` of an array's items against a limit: "Total 15 / 15 seconds". Drawn after the list as a Meter. */
export type SchemaFormMeter = {
    /** The key of each item that holds the number to add up. */
    readonly valueKey: string
    readonly max: number
    /** The meter's name and the reading beside it, e.g. `${sum} / ${max} seconds`. */
    readonly name: string
    readonly reading: (sum: number, max: number) => string
}

/** What the upload slot draws, and the one way it hands a value back. */
export type SchemaFormUploadSlot = {
    readonly path: SchemaFormPath
    readonly title: string
    readonly kind: "image" | "file"
    readonly accept?: string
    /** What the field holds now (the app decides what an uploaded file is: a url, an id, a list of them). */
    readonly value: unknown
    readonly onChange: (next: unknown) => void
    readonly isReadOnly: boolean
}

export type SchemaFormProps = NoChildren & {
    /** Names the form for assistive technology. */
    readonly label: string
    /** The root of the schema: an object, its `properties` the fields in the order they are drawn. */
    readonly schema: SchemaFormField
    readonly value: SchemaFormValue
    /** The whole value after a change, and the path that changed. The form keeps no copy: the app applies it and passes the new value. */
    readonly onChange: (next: SchemaFormValue, change: { readonly path: SchemaFormPath }) => void
    readonly labels: SchemaFormLabels
    /** The mark of each field by path (see `SchemaFormMark`). A `writing` field is read-only. */
    readonly marks?: Readonly<Record<SchemaFormPath, SchemaFormMark>>
    /** The agent's proposed value for a field, by path: drawn under the field as the difference with Accept and Reject. */
    readonly proposals?: Readonly<Record<SchemaFormPath, unknown>>
    readonly onProposal?: (path: SchemaFormPath, decision: SchemaFormDecision) => void
    /** A limit read against the items of an array, by the array's path. */
    readonly meters?: Readonly<Record<SchemaFormPath, SchemaFormMeter>>
    /** The upload slot for `image` and `file` fields; without it the form draws a `FileDropzone` and hands the chosen files to `onUpload`. */
    readonly upload?: (slot: SchemaFormUploadSlot) => ReactNode
    readonly onUpload?: (path: SchemaFormPath, files: Array<File>) => void
    /** Draws every field as its value in words (the view layout) instead of controls; `editable` lists the exceptions. */
    readonly readOnly?: boolean
    /** Paths of the fields that stay controls inside a read-only form (an approval card with one field to fix). A path of a group or an array opens everything under it. */
    readonly editable?: readonly SchemaFormPath[]
    /** `form` (default): the label over the control. `kv`: the label in a column beside the value or control, the layout of a card of facts. */
    readonly layout?: "form" | "kv"
    /** The required fields left empty are marked (default true). */
    readonly showMissing?: boolean
    /** The values are still arriving: every control draws as the geometry of its ready box, inert. */
    readonly isLoading?: boolean
}

type Context = {
    readonly id: string
    readonly root: SchemaFormValue
    readonly props: SchemaFormProps
    readonly missing: ReadonlySet<SchemaFormPath>
    readonly set: (path: SchemaFormPath, next: unknown) => void
    readonly isEditable: (path: SchemaFormPath) => boolean
}

const titleOf = (field: SchemaFormField, key: string): string => field.title ?? key

const textOf = (value: unknown): string => {
    if (value === undefined || value === null) return ""
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    if (Array.isArray(value)) return value.map(textOf).join(", ")
    return ""
}

const optionsOf = (field: SchemaFormField): readonly { readonly id: string; readonly label: string }[] =>
    field.oneOf !== undefined
        ? field.oneOf.map((choice) => ({ id: String(choice.const), label: choice.title ?? String(choice.const) }))
        : (field.enum ?? []).map((one) => ({ id: String(one), label: String(one) }))

/** The words a choice's stored value is shown as. */
const choiceLabel = (field: SchemaFormField, value: unknown): string => optionsOf(field).find((option) => option.id === String(value))?.label ?? textOf(value)

/** The label of a control: its title with the unit, then the markers (the hand edit, the agent writing). */
const LabelWithMarks = ({ title, unit, mark, labels }: { readonly title: string; readonly unit: string | undefined; readonly mark: SchemaFormMark | undefined; readonly labels: SchemaFormLabels }) => (
    <span className="starci-core-schema-label">
        <span>{unit === undefined ? title : `${title} (${unit})`}</span>
        {mark === "edited" ? (
            <span className="starci-core-schema-mark" data-grammar-schema-mark="edited">
                <Icon source={TablerPencil} usage="text" />
                {labels.edited}
            </span>
        ) : null}
        {mark === "writing" ? (
            <span className="starci-core-schema-mark" data-grammar-schema-mark="writing">
                <TypingDots label={labels.writing} />
                {labels.writing}
            </span>
        ) : null}
    </span>
)

/** The agent's proposed value beside the one now in the field, with the two decisions. */
const Proposal = ({ path, field, current, proposed, ctx }: { readonly path: SchemaFormPath; readonly field: SchemaFormField; readonly current: unknown; readonly proposed: unknown; readonly ctx: Context }) => {
    const { labels, onProposal } = ctx.props
    const shown = (value: unknown) => (kindOf(field) === "choice" ? choiceLabel(field, value) : textOf(value))
    return (
        <div className="starci-core-schema-proposal" role="group" aria-label={labels.proposes} data-grammar-schema-proposal={path}>
            <span className="starci-core-schema-proposal-head">{labels.proposes}</span>
            {isBlank(current) ? null : (
                <p className="starci-core-schema-proposal-line" data-grammar-diff="removed">
                    <span className="starci-core-schema-proposal-name">{labels.current}</span>
                    <del>{shown(current)}</del>
                </p>
            )}
            <p className="starci-core-schema-proposal-line" data-grammar-diff="added">
                <span className="starci-core-schema-proposal-name">{labels.suggested}</span>
                <ins>{shown(proposed)}</ins>
            </p>
            <span className="starci-core-schema-proposal-actions">
                <Button size="sm" onPress={() => onProposal?.(path, "accept")}>{labels.accept}</Button>
                <Button size="sm" onPress={() => onProposal?.(path, "reject")}>{labels.reject}</Button>
            </span>
        </div>
    )
}

/** One leaf field as a control. */
const Control = ({ path, field, title, required, ctx }: { readonly path: SchemaFormPath; readonly field: SchemaFormField; readonly title: string; readonly required: boolean; readonly ctx: Context }) => {
    const { labels, marks, proposals, upload, onUpload, showMissing = true } = ctx.props
    const kind = kindOf(field)
    const mark = marks?.[path]
    const value = valueAt(ctx.root, path)
    const isMissing = showMissing && ctx.missing.has(path)
    const isWriting = mark === "writing"
    const fieldId = `${ctx.id}-${path}`
    const common = {
        label: <LabelWithMarks title={title} unit={field.unit} mark={mark} labels={labels} />,
        isRequired: required,
        isReadOnly: isWriting,
        ...(isMissing ? { description: <span className="starci-core-schema-missing">{labels.missing}</span> } : field.description === undefined ? {} : { description: field.description }),
    }
    let control: ReactNode
    if (kind === "textarea") {
        control = <Textarea {...common} rows={3} value={textOf(value)} onValueChange={(next) => ctx.set(path, next)} {...(field.placeholder === undefined ? {} : { placeholder: field.placeholder })} {...(field.maxLength === undefined ? {} : { maxLength: field.maxLength })} />
    } else if (kind === "number") {
        control = (
            <NumberField
                {...common}
                hideSteppers
                value={typeof value === "number" && Number.isFinite(value) ? value : Number.NaN}
                onValueChange={(next) => ctx.set(path, Number.isFinite(next) ? next : undefined)}
                {...(field.minimum === undefined ? {} : { minValue: field.minimum })}
                {...(field.maximum === undefined ? {} : { maxValue: field.maximum })}
                {...(field.placeholder === undefined ? {} : { placeholder: field.placeholder })}
            />
        )
    } else if (kind === "boolean") {
        control = (
            <Switch
                label={title}
                kind="compact"
                description={field.description ?? ""}
                isSelected={value === true}
                isReadOnly={isWriting}
                onSelectedChange={(next) => ctx.set(path, next)}
            />
        )
    } else if (kind === "choice") {
        control = (
            <Select
                {...common}
                options={[...optionsOf(field)]}
                value={isBlank(value) ? null : String(value)}
                onValueChange={(next) => {
                    const chosen = (field.oneOf ?? []).find((choice) => String(choice.const) === next)?.const ?? (field.enum ?? []).find((one) => String(one) === next)
                    ctx.set(path, chosen ?? next ?? undefined)
                }}
                {...(field.placeholder === undefined ? {} : { placeholder: field.placeholder })}
            />
        )
    } else if (kind === "image" || kind === "file") {
        const slot: SchemaFormUploadSlot = { path, title, kind, ...(field.accept === undefined ? {} : { accept: field.accept }), value, onChange: (next) => ctx.set(path, next), isReadOnly: isWriting }
        control = upload !== undefined ? <div className="starci-core-schema-upload" data-grammar-schema-upload={kind}>{upload(slot)}</div> : (
            <FileDropzone
                label={common.label}
                prompt={labels.uploadPrompt}
                {...(field.accept === undefined ? kind === "image" ? { accept: "image/*" } : {} : { accept: field.accept })}
                onFilesChange={(files) => onUpload?.(path, files)}
                {...(field.description === undefined ? {} : { description: field.description })}
            />
        )
    } else {
        const type: "email" | "tel" | undefined = field.format === "email" ? "email" : field.format === "tel" ? "tel" : undefined
        control = <Input {...common} id={fieldId} name={path} {...(type === undefined ? {} : { kind: type })} value={textOf(value)} onValueChange={(next) => ctx.set(path, next)} {...(field.placeholder === undefined ? {} : { placeholder: field.placeholder })} />
    }
    const proposed = proposals !== undefined && Object.prototype.hasOwnProperty.call(proposals, path) ? proposals[path] : undefined
    return (
        <div
            className="starci-core-schema-field"
            data-grammar-schema-field={path}
            data-grammar-schema-state={isWriting ? "writing" : proposed !== undefined ? "proposed" : isMissing ? "missing" : mark === "edited" ? "edited" : "ready"}
            {...(isWriting ? { "aria-busy": true } : {})}
        >
            {control}
            {proposed === undefined ? null : <Proposal path={path} field={field} current={value} proposed={proposed} ctx={ctx} />}
        </div>
    )
}

/** One field in words: the value as text, or the items of a list. */
const ReadValue = ({ path, field, ctx }: { readonly path: SchemaFormPath; readonly field: SchemaFormField; readonly ctx: Context }) => {
    const { labels } = ctx.props
    const kind = kindOf(field)
    const value = valueAt(ctx.root, path)
    if (kind === "rows" || kind === "list") {
        const rows = Array.isArray(value) ? value : []
        const meter = ctx.props.meters?.[path]
        const properties = Object.entries(field.items?.properties ?? {})
        return (
            <div className="starci-core-schema-read-list">
                {rows.length === 0 ? <span className="starci-core-schema-read-empty">{labels.empty}</span> : (
                    <ol className="starci-core-schema-read-items">
                        {rows.map((row: unknown, index) => (
                            <li key={index}>
                                {kind === "list" ? textOf(row) : properties.map(([key, child], at) => {
                                    const cell = valueAt(row, key)
                                    if (isBlank(cell)) return null
                                    const text = kindOf(child) === "choice" ? choiceLabel(child, cell) : textOf(cell)
                                    return at === 0 ? <Fragment key={key}>{text}</Fragment> : <span key={key} className="starci-core-schema-read-aside"> · {child.unit === undefined ? text : `${text} ${child.unit}`}</span>
                                })}
                            </li>
                        ))}
                    </ol>
                )}
                {meter === undefined ? null : <span className="starci-core-schema-read-total">{meter.reading(sumOf(ctx.root, path, meter.valueKey), meter.max)}</span>}
            </div>
        )
    }
    if (kind === "image" || kind === "file") return <span className="starci-core-schema-read-text">{isBlank(value) ? labels.empty : textOf(value)}</span>
    if (kind === "boolean") return <span className="starci-core-schema-read-text">{value === true ? "✓" : labels.empty}</span>
    const text = kind === "choice" ? choiceLabel(field, value) : textOf(value)
    return <span className="starci-core-schema-read-text" data-grammar-schema-empty={isBlank(value) ? "true" : undefined}>{isBlank(value) ? labels.empty : field.unit === undefined || kind !== "number" ? text : `${text} ${field.unit}`}</span>
}

/** An array of strings or of objects: the items as rows the person adds to, removes and reorders. */
const Rows = ({ path, field, title, ctx }: { readonly path: SchemaFormPath; readonly field: SchemaFormField; readonly title: string; readonly ctx: Context }) => {
    const { labels } = ctx.props
    const items = field.items ?? { type: "string" as const }
    const rows = valueAt(ctx.root, path)
    const list: readonly unknown[] = Array.isArray(rows) ? rows : []
    const meter = ctx.props.meters?.[path]
    const name = items.title ?? field.itemLabel ?? field.items?.itemLabel ?? title
    const itemName = (index: number) => `${field.itemLabel ?? name} ${String(index + 1)}`
    const atMax = field.maxItems !== undefined && list.length >= field.maxItems
    const replace = (next: readonly unknown[]) => ctx.set(path, next)
    const move = (from: number, to: number) => {
        const next = [...list]
        const [picked] = next.splice(from, 1)
        next.splice(to, 0, picked)
        replace(next)
    }
    const sum = meter === undefined ? 0 : sumOf(ctx.root, path, meter.valueKey)
    const columns = Object.values(items.properties ?? {}).map((child) => (kindOf(child) === "number" || kindOf(child) === "choice" || kindOf(child) === "boolean" ? "narrow" : "wide"))
    return (
        <div className="starci-core-schema-rows" data-grammar-schema-rows={path}>
            <div className="starci-core-schema-rows-head">
                <span className="starci-core-schema-rows-title">{title}</span>
            </div>
            {list.length === 0 ? null : (
                <ol className="starci-core-schema-row-list">
                    {list.map((_row, index) => {
                        const at = joinPath(path, index)
                        const mark = ctx.props.marks?.[at]
                        return (
                            <li key={index} className="starci-core-schema-row" data-grammar-schema-row={at} data-grammar-schema-state={mark === "writing" ? "writing" : mark === "edited" ? "edited" : undefined}>
                                <span className="starci-core-schema-row-head">
                                    <span className="starci-core-schema-row-number">{index + 1}</span>
                                    <span className="starci-core-schema-row-name">{itemName(index)}</span>
                                    {mark === "edited" ? <span className="starci-core-schema-mark" data-grammar-schema-mark="edited"><Icon source={TablerPencil} usage="text" />{labels.edited}</span> : null}
                                    <span className="starci-core-schema-row-actions">
                                        <IconButton size="sm" label={labels.moveUp(itemName(index))} source={TablerArrowUp} isDisabled={index === 0} onPress={() => move(index, index - 1)} />
                                        <IconButton size="sm" label={labels.moveDown(itemName(index))} source={TablerArrowDown} isDisabled={index === list.length - 1} onPress={() => move(index, index + 1)} />
                                        <IconButton size="sm" label={labels.remove(itemName(index))} source={TablerTrash} onPress={() => replace(list.filter((_item, other) => other !== index))} />
                                    </span>
                                </span>
                                <div className="starci-core-schema-row-fields" data-grammar-schema-columns={columns.join(" ")}>
                                    {kindOf(items) === "group" ? <Fields parent={at} schema={items} ctx={ctx} /> : <Node path={at} field={items} title={itemName(index)} ctx={ctx} />}
                                </div>
                            </li>
                        )
                    })}
                </ol>
            )}
            <div className="starci-core-schema-rows-foot">
                <Button size="sm" isDisabled={atMax} onPress={() => replace([...list, emptyOf(items) ?? ""])}>
                    {field.addLabel ?? `+ ${name}`}
                </Button>
                {field.maxItems === undefined ? null : <span className="starci-core-schema-rows-limit">{labels.atMost(field.maxItems)}</span>}
            </div>
            {meter === undefined ? null : (
                <div className="starci-core-schema-meter">
                    <Meter label={meter.name} value={Math.min(sum, meter.max)} maxValue={meter.max} valueLabel={meter.reading(sum, meter.max)} tone={sum > meter.max ? "negative" : "foreground"} />
                </div>
            )}
        </div>
    )
}

/** One node of the tree: a group of fields, an array, a value in words (read-only) or a control. */
const Node = ({ path, field, title, required = false, ctx }: { readonly path: SchemaFormPath; readonly field: SchemaFormField; readonly title: string; readonly required?: boolean; readonly ctx: Context }) => {
    const kind = kindOf(field)
    const open = ctx.isEditable(path)
    if (kind === "group") {
        return (
            <fieldset className="starci-core-schema-group" data-grammar-schema-group={path}>
                <legend className="starci-core-schema-group-title">{title}</legend>
                <Fields parent={path} schema={field} ctx={ctx} />
            </fieldset>
        )
    }
    if (!open) {
        return (
            <div className="starci-core-schema-read" data-grammar-schema-read={path}>
                <span className="starci-core-schema-read-title">{title}</span>
                <ReadValue path={path} field={field} ctx={ctx} />
            </div>
        )
    }
    if (kind === "rows" || kind === "list") return <Rows path={path} field={field} title={title} ctx={ctx} />
    return <Control path={path} field={field} title={title} required={required} ctx={ctx} />
}

/** The properties of an object, each as its node. */
const Fields = ({ parent, schema, ctx }: { readonly parent: SchemaFormPath; readonly schema: SchemaFormField; readonly ctx: Context }) => (
    <>
        {Object.entries(schema.properties ?? {}).map(([key, child]) => (
            <Node key={key} path={joinPath(parent, key)} field={child} title={titleOf(child, key)} required={schema.required?.includes(key) === true} ctx={ctx} />
        ))}
    </>
)

/**
 * A form drawn from a schema (a zod schema through `z.toJSONSchema`, or a JSON Schema written by hand): one control per field by its kind (a line, several lines, a number, a switch, a
 * choice, an image or file in an upload slot, a list of lines, a list of rows the person adds to, removes and reorders), the label over the control, and the states of a form that is
 * filled by two hands: a field the person edited carries "You edited" so the agent leaves it alone; a field the agent is writing is read-only and says so; a field the agent proposes a
 * change to shows the difference with Accept and Reject under it; a required field left empty says it is needed. `layout="kv"` with `readOnly` is the card of facts with `editable`
 * fields left as controls. The form keeps no copy of the value: it hands the whole new value to `onChange`, and every word is the app's.
 */
export const SchemaForm = (props: SchemaFormProps) => {
    const { label, schema, value, onChange, readOnly = false, editable = [], layout = "form", isLoading: ownLoading } = props
    const isLoading = useIsLoading(ownLoading)
    const id = useId()
    const missing = new Set(schemaFormMissing(schema, value))
    const ctx: Context = {
        id,
        root: value,
        props,
        missing,
        set: (path, next) => {
            const updated = withValueAt(value, path, next)
            onChange((updated ?? {}) as SchemaFormValue, { path })
        },
        isEditable: (path) => !readOnly || editable.some((open) => path === open || path.startsWith(`${open}.`)),
    }
    return (
        <div
            id={id}
            role="group"
            aria-label={label}
            data-tier="frame"
            data-component="SchemaForm"
            data-contract="FEEDBACK-1 STATE-8"
            className="starci-core-schema-form"
            data-layout={layout}
            {...(readOnly ? { "data-grammar-readonly": "true" } : {})}
            {...(isLoading ? { "aria-busy": true } : {})}
        >
            <LoadingScope isLoading={isLoading}>
                <Fields parent="" schema={schema} ctx={ctx} />
            </LoadingScope>
        </div>
    )
}

