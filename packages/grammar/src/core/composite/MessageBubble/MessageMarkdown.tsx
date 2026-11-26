"use client"

import { fromMarkdown } from "mdast-util-from-markdown"
import { gfmFromMarkdown } from "mdast-util-gfm"
import { gfm } from "micromark-extension-gfm"
import type { List, ListItem, Paragraph, PhrasingContent, Root, RootContent } from "mdast"
import { useMemo, type ReactNode } from "react"
import { Code } from "../../leaf/Code/index.js"
import { Link } from "../../leaf/Link/index.js"
import { isExternalUrl, isSafeLink } from "../../frame/Markdown/urls.js"
import type { NoChildren } from "../../tier.js"

/**
 * The Markdown a chat message may carry (0.60.0, owner 2026-11-26: "chat hỗ trợ render markdown"): bold, italic, strikethrough, inline code, links, line breaks,
 * paragraphs and lists (bulleted, numbered). Everything else a longer document has (headings, tables, images, fences, quotes, raw HTML) is NOT drawn as such: its
 * words stay, as plain text, so a message never grows a heading or loads an image and the bubble keeps its face.
 */
type Allowed = Paragraph | List

/** The words of a node and everything under it, as the author typed them: what a disallowed node becomes. */
const wordsOf = (node: RootContent | PhrasingContent): string => {
    if (node.type === "text" || node.type === "inlineCode" || node.type === "html" || node.type === "code") return node.value
    if (node.type === "break") return "\n"
    if (node.type === "image" || node.type === "imageReference") return node.alt ?? ""
    if ("children" in node) return node.children.map((child) => wordsOf(child as RootContent)).join(node.type === "table" || node.type === "tableRow" ? " " : "")
    return ""
}

/**
 * The allowed subset of a parsed message: paragraphs and lists stay; any other block (a heading, a quote, a table, a fence, raw HTML, a rule) becomes a paragraph of its
 * words. A rule or a definition draws nothing. Exported for the spec; the component below is its only caller.
 */
export const restrictMessageTree = (tree: Root): ReadonlyArray<Allowed> => {
    const blocks: Allowed[] = []
    const visit = (node: RootContent): void => {
        if (node.type === "paragraph" || node.type === "list") { blocks.push(node); return }
        if (node.type === "thematicBreak" || node.type === "definition" || node.type === "footnoteDefinition") return
        const text = wordsOf(node).trim()
        if (text !== "") blocks.push({ type: "paragraph", children: [{ type: "text", value: text }] })
    }
    for (const node of tree.children) visit(node)
    return blocks
}

const Inline = ({ nodes }: { readonly nodes: ReadonlyArray<PhrasingContent> }): ReactNode =>
    nodes.map((node, index) => <InlineNode key={index} node={node} />)

const InlineNode = ({ node }: { readonly node: PhrasingContent }): ReactNode => {
    switch (node.type) {
        case "text":
            return node.value
        case "strong":
            return <strong><Inline nodes={node.children} /></strong>
        case "emphasis":
            return <em><Inline nodes={node.children} /></em>
        case "delete":
            return <del><Inline nodes={node.children} /></del>
        case "inlineCode":
            return <Code>{node.value}</Code>
        case "break":
            return <br />
        case "link": {
            // A link is its words; a destination that is not http(s), mailto, tel or relative is shown as its words, never as a target.
            if (!isSafeLink(node.url)) return <Inline nodes={node.children} />
            const external = isExternalUrl(node.url)
            return <Link href={node.url} {...(external ? { kind: "external" as const } : {})}>{node.children.map((child) => wordsOf(child)).join("")}</Link>
        }
        // A reference, an image, a footnote mark and raw HTML are never drawn as themselves: their words only.
        default:
            return wordsOf(node)
    }
}

const Block = ({ node }: { readonly node: Allowed }): ReactNode => {
    if (node.type === "paragraph") return <p><Inline nodes={node.children} /></p>
    const items = node.children.map((item: ListItem, index: number) => (
        <li key={index}>
            {item.children.map((child, childIndex) => {
                if (child.type === "paragraph") return <Inline key={childIndex} nodes={child.children} />
                if (child.type === "list") return <Block key={childIndex} node={child} />
                const text = wordsOf(child)
                return text === "" ? null : <span key={childIndex}>{text}</span>
            })}
        </li>
    ))
    return node.ordered === true ? <ol {...(node.start != null && node.start !== 1 ? { start: node.start } : {})}>{items}</ol> : <ul>{items}</ul>
}

export type MessageMarkdownProps = NoChildren & {
    /** The message as Markdown. Raw HTML is never rendered; a link off the safe schemes is shown as its words. */
    readonly source: string
}

/**
 * A chat message drawn from Markdown with the grammar's own parts: the text is parsed to a syntax tree (mdast) and mapped node by node to elements, so no HTML
 * string is built or injected, and only the subset a message needs is mapped (`restrictMessageTree`). A link is `Link` (an external one opens in its own context),
 * inline code is `Code`. It lives in the bubble's body, which already sets the face, the size and the foreground (also on the brand fill of an outgoing message).
 */
export const MessageMarkdown = ({ source }: MessageMarkdownProps) => {
    const blocks = useMemo(() => restrictMessageTree(fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })), [source])
    return (
        <div className="starci-core-message-markdown" data-component="MessageMarkdown" data-grammar-message-markdown="true">
            {blocks.map((block, index) => <Block key={index} node={block} />)}
        </div>
    )
}
