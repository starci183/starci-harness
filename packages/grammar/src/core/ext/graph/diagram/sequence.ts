/**
 * The layout of a sequence diagram on the graph canvas (pure): participants as header boxes in one row, a dashed lifeline down from each, then the
 * rows in the order written, top to bottom. A message is a line between two anchor points at its row's height on the two lifelines (a self-message a
 * loop out to the right and back one step lower); a note a soft pill over the lifelines it spans; a block (alt, loop, opt, ...) a tinted field round
 * its rows, its kind and words in its top corner, a dashed divider per `else`. Columns are as far apart as the longest words between them need.
 */
import type { SequenceModel, SequenceParticipant, SequenceRow } from "./model.js"

export interface Rect {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
}

/** Measures one line of words at the canvas's size. */
export type TextWidth = (text: string) => number

export interface SequenceMessageBox {
    readonly row: Extract<SequenceRow, { readonly kind: "message" }>
    /** The line's two ends: `x1` on the sender's lifeline, `x2` on the receiver's; `y` its height (a self-message returns at `y2`). */
    readonly x1: number
    readonly x2: number
    readonly y: number
    readonly y2: number
    readonly self: boolean
    /** Where the words stand: centred over the line (or to the right of a loop). */
    readonly text: Rect
}

export interface SequenceNoteBox {
    readonly row: Extract<SequenceRow, { readonly kind: "note" }>
    readonly box: Rect
}

export interface SequenceFieldBox {
    readonly block: number
    readonly kind: string
    readonly label: string
    readonly box: Rect
    /** The dividers of the block, each with its words, at their heights. */
    readonly sections: readonly { readonly y: number; readonly label: string }[]
    /** How deep the block is nested (0 outermost). */
    readonly depth: number
}

export interface SequenceLayout {
    readonly participants: readonly (SequenceParticipant & { readonly box: Rect; readonly x: number })[]
    /** Every lifeline runs from the foot of its header to `lifelineEnd`. */
    readonly lifelineTop: number
    readonly lifelineEnd: number
    readonly messages: readonly SequenceMessageBox[]
    readonly notes: readonly SequenceNoteBox[]
    readonly fields: readonly SequenceFieldBox[]
    readonly width: number
    readonly height: number
}

/** The sizes of the layout, in canvas pixels at 100%. */
export const SEQUENCE = {
    headerHeight: 40,
    headerPadding: 16,
    headerMinWidth: 96,
    columnGap: 40,
    /** The room a message's words keep on each side between two lifelines. */
    textRoom: 24,
    textHeight: 18,
    /** A message row: its words over the line, then the room under it. */
    messageRow: 44,
    selfWidth: 36,
    selfDrop: 20,
    noteHeight: 28,
    notePadding: 12,
    noteRow: 44,
    blockHead: 30,
    blockSection: 30,
    blockFoot: 14,
    blockInset: 14,
    blockNest: 8,
    top: 0,
    foot: 16,
} as const

const lines = (text: string): readonly string[] => text.split("\n")

/** The width of words that may hold line breaks: their longest line. */
const widthOf = (measure: TextWidth, text: string): number => Math.max(0, ...lines(text).map((line) => measure(line)))

/** The participants' places: header widths from their names, then the distance between neighbours each message's words need. */
const columns = (model: SequenceModel, measure: TextWidth): readonly { readonly width: number; readonly x: number }[] => {
    const widths = model.participants.map((participant) => Math.max(SEQUENCE.headerMinWidth, widthOf(measure, participant.label) + 2 * SEQUENCE.headerPadding))
    const at = new Map(model.participants.map((participant, index) => [participant.id, index] as const))
    // gaps[i]: the distance between the centres of participant i and i + 1.
    const gaps = widths.slice(1).map((width, index) => (widths[index] ?? 0) / 2 + width / 2 + SEQUENCE.columnGap)
    const need = (from: number, to: number, room: number): void => {
        const span = gaps.slice(from, to).reduce((sum, gap) => sum + gap, 0)
        if (span >= room || to <= from) return
        const extra = (room - span) / (to - from)
        for (let index = from; index < to; index += 1) gaps[index] = (gaps[index] ?? 0) + extra
    }
    for (const row of model.rows) {
        if (row.kind !== "message" && row.kind !== "note") continue
        const a = at.get(row.from) ?? 0
        const b = at.get(row.to) ?? 0
        const [low, high] = a <= b ? [a, b] : [b, a]
        if (row.kind === "message" && low !== high) need(low, high, widthOf(measure, row.text) + 2 * SEQUENCE.textRoom)
        // A self-message's words stand right of its loop: the next column keeps them clear.
        if (row.kind === "message" && low === high && low < gaps.length) need(low, low + 1, SEQUENCE.selfWidth + widthOf(measure, row.text) + 2 * SEQUENCE.textRoom)
    }
    const centres: number[] = []
    let x = (widths[0] ?? 0) / 2
    for (let index = 0; index < widths.length; index += 1) {
        centres.push(x)
        x += gaps[index] ?? 0
    }
    return widths.map((width, index) => ({ width, x: centres[index] ?? 0 }))
}

/** The layout of a sequence: every part's box in canvas pixels, the rows in the order written. */
export const layoutSequence = (model: SequenceModel, measure: TextWidth): SequenceLayout => {
    const placed = columns(model, measure)
    const participants = model.participants.map((participant, index) => {
        const column = placed[index] ?? { width: SEQUENCE.headerMinWidth, x: 0 }
        return { ...participant, x: column.x, box: { x: column.x - column.width / 2, y: SEQUENCE.top, width: column.width, height: SEQUENCE.headerHeight } }
    })
    const xOf = new Map(participants.map((participant) => [participant.id, participant.x] as const))
    const indexOf = new Map(participants.map((participant, index) => [participant.id, index] as const))
    const messages: SequenceMessageBox[] = []
    const notes: SequenceNoteBox[] = []
    const fields: SequenceFieldBox[] = []
    const openBlocks: { block: number; kind: string; label: string; top: number; low: number; high: number; sections: { y: number; label: string }[] }[] = []
    let y = SEQUENCE.top + SEQUENCE.headerHeight + SEQUENCE.blockFoot
    // A block spans the columns its rows touch, and every block around it widens to hold it.
    const touch = (a: number, b: number): void => {
        for (const block of openBlocks) {
            block.low = Math.min(block.low, a, b)
            block.high = Math.max(block.high, a, b)
        }
    }
    for (const row of model.rows) {
        if (row.kind === "message") {
            const self = row.from === row.to
            const x1 = xOf.get(row.from) ?? 0
            const x2 = xOf.get(row.to) ?? 0
            const width = widthOf(measure, row.text)
            const height = lines(row.text).length * SEQUENCE.textHeight
            const lineY = y + height + 6
            const text: Rect = self ? { x: x1 + SEQUENCE.selfWidth + 8, y: lineY - 2, width, height } : { x: (x1 + x2) / 2 - width / 2, y: lineY - height - 4, width, height }
            messages.push({ row, x1, x2, y: lineY, y2: self ? lineY + SEQUENCE.selfDrop : lineY, self, text })
            const i = indexOf.get(row.from) ?? 0
            touch(i, indexOf.get(row.to) ?? 0)
            if (self) touch(i, Math.min(i + 1, participants.length - 1))
            y = lineY + (self ? SEQUENCE.selfDrop : 0) + (SEQUENCE.messageRow - SEQUENCE.textHeight - 6)
            continue
        }
        if (row.kind === "note") {
            const a = xOf.get(row.from) ?? 0
            const b = xOf.get(row.to) ?? 0
            const width = Math.max(widthOf(measure, row.text) + 2 * SEQUENCE.notePadding, a === b ? SEQUENCE.headerMinWidth : Math.abs(b - a) + 2 * SEQUENCE.notePadding)
            const height = Math.max(SEQUENCE.noteHeight, lines(row.text).length * SEQUENCE.textHeight + 10)
            const centre = row.side === "left" ? a - width / 2 - 8 : row.side === "right" ? a + width / 2 + 8 : (a + b) / 2
            notes.push({ row, box: { x: centre - width / 2, y, width, height } })
            touch(indexOf.get(row.from) ?? 0, indexOf.get(row.to) ?? 0)
            y += height + (SEQUENCE.noteRow - SEQUENCE.noteHeight)
            continue
        }
        if (row.kind === "open") {
            openBlocks.push({ block: row.block, kind: row.blockKind, label: row.label, top: y, low: Number.POSITIVE_INFINITY, high: Number.NEGATIVE_INFINITY, sections: [] })
            y += SEQUENCE.blockHead
            continue
        }
        if (row.kind === "section") {
            const block = openBlocks.find((each) => each.block === row.block)
            block?.sections.push({ y: y + 4, label: row.label })
            y += SEQUENCE.blockSection
            continue
        }
        const at = openBlocks.findIndex((each) => each.block === row.block)
        const block = openBlocks[at]
        if (block === undefined) continue
        openBlocks.splice(at, 1)
        const depth = openBlocks.length
        const low = Number.isFinite(block.low) ? block.low : 0
        const high = Number.isFinite(block.high) ? block.high : 0
        // A block round another stands one nesting step further out, so both edges show.
        const inner = fields.filter((field) => field.depth > depth && field.box.y >= block.top).reduce((most, field) => Math.max(most, field.depth - depth), 0)
        const inset = SEQUENCE.blockInset + inner * SEQUENCE.blockNest
        const left = (participants[low]?.x ?? 0) - SEQUENCE.headerMinWidth / 2 - inset
        const right = (participants[high]?.x ?? 0) + SEQUENCE.headerMinWidth / 2 + inset
        // A block of one lifeline (a self-message) keeps the room of its loop and words.
        const loopRoom = low === high ? Math.max(0, ...messages.filter((message) => message.self && message.y >= block.top).map((message) => message.text.x + message.text.width + inset - right)) : 0
        y += SEQUENCE.blockFoot - 6
        // The field is at least as wide as its words (the kind's tag, then the label) and every divider's.
        const words = Math.max(widthOf(measure, `${block.kind}  ${block.label}`), ...block.sections.map((section) => widthOf(measure, section.label))) + 48
        fields.push({ block: block.block, kind: block.kind, label: block.label, box: { x: left, y: block.top, width: Math.max(right - left + loopRoom, words), height: y - block.top }, sections: block.sections, depth })
        y += 6
    }
    const lifelineEnd = y + SEQUENCE.foot
    const boxes = [...participants.map((participant) => participant.box), ...notes.map((note) => note.box), ...fields.map((field) => field.box), ...messages.map((message) => message.text)]
    const minX = Math.min(0, ...boxes.map((box) => box.x))
    const maxX = Math.max(0, ...boxes.map((box) => box.x + box.width))
    // Everything shifts so the leftmost part stands at 0.
    const dx = -minX
    const shift = (box: Rect): Rect => ({ ...box, x: box.x + dx })
    return {
        participants: participants.map((participant) => ({ ...participant, x: participant.x + dx, box: shift(participant.box) })),
        lifelineTop: SEQUENCE.top + SEQUENCE.headerHeight,
        lifelineEnd,
        messages: messages.map((message) => ({ ...message, x1: message.x1 + dx, x2: message.x2 + dx, text: shift(message.text) })),
        notes: notes.map((note) => ({ ...note, box: shift(note.box) })),
        fields: fields.sort((a, b) => a.depth - b.depth).map((field) => ({ ...field, box: shift(field.box) })),
        width: maxX - minX,
        height: lifelineEnd,
    }
}
