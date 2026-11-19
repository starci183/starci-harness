"use client"

import { ChoiceGroup, type ChoiceChip, type ChoiceGroupProps } from "../../choiceToggles.js"
import type { NoChildren } from "../../tier.js"

export type { ChoiceChip }

export type ChoiceChipsProps = NoChildren & ChoiceGroupProps

/**
 * One choice among a few short options (a time, a size, a day), as chips as tall as a Chip that wrap onto as many rows as the width
 * needs, so every option stays visible and none hides behind a menu. A radio group by behaviour: one is always selected once chosen,
 * arrow keys move, a disabled option keeps its place. Options with the weight of a button (a plan level, an amount) are
 * `ChoiceButtons`. It is not a filter (`Tabs kind="filter"` narrows a list).
 */
export const ChoiceChips = (props: ChoiceChipsProps) => <ChoiceGroup look="chip" {...props} />
