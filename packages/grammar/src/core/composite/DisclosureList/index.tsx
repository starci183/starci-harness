"use client"

import { Disclosure, type DisclosureProps } from "../../branch/Disclosure/index.js"
import type { NoChildren } from "../../tier.js"

/** One section of the list: a `Disclosure`'s props and a stable id. Each keeps its own open state. */
export type DisclosureListItem = DisclosureProps & { readonly id: string }

export type DisclosureListProps = NoChildren & {
    /** Names the list for assistive technology, e.g. "Setup steps". */
    readonly label: string
    readonly items: ReadonlyArray<DisclosureListItem>
}

/**
 * Sibling disclosures joined into one list: a real `<ul>` of `Disclosure`s divided by full-bleed lines, the trigger rows as tall
 * as a touch target (a setup's steps, a settings group). Each section opens on its own; nothing here is a surface (put it in a card
 * or a pane). A loading region keeps the titles and draws each step mark and end summary as geometry (each `Disclosure` reads it).
 */
export const DisclosureList = ({ label, items }: DisclosureListProps) => (
    <ul className="starci-core-disclosure-list" aria-label={label} data-component="DisclosureList" data-tier="composite" data-contract="BOUNDARY-3">
        {items.map(({ id, ...disclosure }) => (
            <li key={id} className="starci-core-disclosure-list-item"><Disclosure {...disclosure} /></li>
        ))}
    </ul>
)
