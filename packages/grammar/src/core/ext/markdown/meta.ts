/** The meta string of a fence (`file=src/x.ts highlight=2,4-6 start=10 title="A · B"`), read into keys and bare flags. */
export interface FenceMeta {
    readonly values: Readonly<Record<string, string>>
    readonly flags: readonly string[]
}

const TOKEN = /([A-Za-z][\w-]*)=(?:"([^"]*)"|'([^']*)'|(\S+))|([A-Za-z][\w-]*)/g

/** Reads `key=value`, `key="quoted value"` and bare words; anything else is ignored. */
export const readMeta = (meta: string | null | undefined): FenceMeta => {
    const values: Record<string, string> = {}
    const flags: string[] = []
    if (meta === null || meta === undefined) return { values, flags }
    for (const match of meta.matchAll(TOKEN)) {
        const [, key, double, single, bare, flag] = match
        if (key !== undefined) values[key] = double ?? single ?? bare ?? ""
        else if (flag !== undefined) flags.push(flag)
    }
    return { values, flags }
}

/** `2,4-6` -> [2, 4, 5, 6]; a part that is not a number or a range is skipped, and so is a range over 500 lines. */
export const readLineList = (text: string | undefined): number[] => {
    if (text === undefined || text.trim() === "") return []
    const lines = new Set<number>()
    for (const part of text.split(",")) {
        const range = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part)
        if (range === null) continue
        const from = Number(range[1])
        const to = range[2] === undefined ? from : Number(range[2])
        if (to < from || to - from > 500) continue
        for (let line = from; line <= to; line += 1) lines.add(line)
    }
    return [...lines].sort((a, b) => a - b)
}

/** A positive whole number, or the fallback. */
export const readStart = (text: string | undefined): number => {
    if (text === undefined) return 1
    const value = Number(text)
    return Number.isInteger(value) && value >= 0 ? value : 1
}
