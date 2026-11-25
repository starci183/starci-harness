"use client"

import type { ReactNode } from "react"
import { DropdownMenu } from "../../branch/DropdownMenu/index.js"
import { Button } from "../../leaf/Button/index.js"
import { TablerDots, TablerPencil } from "../../leaf/Icon/tabler.js"
import { IconButton } from "../../leaf/IconButton/index.js"
import { Link } from "../../leaf/Link/index.js"
import { Skeleton } from "../../leaf/Skeleton/index.js"
import { ErrorView, LOADING_ROWS, type ErrorData } from "../../loadingState.js"
import { useIsLoading } from "../../regionScope.js"
import type { ItemMenu } from "../../surfaceCardData.js"

/** One thing an agent remembers: what kind it is and where it came from, the sentence itself, who it applies to and how often it was used. */
export type NoteRowData = {
    readonly id: string
    /** The kind in the app's words ("Rule", "Preference", "Fact about the shop"), drawn over the sentence with `source`. */
    readonly kind: string
    /** Where it came from ("from the setup chat, 26 Nov"). */
    readonly source: string
    /** The remembered sentence, in the owner's words. */
    readonly text: string
    /** Who it applies to, and, when it is narrower than the shop, the one command that widens it. */
    readonly scope: {
        readonly label: string
        readonly promote?: { readonly label: string; readonly press: () => void }
    }
    /** How often the agent used it ("in 14 runs", linking to those runs when `href` is given), or the plain words when it never has ("not used yet"). */
    readonly usage: { readonly label: string; readonly href?: string }
    /** Opens the note for editing. */
    readonly edit?: { readonly label: string; readonly press: () => void }
    /** The commands beyond edit (stop using it). */
    readonly menu?: ItemMenu
}

/** The column heads of the list, the app's words. */
export type NoteListColumns = {
    readonly note: string
    readonly scope: string
    readonly usage: string
}

export type NoteListProps = {
    /** Names the list for assistive technology, e.g. "What the agent remembers". */
    readonly label: string
    readonly notes: readonly NoteRowData[]
    readonly columns: NoteListColumns
    /** What shows when there are no notes. Required: a list answers for its empty state. */
    readonly empty: ReactNode
    readonly isLoading?: boolean
    readonly error?: ErrorData
}

/** One note as a row of the list. */
export const NoteRow = ({ note, isLoading = false }: { readonly note: NoteRowData; readonly isLoading?: boolean }) => (
    <li className="starci-core-note-row" data-tier="frame" data-component="NoteRow" data-contract="GAP-3" data-grammar-row-id={note.id}>
        <div className="starci-core-note-copy">
            <span className="starci-core-note-meta">{isLoading ? <Skeleton shape="text" /> : `${note.kind} · ${note.source}`}</span>
            <span className="starci-core-note-text">{isLoading ? <Skeleton shape="text" /> : note.text}</span>
        </div>
        <div className="starci-core-note-scope">
            <span>{isLoading ? <Skeleton shape="text" /> : note.scope.label}</span>
            {isLoading || note.scope.promote === undefined ? null : <Button size="sm" variant="border" onPress={note.scope.promote.press}>{note.scope.promote.label}</Button>}
        </div>
        <div className="starci-core-note-usage" data-grammar-note-usage={note.usage.href === undefined ? "none" : "used"}>
            {isLoading ? <Skeleton shape="text" /> : note.usage.href === undefined ? note.usage.label : <Link href={note.usage.href}>{note.usage.label}</Link>}
        </div>
        <div className="starci-core-note-actions">
            {isLoading || note.edit === undefined ? null : <IconButton size="sm" label={note.edit.label} source={TablerPencil} onPress={note.edit.press} />}
            {isLoading || note.menu === undefined ? null : <DropdownMenu placement="bottom end" entries={note.menu.entries} trigger={<IconButton size="sm" label={note.menu.label} source={TablerDots} />} />}
        </div>
    </li>
)

/**
 * FRAME - `NoteList`: what an agent remembers, as the rows of `NoteRow` under their column heads (the note, who it applies to, how often it was used). A list, not a table of
 * cards: the rows stand on one surface with hairlines between them, and below 40rem each row stacks its scope and usage under the sentence. Loading keeps the heads and draws the
 * rows as geometry; no notes is the app's `empty`.
 */
export const NoteList = ({ label, notes, columns, empty, isLoading: ownLoading, error }: NoteListProps) => {
    const isLoading = useIsLoading(ownLoading)
    if (!isLoading && error !== undefined) return <ErrorView error={error} />
    if (!isLoading && notes.length === 0) return <>{empty}</>
    const shown: readonly NoteRowData[] = isLoading && notes.length === 0
        ? Array.from({ length: LOADING_ROWS }, (_unused, index) => ({ id: `loading-${index}`, kind: " ", source: " ", text: " ", scope: { label: " " }, usage: { label: " " } }))
        : notes
    return (
        <div data-tier="frame" data-component="NoteList" data-contract="STATE-8" className="starci-core-note-list" {...(isLoading ? { "aria-busy": true } : {})}>
            <div className="starci-core-note-head" aria-hidden="true">
                <span>{columns.note}</span>
                <span>{columns.scope}</span>
                <span>{columns.usage}</span>
                <span />
            </div>
            <ul className="starci-core-note-rows" aria-label={label}>
                {shown.map((note) => <NoteRow key={note.id} note={note} isLoading={isLoading} />)}
            </ul>
        </div>
    )
}
