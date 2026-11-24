"use client"

import { ChoiceGroup, type ChoiceGroupProps, type ChoiceOption } from "../../choiceToggles.js"
import type { NoChildren } from "../../tier.js"

/** One option of a ChoiceButtons group. */
export type ChoiceButton = ChoiceOption

export type ChoiceButtonsProps = NoChildren & ChoiceGroupProps & {
    /** The height of every option, a Button's: `md` (default) 40, `sm` 32. */
    readonly size?: "sm" | "md"
}

/**
 * One form value among a few options with the weight of a button (a plan level, an amount; never a period or mode switch of shown data, which is `Tabs appearance="primary"`), each option a separate toggle as
 * tall as a Button of `size`, wrapping onto as many rows as the width needs. Never joined into one bar (R380). Any other value of a
 * form or a toolbar is a `Select` (owner 2026-11-24: "trong form thì chọn dropdown").
 */
export const ChoiceButtons = ({ size = "md", ...props }: ChoiceButtonsProps) => <ChoiceGroup size={size} {...props} />
