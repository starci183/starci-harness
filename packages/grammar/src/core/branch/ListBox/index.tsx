"use client"

import { Description as HeroDescription, Header as HeroHeader, Label as HeroLabel, ListBox as HeroListBox, Separator as HeroSeparator, type Selection } from "@heroui/react"
import type { ComponentPropsWithRef, ReactNode } from "react"
import { navigationClassName } from "../../navigationClassNames.js"
import { Skeleton } from "../../primitive/Skeleton/index.js"
import { usePaneContext } from "../../paneContext.js"
import { useSurfaceNesting } from "../../surfaceContext.js"
import { ButtonPlacementProvider } from "../../buttonIntent.js"
import { useCollectionItemPresentation, type ItemDescriptionLines } from "../../collectionItem.js"

/** The leading identity slot is 32, 40 or 48px; HeroUI retains the row's own padding and radius. */
export type ListBoxSize = "sm" | "md" | "lg"

export type ListBoxItem = {
    readonly id: string
    /** The row's title, its accessible name and its typeahead text. */
    readonly label: string
    /**
     * An optional decorative glyph in the title line, inside HeroUI's `Label` before `label`.
     * It sits on the text baseline in the shared leading wrapper, is `aria-hidden` (A11Y-2) and never
     * joins the name; a glyph that carries meaning belongs in `label` or `description`.
     */
    readonly labelLeading?: ReactNode
    readonly description?: ReactNode
    /** Preview lines before ellipsis; overrides the list's `descriptionLines` for this row. */
    readonly descriptionLines?: ItemDescriptionLines
    /** Unread copy uses the family's strong weight for both label and description. */
    readonly emphasis?: "unread"
    /** Decorative identity content centred in the fixed slot for this item's size. */
    readonly leading?: ReactNode
    /** Overrides the list's leading slot size for this item. */
    readonly size?: ListBoxSize
    readonly trailing?: ReactNode
    readonly isDisabled?: boolean
}

/** A named section whose caption and option content share an edge. Item ids are unique across sections. */
export type ListBoxSection = {
    readonly id: string
    readonly label: string
    readonly items: ReadonlyArray<ListBoxItem>
}

type ListBoxContent =
    | { readonly items: ReadonlyArray<ListBoxItem>; readonly sections?: never }
    | { readonly items?: never; readonly sections: ReadonlyArray<ListBoxSection> }

const clampRows = (rows: number) => Math.min(12, Math.max(1, Math.floor(Number.isFinite(rows) ? rows : 3)))

/**
 * Skeleton rows for a loading list. They sit directly inside the busy listbox (an `aria-busy` listbox may be empty), NOT in
 * `renderEmptyState`: the vendor wraps that in an unnamed `role="option"`, and these rows are `aria-hidden`, so it would be a nameless option.
 */
const loadingSkeleton = (rows: number) => (
    <div className="starci-core-list-box-skeleton" data-grammar-list-skeleton="true">
        {Array.from({ length: clampRows(rows) }, (_, index) => (
            <div key={index} aria-hidden="true" className="starci-core-list-box-skeleton-option" data-grammar-skeleton="true">
                <span data-grammar-list-copy="true">
                    <span className="starci-core-list-box-label"><Skeleton shape="text" /></span>
                    <span className="starci-core-list-box-description"><Skeleton shape="text" /></span>
                </span>
            </div>
        ))}
    </div>
)

export type ListBoxProps = ListBoxContent & {
    /** Names the list, e.g. "Members". */
    readonly label: string
    /** The panel list box shares the field and tabs edge; its content keeps HeroUI's list and item padding. */
    readonly inset?: "default" | "panel"
    /** Description lines for every row: `wrap` (default) shows the whole text over as many lines as it needs; 1, 2 or 3 clamp with an ellipsis. */
    readonly descriptionLines?: ItemDescriptionLines
    /** The leading slot size shared by rows (default md, 40px); a row may override it. */
    readonly size?: ListBoxSize
    /** `none` makes an actionable (not selectable) list; rows then only fire `onAction`. */
    readonly selectionMode?: "none" | "single" | "multiple"
    readonly selectedIds?: ReadonlyArray<string>
    readonly defaultSelectedIds?: ReadonlyArray<string>
    readonly onSelectionChange?: (ids: ReadonlyArray<string>) => void
    readonly onAction?: (id: string) => void
    /**
     * The vendor selection indicator (the check at the end of a selected row). `check` (default) keeps HeroUI's anatomy; `none`
     * omits `ListBox.ItemIndicator` for a list whose selected row already reads from its fill (a conversation list), so the
     * row shows the fill and no check. Selection, `aria-selected` and keyboard behaviour are unchanged.
     */
    readonly selectionIndicator?: "check" | "none"
    readonly emptyContent?: ReactNode
    /**
     * The options are loading (knowledge STATE-8). With no `items` it draws `loadingRows` skeleton options (a label line and a
     * description line, `aria-hidden`) inside the same named list, which is `aria-busy`; real `items` win, and loading beats
     * `emptyContent`.
     */
    readonly isLoading?: boolean
    /** How many skeleton options a loading list draws (default 3, 1 to 12). */
    readonly loadingRows?: number
    readonly className?: string
}

/**
 * A list of selectable or actionable rows (`role="listbox"`). Arrow keys, Home/End and typeahead
 * move between rows; Space/Enter select. A row is HeroUI's own item: its `Label` (with a `Description` under it), then the vendor
 * selection indicator at the end of the row; the selected row carries the vendor `aria-selected`.
 * Contract: list FOCUS-2 STATE-1, empty STATE-3, leading and title-line glyphs A11Y-2.
 */
export const ListBox = ({
    label,
    items = [],
    sections,
    inset,
    size = "md",
    descriptionLines = "wrap",
    selectionMode = "single",
    selectedIds,
    defaultSelectedIds,
    onSelectionChange,
    onAction,
    selectionIndicator = "check",
    emptyContent,
    isLoading = false,
    loadingRows = 3,
    className,
}: ListBoxProps) => {
    const presentation = useCollectionItemPresentation()
    const nested = useSurfaceNesting()
    const inPane = usePaneContext() !== undefined
    const resolvedInset = inset ?? (nested || inPane ? "panel" : "default")
    const allItems = sections === undefined ? items : sections.flatMap((section) => section.items)
    const renderLabel = (item: ListBoxItem) => (
        <HeroLabel data-grammar-item-label="true" style={item.emphasis === "unread" ? { fontWeight: presentation.unreadWeight } : undefined}>
            {item.labelLeading === undefined ? null : (
                <><span aria-hidden="true" data-grammar-list-leading="label" data-contract="A11Y-2">{item.labelLeading}</span>{" "}</>
            )}
            {item.label}
        </HeroLabel>
    )
    const renderItem = (item: ListBoxItem) => (
        <HeroListBox.Item
            key={item.id}
            id={item.id}
            aria-label={item.label}
            className="starci-core-list-box-item"
            data-grammar-list-item="true"
            data-grammar-list-size={item.size ?? size}
            data-grammar-list-emphasis={item.emphasis}
            textValue={item.label}
            {...(item.isDisabled === undefined ? {} : { isDisabled: item.isDisabled })}
        >
            <ButtonPlacementProvider placement="item">
            {item.leading === undefined ? null : <span aria-hidden="true" data-grammar-list-leading="true" data-contract="A11Y-2">{item.leading}</span>}
            {item.description === undefined ? renderLabel(item) : (
                <div data-grammar-list-copy="true">
                    {renderLabel(item)}
                    <HeroDescription
                        data-grammar-item-description="true"
                        data-grammar-description-lines={item.descriptionLines ?? descriptionLines}
                        style={item.emphasis === "unread" ? { fontWeight: presentation.unreadWeight } : undefined}
                    >{item.description}</HeroDescription>
                </div>
            )}
            {item.trailing === undefined ? null : <span data-grammar-list-trailing="true">{item.trailing}</span>}
            {selectionMode === "none" || selectionIndicator === "none" ? null : <HeroListBox.ItemIndicator />}
            </ButtonPlacementProvider>
        </HeroListBox.Item>
    )
    return (
    <HeroListBox
        aria-label={label}
        className={navigationClassName("starci-core-list-box", className)}
        data-component="ListBox"
        data-contract="FOCUS-2 STATE-1 PADDING-0"
        data-tier="branch"
        data-loading={String(isLoading)}
        {...(isLoading ? { render: (domProps: ComponentPropsWithRef<"div">) => <div {...domProps} aria-busy="true">{domProps.children}{allItems.length === 0 ? loadingSkeleton(loadingRows) : null}</div> } : {})}
        data-grammar-list-inset={resolvedInset}
        {...(inPane && resolvedInset === "panel" ? { style: { paddingInline: 0 } } : {})}
        data-grammar-list-size={size}
        data-grammar-list-selection={selectionMode}
        selectionMode={selectionMode}
        {...(selectedIds === undefined ? {} : { selectedKeys: new Set(selectedIds) })}
        {...(defaultSelectedIds === undefined ? {} : { defaultSelectedKeys: new Set(defaultSelectedIds) })}
        {...(onSelectionChange === undefined ? {} : {
            onSelectionChange: (selection: Selection) => onSelectionChange(selection === "all" ? allItems.map((item) => item.id) : [...selection].map(String)),
        })}
        {...(onAction === undefined ? {} : { onAction: (key: string | number) => onAction(String(key)) })}
        {...(isLoading
            ? {}
            : emptyContent === undefined ? {} : { renderEmptyState: () => <div className="starci-core-list-box-empty" data-contract="STATE-3" data-grammar-list-empty="true">{emptyContent}</div> })}
    >
        {sections === undefined ? items.map(renderItem) : sections.flatMap((section, index) => {
            const sectionElement = <HeroListBox.Section key={section.id} id={section.id} aria-label={section.label}>
                <HeroHeader data-grammar-list-section-header="true">{section.label}</HeroHeader>
                {section.items.map(renderItem)}
            </HeroListBox.Section>
            return index === 0 ? [sectionElement] : [<HeroSeparator key={`separator-${index}`} />, sectionElement]
        })}
    </HeroListBox>
    )
}
