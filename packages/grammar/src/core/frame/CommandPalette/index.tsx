"use client"

import { Autocomplete } from "react-aria-components"
import { OverlayTriggerStateContext } from "react-aria-components/Dialog"
import { useContext, useEffect, useRef, type ReactNode } from "react"
import { ListBox, type ListBoxItem, type ListBoxSection } from "../../branch/ListBox/index.js"
import { Icon } from "../../leaf/Icon/index.js"
import { Kbd } from "../../leaf/Kbd/index.js"
import { SearchField } from "../../leaf/SearchField/index.js"
import type { ErrorData } from "../../loadingState.js"
import type { OverlayOpenState } from "../../overlayScope.js"
import { Dialog } from "../Dialog/index.js"
import type { CommandPaletteGroup, CommandPaletteItem } from "./data.js"

export type CommandPaletteProps = OverlayOpenState & {
    /** The dialog's title and the search field's accessible name ("Search"). */
    readonly label: string
    /** The close button's name. */
    readonly closeLabel: string
    /** The text in the field. The palette never filters: the app searches and passes the results. */
    readonly query: string
    readonly onQueryChange: (query: string) => void
    readonly placeholder?: string
    /** The name of the field's clear button. */
    readonly clearLabel?: string
    readonly groups: ReadonlyArray<CommandPaletteGroup>
    /** A result was chosen (Enter, a press or a link). The palette closes. */
    readonly onAction: (id: string) => void
    /** What stands where the results would, when there are none (no match for the query): an `EmptyNotice`. */
    readonly empty: ReactNode
    /** The results for this query are still coming: skeleton rows in the place of the results, and the field shows its pending mark. */
    readonly isLoading?: boolean
    /** The search failed: this takes the place of the results. */
    readonly error?: ErrorData
    /** The keys hint under the results (up and down choose, Enter opens, Escape closes), in the app's language. Not drawn on a coarse pointer (a touch screen has no keys). */
    readonly footer?: ReactNode
}

const toListItem = (item: CommandPaletteItem): ListBoxItem => ({
    id: item.id,
    label: item.label,
    size: "sm",
    ...(item.hint === undefined ? {} : { description: item.hint, descriptionLines: 1 as const }),
    ...(item.source === undefined ? {} : { leading: <Icon source={item.source} usage="leading" /> }),
    ...(item.shortcut === undefined ? {} : { trailing: <Kbd keys={item.shortcut} /> }),
    ...(item.href === undefined ? {} : { href: item.href }),
    ...(item.isDisabled === undefined ? {} : { isDisabled: item.isDisabled }),
})

const toListSection = (group: CommandPaletteGroup): ListBoxSection => ({ id: group.id, label: group.label, items: group.items.map(toListItem) })

type BodyProps = Omit<CommandPaletteProps, "closeLabel" | "footer" | keyof OverlayOpenState>

/** The field and the results: virtual focus, so the arrows move through the results while the caret stays in the field. */
const PaletteBody = ({ label, query, onQueryChange, placeholder, clearLabel, groups, onAction, empty, isLoading = false, error }: BodyProps) => {
    const overlay = useContext(OverlayTriggerStateContext)
    return (
        <div className="starci-core-command-palette" data-component="CommandPalette" data-tier="frame" data-grammar-command-palette="true" data-contract="FOCUS-3 STATE-3 STATE-8">
            <Autocomplete inputValue={query} onInputChange={onQueryChange}>
                <SearchField
                    label={label}
                    isLabelHidden
                    value={query}
                    onValueChange={onQueryChange}
                    isPending={isLoading}
                    autoFocus
                    {...(placeholder === undefined ? {} : { placeholder })}
                    {...(clearLabel === undefined ? {} : { clearLabel })}
                />
                <ListBox
                    label={label}
                    sections={groups.map(toListSection)}
                    selectionMode="none"
                    size="sm"
                    isLoading={isLoading}
                    emptyContent={empty}
                    {...(error === undefined ? {} : { error })}
                    onAction={(id) => {
                        onAction(id)
                        overlay?.close()
                    }}
                />
            </Autocomplete>
        </div>
    )
}

/**
 * FRAME - `CommandPalette` (0.46.0): the one search of the whole app, a dialog over the page that takes a query and lists what matches, grouped,
 * to go to or to run. It is a `Dialog` holding a `SearchField` and a sectioned `ListBox` joined by React Aria's autocomplete: the caret stays in the
 * field and the arrows, Home and End move through the results, Enter chooses, Escape closes (the vendor's). A result is a destination (`href`) or a command (`onAction`).
 * It draws what it is given: the app searches, orders the groups and says what an empty or failed search shows. At 390 it takes the full width at the top and is as tall as its results (0.48.0);
 * the keys `footer` is not drawn on a touch screen, and the row the arrows are on wears the selected fill, not a focus ring.
 *
 * The app opens it with `isOpen` and registers the shortcut with `useCommandPaletteShortcut`; a `TopBar` search control (an `IconButton` or a `Button`
 * with a `Kbd`) opens it by press.
 * Contract: FOCUS-3 (modal trap and return), STATE-3 (empty), STATE-8 (loading keeps the list's shape).
 */
export const CommandPalette = ({ closeLabel, footer, ...rest }: CommandPaletteProps) => {
    const { isOpen, defaultOpen, onOpenChange, ...body } = rest
    return (
        <Dialog
            title={body.label}
            closeLabel={closeLabel}
            size="lg"
            {...(isOpen === undefined ? {} : { isOpen })}
            {...(defaultOpen === undefined ? {} : { defaultOpen })}
            {...(onOpenChange === undefined ? {} : { onOpenChange })}
            {...(footer === undefined ? {} : { footer })}
        >
            <PaletteBody {...body} />
        </Dialog>
    )
}

/**
 * Registers the palette's shortcut: Ctrl K, and Command K on a Mac, anywhere on the page, even while a field has focus. `onTrigger` opens the palette
 * (or toggles it). The page's own Ctrl K is taken, so call this once, in the shell.
 */
export const useCommandPaletteShortcut = (onTrigger: () => void): void => {
    const latest = useRef(onTrigger)
    useEffect(() => { latest.current = onTrigger })
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key.toLowerCase() !== "k" || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.defaultPrevented) return
            event.preventDefault()
            latest.current()
        }
        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
    }, [])
}
