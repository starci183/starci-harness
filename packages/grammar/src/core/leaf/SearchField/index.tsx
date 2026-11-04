"use client"

import { withRegionLoading } from "../../regionScope.js"
import { useFieldVariant } from "../../surfaceContext.js"
import { SearchField as HeroSearchField, Spinner as HeroSpinner } from "@heroui/react"
import type { ClipboardEvent } from "react"
import {
    FieldDescription,
    FieldErrorText,
    FieldLabel,
    FieldSkeletonScope,
    loadingFieldProps,
    fieldVariantAttributes,
    vendorFieldProps,
    type FieldControlProps,
} from "../Field/index.js"
import type { NoChildren } from "../../tier.js"

export type SearchFieldProps = NoChildren & FieldControlProps & {
    readonly id?: string
    readonly placeholder?: string
    readonly value?: string
    readonly defaultValue?: string
    readonly onValueChange?: (value: string) => void
    /** Enter in the field. */
    readonly onSubmit?: (value: string) => void
    /** The clear button or Escape emptied the field. */
    readonly onClear?: () => void
    /** Results for the current query are loading. The field stays editable. */
    readonly isPending?: boolean
    /** Accessible name of the clear button. Pass the app's localized "clear" copy. */
    readonly clearLabel?: string
    /**
     * Initial unresolved content (knowledge STATE-8), with skeleton parity: the ready anatomy at the same props (label,
     * description, control box, options) inside an inert, `aria-busy` scope, its control box painted as a Skeleton and its
     * value or mark not drawn, so the loading field keeps the ready box. Nothing is invalid or pending while it loads.
     */
    readonly isLoading?: boolean
    /** Focus left the input. */
    readonly onBlur?: () => void
    /** The native paste event of the input. */
    readonly onPaste?: (event: ClipboardEvent<HTMLInputElement>) => void
    /** Focuses the input when it mounts. */
    readonly autoFocus?: boolean
}

/*
 * Consumer hook: `starci-core-search-field` names this control's root for a consumer or family
 * stylesheet. No shipped sheet paints it: the root is drawn as a whole by `.starci-core-field`, so
 * a rule on the hook adds to the shared anatomy and never has to replace it.
 */

/**
 * Skeleton parity (knowledge STATE-8): `isLoading` renders the ready anatomy at the same props inside
 * `FieldSkeletonScope` (inert, `aria-busy`, control box painted as a Skeleton), so the loading field keeps the ready box.
 */
const SearchFieldInner = ({ isLoading = false, ...props }: SearchFieldProps) => isLoading
    ? <FieldSkeletonScope component="SearchField"><SearchFieldControl {...loadingFieldProps(props)} /></FieldSkeletonScope>
    : <SearchFieldControl {...props} />

/**
 * A text field whose job is a query: `type="search"`, a clear button, Escape to clear, Enter to
 * submit - all the vendor's. The leading glyph is decoration; the label is the name.
 */
const SearchFieldControl = ({
    id,
    placeholder,
    value,
    defaultValue,
    onValueChange,
    onSubmit,
    onClear,
    isPending = false,
    clearLabel,
    onBlur,
    onPaste,
    autoFocus = false,
    ...field
}: Omit<SearchFieldProps, "isLoading">) => {
    const variant = useFieldVariant()
    return (
        <HeroSearchField
            data-tier="leaf"
            data-component="SearchField"
            data-contract="A11Y-1 FEEDBACK-1 STATE-1"
            className="starci-core-field starci-core-search-field"
            fullWidth
            variant={variant}
            {...fieldVariantAttributes(variant)}
            {...vendorFieldProps({ ...field, isPending })}
            isReadOnly={field.isReadOnly === true}
            {...(value === undefined ? defaultValue === undefined ? {} : { defaultValue } : { value })}
            {...(onValueChange === undefined ? {} : { onChange: onValueChange })}
            {...(onSubmit === undefined ? {} : { onSubmit })}
            {...(onClear === undefined ? {} : { onClear })}
        >
            <FieldLabel isHidden={field.isLabelHidden} isRequired={field.isRequired}>{field.label}</FieldLabel>
            <HeroSearchField.Group className="starci-core-search-field-group" data-grammar-field-control="true">
                <HeroSearchField.SearchIcon aria-hidden="true" />
                <HeroSearchField.Input
                    {...(id === undefined ? {} : { id })}
                    {...(placeholder === undefined ? {} : { placeholder })}
                    className="starci-core-search-field-input"
                    {...(autoFocus ? { autoFocus: true } : {})}
                    {...(onBlur === undefined ? {} : { onBlur: () => onBlur() })}
                    {...(onPaste === undefined ? {} : { onPaste })}
                    {...(isPending ? { "aria-busy": true } : {})}
                />
                {isPending ? <HeroSpinner size="sm" color="current" aria-hidden="true" className="starci-core-field-spinner" /> : null}
                <HeroSearchField.ClearButton
                    className="starci-core-search-field-clear"
                    {...(clearLabel === undefined ? {} : { "aria-label": clearLabel })}
                />
            </HeroSearchField.Group>
            <FieldDescription>{field.description}</FieldDescription>
            <FieldErrorText>{field.errorMessage}</FieldErrorText>
        </HeroSearchField>
    )
}

/**
 * Skeleton parity (knowledge STATE-8): `isLoading` renders the ready anatomy at the same props inside
 * `FieldSkeletonScope` (inert, `aria-busy`, control box painted as a Skeleton), so the loading field keeps the ready box.
 */
export const SearchField = withRegionLoading(SearchFieldInner)
