"use client"

import { useFieldVariant } from "../../surfaceContext.js"
import { Radio as HeroRadio, RadioGroup as HeroRadioGroup } from "@heroui/react"
import {
    FieldDescription,
    FieldErrorText,
    FieldLabel,
    FieldSkeletonScope,
    loadingFieldProps,
    fieldVariantAttributes,
    vendorFieldProps,
    type FieldControlProps,
} from "../../primitive/Field/index.js"
import type { ChoiceOption, ChoiceOrientation } from "../CheckboxGroup/index.js"

export type RadioGroupProps = FieldControlProps & {
    readonly options: ReadonlyArray<ChoiceOption>
    readonly value?: string | null
    readonly defaultValue?: string | null
    readonly onValueChange?: (value: string) => void
    readonly orientation?: ChoiceOrientation
    /** Defaults to `secondary` inside a Grammar surface and `primary` outside (ANATOMY-2 case-1). */
    readonly variant?: "primary" | "secondary"
    /** Initial unresolved content (knowledge STATE-8): the same anatomy, inert, its control painted as a Skeleton. */
    readonly isSkeleton?: boolean
}

/*
 * Consumer hook: `starci-core-choice-group` names this control's root for a consumer or family
 * stylesheet. No shipped sheet paints it: the root is drawn as a whole by `.starci-core-field`, so
 * a rule on the hook adds to the shared anatomy and never has to replace it.
 */

/*
 * Consumer hook: `starci-core-radio` names each option's root for a consumer or family stylesheet.
 * No shipped sheet paints it: the root is drawn as a whole by `.starci-core-choice`, so a rule on
 * the hook adds to the shared anatomy and never has to replace it.
 */

/**
 * Skeleton parity (knowledge STATE-8): `isSkeleton` renders the ready anatomy at the same props inside
 * `FieldSkeletonScope` (inert, `aria-busy`, control box painted as a Skeleton), so the loading field keeps the ready box.
 */
export const RadioGroup = ({ isSkeleton = false, ...props }: RadioGroupProps) => isSkeleton
    ? <FieldSkeletonScope component="RadioGroup"><RadioGroupControl {...loadingFieldProps(props)} /></FieldSkeletonScope>
    : <RadioGroupControl {...props} />

/**
 * Exactly one of a few visible choices (`role="radiogroup"`). Arrow keys move and select within the
 * group, Tab leaves it - roving focus is the vendor's.
 */
const RadioGroupControl = ({
    options,
    value,
    defaultValue,
    onValueChange,
    orientation = "vertical",
    variant: requestedVariant,
    ...field
}: Omit<RadioGroupProps, "isSkeleton">) => {
    const variant = useFieldVariant(requestedVariant)
    return (
        <HeroRadioGroup
            data-tier="composite"
            data-component="RadioGroup"
            data-contract="A11Y-1 STATE-6 FOCUS-2"
            data-grammar-orientation={orientation}
            className="starci-core-field starci-core-choice-group"
            orientation={orientation}
            variant={variant}
            {...fieldVariantAttributes(variant)}
            {...vendorFieldProps(field)}
            isReadOnly={field.isReadOnly === true}
            {...(value === undefined ? defaultValue === undefined ? {} : { defaultValue } : { value })}
            {...(onValueChange === undefined ? {} : { onChange: onValueChange })}
        >
            <FieldLabel isHidden={field.isLabelHidden} isRequired={field.isRequired}>{field.label}</FieldLabel>
            <FieldDescription>{field.description}</FieldDescription>
            <div className="starci-core-choice-group-options" data-grammar-field-control="true">
                {options.map((option) => (
                    <HeroRadio
                        key={option.value}
                        value={option.value}
                        isDisabled={option.isDisabled === true}
                        className="starci-core-choice starci-core-radio"
                        data-grammar-option="true"
                    >
                        <HeroRadio.Content className="starci-core-choice-content" data-grammar-choice-target="true">
                            <HeroRadio.Control className="starci-core-choice-control" data-grammar-choice-control="radio">
                                <HeroRadio.Indicator />
                            </HeroRadio.Control>
                            <FieldLabel>{option.label}</FieldLabel>
                        </HeroRadio.Content>
                        <FieldDescription>{option.description}</FieldDescription>
                    </HeroRadio>
                ))}
            </div>
            <FieldErrorText>{field.errorMessage}</FieldErrorText>
        </HeroRadioGroup>
    )
}
