"use client"

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Disclosure } from "../../branch/Disclosure/index.js"

/** One margin note: the term as the prose writes it, and what it means. */
export type SidenoteItem = {
    /** The id a `SidenoteTerm` in the prose names. */
    readonly id: string
    readonly term: string
    readonly note: ReactNode
}

export type SidenotesProps = {
    /** The prose: paragraphs and blocks that carry `SidenoteTerm`s. */
    readonly children: ReactNode
    readonly notes: readonly SidenoteItem[]
    /** The heading of the margin column ("Terms in this question"); also its landmark name. */
    readonly title: string
    /** The fold's words on a narrow frame, given the count ("Terms (4)"). */
    readonly foldLabel: (count: number) => string
    /**
     * A narrow frame (under 52rem): `fold` (default) gathers the notes in one quiet fold under the prose; `inline` (0.57.1, a phone
     * reading) has no fold: pressing a term opens its note right under it, in the paragraph, and pressing it again closes it.
     */
    readonly narrow?: "fold" | "inline"
}

type SidenotesContextValue = {
    readonly noteId: (id: string) => string
    readonly register: (id: string, node: HTMLElement | null) => void
    readonly activeId: string | null
    readonly setActive: (id: string | null) => void
    readonly reveal: (id: string) => void
    /** `inline` on a narrow frame: the terms open their notes in place. */
    readonly isInline: boolean
    readonly openIds: ReadonlySet<string>
    /** True while the margin column is drawn (a wide frame). */
    readonly isWide: () => boolean
    readonly toggle: (id: string) => void
    readonly noteOf: (id: string) => SidenoteItem | undefined
}

const SidenotesContext = createContext<SidenotesContextValue | null>(null)

/** Use the layout effect in the browser only (the server renders the notes stacked). */
const useClientLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect

/**
 * FRAME - `Sidenotes`: prose with its terms explained in the margin (owner 2026-11-23, a lesson's vocabulary). On a wide frame the notes
 * stand in a column beside the prose, each level with the dotted term it explains (pushed down only when the one above needs the room);
 * hovering or focusing a term marks its note, and its note is the term's description. On a narrow frame (under 52rem) the column folds
 * into one quiet line under the prose, "Terms (n)", and pressing a term opens it at that note; with `narrow="inline"` (0.57.1) there is no
 * fold and a pressed term opens its own note in place, under it in the paragraph.
 * Contract: A11Y-2 (the column is a named complementary landmark, a term is described by its note), FOCUS-1.
 */
export const Sidenotes = ({ children, notes, title, foldLabel, narrow = "fold" }: SidenotesProps) => {
    const base = useId()
    const frame = useRef<HTMLDivElement | null>(null)
    const side = useRef<HTMLElement | null>(null)
    const terms = useRef(new Map<string, HTMLElement>())
    const [activeId, setActiveId] = useState<string | null>(null)
    const [isFoldOpen, setFoldOpen] = useState(false)
    const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set())
    const isWide = useCallback(() => side.current !== null && side.current.offsetParent !== null, [])
    const toggle = useCallback((id: string) => {
        setOpenIds((now) => {
            const next = new Set(now)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }, [])
    const [revision, setRevision] = useState(0)
    const noteId = useCallback((id: string) => `${base}-note-${id}`, [base])

    const register = useCallback((id: string, node: HTMLElement | null) => {
        if (node === null) terms.current.delete(id)
        else if (!terms.current.has(id)) terms.current.set(id, node)
    }, [])

    const reveal = useCallback((id: string) => {
        setActiveId(id)
        setFoldOpen(true)
        // The note shown on this frame (the column's or the fold's) is brought into view once the fold has opened.
        requestAnimationFrame(() => {
            const shown = [...(frame.current?.querySelectorAll<HTMLElement>(`[data-grammar-sidenote="${CSS.escape(id)}"]`) ?? [])].find((node) => node.offsetParent !== null)
            shown?.scrollIntoView({ block: "nearest", behavior: "smooth" })
        })
    }, [])

    // Each note stands level with its term in the column: its top is the term's top, or just under the note above when that is lower.
    useClientLayoutEffect(() => {
        const column = side.current
        if (column === null) return
        const list = column.querySelectorAll<HTMLElement>("[data-grammar-sidenote]")
        if (column.offsetParent === null) {
            for (const node of list) node.style.marginBlockStart = ""
            return
        }
        // The column's own gap is the least room between two notes; the list (a plain block) starts where the notes may start.
        const gap = Number.parseFloat(getComputedStyle(column).rowGap) || 0
        const columnTop = column.getBoundingClientRect().top
        let flow = (column.querySelector<HTMLElement>(".starci-core-sidenotes-list")?.getBoundingClientRect().top ?? columnTop) - columnTop
        list.forEach((node, index) => {
            const least = index === 0 ? 0 : gap
            const term = terms.current.get(node.dataset.grammarSidenote ?? "")
            const wanted = term === undefined ? flow + least : term.getBoundingClientRect().top - columnTop
            const offset = Math.max(least, wanted - flow)
            node.style.marginBlockStart = `${String(offset)}px`
            flow += offset + node.getBoundingClientRect().height
        })
    }, [notes, revision])

    useEffect(() => {
        const element = frame.current
        if (element === null || typeof ResizeObserver === "undefined") return
        const observer = new ResizeObserver(() => setRevision((value) => value + 1))
        observer.observe(element)
        return () => { observer.disconnect() }
    }, [])

    const noteOf = useCallback((id: string) => notes.find((item) => item.id === id), [notes])
    const context = useMemo<SidenotesContextValue>(
        () => ({ noteId, register, activeId, setActive: setActiveId, reveal, isInline: narrow === "inline", openIds, isWide, toggle, noteOf }),
        [activeId, noteId, register, reveal, narrow, openIds, isWide, toggle, noteOf],
    )

    const list = (where: "side" | "fold") => (
        <dl className="starci-core-sidenotes-list">
            {notes.map((item) => (
                <div
                    key={item.id}
                    className="starci-core-sidenote"
                    data-grammar-sidenote={item.id}
                    data-grammar-sidenote-active={activeId === item.id ? "true" : "false"}
                    onMouseEnter={() => setActiveId(item.id)}
                    onMouseLeave={() => setActiveId(null)}
                >
                    <dt className="starci-core-sidenote-term">{item.term}</dt>
                    <dd className="starci-core-sidenote-note" {...(where === "side" ? { id: noteId(item.id) } : {})}>{item.note}</dd>
                </div>
            ))}
        </dl>
    )

    return (
        <SidenotesContext.Provider value={context}>
            <div ref={frame} className="starci-core-sidenotes" data-component="Sidenotes" data-tier="frame" data-contract="A11Y-2 FOCUS-1">
                <div className="starci-core-sidenotes-grid">
                    <div className="starci-core-sidenotes-main">
                        {children}
                        {narrow === "fold" ? (
                            <div className="starci-core-sidenotes-fold">
                                <Disclosure kind="quiet" title={foldLabel(notes.length)} body={list("fold")} isExpanded={isFoldOpen} onExpandedChange={setFoldOpen} />
                            </div>
                        ) : null}
                    </div>
                    <aside ref={side} className="starci-core-sidenotes-side" aria-label={title}>
                        <p className="starci-core-sidenotes-title">{title}</p>
                        {list("side")}
                    </aside>
                </div>
            </div>
        </SidenotesContext.Provider>
    )
}

export type SidenoteTermProps = {
    /** The id of its note in the `Sidenotes` around it. */
    readonly id: string
    /** The term as it stands in the sentence. */
    readonly children: string
}

/**
 * LEAF PART of `Sidenotes` - `SidenoteTerm`: a term in the prose with a dotted underline, anchoring its margin note. It keeps the words
 * around it (size, weight, colour). It is a real button described by its note: a hover or focus marks the note, a press brings it into
 * view (on a narrow frame it opens the fold at it, or with `narrow="inline"` opens and closes its note in place). Outside `Sidenotes` it is
 * plain text.
 */
export const SidenoteTerm = ({ id, children }: SidenoteTermProps) => {
    const context = useContext(SidenotesContext)
    const ref = useCallback((node: HTMLButtonElement | null) => { context?.register(id, node) }, [context, id])
    if (context === null) return <>{children}</>
    const inlineId = `${context.noteId(id)}-inline`
    const isOpen = context.isInline && context.openIds.has(id)
    const note = context.isInline ? context.noteOf(id) : undefined
    const button = (
        <button
            ref={ref}
            type="button"
            className="starci-core-sidenote-anchor"
            data-component="SidenoteTerm"
            data-tier="frame"
            data-grammar-sidenote-active={context.activeId === id ? "true" : "false"}
            aria-describedby={context.noteId(id)}
            onMouseEnter={() => context.setActive(id)}
            onMouseLeave={() => context.setActive(null)}
            onFocus={() => context.setActive(id)}
            onBlur={() => context.setActive(null)}
            {...(context.isInline ? { "aria-expanded": isOpen, "aria-controls": inlineId } : {})}
            onClick={() => (context.isInline && !context.isWide() ? context.toggle(id) : context.reveal(id))}
        >
            {children}
        </button>
    )
    if (note === undefined) return button
    return (
        <>
            {button}
            <span id={inlineId} className="starci-core-sidenote-inline" hidden={!isOpen}>
                <span className="starci-core-sidenote-inline-term">{note.term}</span>
                <span className="starci-core-sidenote-inline-note">{note.note}</span>
            </span>
        </>
    )
}
