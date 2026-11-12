"use client"

import { fromMarkdown } from "mdast-util-from-markdown"
import { gfmFromMarkdown } from "mdast-util-gfm"
import { gfm } from "micromark-extension-gfm"
import type { Code as CodeNode, Definition, PhrasingContent, Root, RootContent } from "mdast"
import { useMemo, type ReactNode } from "react"
import { Code } from "../../leaf/Code/index.js"
import { Image } from "../../leaf/Image/index.js"
import { Link } from "../../leaf/Link/index.js"
import { MediaFrame } from "../../leaf/MediaFrame/index.js"
import { Text } from "../../leaf/Text/index.js"
import { FencedCodeBlock, MarkdownArticle, MarkdownTableFrame } from "../MarkdownArticle/index.js"
import { MermaidDiagram } from "../MermaidDiagram/index.js"
import type { NoChildren } from "../../tier.js"
import { CopyAction } from "./CopyAction.js"
import { isExternalUrl, isSafeImage, isSafeLink } from "./urls.js"

/** The words the rendered body speaks itself. Every one has an English default; pass them translated. */
export type MarkdownLabels = {
    /** The Copy action of a code block. */
    readonly copy?: string
    /** The Copy action after the code reached the clipboard. */
    readonly copied?: string
    /** Announced when the clipboard refused. */
    readonly copyError?: string
    /** Names a Mermaid diagram; a body with several diagrams numbers them ("Diagram 1"). */
    readonly diagram?: string
    /** The error title of a diagram that cannot be drawn. */
    readonly diagramError?: string
    /** Names a table's scrolling frame. */
    readonly table?: string
    /** Read for a checked task-list item. */
    readonly taskDone?: string
    /** Read for an unchecked task-list item. */
    readonly taskOpen?: string
    /** Appended (visually hidden) to an external link, e.g. "opens in a new tab". */
    readonly externalHint?: string
}

/** One fenced code block as the `renderCode` slot receives it. */
export type MarkdownCode = {
    /** The info string of the fence (`ts`, `bash`), or `null` when the fence names none. */
    readonly language: string | null
    /** The exact code, as the author typed it (what Copy writes to the clipboard). */
    readonly value: string
}

export type MarkdownProps = NoChildren & {
    /** The markdown (CommonMark with GitHub tables, task lists, strikethrough, autolinks and footnotes). Raw HTML is never rendered. */
    readonly source: string
    /** The line length of the frame; `reading` by default. */
    readonly measure?: "reading" | "compact"
    /** Accessible name of the whole document, when it is worth naming. */
    readonly ariaLabel?: string
    readonly labels?: MarkdownLabels
    /** Decides whether a link leaves the site (opens in a new context and ends in the arrow). Default: an absolute http(s) URL. */
    readonly isExternal?: (href: string) => boolean
    /**
     * Draws the body of a fenced code block (syntax highlighting): the app supplies the highlighter, Grammar depends on none. The slot replaces ONLY the
     * code body; the `FencedCodeBlock` frame, its language label and its Copy action stay Grammar's, and Copy always writes the original `value`.
     * Return the already-highlighted markup in a `data-grammar-fenced-code-highlight="true"` wrapper (Grammar styles the frame and scrolls it inline),
     * or `null` to keep the plain text (e.g. while the highlighter is still loading). A `mermaid` fence never goes through the slot.
     */
    readonly renderCode?: (code: MarkdownCode) => ReactNode
}

const DEFAULT_LABELS: Required<MarkdownLabels> = {
    copy: "Copy",
    copied: "Copied",
    copyError: "Could not copy. Select the code and copy it by hand.",
    diagram: "Diagram",
    diagramError: "This diagram could not be drawn.",
    table: "Table",
    taskDone: "Done",
    taskOpen: "Not done",
    externalHint: "",
}

type Context = {
    readonly labels: Required<MarkdownLabels>
    readonly isExternal: (href: string) => boolean
    readonly definitions: ReadonlyMap<string, Definition>
    /** The label of every Mermaid fence, by node: a body with one diagram keeps the plain name, several are numbered. */
    readonly diagramLabels: ReadonlyMap<CodeNode, string>
    readonly renderCode: ((code: MarkdownCode) => ReactNode) | undefined
}

/** A fence: the plain block, or the frame around the app's highlighted body. */
const FenceOf = (props: { readonly node: CodeNode; readonly context: Context }) => {
    const { node, context } = props
    const action = <CopyAction code={node.value} copyLabel={context.labels.copy} copiedLabel={context.labels.copied} copyErrorLabel={context.labels.copyError} />
    const language = node.lang == null || node.lang === "" ? undefined : node.lang
    const rendered = context.renderCode?.({ language: language ?? null, value: node.value }) ?? null
    if (rendered === null || rendered === false) {
        return <FencedCodeBlock code={node.value} {...(language === undefined ? {} : { language })} action={action} />
    }
    // The frame cannot measure a rendered body, so the one-line command (no language label) is decided here.
    const isOneLine = !node.value.trim().includes("\n")
    return (
        <FencedCodeBlock {...(language === undefined ? {} : { language })} {...(isOneLine ? { showLanguage: false } : {})} action={action}>
            {rendered}
        </FencedCodeBlock>
    )
}

const parse = (source: string): Root =>
    fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })

const collect = (node: Root | RootContent, definitions: Definition[], diagrams: CodeNode[]): void => {
    if (node.type === "definition") definitions.push(node)
    if (node.type === "code" && node.lang === "mermaid") diagrams.push(node)
    if ("children" in node) for (const child of node.children) collect(child, definitions, diagrams)
}

const headingTag = (depth: number): "h2" | "h3" | "h4" => (depth <= 2 ? "h2" : depth === 3 ? "h3" : "h4")

/** A Link label is text; the words of a link that wraps other marks (strong, code) are read as plain text. */
const wordsOf = (nodes: ReadonlyArray<PhrasingContent>): string =>
    nodes.map((node) => {
        if (node.type === "text" || node.type === "inlineCode") return node.value
        if (node.type === "break") return " "
        if ("children" in node) return wordsOf(node.children)
        return ""
    }).join("")

const LinkOf = (props: { readonly href: string; readonly nodes: ReadonlyArray<PhrasingContent>; readonly context: Context }) => {
    const { labels } = props.context
    if (!isSafeLink(props.href)) return <Inline nodes={props.nodes} context={props.context} />
    const external = props.context.isExternal(props.href)
    return (
        <Link
            href={props.href}
            {...(external ? { kind: "external" as const } : {})}
            {...(external && labels.externalHint !== "" ? { externalHint: labels.externalHint } : {})}
        >
            {wordsOf(props.nodes)}
        </Link>
    )
}

/** An image inside a line of text; one whose destination is not http(s) or relative is shown as its alt. */
const ImageOf = (props: { readonly src: string; readonly alt: string }) =>
    isSafeImage(props.src) && props.src !== "" ? <Image src={props.src} alt={props.alt} aspect="auto" fit="contain" /> : props.alt

const Inline = (props: { readonly nodes: ReadonlyArray<PhrasingContent>; readonly context: Context }) =>
    props.nodes.map((node, index) => <InlineNode key={index} node={node} context={props.context} />)

const InlineNode = (props: { readonly node: PhrasingContent; readonly context: Context }): ReactNode => {
    const { node, context } = props
    switch (node.type) {
        case "text":
            return node.value
        case "strong":
            return <Text as="span" isStrong><Inline nodes={node.children} context={context} /></Text>
        case "emphasis":
            return <em><Inline nodes={node.children} context={context} /></em>
        case "delete":
            return <del><Inline nodes={node.children} context={context} /></del>
        case "inlineCode":
            return <Code>{node.value}</Code>
        case "break":
            return <br />
        case "link":
            return <LinkOf href={node.url} nodes={node.children} context={context} />
        case "linkReference": {
            const definition = context.definitions.get(node.identifier)
            return definition === undefined ? <Inline nodes={node.children} context={context} /> : <LinkOf href={definition.url} nodes={node.children} context={context} />
        }
        case "image":
            return <ImageOf src={node.url} alt={node.alt ?? ""} />
        case "imageReference":
            return <ImageOf src={context.definitions.get(node.identifier)?.url ?? ""} alt={node.alt ?? ""} />
        case "footnoteReference":
            return <sup>[{node.label ?? node.identifier}]</sup>
        case "html":
            // Raw HTML is never rendered: a comment is dropped, any other tag is shown as the characters the author typed.
            return node.value.startsWith("<!--") ? null : node.value
        default:
            return null
    }
}

/** A paragraph that holds only images is figures with captions, not a line of text. */
const imageOnly = (nodes: ReadonlyArray<PhrasingContent>): boolean =>
    nodes.some((node) => node.type === "image" || node.type === "imageReference") &&
    nodes.every((node) => node.type === "image" || node.type === "imageReference" || (node.type === "text" && node.value.trim() === ""))

const Figure = (props: { readonly node: PhrasingContent; readonly context: Context }): ReactNode => {
    const { node, context } = props
    if (node.type !== "image" && node.type !== "imageReference") return null
    const src = node.type === "image" ? node.url : (context.definitions.get(node.identifier)?.url ?? "")
    const alt = node.alt ?? ""
    if (src === "" || !isSafeImage(src)) return alt === "" ? null : <Text as="p">{alt}</Text>
    return <MediaFrame aspect="auto" fit="contain" media={<Image src={src} alt={alt} aspect="auto" fit="contain" />} {...(alt === "" ? {} : { caption: alt })} />
}

const Blocks = (props: { readonly nodes: ReadonlyArray<RootContent>; readonly context: Context; readonly isTight?: boolean }) =>
    props.nodes.map((node, index) => <Block key={index} node={node} context={props.context} isTight={props.isTight === true} />)

const alignStyle = (align: "left" | "right" | "center" | null | undefined) => (align === null || align === undefined ? undefined : { textAlign: align })

const Block = (props: { readonly node: RootContent; readonly context: Context; readonly isTight: boolean }): ReactNode => {
    const { node, context } = props
    switch (node.type) {
        case "heading": {
            const Tag = headingTag(node.depth)
            return <Tag><Inline nodes={node.children} context={context} /></Tag>
        }
        case "paragraph":
            if (imageOnly(node.children)) return node.children.map((child, index) => <Figure key={index} node={child} context={context} />)
            return props.isTight
                ? <Inline nodes={node.children} context={context} />
                : <Text as="p"><Inline nodes={node.children} context={context} /></Text>
        case "blockquote":
            return <blockquote><Blocks nodes={node.children} context={context} /></blockquote>
        case "thematicBreak":
            return <hr />
        case "list": {
            const items = node.children.map((item, index) => {
                const isTask = item.checked !== null && item.checked !== undefined
                return (
                    <li key={index} {...(isTask ? { "data-grammar-markdown-task": item.checked === true ? "done" : "open" } : {})}>
                        {isTask ? <input type="checkbox" checked={item.checked === true} disabled readOnly aria-label={item.checked === true ? context.labels.taskDone : context.labels.taskOpen} /> : null}
                        <Blocks nodes={item.children} context={context} isTight={node.spread !== true && item.spread !== true} />
                    </li>
                )
            })
            return node.ordered === true ? <ol {...(node.start != null && node.start !== 1 ? { start: node.start } : {})}>{items}</ol> : <ul>{items}</ul>
        }
        case "code": {
            const diagramLabel = context.diagramLabels.get(node)
            if (diagramLabel !== undefined) {
                return <MermaidDiagram source={node.value} label={diagramLabel} height="md" errorTitle={context.labels.diagramError} />
            }
            return <FenceOf node={node} context={context} />
        }
        case "table":
            return (
                <MarkdownTableFrame label={context.labels.table}>
                    <table>
                        <thead>
                            {node.children.slice(0, 1).map((row, rowIndex) => (
                                <tr key={rowIndex}>
                                    {row.children.map((cell, cellIndex) => (
                                        <th key={cellIndex} scope="col" style={alignStyle(node.align?.[cellIndex])}><Inline nodes={cell.children} context={context} /></th>
                                    ))}
                                </tr>
                            ))}
                        </thead>
                        <tbody>
                            {node.children.slice(1).map((row, rowIndex) => (
                                <tr key={rowIndex}>
                                    {row.children.map((cell, cellIndex) => (
                                        <td key={cellIndex} style={alignStyle(node.align?.[cellIndex])}><Inline nodes={cell.children} context={context} /></td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </MarkdownTableFrame>
            )
        case "footnoteDefinition":
            return (
                <Text as="div" size="xs" tone="muted">
                    [{node.label ?? node.identifier}] <Blocks nodes={node.children} context={context} isTight />
                </Text>
            )
        case "html":
            // Raw HTML is never rendered: a comment is dropped, any other markup is shown as the text the author typed.
            return node.value.startsWith("<!--") ? null : <Text as="p">{node.value}</Text>
        default:
            return null
    }
}

/**
 * A course body: a markdown string drawn with the grammar's own parts inside the reading frame (`MarkdownArticle`).
 * Headings are `h2` to `h4` (an `h1` is demoted to `h2`), a paragraph is `Text`, inline code is `Code`, a link is `Link` (an external
 * one opens in its own context and ends in the arrow), a table sits in `MarkdownTableFrame`, a fence is a `FencedCodeBlock` with a Copy
 * action, a `mermaid` fence is a `MermaidDiagram`, an image is a `MediaFrame` captioned with its alt.
 *
 * The text is parsed to a syntax tree (mdast) and mapped node by node to elements: no HTML string is built or injected. Raw HTML is
 * shown as text (a comment is dropped); a link or image whose scheme is not http(s), mailto, tel or relative is shown as its words.
 * `renderCode` (optional) draws the code body of a fence (syntax highlighting supplied by the app); the frame, language label and Copy stay here.
 * Contract: overflow OVERFLOW-4 (tables and code scroll inline inside their frames).
 */
export const Markdown = ({ source, measure, ariaLabel, labels, isExternal = isExternalUrl, renderCode }: MarkdownProps) => {
    const tree = useMemo(() => parse(source), [source])
    const { copy, copied, copyError, diagram, diagramError, table, taskDone, taskOpen, externalHint } = { ...DEFAULT_LABELS, ...stripUndefined(labels) }
    const context = useMemo<Context>(() => {
        const definitions: Definition[] = []
        const diagrams: CodeNode[] = []
        collect(tree, definitions, diagrams)
        return {
            labels: { copy, copied, copyError, diagram, diagramError, table, taskDone, taskOpen, externalHint },
            isExternal,
            renderCode,
            definitions: new Map(definitions.map((definition) => [definition.identifier, definition])),
            diagramLabels: new Map(diagrams.map((node, index) => [node, diagrams.length > 1 ? `${diagram} ${index + 1}` : diagram])),
        }
    }, [tree, isExternal, renderCode, copy, copied, copyError, diagram, diagramError, table, taskDone, taskOpen, externalHint])
    return (
        <MarkdownArticle {...(measure === undefined ? {} : { measure })} {...(ariaLabel === undefined ? {} : { ariaLabel })}>
            <Blocks nodes={tree.children} context={context} />
        </MarkdownArticle>
    )
}

const stripUndefined = (labels: MarkdownLabels | undefined): MarkdownLabels =>
    Object.fromEntries(Object.entries(labels ?? {}).filter(([, value]) => value !== undefined))
