"use client"

import { FieldSkeletonScope, loadingFieldProps } from "../../leaf/Field/index.js"
import { withRegionLoading } from "../../regionScope.js"
import { useCallback, useId, useRef } from "react"
import { InputOTP, Label as HeroLabel, REGEXP_ONLY_DIGITS } from "@heroui/react"
import { horizontalScrollRegionClassName } from "../../classNames.js"
import { HorizontalScrollFrame } from "../../HorizontalScrollFrame.js"
import { useFieldVariant } from "../../surfaceContext.js"
import type { NoChildren } from "../../tier.js"

export type OtpInputProps = NoChildren & {
    /** In a `Grid kind="form"` (`FormGrid`): `full` makes the field stand alone on its own row across every column. The control itself ignores it. */
    readonly span?: "full"
    /** Unresolved (knowledge STATE-8): the ready anatomy as geometry, inert and `aria-busy`, label and description kept; a loading region is inherited. */
    readonly isLoading?: boolean
    readonly id: string
    readonly name: string
    /**
     * Visible name of the code, e.g. "Verification code". It is drawn above the slots as a
     * `<label for={id}>` and names both the slot group (`role="group"`) and the one real input.
     */
    readonly label?: string
    /** Keep `label` as the accessible name but hide the drawn text. */
    readonly isLabelHidden?: boolean
    /** Id of an app-owned element (a Field label, a heading) that names the code instead of `label`. */
    readonly labelledBy?: string
    readonly defaultValue?: string
    readonly isDisabled?: boolean
    readonly isInvalid?: boolean
    readonly describedBy?: string
    readonly onValueChange?: (value: string) => void
}

/**
 * Own the conventional six-digit OTP control and its intrinsic-width overflow treatment.
 *
 * The slot strip is a `role="group"` named by `label` (or `labelledBy`), and the single hidden
 * `<input>` that receives the code carries the same name, so the control is announced as, e.g.,
 * "Verification code, group" and "Verification code, edit text". The strip scrolls only the slots,
 * which the focused input already reaches, so the region adds no extra Tab stop.
 */
const OtpInputControl = (props: Omit<OtpInputProps, "isLoading">) => {
    const variant = useFieldVariant()
    const regionRef = useRef<HTMLDivElement>(null)
    const generatedLabelId = useId()
    const onChange = useCallback((nextValue: string) => {
        props.onValueChange?.(nextValue)
        window.requestAnimationFrame(() => {
            const slots = regionRef.current?.querySelectorAll<HTMLElement>("[data-slot='input-otp-slot']")
            if (!slots?.length) return
            const activeIndex = Math.min(nextValue.length, slots.length - 1)
            slots.item(activeIndex).scrollIntoView({ block: "nearest", inline: "nearest" })
        })
    }, [props.onValueChange])

    const labelId = props.label === undefined ? props.labelledBy : generatedLabelId
    const control = (
        <HorizontalScrollFrame
            ref={regionRef}
            className={horizontalScrollRegionClassName}
            data-contract="PADDING-1 MEASURE-3 OVERFLOW-3 OVERFLOW-5"
            data-grammar-overflow="always"
            data-grammar-variant={variant}
            hideScrollBar
            orientation="horizontal"
            scrollPreviousLabel="Scroll left"
            scrollNextLabel="Scroll right"
            {...(props.label === undefined ? { "data-component": "OtpInput", "data-tier": "branch" } : {})}
            {...(labelId === undefined ? {} : { role: "group", "aria-labelledby": labelId })}
        >
            <InputOTP
                id={props.id}
                name={props.name}
                maxLength={6}
                pattern={REGEXP_ONLY_DIGITS}
                autoComplete="one-time-code"
                inputMode="numeric"
                defaultValue={props.defaultValue}
                isDisabled={props.isDisabled === true}
                isInvalid={props.isInvalid === true}
                aria-invalid={props.isInvalid === true ? true : undefined}
                aria-describedby={props.describedBy}
                {...(labelId === undefined ? {} : { "aria-labelledby": labelId })}
                variant={variant}
                onChange={onChange}
            >
                <InputOTP.Group>
                    {Array.from({ length: 6 }, (_, index) => (
                        <InputOTP.Slot key={index} index={index} />
                    ))}
                </InputOTP.Group>
            </InputOTP>
        </HorizontalScrollFrame>
    )

    if (props.label === undefined) return control
    return (
        <div className="starci-core-otp-field" data-grammar-otp-field="true" data-component="OtpInput" data-tier="branch" data-grammar-variant={variant}>
            <HeroLabel
                className={props.isLabelHidden === true ? "starci-core-visually-hidden" : "starci-core-otp-label"}
                htmlFor={props.id}
                id={labelId}
            >
                {props.label}
            </HeroLabel>
            {control}
        </div>
    )
}

/**
 * Own the conventional six-digit OTP control and its intrinsic-width overflow treatment.
 *
 * The slot strip is a `role="group"` named by `label` (or `labelledBy`), and the single hidden
 * `<input>` that receives the code carries the same name, so the control is announced as, e.g.,
 * "Verification code, group" and "Verification code, edit text". The strip scrolls only the slots,
 * which the focused input already reaches, so the region adds no extra Tab stop.
 */
const OtpInputRegion = ({ isLoading = false, ...props }: OtpInputProps) => isLoading
    ? <FieldSkeletonScope component="OtpInput"><OtpInputControl {...loadingFieldProps(props)} /></FieldSkeletonScope>
    : <OtpInputControl {...props} />

export const OtpInput = withRegionLoading(OtpInputRegion)
