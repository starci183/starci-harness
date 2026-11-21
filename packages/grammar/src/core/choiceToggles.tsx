"use client"

import { ToggleButton as HeroToggleButton, ToggleButtonGroup as HeroToggleButtonGroup, Tooltip as HeroTooltip, type Key } from "@heroui/react"
import { useId, type ReactNode } from "react"
import { FieldSkeletonScope } from "./leaf/Field/index.js"
import { useOverlayContainer } from "./overlayScope.js"
import { tooltipContentClassName } from "./tooltipClassName.js"
import { ErrorView, LOADING_ROWS, type ErrorData } from "./loadingState.js"
import { useIsLoading } from "./regionScope.js"
import type { NoChildren } from "./tier.js"

/** One option of a choice group (ChoiceChips, ChoiceButtons). */
export type ChoiceChip = {
    readonly value: string
    readonly label: string
    /** A taken or unavailable choice stays in place so the others keep their positions. */
    readonly isDisabled?: boolean
    /** Why the choice is unavailable ("Taken"), given on hover and to a screen reader. Give it with `isDisabled`. */
    readonly disabledReason?: string
}

/** The words a disabled chip gives for being unavailable. The platform skips a disabled control, so the vendor trigger around it carries the events. */
const DisabledReason = ({ reason, children }: { readonly reason: string; readonly children: ReactNode }) => {
    const reasonId = useId()
    const { anchor, container } = useOverlayContainer("Tooltip")
    return (
        <HeroTooltip>
            <span id={reasonId} hidden>{reason}</span>
            <HeroTooltip.Trigger className="starci-core-tooltip-disabled-trigger" data-grammar-tooltip-disabled-trigger="true" role="group" aria-describedby={reasonId}>
                {children}
            </HeroTooltip.Trigger>
            {anchor}
            {container === null ? null : (
                <HeroTooltip.Content UNSTABLE_portalContainer={container} placement="top" className={tooltipContentClassName} data-grammar-tooltip-content="true">
                    {reason}
                </HeroTooltip.Content>
            )}
        </HeroTooltip>
    )
}

/** The props both choice groups share. */
export type ChoiceGroupProps = NoChildren & {
    /** Names the group, e.g. "Time". Drawn as the field label unless `isLabelHidden`. */
    readonly label: string
    readonly isLabelHidden?: boolean
    readonly options: ReadonlyArray<ChoiceChip>
    readonly value?: string
    readonly defaultValue?: string
    readonly onValueChange?: (value: string) => void
    /**
     * `single` (default): one choice, always one once chosen (`value`, `defaultValue`, `onValueChange`). `multiple`: any number of
     * chips, none allowed (a set of weekdays); read and write it with `values`, `defaultValues` and `onValuesChange`, a chip toggles
     * on press and the group is announced as a set of toggle buttons.
     */
    readonly selectionMode?: "single" | "multiple"
    readonly values?: ReadonlyArray<string>
    readonly defaultValues?: ReadonlyArray<string>
    readonly onValuesChange?: (values: ReadonlyArray<string>) => void
    /** What shows in place of the chips when there are none (no free time). Required: a group answers for its empty state. */
    readonly empty: ReactNode
    /**
     * `content` (default): each chip is as wide as its words. `fill`: the chips share the row, growing evenly from their own width, and
     * wrap onto a further row only when they cannot fit (days of a week, two or three modes).
     */
    readonly width?: "content" | "fill"
    /** The first read has no data yet: the options given draw as geometry (three when none). */
    readonly isLoading?: boolean
    readonly error?: ErrorData
}

const firstKey = (keys: Iterable<Key>): string | undefined => {
    const first = keys[Symbol.iterator]().next()
    return first.done ? undefined : String(first.value)
}

/**
 * The one choice group both public components draw: a set of toggles that wrap onto as many rows as the width needs, a radio
 * group by behaviour (one is always selected once chosen, arrow keys move, a disabled option keeps its place). `look` sets the
 * option's height and paint: `chip` is as tall as a Chip, `button` as tall as a Button of `size`. Not exported from the package.
 */
export const ChoiceGroup = ({ look, size = "md", label, isLabelHidden = false, options, value, defaultValue, onValueChange, selectionMode = "single", values, defaultValues, onValuesChange, empty, width = "content", isLoading: ownLoading, error }: ChoiceGroupProps & { readonly look: "chip" | "button"; readonly size?: "sm" | "md" }) => {
    const labelId = useId()
    const isLoading = useIsLoading(ownLoading)
    const isMultiple = selectionMode === "multiple"
    const labelClass = isLabelHidden ? "starci-core-field-label starci-core-form-label--screen-reader" : "starci-core-field-label"
    // loading: HeroUI Skeleton shapes only, the label line and one pill per option (owner, 2026-11-21: no real text, no painted real control)
    if (isLoading) return <FieldSkeletonScope component={look === "chip" ? "ChoiceChips" : "ChoiceButtons"} field={{ label, isLabelHidden }} control={{ kind: "pills", count: options.length === 0 ? LOADING_ROWS : options.length }} />
    return (
        <div
            className="starci-core-choice-chips"
            data-component={look === "chip" ? "ChoiceChips" : "ChoiceButtons"}
            data-grammar-choice-look={look}
            {...(look === "button" ? { "data-size": size } : {})}
            data-tier="composite"
            data-grammar-width={width}
            data-contract="A11Y-1 STATE-6 FOCUS-2"
        >
            <span id={labelId} className={labelClass} data-grammar-field-label="true">{label}</span>
            {error !== undefined ? <ErrorView error={error} /> : options.length === 0 ? empty : (
                <HeroToggleButtonGroup
                    aria-labelledby={labelId}
                    className="starci-core-choice-chips-row"
                    data-grammar-field-control="true"
                    isDetached
                    selectionMode={selectionMode}
                    data-grammar-selection-mode={selectionMode}
                    {...(isMultiple ? {} : { disallowEmptySelection: true })}
                    size={look === "chip" ? "sm" : size}
                    {...(isMultiple
                        ? values === undefined ? {} : { selectedKeys: [...values] }
                        : value === undefined ? {} : { selectedKeys: [value] })}
                    {...(isMultiple
                        ? defaultValues === undefined ? {} : { defaultSelectedKeys: [...defaultValues] }
                        : defaultValue === undefined ? {} : { defaultSelectedKeys: [defaultValue] })}
                    onSelectionChange={(keys) => {
                        if (isMultiple) {
                            onValuesChange?.([...keys].map(String))
                            return
                        }
                        const next = firstKey(keys)
                        if (next !== undefined) onValueChange?.(next)
                    }}
                >
                    {options.map((option) => {
                        const chip = (
                            <HeroToggleButton key={option.value} id={option.value} isDisabled={option.isDisabled === true} className="starci-core-choice-chip" data-grammar-option="true">
                                {option.label}
                            </HeroToggleButton>
                        )
                        return option.isDisabled === true && option.disabledReason !== undefined && option.disabledReason !== ""
                            ? <DisabledReason key={option.value} reason={option.disabledReason}>{chip}</DisabledReason>
                            : chip
                    })}
                </HeroToggleButtonGroup>
            )}
        </div>
    )
}
