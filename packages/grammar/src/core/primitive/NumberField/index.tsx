"use client"

import { useFieldVariant } from "../../surfaceContext.js"
import { NumberField as HeroNumberField } from "@heroui/react"
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

export type NumberFieldProps = FieldControlProps & {
    readonly id?: string
    readonly placeholder?: string
    readonly value?: number
    readonly defaultValue?: number
    readonly onValueChange?: (value: number) => void
    readonly minValue?: number
    readonly maxValue?: number
    readonly step?: number
    /** Locale-aware display, e.g. `{ style: "percent" }` or a currency. */
    readonly formatOptions?: Intl.NumberFormatOptions
    /** Hides the stepper buttons; arrow keys, Page Up/Down and Home/End still step. */
    readonly hideSteppers?: boolean
    /** Defaults to `secondary` inside a Grammar surface and `primary` outside (ANATOMY-2 case-1). */
    readonly variant?: "primary" | "secondary"
    /**
     * Initial unresolved content (knowledge STATE-8), with skeleton parity: the ready anatomy at the same props (label,
     * description, control box, options) inside an inert, `aria-busy` scope, its control box painted as a Skeleton and its
     * value or mark not drawn, so the loading field keeps the ready box. Nothing is invalid or pending while it loads.
     */
    readonly isSkeleton?: boolean
}

/*
 * Consumer hook: `starci-core-number-field` names this control's root for a consumer or family
 * stylesheet. No shipped sheet paints it: the root is drawn as a whole by `.starci-core-field`, so
 * a rule on the hook adds to the shared anatomy and never has to replace it.
 */

/**
 * Skeleton parity (knowledge STATE-8): `isSkeleton` renders the ready anatomy at the same props inside
 * `FieldSkeletonScope` (inert, `aria-busy`, control box painted as a Skeleton), so the loading field keeps the ready box.
 */
export const NumberField = ({ isSkeleton = false, ...props }: NumberFieldProps) => isSkeleton
    ? <FieldSkeletonScope component="NumberField"><NumberFieldControl {...loadingFieldProps(props)} /></FieldSkeletonScope>
    : <NumberFieldControl {...props} />

/**
 * A number with stepping. The vendor owns `role="spinbutton"`-equivalent semantics on the input,
 * locale parsing, arrow-key and wheel stepping, clamping to min/max and the localized stepper names.
 */
const NumberFieldControl = ({
    id,
    placeholder,
    value,
    defaultValue,
    onValueChange,
    minValue,
    maxValue,
    step,
    formatOptions,
    hideSteppers = false,
    variant: requestedVariant,
    ...field
}: Omit<NumberFieldProps, "isSkeleton">) => {
    const variant = useFieldVariant(requestedVariant)
    return (
        <HeroNumberField
            data-tier="atom"
            data-component="NumberField"
            data-contract="A11Y-1 FEEDBACK-1 STATE-1"
            className="starci-core-field starci-core-number-field"
            fullWidth
            variant={variant}
            {...fieldVariantAttributes(variant)}
            {...vendorFieldProps(field)}
            isReadOnly={field.isReadOnly === true}
            {...(value === undefined ? defaultValue === undefined ? {} : { defaultValue } : { value })}
            {...(onValueChange === undefined ? {} : { onChange: onValueChange })}
            {...(minValue === undefined ? {} : { minValue })}
            {...(maxValue === undefined ? {} : { maxValue })}
            {...(step === undefined ? {} : { step })}
            {...(formatOptions === undefined ? {} : { formatOptions })}
        >
            <FieldLabel isHidden={field.isLabelHidden} isRequired={field.isRequired}>{field.label}</FieldLabel>
            <HeroNumberField.Group className="starci-core-number-field-group" data-grammar-field-control="true">
                {hideSteppers ? null : <HeroNumberField.DecrementButton className="starci-core-number-field-step" />}
                <HeroNumberField.Input
                    {...(id === undefined ? {} : { id })}
                    {...(placeholder === undefined ? {} : { placeholder })}
                    className="starci-core-number-field-input"
                />
                {hideSteppers ? null : <HeroNumberField.IncrementButton className="starci-core-number-field-step" />}
            </HeroNumberField.Group>
            <FieldDescription>{field.description}</FieldDescription>
            <FieldErrorText>{field.errorMessage}</FieldErrorText>
        </HeroNumberField>
    )
}
