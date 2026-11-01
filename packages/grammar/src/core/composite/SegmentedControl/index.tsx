"use client"

import { ToggleButton as HeroToggleButton, ToggleButtonGroup as HeroToggleButtonGroup, type Key } from "@heroui/react"
import { useId, useState, type ReactNode } from "react"
import { fieldStateAttributes, StaticFieldError, FieldSkeletonScope, loadingFieldProps, isFieldInvalid, type FieldControlProps } from "../../leaf/Field/index.js"
import type { NoChildren } from "../../tier.js"

export type SegmentOption = {
    readonly value: string
    readonly label: ReactNode
    /** Required when `label` is an icon only. */
    readonly accessibleLabel?: string
    readonly isDisabled?: boolean
}

export type SegmentedControlSize = "sm" | "md"

export type SegmentedControlProps = NoChildren & FieldControlProps & {
    readonly options: ReadonlyArray<SegmentOption>
    readonly value?: string
    readonly defaultValue?: string
    readonly onValueChange?: (value: string) => void
    /** `fill` stretches the segments across the parent. */
    readonly width?: "content" | "fill"
    /** `md` (default) or `sm` for a control nested in an item or a dense toolbar: HeroUI's own ToggleButtonGroup sizes. */
    readonly size?: SegmentedControlSize
    /**
     * Initial unresolved content (knowledge STATE-8), with skeleton parity: the ready anatomy at the same props (label,
     * description, control box, options) inside an inert, `aria-busy` scope, its control box painted as a Skeleton and its
     * value or mark not drawn, so the loading field keeps the ready box. Nothing is invalid or pending while it loads.
     */
    readonly isLoading?: boolean
}

const firstKey = (keys: Iterable<Key>): string | undefined => {
    const first = keys[Symbol.iterator]().next()
    return first.done ? undefined : String(first.value)
}

/**
 * Skeleton parity (knowledge STATE-8): `isLoading` renders the ready anatomy at the same props inside
 * `FieldSkeletonScope` (inert, `aria-busy`, control box painted as a Skeleton), so the loading field keeps the ready box.
 */
export const SegmentedControl = ({ isLoading = false, ...props }: SegmentedControlProps) => isLoading
    ? <FieldSkeletonScope component="SegmentedControl"><SegmentedControlControl {...loadingFieldProps(props)} /></FieldSkeletonScope>
    : <SegmentedControlControl {...props} />

/**
 * One-of-few choice drawn as joined segments (a toggle-button group in single-selection mode, so it
 * is announced as a radio group). A segment is never deselected by pressing it again. With `name`,
 * the selected value is submitted through a hidden input so it works inside a Form.
 */
const SegmentedControlControl = ({
    options,
    value,
    defaultValue,
    onValueChange,
    width = "content",
    size = "md",
    label,
    isLabelHidden,
    description,
    errorMessage,
    isInvalid,
    isRequired,
    isDisabled,
    isReadOnly,
    name,
}: Omit<SegmentedControlProps, "isLoading">) => {
    const id = useId().replaceAll(":", "")
    const [held, setHeld] = useState<string | undefined>(value ?? defaultValue ?? options[0]?.value)
    const selected = value ?? held
    const invalid = isFieldInvalid({ isInvalid, errorMessage })
    const labelId = `segmented${id}-label`
    const descriptionId = description == null ? undefined : `segmented${id}-description`
    const errorId = invalid && errorMessage != null ? `segmented${id}-error` : undefined
    const describedBy = [descriptionId, errorId].filter((part) => part !== undefined).join(" ")


    return (
        <div
            data-tier="composite"
            data-component="SegmentedControl"
            data-contract="A11Y-1 FEEDBACK-1"
            data-width={width}
            data-grammar-segmented-size={size}
            className="starci-core-field starci-core-segmented-control"
            {...fieldStateAttributes({ isInvalid: invalid, isDisabled, isReadOnly, isRequired })}
        >
            <span
                id={labelId}
                className={isLabelHidden === true ? "starci-core-field-label starci-core-form-label--screen-reader" : "starci-core-field-label"}
                data-grammar-field-label="true"
            >
                {label}
            </span>
            <HeroToggleButtonGroup
                aria-labelledby={labelId}
                {...(describedBy === "" ? {} : { "aria-describedby": describedBy })}
                selectionMode="single"
                disallowEmptySelection
                fullWidth={width === "fill"}
                size={size}
                {...(isDisabled === true ? { isDisabled: true } : {})}
                selectedKeys={selected === undefined ? [] : [selected]}
                onSelectionChange={(keys) => {
                    const next = firstKey(keys)
                    if (isReadOnly === true || next === undefined) return
                    setHeld(next)
                    onValueChange?.(next)
                }}
                className="starci-core-segmented-control-group"
                data-grammar-field-control="true"
                data-contract="STATE-6 FOCUS-2"
            >
                {options.map((option) => (
                    <HeroToggleButton
                        key={option.value}
                        id={option.value}
                        isDisabled={option.isDisabled === true}
                        className="starci-core-segment"
                        data-grammar-option="true"
                        {...(option.accessibleLabel === undefined ? {} : { "aria-label": option.accessibleLabel })}
                    >
                        {option.label}
                    </HeroToggleButton>
                ))}
            </HeroToggleButtonGroup>
            {name === undefined || selected === undefined ? null : <input type="hidden" name={name} value={selected} />}
            {descriptionId === undefined ? null : (
                <span id={descriptionId} className="starci-core-field-description" data-grammar-field-description="true">{description}</span>
            )}
            {errorId === undefined ? null : (
                <StaticFieldError id={errorId}>{errorMessage}</StaticFieldError>
            )}
        </div>
    )
}
