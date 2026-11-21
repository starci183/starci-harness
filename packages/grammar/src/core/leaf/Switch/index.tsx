"use client"

import { withRegionLoading } from "../../regionScope.js"
import { Switch as HeroSwitch } from "@heroui/react"
import { Icon, type IconSource } from "../Icon/index.js"
import {
    FieldDescription,
    FieldErrorText,
    FieldLabel,
    FieldSkeletonScope,
    vendorFieldProps,
    type FieldControlProps,
} from "../Field/index.js"
import type { NoChildren } from "../../tier.js"

export type SwitchSize = "md" | "lg" | "control"

/**
 * The two StarCi switches (0.40.1, owner): `toggle` is the standalone 72x40 control (thumb 32), `compact` the 32x18 track with a 14px thumb for a setting in a row or a list.
 */
export type SwitchKind = "toggle" | "compact"

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
     * Which StarCi switch (0.40.1, owner). `toggle` (default) is the standalone, prominent switch: a 72x40 track (the IconButton and bar control height) with a 32px round thumb that
     * may carry a glyph, so it lines up with the buttons beside it (the theme switch). `compact` is 32x18 with a 14px thumb inset 2px, for a setting in a settings or list row, a table
     * cell or a toolbar; it draws no thumb glyph (too small), so `thumbIcon` and `selectedThumbIcon` are ignored on it. The track is the accent when on, the focus ring the field ring,
     * disabled 45%, and the thumb travels in 150ms (none under reduced motion), on both kinds.
     */
    readonly kind?: SwitchKind
    /**
     * Kept for compatibility. `control` is the same as `kind="toggle"`; `md` and `lg` are HeroUI's own smaller sizes, kept for a dense table cell. When `kind` is given it wins and `size` is
     * ignored; without `kind` the switch is the `toggle` (`control`) unless `size` says `md` or `lg`. New code states `kind`.
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
    ? <FieldSkeletonScope component="Switch" field={props} control={{ kind: "switch", size: props.kind === "compact" ? "compact" : "toggle" }} />
    : <SwitchControl {...props} />

const SwitchControl = ({ value, isSelected, defaultSelected, onSelectedChange, kind, size = "control", thumbIcon: wantedThumbIcon, selectedThumbIcon: wantedSelectedThumbIcon, ...field }: Omit<SwitchProps, "isLoading">) => {
    /* `kind` wins over the legacy `size`; a compact switch is too small for a glyph. */
    const look: SwitchSize | "compact" = kind === "compact" ? "compact" : kind === "toggle" ? "control" : size
    const thumbIcon = look === "compact" ? undefined : wantedThumbIcon
    const selectedThumbIcon = look === "compact" ? undefined : wantedSelectedThumbIcon
    return (
    <HeroSwitch
        data-tier="leaf"
        data-component="Switch"
        data-contract="A11Y-1 STATE-1"
        data-grammar-switch-size={look}
        data-grammar-switch-kind={look === "compact" ? "compact" : "toggle"}
        data-grammar-switch-labelled={field.isLabelHidden === true ? "false" : "true"}
        data-grammar-switch-icons={thumbIcon === undefined ? "none" : selectedThumbIcon === undefined ? "single" : "swap"}
        className="starci-core-choice starci-core-switch"
        size={look === "control" ? "lg" : look === "compact" ? "sm" : look}
        {...vendorFieldProps(field)}
        isReadOnly={field.isReadOnly === true}
        {...(value === undefined ? {} : { value })}
        {...(isSelected === undefined ? defaultSelected === undefined ? {} : { defaultSelected } : { isSelected })}
        {...(onSelectedChange === undefined ? {} : { onChange: onSelectedChange })}
    >
        {/*
          * The press target is the drawn control (0.54.1): `Switch.Content` is React Aria's SwitchButton, the `<label>` around the visually
          * hidden input, so the track is drawn INSIDE it. With a label it is the whole row (text, then the track); with a hidden label it
          * holds only the screen-reader label (out of flow) and the track, so its box is exactly the track. 0.54.0 drew the track beside
          * the label, and a hidden-label switch had no pressable box at all.
          */}
        <HeroSwitch.Content className="starci-core-switch-content" data-grammar-choice-target="true">
            {field.isLabelHidden === true
                ? <FieldLabel isHidden>{field.label}</FieldLabel>
                : (
                    <span className="starci-core-switch-text">
                        <FieldLabel>{field.label}</FieldLabel>
                        <FieldDescription>{field.description}</FieldDescription>
                        <FieldErrorText>{field.errorMessage}</FieldErrorText>
                    </span>
                )}
            <SwitchTrack look={look} thumbIcon={thumbIcon} selectedThumbIcon={selectedThumbIcon} />
        </HeroSwitch.Content>
        {/* A bare control's description and error stand under it, outside the press target, so the target stays the track. */}
        {field.isLabelHidden === true ? <FieldDescription>{field.description}</FieldDescription> : null}
        {field.isLabelHidden === true ? <FieldErrorText>{field.errorMessage}</FieldErrorText> : null}
    </HeroSwitch>
    )
}

const SwitchTrack = ({ look, thumbIcon, selectedThumbIcon }: { readonly look: SwitchSize | "compact"; readonly thumbIcon: IconSource | undefined; readonly selectedThumbIcon: IconSource | undefined }) => (
    <HeroSwitch.Control className="starci-core-choice-control" data-grammar-choice-control="switch" data-grammar-switch-track="true">
        <HeroSwitch.Thumb data-grammar-switch-thumb="true">
            {thumbIcon === undefined ? null : (
                <HeroSwitch.Icon>
                    <span aria-hidden="true" className="starci-core-switch-icon" data-grammar-switch-icon="off"><Icon source={thumbIcon} usage={look === "md" ? "chip" : "leading"} /></span>
                    {selectedThumbIcon === undefined ? null : (
                        <span aria-hidden="true" className="starci-core-switch-icon" data-grammar-switch-icon="on"><Icon source={selectedThumbIcon} usage={look === "md" ? "chip" : "leading"} /></span>
                    )}
                </HeroSwitch.Icon>
            )}
        </HeroSwitch.Thumb>
    </HeroSwitch.Control>
)

/**
 * An immediate on/off setting (`role="switch"`). Use Checkbox for a choice that only takes effect
 * on submit. The label is part of the hit area; Space toggles.
 */
export const Switch = withRegionLoading(SwitchInner)
