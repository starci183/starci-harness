import { parse } from "./parse.js"
import { INLINE_CODE_MAX, profileOf, type Profile } from "./profiles.js"
import { childInlines, walkBlocks, walkInlines } from "./tree.js"
import type { Block, Issue, IssueCode, MarkdownTree, ProfileName, SourcePoint } from "./types.js"

const BLOCK_WORDS: Readonly<Record<Block["type"], string>> = {
    heading: "a heading",
    paragraph: "a paragraph",
    list: "a list",
    blockquote: "a quote",
    thematicBreak: "a rule",
    code: "a code block",
    diff: "a diff",
    terminal: "a terminal",
    mermaid: "a mermaid figure",
    compare: "a compare",
    callout: "a callout",
    accordion: "an accordion",
    tabs: "a tab group",
    table: "a table",
}

const issue = (code: IssueCode, severity: Issue["severity"], message: string, at: SourcePoint | undefined): Issue => ({
    code,
    severity,
    message,
    ...(at === undefined ? {} : { line: at.line, column: at.column }),
})

/** The profile's rules over a parsed tree (the tree's own `issues` are not repeated). */
export const validateTree = (tree: MarkdownTree, profile: Profile): Issue[] => {
    const found: Issue[] = []
    const counts = new Map<Block["type"], number>()
    walkBlocks(tree.children, (node) => {
        const at = node.at
        if (!profile.blocks.includes(node.type)) found.push(issue("MD_NOT_ALLOWED", "error", `${BLOCK_WORDS[node.type]} is not allowed in the ${profile.name} profile (allowed: ${profile.blocks.join(", ")})`, at))
        counts.set(node.type, (counts.get(node.type) ?? 0) + 1)
        const max = profile.max[node.type]
        if (max !== undefined && counts.get(node.type) === max + 1) found.push(issue("MD_TOO_MANY", "error", `the ${profile.name} profile holds at most ${String(max)} ${node.type} block${max === 1 ? "" : "s"}`, at))
        if (node.type === "mermaid" && node.caption.trim() === "") found.push(issue("MD_MERMAID_CAPTION_MISSING", "error", "a mermaid figure needs its caption: ```mermaid caption=\"Figure 1: ...\"", at))
        walkInlines(childInlines(node), (one) => {
            const inlineAt = "at" in one ? one.at : at
            if (!profile.inlines.includes(one.type)) found.push(issue("MD_NOT_ALLOWED", "error", `${one.type} is not allowed in the ${profile.name} profile`, inlineAt))
            if (one.type === "inlineCode" && one.value.length > INLINE_CODE_MAX) {
                found.push(issue("MD_INLINE_CODE_TOO_LONG", "warning", `inline code is for names (at most ${String(INLINE_CODE_MAX)} characters); \`${one.value.slice(0, 24)}…\` belongs in a code block`, inlineAt))
            }
        })
    })
    return found
}

/**
 * Judges one text against a profile: what `parse` dropped or could not read (raw HTML, an unknown directive, a highlight out of range)
 * and the profile's allow-list (a block or an inline it does not allow, more than its maximum), the mermaid caption, inline code that is
 * too long for a name. Sorted by line. An importer refuses a text with any `error`.
 */
export const validate = (markdown: string, profile: ProfileName = "prose"): Issue[] => {
    const tree = parse(markdown)
    return [...tree.issues, ...validateTree(tree, profileOf(profile))].sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0))
}

/** True when no issue is an error. */
export const isValid = (issues: readonly Issue[]): boolean => issues.every((one) => one.severity !== "error")
