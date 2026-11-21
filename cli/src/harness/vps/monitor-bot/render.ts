/**
 * The look of every reply of the monitor bot (contexts/project/monitoring.md PROJECT-MONITORING-6): Telegram HTML parse mode, aligned tables in
 * `<pre>`, unicode bars and sparklines, status emojis, numbers written the Vietnamese way (1.234,5). Pure functions, no I/O: the specs pin them.
 * This folder runs in the monitor-bot container on Node's built-ins alone; it imports nothing outside it.
 */

/** Escapes the three characters Telegram's HTML parse mode reads. */
export const escapeHtml = (text: string): string => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

/** A number the Vietnamese way: `.` between thousands, `,` before the decimals. */
export const formatNumber = (value: number, decimals = 0): string => {
    if (!Number.isFinite(value)) return "—"
    const fixed = Math.abs(value).toFixed(decimals)
    const [whole = "0", fraction] = fixed.split(".")
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
    const sign = value < 0 && Number(fixed) !== 0 ? "-" : ""
    return `${sign}${grouped}${fraction === undefined ? "" : `,${fraction}`}`
}

/** A fraction (0..1) as a percent, one decimal under 10%. */
export const formatPercent = (fraction: number): string => (Number.isFinite(fraction) ? `${formatNumber(fraction * 100, Math.abs(fraction) < 0.1 ? 1 : 0)}%` : "—")

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const

/** Bytes in binary units (1 GB = 1024 MB), one decimal from MB up. */
export const formatBytes = (bytes: number): string => {
    if (!Number.isFinite(bytes)) return "—"
    let value = Math.abs(bytes)
    let unit = 0
    while (value >= 1024 && unit < UNITS.length - 1) {
        value /= 1024
        unit += 1
    }
    return `${bytes < 0 ? "-" : ""}${formatNumber(value, unit >= 2 ? 1 : 0)} ${UNITS[unit] ?? "B"}`
}

/** A duration in seconds, the two largest units in Vietnamese (`2 ngày 3 giờ`, `5 phút`). */
export const formatDuration = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds < 0) return "—"
    const parts: [number, string][] = [
        [Math.floor(seconds / 86_400), "ngày"],
        [Math.floor((seconds % 86_400) / 3600), "giờ"],
        [Math.floor((seconds % 3600) / 60), "phút"],
        [Math.floor(seconds % 60), "giây"],
    ]
    const first = parts.findIndex(([count]) => count > 0)
    if (first === -1) return "0 giây"
    return parts
        .slice(first, first + 2)
        .filter(([count]) => count > 0)
        .map(([count, unit]) => `${String(count)} ${unit}`)
        .join(" ")
}

/** A bar of `width` cells, filled to the fraction (clamped to 0..1): ▓ filled, ░ empty. */
export const bar = (fraction: number, width = 10): string => {
    const clamped = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0
    const filled = Math.round(clamped * width)
    return "▓".repeat(filled) + "░".repeat(width - filled)
}

const SPARKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const

/** A sparkline of the values, at most `width` cells (averaged buckets); a flat series is its lowest cell; a missing point a space. */
export const sparkline = (values: readonly number[], width = 24): string => {
    const finite = values.filter((value) => Number.isFinite(value))
    if (finite.length === 0) return ""
    const buckets: number[] = []
    const size = Math.max(1, Math.ceil(values.length / width))
    for (let start = 0; start < values.length; start += size) {
        const slice = values.slice(start, start + size).filter((value) => Number.isFinite(value))
        buckets.push(slice.length === 0 ? Number.NaN : slice.reduce((sum, value) => sum + value, 0) / slice.length)
    }
    const min = Math.min(...finite)
    const max = Math.max(...finite)
    return buckets
        .map((value) => {
            if (!Number.isFinite(value)) return " "
            if (max === min) return SPARKS[0]
            return SPARKS[Math.min(SPARKS.length - 1, Math.floor(((value - min) / (max - min)) * SPARKS.length))] ?? SPARKS[0]
        })
        .join("")
}

/** The status emoji of a fraction against its warning and critical thresholds. */
export const statusOf = (fraction: number, warn: number, critical: number): string => {
    if (!Number.isFinite(fraction)) return "⚪"
    if (fraction >= critical) return "🔴"
    if (fraction >= warn) return "⚠️"
    return "🟢"
}

/** The column alignment of a table: left or right. */
export type Align = "left" | "right"

/** The display width of a cell: one per code point (the bars, sparks and digits a table holds are one cell each). */
const widthOf = (text: string): number => Array.from(text).length

const pad = (text: string, width: number, align: Align): string => {
    const gap = " ".repeat(Math.max(0, width - widthOf(text)))
    return align === "right" ? gap + text : text + gap
}

/** Cuts a cell to `max` display cells, ending it with `…`. */
export const clip = (text: string, max: number): string => {
    const chars = Array.from(text)
    return chars.length <= max ? text : `${chars.slice(0, Math.max(0, max - 1)).join("")}…`
}

/**
 * An aligned table in one `<pre>` block: every cell escaped, each column padded to its widest cell, aligned as `aligns` says (left by
 * default). A header row, when given, is followed by a rule.
 */
export const table = (rows: readonly (readonly string[])[], options: { readonly header?: readonly string[]; readonly aligns?: readonly Align[] } = {}): string => {
    const all = options.header === undefined ? rows : [options.header, ...rows]
    const columns = Math.max(0, ...all.map((row) => row.length))
    const widths = Array.from({ length: columns }, (_unused, column) => Math.max(0, ...all.map((row) => widthOf(row[column] ?? ""))))
    const line = (row: readonly string[]): string =>
        widths
            .map((width, column) => pad(row[column] ?? "", width, options.aligns?.[column] ?? "left"))
            .join("  ")
            .trimEnd()
    const lines = rows.map(line)
    const head = options.header === undefined ? [] : [line(options.header), "─".repeat(widths.reduce((sum, width) => sum + width, 0) + 2 * Math.max(0, columns - 1))]
    return `<pre>${escapeHtml([...head, ...lines].join("\n"))}</pre>`
}

/** Telegram's limit of one message; a reply is cut before it, closing an open `<pre>`. */
export const MESSAGE_LIMIT = 4096

/** Cuts a reply to Telegram's limit, keeping its HTML well formed (an open `<pre>` is closed). */
export const fitMessage = (html: string, limit = MESSAGE_LIMIT): string => {
    if (html.length <= limit) return html
    const tail = "\n…(đã cắt bớt)"
    let cut = html.slice(0, limit - tail.length - "</pre>".length)
    const lastAmp = cut.lastIndexOf("&")
    if (lastAmp > cut.lastIndexOf(";")) cut = cut.slice(0, lastAmp)
    const lastLt = cut.lastIndexOf("<")
    if (lastLt > cut.lastIndexOf(">")) cut = cut.slice(0, lastLt)
    const open = (cut.match(/<pre>/g) ?? []).length > (cut.match(/<\/pre>/g) ?? []).length
    return `${cut}${open ? "</pre>" : ""}${tail}`
}
