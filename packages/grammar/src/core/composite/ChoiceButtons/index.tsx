"use client"

import { ChoiceGroup, type ChoiceChip, type ChoiceGroupProps } from "../../choiceToggles.js"
import type { NoChildren } from "../../tier.js"

/** One option of a ChoiceButtons group. */
export type ChoiceButton = ChoiceChip

export type ChoiceButtonsProps = NoChildren & ChoiceGroupProps & {
    /** The height of every option, a Button's: `md` (default) 40, `sm` 32. */
    readonly size?: "sm" | "md"
}

/**
 * One form value among a few options with the weight of a button (a plan level, an amount; never a period or mode switch of shown data, which is `Tabs appearance="primary"`), each option a separate toggle as
 * tall as a Button of `size`, wrapping onto as many rows as the width needs. The same radio behaviour as `ChoiceChips`, which draws
 * the options as Chips. Never joined into one bar (R380).
 */
export const ChoiceButtons = ({ size = "md", ...props }: ChoiceButtonsProps) => <ChoiceGroup look="button" size={size} {...props} />
