"use client"

import { ToggleButton as HeroToggleButton, ToggleButtonGroup as HeroToggleButtonGroup, type Key } from "@heroui/react"
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { Button } from "../../primitive/Button/index.js"
import { SearchField } from "../../primitive/SearchField/index.js"
import { Skeleton } from "../../primitive/Skeleton/index.js"
import { ListBox } from "../../branch/ListBox/index.js"
import { Popover } from "../../branch/Popover/index.js"

export type FilterOption = {
    readonly value: string
    readonly label: string
    /** How many items the value holds. `0` stays visible. */
    readonly count?: number
    readonly isDisabled?: boolean
}

export type FilterButtonGroupProps = {
    /** Names the group for assistive technology, e.g. "Provider". Hidden from sight unless `isLabelVisible`. */
    readonly label: string
    readonly isLabelVisible?: boolean
    readonly options: ReadonlyArray<FilterOption>
    readonly value?: string
    readonly defaultValue?: string
    readonly onValueChange?: (value: string) => void
    /** App-owned accessible name of the overflow button, e.g. `(count) => \`${count} more filters\``. */
    readonly moreLabel?: (count: number) => string
    /** App-owned name of the search field in the overflow list, and its placeholder. */
    readonly searchLabel?: string
    /** Shown in the overflow list when the search matches nothing. */
    readonly emptyLabel?: string
    /** One row of skeleton buttons while the options are unresolved (knowledge STATE-8). */
    readonly isSkeleton?: boolean
}

const firstKey = (keys: Iterable<Key>): string | undefined => {
    const first = keys[Symbol.iterator]().next()
    return first.done ? undefined : String(first.value)
}

/** Lower case without tone marks, so "ke toan" finds "Kế toán" (the Vietnamese đ folds to d). */
export const foldForSearch = (text: string): string =>
    text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "d").toLowerCase()

const GAP_PX = 8
const SKELETON_COUNT = 4
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect

const optionContent = (option: FilterOption): ReactNode => (
    <>
        <span className="starci-core-filter-button-label">{option.label}</span>
        {option.count === undefined ? null : <span className="starci-core-filter-button-count">{option.count}</span>}
    </>
)

/**
 * The options that show in the row: the first option and the selected one always, then the rest in order while they fit with
 * the overflow button after them. `widths` are the measured widths of every option, `plusWidth` the overflow button's.
 */
export const visibleOptionIndexes = (widths: ReadonlyArray<number>, selected: number, available: number, plusWidth: number): ReadonlyArray<number> => {
    const all = widths.map((_, index) => index)
    const total = widths.reduce((sum, width) => sum + width, 0) + GAP_PX * Math.max(0, widths.length - 1)
    if (total <= available) return all
    const pinned = new Set<number>([0])
    if (selected >= 0) pinned.add(selected)
    const used = (set: ReadonlySet<number>) => [...set].reduce((sum, index) => sum + (widths[index] ?? 0), 0) + GAP_PX * Math.max(0, set.size - 1) + GAP_PX + plusWidth
    const shown = new Set(pinned)
    for (const index of all) {
        if (shown.has(index)) continue
        const next = new Set(shown).add(index)
        if (used(next) > available) break
        shown.add(index)
    }
    return all.filter((index) => shown.has(index))
}

/**
 * Peer values that filter a collection in place: a group of small toggle buttons on ONE row, one value selected (a radio group
 * to assistive technology, arrow keys move). The row never wraps: options that do not fit go behind a "+n" button that opens a
 * searchable list, and a chosen hidden option takes its place in the row. The fit is measured from the real width, and the
 * row stays hidden until it is measured, so the server render holds one row of the same height and nothing jumps.
 * Selected is the accent soft pair; the rest take the surface.
 */
export const FilterButtonGroup = ({
    label,
    isLabelVisible = false,
    options,
    value,
    defaultValue,
    onValueChange,
    moreLabel = (count) => `${count} more filters`,
    searchLabel = "Search filters",
    emptyLabel = "No filter found",
    isSkeleton = false,
}: FilterButtonGroupProps) => {
    const id = useId().replaceAll(":", "")
    const labelId = `filter${id}-label`
    const [held, setHeld] = useState<string | undefined>(value ?? defaultValue ?? options[0]?.value)
    const selected = value ?? held
    const selectedIndex = options.findIndex((option) => option.value === selected)
    const rowRef = useRef<HTMLDivElement>(null)
    const measureRef = useRef<HTMLDivElement>(null)
    const plusMeasureRef = useRef<HTMLSpanElement>(null)
    const [fit, setFit] = useState<{ readonly widths: ReadonlyArray<number>, readonly plus: number, readonly available: number } | null>(null)
    const [isOpen, setIsOpen] = useState(false)
    const [query, setQuery] = useState("")

    const measure = useCallback(() => {
        const row = rowRef.current
        const probe = measureRef.current
        const plus = plusMeasureRef.current
        if (row === null || probe === null || plus === null) return
        const widths = Array.from(probe.firstElementChild?.children ?? []).map((child) => Math.ceil(child.getBoundingClientRect().width))
        const next = { widths, plus: Math.ceil(plus.getBoundingClientRect().width) + 4, available: Math.floor(row.getBoundingClientRect().width) }
        setFit((previous) => previous !== null && previous.available === next.available && previous.plus === next.plus && previous.widths.length === widths.length && previous.widths.every((width, index) => width === widths[index]) ? previous : next)
    }, [])
    const optionKey = options.map((option) => `${option.value}|${option.label}|${option.count ?? ""}`).join("\u0000")
    useIsomorphicLayoutEffect(() => { measure() }, [measure, optionKey, isSkeleton])
    useEffect(() => {
        const row = rowRef.current
        if (row === null || typeof ResizeObserver === "undefined") return
        const observer = new ResizeObserver(() => measure())
        observer.observe(row)
        return () => observer.disconnect()
    }, [measure, isSkeleton])

    const shown = useMemo<ReadonlyArray<number>>(
        () => fit === null || fit.widths.length !== options.length ? options.map((_, index) => index) : visibleOptionIndexes(fit.widths, selectedIndex, fit.available, fit.plus),
        [fit, options, selectedIndex],
    )
    const hidden = useMemo(() => options.filter((_, index) => !shown.includes(index)), [options, shown])
    const filtered = useMemo(() => {
        const needle = foldForSearch(query.trim())
        return needle === "" ? hidden : hidden.filter((option) => foldForSearch(option.label).includes(needle))
    }, [hidden, query])

    const pick = (next: string) => {
        setHeld(next)
        onValueChange?.(next)
    }

    if (isSkeleton) {
        return (
            <div className="starci-core-filter-button-group" data-component="FilterButtonGroup" data-tier="composite" data-grammar-filter-fit="ready" aria-busy="true" data-loading="true">
                <div className="starci-core-filter-button-row">
                    {Array.from({ length: Math.min(SKELETON_COUNT, Math.max(1, options.length)) }, (_, index) => (
                        <span className="starci-core-filter-button-skeleton" key={index}><Skeleton shape="rect" /></span>
                    ))}
                </div>
            </div>
        )
    }

    const onSearchKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        if (event.key !== "ArrowDown") return
        const list = event.currentTarget.querySelector<HTMLElement>("[role=\"listbox\"] [role=\"option\"]")
        if (list === null) return
        event.preventDefault()
        list.focus()
    }

    return (
        <div
            className="starci-core-filter-button-group"
            data-component="FilterButtonGroup"
            data-tier="composite"
            data-contract="A11Y-1 STATE-6 FOCUS-2"
            data-grammar-filter-fit={fit === null ? "pending" : "ready"}
        >
            <span id={labelId} className={isLabelVisible ? "starci-core-field-label" : "starci-core-field-label starci-core-form-label--screen-reader"} data-grammar-field-label="true">{label}</span>
            <div className="starci-core-filter-button-row" ref={rowRef}>
                <HeroToggleButtonGroup
                    aria-labelledby={labelId}
                    className="starci-core-filter-button-toggles"
                    data-grammar-field-control="true"
                    isDetached
                    selectionMode="single"
                    disallowEmptySelection
                    size="sm"
                    selectedKeys={selected === undefined ? [] : [selected]}
                    onSelectionChange={(keys) => {
                        const next = firstKey(keys)
                        if (next !== undefined) pick(next)
                    }}
                >
                    {shown.map((index) => {
                        const option = options[index]
                        if (option === undefined) return null
                        return (
                            <HeroToggleButton key={option.value} id={option.value} isDisabled={option.isDisabled === true} className="starci-core-filter-button" data-grammar-option="true">
                                {optionContent(option)}
                            </HeroToggleButton>
                        )
                    })}
                </HeroToggleButtonGroup>
                {hidden.length === 0 ? null : (
                    <Popover
                        isOpen={isOpen}
                        onOpenChange={(next) => {
                            setIsOpen(next)
                            if (!next) setQuery("")
                        }}
                        label={searchLabel}
                        placement="bottom"
                        trigger={<Button variant="secondary" size="sm" aria-label={moreLabel(hidden.length)}>{`+${hidden.length}`}</Button>}
                    >
                        <div className="starci-core-filter-button-panel" onKeyDown={onSearchKeyDown}>
                            <SearchField
                                label={searchLabel}
                                isLabelHidden
                                placeholder={searchLabel}
                                value={query}
                                onValueChange={setQuery}
                                onSubmit={() => {
                                    const first = filtered[0]
                                    if (first === undefined) return
                                    pick(first.value)
                                    setIsOpen(false)
                                    setQuery("")
                                }}
                                autoFocus
                            />
                            <div className="starci-core-filter-button-list">
                                <ListBox
                                    label={label}
                                    selectionMode="none"
                                    items={filtered.map((option) => ({
                                        id: option.value,
                                        label: option.label,
                                        isDisabled: option.isDisabled === true,
                                        ...(option.count === undefined ? {} : { trailing: <span className="starci-core-filter-button-count">{option.count}</span> }),
                                    }))}
                                    onAction={(next) => {
                                        pick(next)
                                        setIsOpen(false)
                                        setQuery("")
                                    }}
                                    emptyContent={<span className="starci-core-filter-button-empty">{emptyLabel}</span>}
                                />
                            </div>
                        </div>
                    </Popover>
                )}
            </div>
            <div aria-hidden="true" className="starci-core-filter-button-probe" inert ref={measureRef}>
                <HeroToggleButtonGroup aria-label={label} isDetached size="sm" className="starci-core-filter-button-toggles">
                    {options.map((option) => (
                        <HeroToggleButton key={option.value} id={option.value} className="starci-core-filter-button">{optionContent(option)}</HeroToggleButton>
                    ))}
                </HeroToggleButtonGroup>
            </div>
            <span aria-hidden="true" className="starci-core-filter-button-probe" inert ref={plusMeasureRef}>
                <Button variant="secondary" size="sm" aria-label={label}>{`+${Math.max(options.length, 1)}`}</Button>
            </span>
        </div>
    )
}
