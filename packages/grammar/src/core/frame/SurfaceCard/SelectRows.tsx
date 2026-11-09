"use client"

import { Checkbox as HeroCheckbox } from "@heroui/react"
import type { SelectData } from "../../surfaceCardData.js"
import { FieldDescription, FieldLabel } from "../../leaf/Field/index.js"
import { SkeletonPlaceholder } from "../../leaf/Skeleton/index.js"

/**
 * The rows of a `kind="select"` card: a `role="group"` of HeroUI Checkboxes, one per item, the whole row the label (hit target) with a subtle hover tint and
 * a full-width divider. Both modes use the checkbox look. ARIA: the rows are real checkboxes in both modes, so `single` is a group whose rows exclude one another
 * (the selected row cannot be unchecked, it is replaced by the next pick), not a radiogroup: a radio role would contradict the checkbox the owner chose to see.
 */
export const SelectRows = ({ data, isLoading, ariaLabel }: {
    readonly data: SelectData
    readonly isLoading: boolean
    readonly ariaLabel?: string | undefined
}) => {
    const isChecked = (id: string) => data.selectionMode === "single" ? data.value === id : data.value.includes(id)
    const toggle = (id: string, next: boolean) => {
        if (data.selectionMode === "single") {
            if (next) data.onChange(id)
            return
        }
        data.onChange(next ? [...data.value, id] : data.value.filter((value) => value !== id))
    }
    return (
        <div
            aria-busy={isLoading || undefined}
            aria-label={ariaLabel}
            className="starci-core-select-rows"
            data-grammar-select-mode={data.selectionMode}
            role="group"
        >
            {data.items.map((item) => (
                <HeroCheckbox
                    key={item.id}
                    className="starci-core-choice starci-core-select-row"
                    data-grammar-select-row="true"
                    isDisabled={item.isDisabled === true || isLoading}
                    isSelected={isChecked(item.id)}
                    onChange={(next: boolean) => toggle(item.id, next)}
                    value={item.id}
                >
                    <HeroCheckbox.Content className="starci-core-choice-content" data-grammar-choice-target="true">
                        <HeroCheckbox.Control className="starci-core-choice-control" data-grammar-choice-control="checkbox">
                            <HeroCheckbox.Indicator />
                        </HeroCheckbox.Control>
                        <span className="starci-core-select-copy">
                            <FieldLabel>{isLoading ? <SkeletonPlaceholder>{item.title}</SkeletonPlaceholder> : item.title}</FieldLabel>
                            {item.title !== "" && item.subtitle !== undefined ? (
                                <FieldDescription>{isLoading ? <SkeletonPlaceholder>{item.subtitle}</SkeletonPlaceholder> : item.subtitle}</FieldDescription>
                            ) : null}
                        </span>
                    </HeroCheckbox.Content>
                </HeroCheckbox>
            ))}
        </div>
    )
}
