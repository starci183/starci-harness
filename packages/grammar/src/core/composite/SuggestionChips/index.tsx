"use client"

import { skeletonVariants } from "@heroui/react"
import { useId } from "react"
import { Button as AriaButton, Toolbar as AriaToolbar } from "react-aria-components"
import { Icon, type IconSource } from "../../leaf/Icon/index.js"
import { glyphSource, type GlyphName } from "../../leaf/Icon/glyphs.js"
import { LOADING_ROWS } from "../../loadingState.js"
import { useIsLoading, useRegionOwnsBusy } from "../../regionScope.js"
import type { NoChildren } from "../../tier.js"

type SuggestionIcon =
    | {
        /** A glyph of Grammar's own closed vocabulary at the start of the label. */
        readonly glyph?: GlyphName
        readonly iconSource?: never
    }
    | {
        /** An app-owned icon at the start of the label. */
        readonly iconSource?: IconSource
        readonly glyph?: never
    }

export type SuggestionChip = SuggestionIcon & {
    /** Identifies the chip in `onSelect`. */
    readonly id: string
    /** The words of the chip. Pressing it sends these same words. */
    readonly label: string
    readonly isDisabled?: boolean
}

export type SuggestionChipsProps = NoChildren & {
    /** Names the group for assistive technology ("Suggested questions"). Required; it is drawn only when `isLabelHidden` is `false`. */
    readonly label: string
    /** `true` (default): the name is for assistive technology only. `false`: it is drawn above the chips as a muted xs line. */
    readonly isLabelHidden?: boolean
    readonly items: ReadonlyArray<SuggestionChip>
    /** Called with the `id` of the chip that was pressed. */
    readonly onSelect: (id: string) => void
    /** The first read has no data yet: the chips given draw as pill geometry (three when none). */
    readonly isLoading?: boolean
    /** Disables every chip; one chip is disabled with its own `isDisabled`. */
    readonly isDisabled?: boolean
}

const SKELETON_CLASS_NAME = skeletonVariants({ animationType: "shimmer" }).base({ className: "select-none text-transparent" })

const PLACEHOLDERS: ReadonlyArray<SuggestionChip> = Array.from({ length: LOADING_ROWS }, (_, index) => ({ id: String(index), label: "Suggestion" }))

/**
 * Quick replies and suggested questions: short pills that wrap, each one a real button whose press sends its own label (the assistant
 * drawer, a composer's suggestions, the shortcuts of an empty state). They are a `role="toolbar"` named by `label`: one tab stop,
 * arrow keys move between chips. A press holds no selection state (that is `ChoiceChips`); commands whose words differ from their
 * effects are `Button`s.
 */
export const SuggestionChips = ({ label, isLabelHidden = true, items, onSelect, isLoading: ownLoading, isDisabled = false }: SuggestionChipsProps) => {
    const isLoading = useIsLoading(ownLoading)
    const ownsBusy = useRegionOwnsBusy()
    const labelId = useId()
    const shown = items.length === 0 ? PLACEHOLDERS : items
    return (
        <div
            className="starci-core-suggestion-chips"
            data-component="SuggestionChips"
            data-tier="composite"
            data-contract="A11Y-1 STATE-6 FOCUS-2"
            {...(isLoading && !ownsBusy ? { "aria-busy": true } : {})}
        >
            {isLabelHidden ? null : <span id={labelId} className="starci-core-suggestion-chips-label">{label}</span>}
            {isLoading ? (
                <div className="starci-core-suggestion-chips-row" aria-hidden="true" data-grammar-suggestion-loading="true">
                    {shown.map((item) => (
                        <span
                            className={`starci-core-suggestion-chip ${SKELETON_CLASS_NAME}`}
                            data-grammar-glyph={item.glyph !== undefined || item.iconSource !== undefined ? "true" : undefined}
                            key={item.id}
                        >
                            {item.label}
                        </span>
                    ))}
                </div>
            ) : (
                <AriaToolbar className="starci-core-suggestion-chips-row" orientation="horizontal" {...(isLabelHidden ? { "aria-label": label } : { "aria-labelledby": labelId })}>
                    {items.map((item) => {
                        const source = item.iconSource ?? (item.glyph === undefined ? undefined : glyphSource(item.glyph))
                        return (
                            <AriaButton
                                key={item.id}
                                className="starci-core-suggestion-chip"
                                data-grammar-option="true"
                                data-grammar-glyph={source === undefined ? undefined : "true"}
                                isDisabled={isDisabled || item.isDisabled === true}
                                onPress={() => onSelect(item.id)}
                            >
                                {source === undefined ? null : <Icon source={source} usage="chip" />}
                                <span className="starci-core-suggestion-chip-label">{item.label}</span>
                            </AriaButton>
                        )
                    })}
                </AriaToolbar>
            )}
        </div>
    )
}
