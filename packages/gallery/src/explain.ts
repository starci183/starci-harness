// Reads one explain.md: a front matter (title, route, area) and one "## <Region>" per visible region, each with the lines "Vì sao:", "Luật:" and "Grammar:".
// A region is a bug when it lacks a Vì sao or Grammar value, or when a value starts with CHƯA RÕ or SAI. `starci app check` judges the same file by the same rules
// (HFS_APP_GALLERY_*, packages/hfs/runtime/scripts/hfs/gallery-explain.mts); the hfs specs keep the two readers answering alike.
export const FIELDS = ["Vì sao", "Luật", "Grammar"] as const
export type Field = (typeof FIELDS)[number]
const REQUIRED: readonly Field[] = ["Vì sao", "Grammar"]
const UNCLEAR = /^(?:CHƯA RÕ|SAI)(?![\p{L}\p{N}])/u
const fieldPattern = (field: string): RegExp => new RegExp(`^\\s*(?:[-*]\\s*)?\\*{0,2}${field}\\*{0,2}:\\*{0,2}[ \\t]*`, "iu")
const PATTERNS: readonly (readonly [Field, RegExp])[] = FIELDS.map((field) => [field, fieldPattern(field)] as const)

export interface Problem {
    readonly kind: "missing" | "unclear"
    readonly field: Field
}
export interface Region {
    readonly name: string
    readonly fields: Partial<Record<Field, string>>
    readonly problems: Problem[]
}
export interface Explain {
    readonly meta: Record<string, string>
    readonly intro: string
    readonly regions: Region[]
}

/** The only widths a screen is shot at; a state or an agent variant is its own screen folder. */
export const SHOT_WIDTHS = ["1440", "1920", "390"] as const
export type Width = (typeof SHOT_WIDTHS)[number]

export function parseExplain(markdown: string): Explain {
    let body = markdown.normalize("NFC").replace(/\r\n/gu, "\n")
    const meta: Record<string, string> = {}
    const front = /^---\n([\s\S]*?)\n---\n?/u.exec(body)
    if (front) {
        for (const line of (front[1] ?? "").split("\n")) {
            const pair = /^(\w+):\s*(.*)$/u.exec(line)
            if (pair?.[1] !== undefined) meta[pair[1]] = (pair[2] ?? "").replace(/^["']|["']$/gu, "").trim()
        }
        body = body.slice(front[0].length)
    }
    const regions: Region[] = []
    const intro: string[] = []
    let current: Region | null = null
    let last: Field | null = null
    for (const line of body.split("\n")) {
        const heading = /^##\s+(.+?)\s*$/u.exec(line)
        if (heading?.[1] !== undefined) {
            current = { name: heading[1], fields: {}, problems: [] }
            regions.push(current)
            last = null
            continue
        }
        if (!current) {
            intro.push(line)
            continue
        }
        const hit = PATTERNS.find(([, pattern]) => pattern.test(line))
        if (hit) {
            current.fields[hit[0]] = line.replace(hit[1], "").trim()
            last = hit[0]
        } else if (last !== null && line.trim() !== "") {
            current.fields[last] = `${current.fields[last] ?? ""} ${line.trim()}`.trim()
        }
    }
    for (const region of regions) {
        for (const field of FIELDS) {
            const value = region.fields[field]
            if (REQUIRED.includes(field) && !value) region.problems.push({ kind: "missing", field })
            else if (value && UNCLEAR.test(value)) region.problems.push({ kind: "unclear", field })
        }
    }
    return { meta, intro: intro.join("\n").trim(), regions }
}

export interface Link {
    readonly to: string
    readonly x?: number
    readonly y?: number
    readonly w?: number
    readonly h?: number
}

const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** links.json of a screen: an array, or { links: [...] }, of { to, x, y, w, h } hotspots (fractions of the shot); empty when malformed. */
export function linkList(json: unknown): Link[] {
    const list = Array.isArray(json) ? (json as unknown[]) : plain(json) && Array.isArray(json.links) ? (json.links as unknown[]) : null
    if (!list?.every((link) => plain(link) && typeof link.to === "string" && link.to !== "")) return []
    return list as Link[]
}

export interface Flow {
    readonly name: string
    readonly screens: string[]
}

/** flows.json: { "<name>": ["<area>/<screen>", ...] } or [{ name, screens }]; empty when malformed. */
export function flowList(json: unknown): Flow[] {
    const entries: [unknown, unknown][] = Array.isArray(json)
        ? (json as unknown[]).map((flow) => (plain(flow) ? [flow.name, flow.screens] : [undefined, undefined]))
        : plain(json)
          ? Object.entries(json)
          : []
    const ok = entries.every(([name, screens]) => typeof name === "string" && name !== "" && Array.isArray(screens) && screens.every((id) => typeof id === "string" && id !== ""))
    return ok ? entries.map(([name, screens]) => ({ name: name as string, screens: screens as string[] })) : []
}

const ENTITIES: Readonly<Record<string, string>> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " }

/** The inline markup of a canvas note as markdown: code and bold kept, every other tag dropped, entities decoded. */
const inlineMarkdown = (html: string): string =>
    html
        .replace(/<br\s*\/?>/giu, " ")
        .replace(/<code[^>]*>([\s\S]*?)<\/code>/giu, "`$1`")
        .replace(/<(?:b|strong)[^>]*>([\s\S]*?)<\/(?:b|strong)>/giu, "**$1**")
        .replace(/<[^>]+>/gu, "")
        .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/gu, (entity) => ENTITIES[entity] ?? entity)
        .replace(/\s+/gu, " ")
        .trim()

/**
 * The note of a canvas fragment (`<div class="note">`, skills/claude-design references/format.md) as the explain.md it copies: `.fm` is the front matter
 * (`title: … · route: … · area: …`), `.intro` the introduction, each `<h4>` a region and the `<p>` lines under it its Vì sao, Luật and Grammar lines.
 */
export function noteToMarkdown(noteHtml: string): string {
    const lines: string[] = []
    const fm = /<div class="fm"[^>]*>([\s\S]*?)<\/div>/u.exec(noteHtml)?.[1]
    if (fm !== undefined) {
        lines.push("---")
        for (const part of inlineMarkdown(fm).split(" · ")) {
            const pair = /^(\w+):\s*(.*)$/u.exec(part.trim())
            if (pair?.[1] !== undefined) lines.push(`${pair[1]}: ${pair[2] ?? ""}`)
        }
        lines.push("---", "")
    }
    const rest = fm === undefined ? noteHtml : noteHtml.replace(/<div class="fm"[^>]*>[\s\S]*?<\/div>/u, "")
    for (const [, tag, inner] of rest.matchAll(/<(p|h4)\b[^>]*>([\s\S]*?)<\/\1>/giu)) {
        const text = inlineMarkdown(inner ?? "")
        if (text === "") continue
        if (tag?.toLowerCase() === "h4") lines.push("", `## ${text}`)
        else lines.push(text)
    }
    return lines.join("\n")
}

const CLAUSES = ["Mục tiêu", "Thao tác", "Bố cục", "Nút chính", "Lọc", "Khác bản hiện tại", "Lưu ý xung đột"] as const

/** The introduction split at its clauses (`Mục tiêu:`, `Thao tác:` …) so it reads as rows; one unnamed row when it holds fewer than two. */
export function introClauses(intro: string): { label: string | null; text: string }[] {
    const pattern = new RegExp(`(?:^|\\s)(?:\\*\\*)?(${CLAUSES.join("|")}):(?:\\*\\*)?\\s*`, "gu")
    const hits = [...intro.matchAll(pattern)]
    if (hits.length < 2) return intro === "" ? [] : [{ label: null, text: intro }]
    const rows: { label: string | null; text: string }[] = []
    const head = intro.slice(0, hits[0]?.index ?? 0).trim()
    if (head !== "") rows.push({ label: null, text: head })
    hits.forEach((hit, index) => {
        const start = hit.index + hit[0].length
        const end = hits[index + 1]?.index ?? intro.length
        rows.push({ label: hit[1] ?? null, text: intro.slice(start, end).trim() })
    })
    return rows
}
