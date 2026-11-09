"use client"

import { withRegionLoading } from "../../regionScope.js"
import { Switch as HeroSwitch } from "@heroui/react"
import { Icon, type IconSource } from "../Icon/index.js"
import {
    FieldDescription,
    FieldErrorText,
    FieldLabel,
    FieldSkeletonScope,
    loadingFieldProps,
    vendorFieldProps,
    type FieldControlProps,
} from "../Field/index.js"
import type { NoChildren } from "../../tier.js"

export type SwitchSize = "md" | "lg" | "control"

/**
 * A Switch with a visible label MUST carry its description (owner, 0.37.5): the row is label + description at the start and the control at the end.
 * Only a bare control (`isLabelHidden`, an icon-only or theme switch) may go without.
 */
export type SwitchDescription =
    | { readonly isLabelHidden?: false; readonly description: string }
    | { readonly isLabelHidden: true; readonly description?: string }

export type SwitchProps = NoChildren & Omit<FieldControlProps, "description" | "isLabelHidden"> & SwitchDescription & {
    readonly value?: string
    readonly isSelected?: boolean
    readonly defaultSelected?: boolean
    readonly onSelectedChange?: (isSelected: boolean) => void
    /**
     * `control` (default) is the one StarCi size: a 40px track (2.5rem, the IconButton and bar control height) with a round thumb that may carry a
     * glyph, so a switch lines up with the buttons beside it. `md` and `lg` are HeroUI's own smaller sizes, kept for a dense table cell.
     * With `isLabelHidden` the label stays the accessible name and draws nothing, for a switch that carries only an aria label.
     */
    readonly size?: SwitchSize
    /**
     * A glyph drawn centred in the thumb, at the canon icon size: 20px (`Icon` `leading`) on `lg` and `control`, the 16px `chip` step on `md`. With `selectedThumbIcon` it is the glyph of the off state.
     */
    readonly thumbIcon?: IconSource
    /** The thumb glyph while on (a sun/moon theme switch passes the moon here). Needs `thumbIcon`; without one it is ignored. */
    readonly selectedThumbIcon?: IconSource
    /**
     * Initial unresolved content (knowledge STATE-8), with skeleton parity: the ready anatomy at the same props (label,
     * description, control box, options) inside an inert, `aria-busy` scope, its control box painted as a Skeleton and its
     * value or mark not drawn, so the loading field keeps the ready box. Nothing is invalid or pending while it loads.
     */
    readonly isLoading?: boolean
}

/*
 * Consumer hook: `starci-core-switch` names this control's root for a consumer or family
 * stylesheet. No shipped sheet paints it: the root is drawn as a whole by `.starci-core-choice`, so
 * a rule on the hook adds to the shared anatomy and never has to replace it.
 */

/**
 * An immediate on/off setting (`role="switch"`). Use Checkbox for a choice that only takes effect
 * on submit. The label is part of the hit area; Space toggles.
 *
 * ONE layout (0.37.5, owner): with a label the Switch is a single row, the label (14, weight 500) and the description (12, muted) at the start filling the row, the
 * control at the end edge centred vertically, the whole row the hit target. There is no placement prop: the control cannot be put before the text. `isLabelHidden`
 * keeps the bare control for an icon-only switch (a theme toggle).
 */
const SwitchInner = ({ isLoading = false, ...props }: SwitchProps) => isLoading
    ? <FieldSkeletonScope component="Switch"><SwitchControl {...loadingFieldProps(props)} /></FieldSkeletonScope>
    : <SwitchControl {...props} />

const SwitchControl = ({ value, isSelected, defaultSelected, onSelectedChange, size = "control", thumbIcon, selectedThumbIcon, ...field }: Omit<SwitchProps, "isLoading">) => (
    <HeroSwitch
        data-tier="leaf"
        data-component="Switch"
        data-contract="A11Y-1 STATE-1"
        data-grammar-switch-size={size}
        data-grammar-switch-labelled={field.isLabelHidden === true ? "false" : "true"}
        data-grammar-switch-icons={thumbIcon === undefined ? "none" : selectedThumbIcon === undefined ? "single" : "swap"}
        className="starci-core-choice starci-core-switch"
        size={size === "control" ? "lg" : size}
        {...vendorFieldProps(field)}
        isReadOnly={field.isReadOnly === true}
        {...(value === undefined ? {} : { value })}
        {...(isSelected === undefined ? defaultSelected === undefined ? {} : { defaultSelected } : { isSelected })}
        {...(onSelectedChange === undefined ? {} : { onChange: onSelectedChange })}
    >
        <HeroSwitch.Content className="starci-core-switch-text" data-grammar-choice-target="true">
            <FieldLabel isHidden={field.isLabelHidden === true}>{field.label}</FieldLabel>
            <FieldDescription>{field.description}</FieldDescription>
            <FieldErrorText>{field.errorMessage}</FieldErrorText>
        </HeroSwitch.Content>
        <HeroSwitch.Control className="starci-core-choice-control" data-grammar-choice-control="switch" data-grammar-switch-track="true">
            <HeroSwitch.Thumb data-grammar-switch-thumb="true">
                {thumbIcon === undefined ? null : (
                    <HeroSwitch.Icon>
                        <span aria-hidden="true" className="starci-core-switch-icon" data-grammar-switch-icon="off"><Icon source={thumbIcon} usage={size === "md" ? "chip" : "leading"} /></span>
                        {selectedThumbIcon === undefined ? null : (
                            <span aria-hidden="true" className="starci-core-switch-icon" data-grammar-switch-icon="on"><Icon source={selectedThumbIcon} usage={size === "md" ? "chip" : "leading"} /></span>
                        )}
                    </HeroSwitch.Icon>
                )}
            </HeroSwitch.Thumb>
        </HeroSwitch.Control>
    </HeroSwitch>
)

/**
 * An immediate on/off setting (`role="switch"`). Use Checkbox for a choice that only takes effect
 * on submit. The label is part of the hit area; Space toggles.
 */
export const Switch = withRegionLoading(SwitchInner)
