"use client"

import { useRegionOwnsBusy, withRegionLoading } from "../../regionScope.js"
import {
    Description as HeroDescription,
    FieldError as HeroFieldError,
    Label as HeroLabel,
    Skeleton as HeroSkeleton,
} from "@heroui/react"
import { FieldErrorContext } from "react-aria-components/FieldError"
import { useCallback, useId, useState, type ReactNode } from "react"
import type { PresentationState } from "../../../common/state.js"
import type { NoChildren } from "../../tier.js"

/**
 * The one field contract every Grammar form control shares.
 *
 * A control owns its label, its guidance and its validation copy, so a reader never meets a control
 * whose error is painted somewhere the screen reader cannot find. Every form control in the package
 * takes these props, renders the same label / description / error anatomy, and stamps the same
 * `data-grammar-*` state hooks on its root, so a visual family targets one vocabulary instead of one
 * per vendor part.
 */
export type FieldControlProps = {
    /** The visible accessible name. Required: a placeholder is never a name. */
    readonly label: ReactNode
    /** Keeps the label for assistive technology only; the name stays in the accessibility tree. */
    readonly isLabelHidden?: boolean
    /** Guidance the control's `aria-describedby` points at. */
    readonly description?: ReactNode
    /** Validation copy. Supplying it marks the control invalid, the same rule `Input` follows. */
    readonly errorMessage?: ReactNode
    readonly isInvalid?: boolean
    readonly isRequired?: boolean
    readonly isDisabled?: boolean
    readonly isReadOnly?: boolean
    /** The form field name submitted with the value. */
    readonly name?: string
    /** In a `Grid kind="form"` (`FormGrid`): `full` makes the field stand alone on its own row across every column (a note, an address). The control itself ignores it. */
    readonly span?: "full"
}

export type FieldStateInput = {
    readonly isInvalid?: boolean | undefined
    readonly isDisabled?: boolean | undefined
    readonly isReadOnly?: boolean | undefined
    readonly isRequired?: boolean | undefined
    readonly isPending?: boolean | undefined
}

/** Folds the control's state into the render-neutral presentation vocabulary. */
export const fieldPresentationState = ({ isInvalid, isDisabled, isPending }: FieldStateInput): PresentationState => {
    if (isDisabled === true) return "unavailable"
    if (isPending === true) return "pending"
    if (isInvalid === true) return "negative"
    return "neutral"
}

const flag = (value: boolean | undefined) => (value === true ? "true" : "false")

/** The state hooks every form control root carries. Families read these, never vendor internals. */
export const fieldStateAttributes = (state: FieldStateInput) => ({
    "data-grammar-field": "true",
    "data-grammar-field-state": fieldPresentationState(state),
    "data-grammar-invalid": flag(state.isInvalid),
    "data-grammar-disabled": flag(state.isDisabled),
    "data-grammar-readonly": flag(state.isReadOnly),
    "data-grammar-required": flag(state.isRequired),
    "data-grammar-pending": flag(state.isPending),
}) as const

/** A control is invalid when it says so or when it carries validation copy. */
export const isFieldInvalid = ({ isInvalid, errorMessage }: {
    readonly isInvalid?: boolean | undefined
    readonly errorMessage?: ReactNode
}) =>
    isInvalid === true || errorMessage != null

const labelClassName = (isHidden: boolean | undefined) =>
    isHidden === true ? "starci-core-field-label starci-core-form-label--screen-reader" : "starci-core-field-label"

/** Label wired through the vendor's field context, so the control is named without an id handshake. */
export const FieldLabel = ({ children, isHidden, isRequired }: {
    readonly children: ReactNode
    readonly isHidden?: boolean | undefined
    readonly isRequired?: boolean | undefined
}) => (
    <HeroLabel
        className={labelClassName(isHidden)}
        data-grammar-field-label="true"
        {...(isRequired === true ? { isRequired: true } : {})}
    >
        {children}
    </HeroLabel>
)

/** Description slot; the vendor wires it into the control's `aria-describedby`. */
export const FieldDescription = ({ children }: { readonly children?: ReactNode }) => (children == null ? null : (
    <HeroDescription className="starci-core-field-description" data-grammar-field-description="true">
        {children}
    </HeroDescription>
))

/**
 * Error slot. It shows the supplied copy, or - when none is supplied - the messages the control's
 * own validation produced (a required value, a native constraint, a Form `validationErrors` entry),
 * and is referenced by the control's `aria-describedby` only while the control is invalid.
 */
export const FieldErrorText = ({ children }: { readonly children?: ReactNode }) => (
    <HeroFieldError className="starci-core-field-error" data-grammar-field-error="true" data-contract="FEEDBACK-1">
        {(validation) => children ?? validation.validationErrors.join(" ")}
    </HeroFieldError>
)

const INVALID_NOW = Object.freeze({
    isInvalid: true,
    validationErrors: [] as string[],
    validationDetails: Object.freeze({
        badInput: false, customError: true, patternMismatch: false, rangeOverflow: false, rangeUnderflow: false,
        stepMismatch: false, tooLong: false, tooShort: false, typeMismatch: false, valueMismatch: false, valueMissing: false, valid: false,
    }),
})

/**
 * HeroUI's FieldError for a control that is not a react-aria field (a custom group, a dropzone, a fieldset): the same vendor part and
 * styling as `FieldErrorText`, mounted on an always-invalid context because its caller only renders it while the control is invalid.
 * `id` is the id the control's `aria-describedby` references.
 */
export const StaticFieldError = ({ id, children }: { readonly id: string, readonly children?: ReactNode }) => (
    <FieldErrorContext.Provider value={INVALID_NOW}>
        <HeroFieldError id={id} className="starci-core-field-error" data-grammar-field-error="true" data-contract="FEEDBACK-1">{children}</HeroFieldError>
    </FieldErrorContext.Provider>
)

/**
 * The compact step of a single-line field: `sm` is 32px (a picker in a list head or a toolbar), `md` (default) the 40px field. One step for
 * Input, Select, ComboBox, SearchField and NumberField; it keeps the hidden label, the region loading box and every state.
 */
export type FieldSizeProps = { readonly size?: "md" | "sm" }

/** The shared anatomy props every vendor field root gets. */
export const vendorFieldProps = (props: FieldControlProps & FieldSizeProps & { readonly isPending?: boolean | undefined }) => {
    const invalid = isFieldInvalid(props)
    // Only a true state is stated: an explicit `false` would override what a Fieldset (disabled) or a
    // Form (`validationErrors`) hands the control through the vendor's context.
    return {
        ...(invalid ? { isInvalid: true } : {}),
        ...(props.isDisabled === true ? { isDisabled: true } : {}),
        ...(props.isRequired === true ? { isRequired: true } : {}),
        ...(props.name === undefined ? {} : { name: props.name }),
        ...(props.size === "sm" ? { "data-grammar-field-size": "sm" } : {}),
        ...fieldStateAttributes({
            isInvalid: invalid,
            isDisabled: props.isDisabled,
            isReadOnly: props.isReadOnly,
            isRequired: props.isRequired,
            isPending: props.isPending,
        }),
    }
}

/**
 * Keeps a control's popover inside the Grammar root it was rendered in.
 *
 * The vendor portals popovers to `document.body`, which is outside `.grammar-common-root`: the
 * family's scoped variables (accent, field paint, radii) and scoped rules would not reach the open
 * list or calendar, so a Core or Offset Pop picker would open onto the vendor's default theme. The
 * anchor finds the nearest root once mounted and the popover portals there instead; with no root
 * (bare usage) nothing changes.
 */
export const useGrammarPortal = () => {
    const [container, setContainer] = useState<Element | undefined>(undefined)
    const anchor = useCallback((node: HTMLElement | null) => {
        setContainer(node?.closest(".grammar-common-root") ?? undefined)
    }, [])
    return {
        anchor: <span ref={anchor} hidden data-grammar-portal-anchor="true" />,
        portalProps: container === undefined ? {} : { UNSTABLE_portalContainer: container },
    }
}

/** What `Field` hands the control it wraps: the id and ARIA wiring for a native or custom control. */
export type FieldControlAttributes = {
    readonly id: string
    readonly name?: string
    readonly "aria-describedby"?: string
    readonly "aria-invalid"?: true
    readonly "aria-required"?: true
    readonly required?: true
    readonly disabled?: true
    readonly readOnly?: true
}

export type FieldProps = NoChildren & FieldControlProps & {
    /** Control id. Generated when omitted. */
    readonly id?: string
    /** Renders the control with the attributes that bind it to this field's label, guidance and error. */
    readonly control: (attributes: FieldControlAttributes) => ReactNode
    /** Initial unresolved content (knowledge STATE-8): the same anatomy, inert, its control box painted as a Skeleton. */
    readonly isLoading?: boolean
}

/**
 * Label, control, description and error, in HeroUI's field order, for ANY control: a native element, a third-party
 * widget, or an app's own input. Grammar's own form controls already render this anatomy; `Field` is the same anatomy
 * for everything else, with the id and `aria-describedby` / `aria-invalid` wiring handed to the
 * control so a custom control is announced exactly like a Grammar one.
 */
const FieldInner = ({ isLoading = false, ...props }: FieldProps) => isLoading
    ? <FieldSkeletonScope component="Field" field={props} control={{ kind: "field" }} />
    : <FieldControl {...props} />

const FieldControl = ({
    id: idProp,
    label,
    isLabelHidden,
    description,
    errorMessage,
    isInvalid,
    isRequired,
    isDisabled,
    isReadOnly,
    name,
    control,
}: FieldProps) => {
    const generated = useId()
    const id = idProp ?? `field${generated.replaceAll(":", "")}`
    const invalid = isFieldInvalid({ isInvalid, errorMessage })
    const descriptionId = description == null ? undefined : `${id}-description`
    const errorId = invalid && errorMessage != null ? `${id}-error` : undefined
    const describedBy = [descriptionId, errorId].filter((part) => part !== undefined).join(" ")

    return (
        <div
            data-tier="leaf"
            data-component="Field"
            data-contract="A11Y-1 FEEDBACK-1"
            className="starci-core-field"
            {...fieldStateAttributes({ isInvalid: invalid, isDisabled, isReadOnly, isRequired })}
        >
            <label
                htmlFor={id}
                className={labelClassName(isLabelHidden)}
                data-grammar-field-label="true"
                data-required={isRequired === true ? "true" : undefined}
            >
                {label}
                {isRequired === true ? <span aria-hidden="true" className="starci-core-field-required">*</span> : null}
            </label>
            <div className="starci-core-field-control" data-grammar-field-control="true">
                {control({
                    id,
                    ...(name === undefined ? {} : { name }),
                    ...(describedBy === "" ? {} : { "aria-describedby": describedBy }),
                    ...(invalid ? { "aria-invalid": true } : {}),
                    ...(isRequired === true ? { "aria-required": true, required: true } : {}),
                    ...(isDisabled === true ? { disabled: true } : {}),
                    ...(isReadOnly === true ? { readOnly: true } : {}),
                })}
            </div>
            {description == null ? null : (
                <span id={descriptionId} className="starci-core-field-description" data-grammar-field-description="true">
                    {description}
                </span>
            )}
            {errorId === undefined ? null : (
                <StaticFieldError id={errorId}>{errorMessage}</StaticFieldError>
            )}
        </div>
    )
}

/** The control part of a loading field: the box it stands for, as HeroUI Skeleton shapes. */
export type FieldSkeletonControl =
    /** A 40px field box: an input, a select, a date, a number, a search, a combo box, a copy field, a pressable field. `rows` > 1: a text area of that many lines. */
    | { readonly kind: "field"; readonly rows?: number }
    /** A Switch track at the end of its row: `compact` 32x18 or `toggle` 72x40. */
    | { readonly kind: "switch"; readonly size: "compact" | "toggle" }
    /** A Checkbox: its box beside its label line. */
    | { readonly kind: "check" }
    /** A list of choices (radio, checkbox group): `count` rows of a mark and a line. */
    | { readonly kind: "choices"; readonly count: number }
    /** A row of chips or buttons (ChoiceChips, ChoiceButtons, TagGroup): `count` pills. */
    | { readonly kind: "pills"; readonly count: number }
    /** A row of small boxes (Rating stars, OTP cells): `count` of them. */
    | { readonly kind: "marks"; readonly count: number }
    /** A Slider track. */
    | { readonly kind: "slider" }
    /** A drop zone's box. */
    | { readonly kind: "zone" }

/** The width bucket of a text line skeleton: about the length of the words it stands for. */
const lengthOf = (text: unknown): "s" | "m" | "l" => {
    const length = typeof text === "string" ? text.length : 24
    return length <= 12 ? "s" : length <= 28 ? "m" : "l"
}

const Bone = ({ part, length }: { readonly part: string; readonly length?: "s" | "m" | "l" }) => (
    <HeroSkeleton animationType="shimmer" className="starci-core-skeleton starci-core-field-skeleton-bone" data-part={part} {...(length === undefined ? {} : { "data-length": length })} />
)

const controlBones = (control: FieldSkeletonControl): ReactNode => {
    switch (control.kind) {
    case "field":
        return <Bone part={control.rows !== undefined && control.rows > 1 ? "area" : "field"} />
    case "switch":
        return <Bone part={control.size === "compact" ? "switch-compact" : "switch-toggle"} />
    case "check":
        return <Bone part="check" />
    case "choices":
        return Array.from({ length: Math.max(1, control.count) }, (_, index) => (
            <span key={index} className="starci-core-field-skeleton-choice"><Bone part="check" /><Bone part="line" length="m" /></span>
        ))
    case "pills":
        return Array.from({ length: Math.max(1, control.count) }, (_, index) => <Bone key={index} part="pill" />)
    case "marks":
        return Array.from({ length: Math.max(1, control.count) }, (_, index) => <Bone key={index} part="mark" />)
    case "slider":
        return <Bone part="slider" />
    case "zone":
        return <Bone part="zone" />
    }
}

/**
 * Loading view of a form control (knowledge STATE-8; owner, 2026-11-21: "ý là đơn giản code ske là if else, if trả về Skeleton của heroui thôi chứ không đi sửa màu hay gì"
 * and "không có plain text như label -> ske nốt"). A loading control is `isLoading ? <FieldSkeletonScope … /> : <Control … />`: this draws HeroUI's own Skeleton as shipped,
 * in the field's anatomy, and nothing real. The label, the description and the control are each a Skeleton shape of about their size (a label line, a 40px field box,
 * a Switch track at its kind's size, a check box beside a line, choice rows, pills, marks, a slider track, a drop zone), with one fill, no border, no ring and no tone.
 * The parts keep the field's slots (`data-slot="label"`, `data-grammar-field-control`, `data-grammar-field-description`), so a form grid places them as it places a ready
 * field. The root is `inert`; inside a loading region the region carries the one `aria-busy`, a field loading on its own flag carries it itself.
 */
export const FieldSkeletonScope = ({ component, field, control }: { readonly component: string; readonly field: { readonly label?: unknown; readonly isLabelHidden?: boolean; readonly description?: unknown }; readonly control: FieldSkeletonControl }) => {
    const regionBusy = useRegionOwnsBusy()
    const hasLabel = field.label !== undefined && field.label !== null && field.label !== "" && field.isLabelHidden !== true
    const hasDescription = field.description !== undefined && field.description !== null && field.description !== ""
    const isRow = control.kind === "switch" || control.kind === "check"
    const label = hasLabel ? <span className="starci-core-field-skeleton-label" data-slot="label"><Bone part="line" length={lengthOf(field.label)} /></span> : null
    const description = hasDescription ? <span className="starci-core-field-skeleton-description" data-grammar-field-description="true"><Bone part="line" length={lengthOf(field.description)} /></span> : null
    const box = <div className="starci-core-field-skeleton-control" data-grammar-field-control="true" data-kind={control.kind}>{controlBones(control)}</div>
    return (
        <div
            className="starci-core-field starci-core-field-skeleton"
            data-component={component}
            data-grammar-skeleton-of={component}
            data-grammar-field-skeleton="true"
            data-grammar-skeleton="true"
            data-loading="true"
            data-row={isRow ? "true" : undefined}
            data-contract="A11Y-1 STATE-8"
            aria-hidden={regionBusy ? "true" : undefined}
            {...(regionBusy ? {} : { "aria-busy": "true" })}
            inert
        >
            {isRow
                ? <>{control.kind === "check" ? box : null}<span className="starci-core-field-skeleton-text">{label}{description}</span>{control.kind === "switch" ? box : null}</>
                : <>{label}{box}{description}</>}
        </div>
    )
}

/** What a loading control drops from its props: nothing is invalid, in error or pending while it loads. */
export const loadingFieldProps = <P extends object>(props: P): P =>
    ({ ...props, errorMessage: undefined, isInvalid: undefined, isError: undefined, isPending: undefined }) as P

/**
 * Label, control, description and error, in HeroUI's field order, for ANY control: a native element, a third-party
 * widget, or an app's own input. Grammar's own form controls already render this anatomy; `Field` is the same anatomy
 * for everything else, with the id and `aria-describedby` / `aria-invalid` wiring handed to the
 * control so a custom control is announced exactly like a Grammar one.
 */
export const Field = withRegionLoading(FieldInner)
