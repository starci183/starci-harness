"use client"

import { ToggleButton as HeroToggleButton, ToggleButtonGroup as HeroToggleButtonGroup, type Key } from "@heroui/react"
import { useId, type ReactNode } from "react"
import { Skeleton } from "../../leaf/Skeleton/index.js"
import { ErrorView, useIsLoading, LOADING_ROWS, type ErrorData } from "../../loadingState.js"
import type { NoChildren } from "../../tier.js"

export type ChoiceChip = {
    readonly value: string
    readonly label: string
    /** A taken or unavailable choice stays in place so the others keep their positions; the reason belongs in `label` or beside the group. */
    readonly isDisabled?: boolean
}

export type ChoiceChipsProps = NoChildren & {
    /** Names the group, e.g. "Time". Drawn as the field label unless `isLabelHidden`. */
    readonly label: string
    readonly isLabelHidden?: boolean
    readonly options: ReadonlyArray<ChoiceChip>
    readonly value?: string
    readonly defaultValue?: string
    readonly onValueChange?: (value: string) => void
    /** What shows in place of the chips when there are none (no free time). Required: a group answers for its empty state. */
    readonly empty: ReactNode
    /** The first read has no data yet: the options given draw as geometry (three when none). */
    readonly isLoading?: boolean
    readonly error?: ErrorData
}

const firstKey = (keys: Iterable<Key>): string | undefined => {
    const first = keys[Symbol.iterator]().next()
    return first.done ? undefined : String(first.value)
}

/**
 * One choice among a few short options (a time, a size, a day), as pills that wrap onto as many rows as the width needs, so
 * every option stays visible and none hides behind a menu. A radio group by behaviour: one is always selected once chosen,
 * arrow keys move, a disabled option keeps its place. It is not a filter (`FilterButtonGroup` narrows a list in one row with a
 * "+n" overflow) and not a segmented control (one row of two to five peers).
 */
export const ChoiceChips = ({ label, isLabelHidden = false, options, value, defaultValue, onValueChange, empty, isLoading: ownLoading, error }: ChoiceChipsProps) => {
    const labelId = useId()
    const isLoading = useIsLoading(ownLoading)
    const labelClass = isLabelHidden ? "starci-core-field-label starci-core-form-label--screen-reader" : "starci-core-field-label"
    return (
        <div
            className="starci-core-choice-chips"
            data-component="ChoiceChips"
            data-tier="composite"
            data-contract="A11Y-1 STATE-6 FOCUS-2"
            {...(isLoading ? { "aria-busy": true } : {})}
        >
            <span id={labelId} className={labelClass} data-grammar-field-label="true">{label}</span>
            {isLoading ? (
                <div className="starci-core-choice-chips-row" aria-hidden="true">
                    {Array.from({ length: options.length === 0 ? LOADING_ROWS : options.length }, (_, index) => (
                        <span className="starci-core-choice-chips-skeleton" key={index}><Skeleton shape="rect" /></span>
                    ))}
                </div>
            ) : error !== undefined ? <ErrorView error={error} /> : options.length === 0 ? empty : (
                <HeroToggleButtonGroup
                    aria-labelledby={labelId}
                    className="starci-core-choice-chips-row"
                    data-grammar-field-control="true"
                    isDetached
                    selectionMode="single"
                    disallowEmptySelection
                    size="sm"
                    {...(value === undefined ? {} : { selectedKeys: [value] })}
                    {...(defaultValue === undefined ? {} : { defaultSelectedKeys: [defaultValue] })}
                    onSelectionChange={(keys) => {
                        const next = firstKey(keys)
                        if (next !== undefined) onValueChange?.(next)
                    }}
                >
                    {options.map((option) => (
                        <HeroToggleButton key={option.value} id={option.value} isDisabled={option.isDisabled === true} className="starci-core-choice-chip" data-grammar-option="true">
                            {option.label}
                        </HeroToggleButton>
                    ))}
                </HeroToggleButtonGroup>
            )}
        </div>
    )
}
