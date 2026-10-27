"use client"

import { useFieldVariant } from "../../surfaceContext.js"
import { useCollectionItemPresentation, type ItemDescriptionLines } from "../../collectionItem.js"
import {
    Description as HeroDescription,
    Label as HeroLabel,
    ListBox as HeroListBox,
    Select as HeroSelect,
    Spinner as HeroSpinner,
    type Key,
} from "@heroui/react"
import { useState, type ReactNode } from "react"
import {
    FieldDescription,
    FieldErrorText,
    FieldLabel,
    FieldSkeletonScope,
    loadingFieldProps,
    fieldVariantAttributes,
    useGrammarPortal,
    vendorFieldProps,
    type FieldControlProps,
} from "../../primitive/Field/index.js"

/** One choice in a list-backed control. `label` is plain text because it is also the typeahead value. */
export type ListOption = {
    readonly id: string
    readonly label: string
    readonly description?: ReactNode
    /** Visible option-description lines (default one). */
    readonly descriptionLines?: ItemDescriptionLines
    readonly isDisabled?: boolean
}

export type SelectProps = FieldControlProps & {
    readonly options: ReadonlyArray<ListOption>
    readonly placeholder?: string
    readonly value?: string | null
    readonly defaultValue?: string | null
    readonly onValueChange?: (value: string | null) => void
    /** Options are still arriving. The trigger stays named and focusable, announces pending, and does not open. */
    readonly isPending?: boolean
    /**
     * Initial unresolved content (knowledge STATE-8), with skeleton parity: the ready anatomy at the same props (label,
     * description, control box, options) inside an inert, `aria-busy` scope, its control box painted as a Skeleton and its
     * value or mark not drawn, so the loading field keeps the ready box. Nothing is invalid or pending while it loads.
     */
    readonly isSkeleton?: boolean
    /** Defaults to `secondary` inside a Grammar surface and `primary` outside (ANATOMY-2 case-1). */
    readonly variant?: "primary" | "secondary"
}

const toValue = (key: Key | null): string | null => (key === null ? null : String(key))

/**
 * Renders the options as HeroUI list-box items: a `Label`, a `Description` under it when the option has one (both in one column,
 * the only Grammar element, which lays out and paints nothing), then the vendor item indicator.
 */
export const ListOptions = ({ options }: { readonly options: ReadonlyArray<ListOption> }) => {
    const presentation = useCollectionItemPresentation()
    return (
    <>
        {options.map((option) => (
            <HeroListBox.Item
                key={option.id}
                id={option.id}
                aria-label={option.label}
                textValue={option.label}
                isDisabled={option.isDisabled === true}
                className="starci-core-list-option"
                data-grammar-option="true"
            >
                {option.description == null ? <HeroLabel>{option.label}</HeroLabel> : (
                    <div data-grammar-option-copy="true">
                        <HeroLabel>{option.label}</HeroLabel>
                        <HeroDescription data-grammar-item-description="true" data-grammar-description-lines={option.descriptionLines ?? presentation.descriptionLines}>{option.description}</HeroDescription>
                    </div>
                )}
                <HeroListBox.ItemIndicator />
            </HeroListBox.Item>
        ))}
    </>
    )
}

/*
 * Anatomy and look are HeroUI's own: `Select.Trigger` holding `Select.Value` and `Select.Indicator`, `Select.Popover` holding a
 * `ListBox` of items. The Grammar class names (`starci-core-select`, `-select-trigger`, `-select-indicator`, `-list-popover`,
 * `-list`) are stamps a consumer or family stylesheet selects. Grammar sets the trigger's shared 2.5rem field-height floor to match Input
 * (owner 2026-10-25), and the larger touch-target floor on a coarse pointer.
 */

/**
 * Skeleton parity (knowledge STATE-8): `isSkeleton` renders the ready anatomy at the same props inside
 * `FieldSkeletonScope` (inert, `aria-busy`, control box painted as a Skeleton), so the loading field keeps the ready box.
 */
export const Select = ({ isSkeleton = false, ...props }: SelectProps) => isSkeleton
    ? <FieldSkeletonScope component="Select"><SelectControl {...loadingFieldProps(props)} /></FieldSkeletonScope>
    : <SelectControl {...props} />

/**
 * A single choice from a closed list, opened from a field-shaped trigger.
 *
 * Keyboard, typeahead, listbox semantics and focus return are the vendor's. Read-only keeps the
 * trigger focusable and announced but holds the value and never opens the list; the vendor select
 * has no read-only mode of its own.
 */
const SelectControl = ({
    options,
    placeholder,
    value,
    defaultValue,
    onValueChange,
    isPending = false,
    variant: requestedVariant,
    ...field
}: Omit<SelectProps, "isSkeleton">) => {
    const variant = useFieldVariant(requestedVariant)
    const [heldValue] = useState<string | null>(value ?? defaultValue ?? null)
    const { anchor, portalProps } = useGrammarPortal()
    const readOnly = field.isReadOnly === true
    const selection = readOnly
        ? { value: value === undefined ? heldValue : value }
        : value === undefined ? defaultValue === undefined ? {} : { defaultValue } : { value }


    return (
        <HeroSelect
            data-tier="branch"
            data-component="Select"
            data-contract="A11Y-1 STATE-1 STATE-6"
            className="starci-core-select"
            fullWidth
            variant={variant}
            {...fieldVariantAttributes(variant)}
            {...vendorFieldProps({ ...field, isPending })}
            {...(placeholder === undefined ? {} : { placeholder })}
            {...selection}
            {...(readOnly ? { isOpen: false } : {})}
            onChange={(key: Key | null) => {
                if (!readOnly) {
                    onValueChange?.(toValue(key))
                }
            }}
        >
            {anchor}
            <FieldLabel isHidden={field.isLabelHidden} isRequired={field.isRequired}>{field.label}</FieldLabel>
            <HeroSelect.Trigger
                className="starci-core-select-trigger"
                data-grammar-field-control="true"
                isPending={isPending}
            >
                <HeroSelect.Value />
                {isPending
                    ? <HeroSpinner size="sm" color="current" aria-hidden="true" className="starci-core-field-spinner" />
                    : <HeroSelect.Indicator className="starci-core-select-indicator" />}
            </HeroSelect.Trigger>
            <FieldDescription>{field.description}</FieldDescription>
            <FieldErrorText>{field.errorMessage}</FieldErrorText>
            <HeroSelect.Popover className="starci-core-list-popover" data-grammar-popover="Select" data-contract="LAYOUT-4" {...portalProps}>
                <HeroListBox className="starci-core-list">
                    <ListOptions options={options} />
                </HeroListBox>
            </HeroSelect.Popover>
        </HeroSelect>
    )
}
