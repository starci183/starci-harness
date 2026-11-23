"use client"

import { useRef, useState, type KeyboardEvent } from "react"
import type { NoChildren } from "../../tier.js"

/** One answer of a `ChoiceCard`: what is sent (`value`), the words on the cell, a short muted fact after them, and whether choosing it cannot be undone. */
export type ChoiceCardOption = {
    readonly value: string
    /** The thing the answer names ("Số liệu một bài đăng"), never a bare number. */
    readonly label: string
    /** A short fact after the label, muted, after a middle dot ("xong 21:19"). */
    readonly hint?: string
    /**
     * Choosing it cannot be undone (stop, delete): the cell's words are the danger ink, with no fill, no edge and no button look (a cell, not a Button),
     * and the first press only asks for the confirmation (`labels.confirm`); the second press chooses it.
     */
    readonly isDestructive?: boolean
}

export type ChoiceCardProps = NoChildren & {
    /** The short question over the cells ("Bạn đang hỏi việc nào?"). The options are never repeated in it. */
    readonly question: string
    /** The answers, in order: a long one fills a row, two short ones share a row. */
    readonly options: ReadonlyArray<ChoiceCardOption>
    /** The last full-width cell, for an answer none of the cells gives ("Việc khác…"): the app focuses its composer. Disabled with the rest once a cell is chosen. */
    readonly other?: { readonly label: string; readonly onPress: () => void }
    /** The value already chosen: its cell takes the accent soft fill and the check, every cell is muted and disabled. */
    readonly chosen?: string | null
    /** The value whose answer is in flight: its cell is busy, the others wait disabled. */
    readonly pending?: string | null
    /** The card takes no answer from this reader (it is for someone else, or the moment passed): every cell is disabled. */
    readonly isDisabled?: boolean
    readonly onChoose?: (value: string) => void
    /** The app's words: `confirm` names the second press of a destructive cell ("Bấm lần nữa để dừng: Video ngắn"). */
    readonly labels?: { readonly confirm: (label: string) => string }
    readonly id?: string
}

/** The most characters a cell may hold (label, middle dot and hint) and still share its row with another. */
export const CHOICE_CARD_SHORT_MAX = 18

/** One cell of the grid: an option (by its index) or the `other` cell, its row, its column (0 or 1) and whether it fills the row. */
export type ChoiceCardCell = { readonly kind: "option"; readonly index: number; readonly row: number; readonly col: number; readonly isFull: boolean } | { readonly kind: "other"; readonly row: number; readonly col: 0; readonly isFull: true }

const wordsOf = (option: ChoiceCardOption): string => (option.hint === undefined || option.hint === "" ? option.label : `${option.label} · ${option.hint}`)

/**
 * The grid of a card: options in order, a long one (more than `CHOICE_CARD_SHORT_MAX` characters with its hint) alone on its row, two short neighbours on
 * one row, a short one with no short neighbour alone; then the `other` cell on the last row. Exported so the layout is one rule an app can read.
 */
export const choiceCardCellsOf = (options: ReadonlyArray<ChoiceCardOption>, hasOther: boolean): ReadonlyArray<ChoiceCardCell> => {
    const cells: ChoiceCardCell[] = []
    const isShort = (option: ChoiceCardOption | undefined): boolean => option !== undefined && wordsOf(option).length <= CHOICE_CARD_SHORT_MAX
    let row = 0
    for (let index = 0; index < options.length; index += 1) {
        if (isShort(options[index]) && isShort(options[index + 1])) {
            cells.push({ kind: "option", index, row, col: 0, isFull: false }, { kind: "option", index: index + 1, row, col: 1, isFull: false })
            index += 1
        } else cells.push({ kind: "option", index, row, col: 0, isFull: true })
        row += 1
    }
    if (hasOther) cells.push({ kind: "other", row, col: 0, isFull: true })
    return cells
}

/** The cell an arrow key moves to from `at`: left and right walk the cells in order, up and down the row above or below (the nearest column), Home and End the ends. */
export const choiceCardMoveOf = (cells: ReadonlyArray<ChoiceCardCell>, at: number, key: string): number => {
    const here = cells[at]
    if (here === undefined) return at
    if (key === "ArrowRight") return Math.min(at + 1, cells.length - 1)
    if (key === "ArrowLeft") return Math.max(at - 1, 0)
    if (key === "Home") return 0
    if (key === "End") return cells.length - 1
    if (key !== "ArrowDown" && key !== "ArrowUp") return at
    const target = here.row + (key === "ArrowDown" ? 1 : -1)
    const inRow = cells.map((cell, index) => ({ cell, index })).filter((entry) => entry.cell.row === target)
    if (inRow.length === 0) return at
    const same = inRow.find((entry) => entry.cell.col === here.col) ?? inRow[0]
    return same === undefined ? at : same.index
}

/** The check of the chosen cell, at 1em of its words. */
const CheckGlyph = () => (
    <svg aria-hidden="true" className="starci-core-choice-card-check" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 10.5 8.5 14.5 15.5 6" />
    </svg>
)

/**
 * COMPOSITE - `ChoiceCard`: a question with its answers as ONE card (Telegram's inline keyboard, the iOS alert), the body of `MessageBubble content="card"`:
 * the short question on top, then the answers as cells in the same frame, separated by hairlines (horizontal between rows, vertical between the two cells
 * of a row). A long answer fills its row, short ones go two to a row; `other` adds the last full-width cell ("Việc khác…"). Each cell names the thing,
 * with a short muted `hint`. Once `chosen`, that cell takes the accent soft fill and the check, the rest are muted and every cell is disabled. A destructive
 * answer is the danger ink only (a cell, never a danger button) and asks once more before it is chosen.
 * Keyboard: one cell is in the tab order; the arrow keys move within the grid (left and right in order, up and down by row), Home and End to the ends, Enter
 * and Space press; Escape takes back a confirmation. Each answer cell carries `aria-pressed` (true on the chosen one).
 * Contract: A11Y-2 (the check is decorative; the cell's words name it), FOCUS-1 (a visible focus ring on the cell).
 */
export const ChoiceCard = ({ question, options, other, chosen = null, pending = null, isDisabled = false, onChoose, labels, id }: ChoiceCardProps) => {
    const cells = choiceCardCellsOf(options, other !== undefined)
    const refs = useRef<Array<HTMLButtonElement | null>>([])
    const [confirming, setConfirming] = useState<string | null>(null)
    const [focusAt, setFocusAt] = useState(() => Math.max(0, cells.findIndex((cell) => cell.kind === "option" && options[cell.index]?.value === chosen)))
    const isClosed = chosen !== null || isDisabled
    const isBusy = pending !== null
    const press = (option: ChoiceCardOption) => {
        if (isClosed || isBusy) return
        if (option.isDestructive === true && confirming !== option.value) {
            setConfirming(option.value)
            return
        }
        setConfirming(null)
        onChoose?.(option.value)
    }
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape" && confirming !== null) {
            event.preventDefault()
            setConfirming(null)
            return
        }
        const next = choiceCardMoveOf(cells, focusAt, event.key)
        if (next === focusAt) return
        event.preventDefault()
        setFocusAt(next)
        refs.current[next]?.focus()
    }
    return (
        <div
            className="starci-core-choice-card"
            data-component="ChoiceCard"
            data-tier="composite"
            data-contract="A11Y-2 FOCUS-1"
            {...(id === undefined ? {} : { id })}
            {...(isClosed ? { "data-closed": "true" } : {})}
        >
            <div className="starci-core-choice-card-question">{question}</div>
            <div
                className="starci-core-choice-card-grid"
                role="group"
                aria-label={question}
                onKeyDown={onKeyDown}
                onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) setConfirming(null)
                }}
            >
                {cells.map((cell, at) => {
                    const option = cell.kind === "option" ? options[cell.index] : undefined
                    const isChosen = option !== undefined && option.value === chosen
                    const isPending = option !== undefined && option.value === pending
                    const isConfirming = option !== undefined && option.value === confirming
                    const disabled = isClosed || (isBusy && !isPending)
                    const common = {
                        ref: (node: HTMLButtonElement | null) => {
                            refs.current[at] = node
                        },
                        type: "button" as const,
                        className: "starci-core-choice-card-cell",
                        "data-row": cell.row,
                        "data-col": cell.col,
                        ...(cell.isFull ? { "data-full": "true" } : {}),
                        tabIndex: at === focusAt ? 0 : -1,
                        disabled,
                        onFocus: () => setFocusAt(at),
                    }
                    if (option === undefined) {
                        return (
                            <button key="other" {...common} data-other="true" onClick={() => other?.onPress()}>
                                <span className="starci-core-choice-card-words">{other?.label}</span>
                            </button>
                        )
                    }
                    return (
                        <button
                            key={option.value}
                            {...common}
                            aria-pressed={isChosen}
                            {...(isPending ? { "aria-busy": true } : {})}
                            {...(isChosen ? { "data-chosen": "true" } : {})}
                            {...(option.isDestructive === true ? { "data-destructive": "true" } : {})}
                            {...(isConfirming ? { "data-confirming": "true" } : {})}
                            onClick={() => press(option)}
                        >
                            {isChosen ? <CheckGlyph /> : null}
                            {/* one line of words that wraps as text: the label, then its hint, centred together (never a column of its own) */}
                            <span className="starci-core-choice-card-words">
                                <span className="starci-core-choice-card-label">{isConfirming && labels !== undefined ? labels.confirm(option.label) : option.label}</span>
                                {isConfirming || option.hint === undefined || option.hint === "" ? null : <span className="starci-core-choice-card-hint">{` · ${option.hint}`}</span>}
                            </span>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
