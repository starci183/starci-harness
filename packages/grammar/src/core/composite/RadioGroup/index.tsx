"use client"

import { withRegionLoading } from "../../regionScope.js"
import { SkeletonPlaceholder } from "../../leaf/Skeleton/index.js"
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
} from "../../leaf/Field/index.js"
import type { ChoiceOption, ChoiceOrientation } from "../CheckboxGroup/index.js"
import type { NoChildren } from "../../tier.js"

export type RadioGroupProps = NoChildren & FieldControlProps & {
    readonly options: ReadonlyArray<ChoiceOption>
    readonly value?: string | null
    readonly defaultValue?: string | null
    readonly onValueChange?: (value: string) => void
    readonly orientation?: ChoiceOrientation
    /**
     * `rows`: each option is its own row (a rounded box with its radio, title and description), the chosen row on the accent
     * soft pair, for a few choices that each need a sentence (a service, a time slot, a plan). `plain` (default): bare radios.
     */
    readonly appearance?: "plain" | "rows"
    /** Initial unresolved content (knowledge STATE-8): the same anatomy, inert, its control painted as a Skeleton. */
    readonly isLoading?: boolean
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
 * Skeleton parity (knowledge STATE-8): `isLoading` renders the ready anatomy at the same props inside
 * `FieldSkeletonScope` (inert, `aria-busy`, control box painted as a Skeleton), so the loading field keeps the ready box.
 */
const RadioGroupInner = ({ isLoading = false, ...props }: RadioGroupProps) => isLoading
    ? <FieldSkeletonScope component="RadioGroup"><RadioGroupControl {...loadingFieldProps(props)} isDataLoading /></FieldSkeletonScope>
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
    appearance = "plain",
    isDataLoading = false,
    ...field
}: Omit<RadioGroupProps, "isLoading"> & { readonly isDataLoading?: boolean }) => {
    const variant = useFieldVariant()
    return (
        <HeroRadioGroup
            data-tier="composite"
            data-component="RadioGroup"
            data-contract="A11Y-1 STATE-6 FOCUS-2"
            data-grammar-orientation={orientation}
            data-grammar-radio-appearance={appearance}
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
                            <FieldLabel>{isDataLoading ? <SkeletonPlaceholder>{option.label}</SkeletonPlaceholder> : option.label}</FieldLabel>
                        </HeroRadio.Content>
                        <FieldDescription>{isDataLoading && option.description != null ? <SkeletonPlaceholder>{option.description}</SkeletonPlaceholder> : option.description}</FieldDescription>
                    </HeroRadio>
                ))}
            </div>
            <FieldErrorText>{field.errorMessage}</FieldErrorText>
        </HeroRadioGroup>
    )
}

/**
 * Skeleton parity (knowledge STATE-8): `isLoading` renders the ready anatomy at the same props inside
 * `FieldSkeletonScope` (inert, `aria-busy`, control box painted as a Skeleton), so the loading field keeps the ready box.
 */
export const RadioGroup = withRegionLoading(RadioGroupInner)
