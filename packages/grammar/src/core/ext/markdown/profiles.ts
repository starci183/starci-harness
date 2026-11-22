import type { BlockType, InlineType, ProfileName } from "./types.js"

/**
 * A profile is an allow-list: the blocks and inlines a text of that kind may hold, and how many of a block it may hold. `<Markdown>`
 * draws only what its profile allows, and `validate` reports the rest, so a question stem never grows a diagram.
 */
export interface Profile {
    readonly name: ProfileName
    readonly blocks: readonly BlockType[]
    readonly inlines: readonly InlineType[]
    /** At most this many of a block (stem: one code block; option: one diff). */
    readonly max: Partial<Readonly<Record<BlockType, number>>>
}

const ALL_BLOCKS: readonly BlockType[] = [
    "heading", "paragraph", "list", "blockquote", "thematicBreak", "code", "diff", "terminal", "mermaid", "compare", "callout", "accordion", "tabs", "table",
]
const ALL_INLINES: readonly InlineType[] = ["text", "strong", "emphasis", "delete", "inlineCode", "link", "image", "break"]
/** Words with emphasis and names: what a stem, an option or a report line says. */
const TEXT_INLINES: readonly InlineType[] = ["text", "strong", "emphasis", "inlineCode", "break"]

export const PROFILES: Readonly<Record<ProfileName, Profile>> = {
    /** A body text: everything. */
    prose: { name: "prose", blocks: ALL_BLOCKS, inlines: ALL_INLINES, max: {} },
    /** A question stem: text, inline code and ONE code block. */
    stem: { name: "stem", blocks: ["paragraph", "code"], inlines: TEXT_INLINES, max: { code: 1 } },
    /** An answer option: text, inline code and a `diff` fence. */
    option: { name: "option", blocks: ["paragraph", "diff"], inlines: TEXT_INLINES, max: { diff: 1 } },
    /** A test report: text, a terminal, an expected/received compare and code. */
    report: { name: "report", blocks: ["paragraph", "terminal", "compare", "code"], inlines: TEXT_INLINES, max: {} },
}

export const PROFILE_NAMES = Object.keys(PROFILES) as ProfileName[]

export const profileOf = (name: ProfileName): Profile => PROFILES[name]

/** Inline code names a thing (a function, a key, a file); past this many characters it is code that wants a block. */
export const INLINE_CODE_MAX = 40
