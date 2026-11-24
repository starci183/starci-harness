"use client"

import {
    Alert,
    Badge,
    Button,
    Code,
    Disclosure,
    Divider,
    FencedCodeBlock,
    Fragment as GrammarFragment,
    Heading,
    Image,
    Link,
    MarkdownArticle,
    MarkdownTableFrame,
    Skeleton,
    Stack,
    Tabs,
    Terminal,
    Text,
} from "../../../index.js"
import { createElement as h, Fragment, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react"
import { compareSegments } from "../compare.js"
import { parse, plainText } from "../parse.js"
import { profileOf, type Profile } from "../profiles.js"
import type { Block, CalloutBlock, CodeBlock, CodeToken, CompareBlock, Diagrams, DiffBlock, Inline, MarkdownTree, MermaidBlock, ProfileName, SourcePoint, TabsBlock, TerminalBlock } from "../types.js"

/** The words the drawn body speaks itself. The consumer passes its own, in its language; the defaults are plain English. */
export interface MarkdownLabels {
    readonly copy: string
    readonly copied: string
    readonly copyError: string
    readonly tabs: string
    readonly code: string
    readonly preview: string
    readonly tab: string
    readonly expected: string
    readonly received: string
    readonly table: string
    readonly diagram: string
    readonly diagramError: string
    readonly info: string
    readonly warn: string
    readonly danger: string
    readonly tip: string
}

export const DEFAULT_LABELS: MarkdownLabels = {
    copy: "Copy",
    copied: "Copied",
    copyError: "Could not copy",
    tabs: "Views",
    code: "Code",
    preview: "Preview",
    tab: "Tab",
    expected: "Expected",
    received: "Received",
    table: "Table",
    diagram: "Diagram",
    diagramError: "This diagram could not be drawn",
    info: "Note",
    warn: "Warning",
    danger: "Danger",
    tip: "Tip",
}

/** The tone of a highlight: a Grammar soft pair (a Badge's tones). */
export type HighlightTone = "neutral" | "accent" | "info" | "success" | "warning" | "danger"

/**
 * A passage the app marks: `start` and `end` are character offsets into the markdown `source` (end exclusive), the same offsets
 * `parse` records. The words inside the range are marked, across inline code, emphasis, links and line breaks; a range over several
 * blocks is marked in each. `note` is drawn as a line under the block where the range ends.
 */
export interface MarkdownHighlight {
    readonly id: string
    readonly start: number
    readonly end: number
    readonly note?: string
    readonly tone?: HighlightTone
}

/** What a ref to `<Markdown>` can do. */
export interface MarkdownHandle {
    /** Scrolls the first mark of the highlight into view and focuses it when it is pressable; false when the id is not drawn. */
    readonly scrollToHighlight: (id: string) => boolean
}

export interface MarkdownProps {
    /** The allow-list the text is drawn under; a block or inline it does not allow is not drawn. Default `prose`. */
    readonly profile?: ProfileName
    /** The text. Parsed in place, unhighlighted; a server passes `tree` from `prepare()` instead. */
    readonly source?: string
    /** A tree from `parse()` or `prepare()` (Shiki tokens included). Wins over `source`. */
    readonly tree?: MarkdownTree
    /** The prerendered SVG of each mermaid figure, by key (`prerender()`); a figure missing here is drawn in the browser by Mermaid. */
    readonly diagrams?: Diagrams
    readonly labels?: Partial<MarkdownLabels>
    /** Passages to mark, by source offsets. */
    readonly highlights?: readonly MarkdownHighlight[]
    /** A mark was pressed (click, Enter or Space); given, every mark is a button. */
    readonly onHighlightPress?: (id: string) => void
    /** The first read has no data yet: skeleton lines, never placeholder words. */
    readonly isLoading?: boolean
    /** The line length of the frame (Grammar `MarkdownArticle`). */
    readonly measure?: "reading" | "compact"
    readonly ariaLabel?: string
    /** Draws the code of a `:::preview` pane; left out, the pane shows the code itself. */
    readonly renderPreview?: (code: string, lang: string) => ReactNode
    readonly ref?: Ref<MarkdownHandle>
}

interface Context {
    readonly profile: Profile
    readonly labels: MarkdownLabels
    readonly diagrams: Diagrams
    readonly highlights: readonly MarkdownHighlight[]
    readonly onHighlightPress: ((id: string) => void) | undefined
    readonly renderPreview: MarkdownProps["renderPreview"]
    readonly inPreview: boolean
}

const SAFE_URL = /^(?:https?:|mailto:|tel:)/i
const isSafeUrl = (url: string): boolean => SAFE_URL.test(url.trim()) || !/^[a-z][a-z\d+.-]*:/i.test(url.trim())

/* ---------------------------------------------------------------- highlights */

const Mark = (props: { readonly range: MarkdownHighlight; readonly context: Context; readonly children?: ReactNode }): ReactNode => {
    const { range, context } = props
    const press = context.onHighlightPress
    const base = { className: "starci-md-highlight", "data-highlight-id": range.id, "data-tone": range.tone ?? "warning" }
    if (press === undefined) return h("mark", base, props.children)
    const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        press(range.id)
    }
    return h("mark", { ...base, role: "button", tabIndex: 0, "aria-label": range.note, onClick: () => { press(range.id) }, onKeyDown }, props.children)
}

/** The highlights a span of the source meets. */
const meeting = (context: Context, start: number, end: number): MarkdownHighlight[] => context.highlights.filter((range) => range.start < end && range.end > start)

/**
 * A run of text split at the edges of the highlights it meets. When the node's words are its source characters one to one, the
 * split is exact; otherwise (an escape, an entity) a highlight that meets the node marks it whole.
 */
const marked = (value: string, at: SourcePoint | undefined, context: Context, draw: (text: string) => ReactNode): ReactNode => {
    if (context.highlights.length === 0 || at?.offset === undefined || at.end === undefined) return draw(value)
    const { offset, end } = at
    const ranges = meeting(context, offset, end)
    if (ranges.length === 0) return draw(value)
    if (end - offset !== value.length) {
        const [first] = ranges
        return first === undefined ? draw(value) : h(Mark, { range: first, context }, draw(value))
    }
    const cuts = new Set<number>([0, value.length])
    for (const range of ranges) {
        cuts.add(Math.max(0, range.start - offset))
        cuts.add(Math.min(value.length, range.end - offset))
    }
    const edges = [...cuts].sort((a, b) => a - b)
    return edges.slice(0, -1).map((from, index) => {
        const to = edges[index + 1] ?? value.length
        const text = value.slice(from, to)
        const range = ranges.find((one) => one.start <= offset + from && one.end >= offset + to)
        return h(Fragment, { key: index }, range === undefined ? draw(text) : h(Mark, { range, context }, draw(text)))
    })
}

/** The note lines of the highlights that end inside a block, drawn under it. */
const notesUnder = (node: Block, context: Context): ReactNode => {
    const at = node.at
    if (at?.offset === undefined || at.end === undefined) return null
    const { offset, end } = at
    const notes = context.highlights.filter((range) => range.note !== undefined && range.end > offset && range.end <= end)
    if (notes.length === 0) return null
    return notes.map((range) =>
        h("div", { key: range.id, className: "starci-md-highlight-note", "data-highlight-note": range.id, "data-tone": range.tone ?? "warning" }, h(Text, { as: "p", role: "caption" }, range.note)),
    )
}

/* ---------------------------------------------------------------- inline */

const inlineList = (nodes: readonly Inline[], context: Context): ReactNode[] => nodes.map((node, index) => h(Fragment, { key: index }, inlineNode(node, context)))

const inlineNode = (node: Inline, context: Context): ReactNode => {
    if (!context.profile.inlines.includes(node.type)) {
        if (node.type === "image") return node.alt
        if (node.type === "text") return marked(node.value, node.at, context, (text) => text)
        return node.type === "inlineCode" ? node.value : node.type === "break" ? " " : inlineList(node.children, context)
    }
    switch (node.type) {
        case "text":
            return marked(node.value, node.at, context, (text) => text)
        case "strong":
            return h(Text, { as: "span", isStrong: true }, inlineList(node.children, context))
        case "emphasis":
            return h("em", null, inlineList(node.children, context))
        case "delete":
            return h("del", null, inlineList(node.children, context))
        case "inlineCode":
            return highlightCode(node, context)
        case "break":
            return h("br")
        case "link": {
            const words = plainText(node.children)
            return isSafeUrl(node.url) && words !== "" ? h(Link, { href: node.url, children: words }) : inlineList(node.children, context)
        }
        case "image":
            return isSafeUrl(node.url) && node.url !== "" ? h(Image, { src: node.url, alt: node.alt, ratio: "auto", fit: "contain" } as never) : node.alt
    }
}

/** Inline code is Grammar's `Code`; a highlight that meets it marks the whole name, never half of it. */
const highlightCode = (node: Extract<Inline, { type: "inlineCode" }>, context: Context): ReactNode => {
    const code = h(Code, null, node.value)
    const at = node.at
    if (at?.offset === undefined || at.end === undefined) return code
    const [range] = meeting(context, at.offset, at.end)
    return range === undefined ? code : h(Mark, { range, context }, code)
}

/* ---------------------------------------------------------------- code */

/** The Copy command of a block's header: Grammar's neutral `sm` Button; the result is announced politely. */
const CopyAction = (props: { readonly code: string; readonly labels: MarkdownLabels }): ReactNode => {
    const [state, setState] = useState<"idle" | "copied" | "failed">("idle")
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
    useEffect(
        () => () => {
            if (timer.current !== null) clearTimeout(timer.current)
        },
        [],
    )
    const settle = (next: "copied" | "failed"): void => {
        setState(next)
        if (timer.current !== null) clearTimeout(timer.current)
        timer.current = setTimeout(() => {
            setState("idle")
        }, 2000)
    }
    const copy = (): void => {
        const clipboard = typeof navigator === "undefined" ? undefined : (navigator.clipboard as Clipboard | undefined)
        if (clipboard === undefined) {
            settle("failed")
            return
        }
        clipboard.writeText(props.code).then(
            () => {
                settle("copied")
            },
            () => {
                settle("failed")
            },
        )
    }
    return h(
        Fragment,
        null,
        h(Button, { variant: "border", size: "sm", onPress: copy, children: state === "copied" ? props.labels.copied : props.labels.copy }),
        h("span", { role: "status", className: "starci-md-visually-hidden" }, state === "copied" ? props.labels.copied : state === "failed" ? props.labels.copyError : ""),
    )
}

const tokenSpans = (tokens: readonly CodeToken[] | undefined, text: string): ReactNode =>
    tokens === undefined
        ? text
        : tokens.map((token, index) =>
              h(
                  "span",
                  {
                      key: index,
                      style: {
                          ...(token.color === undefined ? {} : { color: token.color }),
                          ...(token.fontStyle === "italic" ? { fontStyle: "italic" } : token.fontStyle === "bold" ? { fontWeight: "var(--grammar-weight-medium)" } : {}),
                      },
                  },
                  token.content,
              ),
          )

/** The header of a block is Grammar's: the file (or the language) at the start, the language as a Badge and Copy at the end. */
const header = (name: string | undefined, lang: string, code: string, labels: MarkdownLabels): { readonly language?: string; readonly action: ReactNode } => {
    const label = name ?? (lang === "" ? undefined : lang)
    const action = h(Fragment, null, name !== undefined && lang !== "" ? h(Badge, { tone: "neutral" }, lang) : null, h(CopyAction, { code, labels }))
    return { ...(label === undefined ? {} : { language: label }), action }
}

const CodeView = (props: { readonly node: CodeBlock; readonly labels: MarkdownLabels }): ReactNode => {
    const { node } = props
    const lines = node.code.split("\n")
    const name = node.file ?? node.title
    return h(FencedCodeBlock, {
        ...header(name, node.lang, node.code, props.labels),
        label: name ?? (node.lang === "" ? props.labels.code : node.lang),
        children: h(
            "pre",
            { tabIndex: 0, role: "region", "aria-label": name ?? (node.lang === "" ? props.labels.code : node.lang), "data-kind": "code", className: "starci-md-pre" },
            h(
                "code",
                { className: "starci-type-code" },
                lines.map((line, index) => {
                    const number = node.start + index
                    return h(
                        "span",
                        { key: index, className: "starci-md-line", ...(node.highlight.includes(number) ? { "data-highlighted": "true" } : {}) },
                        h("span", { className: "starci-md-gutter", "aria-hidden": "true" }, String(number)),
                        h("span", null, tokenSpans(node.tokens?.[index], line)),
                    )
                }),
            ),
        ),
    })
}

const DiffView = (props: { readonly node: DiffBlock; readonly labels: MarkdownLabels }): ReactNode => {
    const { node } = props
    const lang = node.lang ?? "diff"
    return h(FencedCodeBlock, {
        ...header(node.title, lang, node.code, props.labels),
        label: node.title ?? lang,
        children: h(
            "pre",
            { tabIndex: 0, role: "region", "aria-label": node.title ?? lang, "data-kind": "diff", className: "starci-md-pre" },
            h(
                "code",
                { className: "starci-type-code" },
                node.lines.map((line, index) =>
                    h(
                        "span",
                        { key: index, className: "starci-md-line", "data-sign": line.sign === "+" ? "add" : line.sign === "-" ? "remove" : "same" },
                        h("span", { className: "starci-md-gutter", "aria-hidden": "true" }, line.sign === "+" ? "+" : line.sign === "-" ? "−" : ""),
                        h("span", null, tokenSpans(node.tokens?.[index], line.text)),
                    ),
                ),
            ),
        ),
    })
}

/** A terminal is Grammar's `Terminal`: the dark log, one line per line, its title the fence's. */
const TerminalView = (props: { readonly node: TerminalBlock; readonly labels: MarkdownLabels }): ReactNode =>
    h(Terminal, { lines: props.node.lines.map((line) => line.text), ...(props.node.title === undefined ? { label: props.labels.code } : { title: props.node.title }) })

const CompareView = (props: { readonly node: CompareBlock; readonly labels: MarkdownLabels }): ReactNode => {
    const { node, labels } = props
    const split = compareSegments(node.expected, node.received)
    const side = (kind: "expected" | "received", label: string, segments: ReturnType<typeof compareSegments>["expected"]): ReactNode =>
        h(
            "div",
            { className: "starci-md-compare-side", "data-side": kind },
            h(Stack, {
                gap: "identity",
                children: [
                    h(Text, { key: "label", as: "p", role: "label.field" }, label),
                    h(FencedCodeBlock, {
                        key: "code",
                        label,
                        children: h(
                            "pre",
                            { tabIndex: 0, role: "region", "aria-label": label, className: "starci-md-pre" },
                            h("code", { className: "starci-type-code" }, segments.map((segment, index) => (segment.changed ? h("mark", { key: index, className: "starci-md-compare-change" }, segment.text) : h(Fragment, { key: index }, segment.text)))),
                        ),
                    }),
                ],
            }),
        )
    return h(
        "div",
        { className: "starci-md-compare", "data-component": "MarkdownCompare" },
        side("expected", node.expectedLabel ?? labels.expected, split.expected),
        side("received", node.receivedLabel ?? labels.received, split.received),
    )
}

/* ---------------------------------------------------------------- mermaid: the one Fragment */

const Figure = (props: { readonly caption: string; readonly art: ReactNode }): ReactNode =>
    h(GrammarFragment, {
        reason: "mermaid figure (prerendered SVG)",
        children: h(
            "figure",
            { className: "starci-md-figure", "data-component": "MarkdownFigure" },
            props.art,
            props.caption === "" ? null : h("figcaption", null, h(Text, { as: "span", role: "caption" }, props.caption)),
        ),
    })

const MermaidView = (props: { readonly node: MermaidBlock; readonly context: Context }): ReactNode => {
    const { node, context } = props
    const prerendered = context.diagrams[node.key]
    const [drawn, setDrawn] = useState<{ readonly svg: string } | "failed" | undefined>(undefined)
    useEffect(() => {
        if (prerendered !== undefined) return undefined
        let live = true
        import("../prerender/mermaid.js")
            .then(({ renderWithMermaid }) => renderWithMermaid(node.code, node.key))
            .then(
                (svg) => {
                    if (live) setDrawn({ svg })
                },
                () => {
                    if (live) setDrawn("failed")
                },
            )
        return () => {
            live = false
        }
    }, [prerendered, node.code, node.key])
    const svg = prerendered?.svg ?? (typeof drawn === "object" ? drawn.svg : undefined)
    const name = node.caption === "" ? context.labels.diagram : node.caption
    if (drawn === "failed") return h(Figure, { caption: node.caption, art: h(Alert, { tone: "negative", title: context.labels.diagramError }) })
    if (svg === undefined) return h(Figure, { caption: node.caption, art: h("div", { className: "starci-md-figure-art", "aria-busy": true }, h(Skeleton, { shape: "rect", ratio: "wide" })) })
    return h(Figure, { caption: node.caption, art: h("div", { className: "starci-md-figure-art", role: "img", "aria-label": name, dangerouslySetInnerHTML: { __html: svg } }) })
}

/* ---------------------------------------------------------------- directives */

const CALLOUT_TONE = { info: "informative", warn: "cautionary", danger: "negative", tip: "affirmative" } as const

/** A callout is Grammar's `Alert` of its tone (its soft box and status mark); `muted` is a quiet label line in the muted role. */
const CalloutView = (props: { readonly node: CalloutBlock; readonly context: Context }): ReactNode => {
    const { node, context } = props
    if (node.tone === "muted") {
        const [only] = node.children
        if (node.children.length === 1 && only?.type === "paragraph") return h(Text, { as: "p", role: "label.group" }, inlineList(only.children, context))
        return h(Stack, { gap: "row", children: [node.title === undefined ? null : h(Text, { key: "title", as: "p", role: "label.group" }, node.title), h(Fragment, { key: "body" }, blockList(node.children, context))] })
    }
    const [first, ...rest] = node.children
    const lead = first?.type === "paragraph" ? first : undefined
    const others = lead === undefined ? node.children : rest
    return h(Alert, {
        tone: CALLOUT_TONE[node.tone],
        title: node.title ?? context.labels[node.tone],
        ...(lead === undefined ? {} : { description: inlineList(lead.children, context) }),
        ...(others.length === 0 ? {} : { form: h(Stack, { gap: "row", children: blockList(others, context) }) }),
    })
}

const TabsView = (props: { readonly node: TabsBlock; readonly context: Context }): ReactNode => {
    const { node, context } = props
    const base = useId()
    const items = node.tabs.map((tab, index) => ({
        id: `${base}-tab-${String(index)}`,
        label: tab.title ?? (tab.kind === "code" ? context.labels.code : tab.kind === "preview" ? context.labels.preview : `${context.labels.tab} ${String(index + 1)}`),
    }))
    const [selected, setSelected] = useState(items[0]?.id ?? "")
    const index = Math.max(0, items.findIndex((item) => item.id === selected))
    const tab = node.tabs[index]
    if (tab === undefined) return null
    const panelId = `${base}-panel`
    return h(Stack, {
        gap: "row",
        children: [
            items.length > 1 ? h(Tabs, { key: "tabs", label: context.labels.tabs, items, selectedKey: items[index]?.id ?? "", onSelect: setSelected, panelId, inset: "none" }) : null,
            h("div", { key: "panel", id: panelId, role: items.length > 1 ? "tabpanel" : undefined }, h(Stack, { gap: "row", children: blockList(tab.children, { ...context, inPreview: tab.kind === "preview" }) })),
        ],
    })
}

/* ---------------------------------------------------------------- blocks */

const blockList = (nodes: readonly Block[], context: Context): ReactNode => {
    const counts = new Map<Block["type"], number>()
    return nodes.map((node, index) => {
        if (!context.profile.blocks.includes(node.type)) return null
        const count = (counts.get(node.type) ?? 0) + 1
        counts.set(node.type, count)
        const max = context.profile.max[node.type]
        if (max !== undefined && count > max) return null
        return h(Fragment, { key: index }, blockNode(node, context), notesUnder(node, context))
    })
}

const HEADING_LEVEL = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 4, 6: 4 } as const

const blockNode = (node: Block, context: Context): ReactNode => {
    switch (node.type) {
        case "heading":
            return h(Heading, { level: HEADING_LEVEL[node.depth], children: plainText(node.children) })
        case "paragraph":
            return h(Text, { as: "p", role: "body" }, inlineList(node.children, context))
        case "list":
            return h(
                node.ordered ? "ol" : "ul",
                node.start === undefined ? null : { start: node.start },
                node.items.map((item, index) =>
                    h("li", { key: index }, item.length === 1 && item[0]?.type === "paragraph" ? h(Text, { as: "span", role: "body" }, inlineList(item[0].children, context)) : h(Stack, { gap: "identity", children: blockList(item, context) })),
                ),
            )
        case "blockquote":
            return h("blockquote", null, h(Stack, { gap: "row", children: blockList(node.children, context) }))
        case "thematicBreak":
            return h(Divider, {})
        case "code":
            if (context.inPreview && context.renderPreview !== undefined) return context.renderPreview(node.code, node.lang)
            return h(CodeView, { node, labels: context.labels })
        case "diff":
            return h(DiffView, { node, labels: context.labels })
        case "terminal":
            return h(TerminalView, { node, labels: context.labels })
        case "mermaid":
            return h(MermaidView, { node, context })
        case "compare":
            return h(CompareView, { node, labels: context.labels })
        case "callout":
            return h(CalloutView, { node, context })
        case "accordion":
            return h(
                "div",
                { className: "starci-md-accordion" },
                node.panels.map((panel, index) => h(Disclosure, { key: index, title: panel.title, body: h(Stack, { gap: "row", children: blockList(panel.children, context) }), headingLevel: 3 })),
            )
        case "tabs":
            return h(TabsView, { node, context })
        case "table":
            return h(MarkdownTableFrame, {
                label: context.labels.table,
                children: h(
                    "table",
                    null,
                    h("thead", null, h("tr", null, node.header.map((cell, index) => h("th", { key: index, scope: "col", style: { textAlign: node.align[index] ?? undefined } }, inlineList(cell, context))))),
                    h("tbody", null, node.rows.map((row, rowIndex) => h("tr", { key: rowIndex }, row.map((cell, index) => h("td", { key: index, style: { textAlign: node.align[index] ?? undefined } }, inlineList(cell, context)))))),
                ),
            })
    }
}

/**
 * Draws one text from Grammar core and nothing of its own: Heading and Text roles for headings, paragraphs and lists, Code for inline
 * code, Link, Image, Divider, Badge, FencedCodeBlock (Grammar's header, language Badge and Copy Button; the lines in the code role, Shiki's
 * colours mapped onto Grammar tokens), Terminal, Alert for callouts, Disclosure for an accordion, Tabs, MarkdownTableFrame for a table,
 * and one Grammar `Fragment`: the prerendered mermaid figure. `highlights` marks passages by source offsets in Grammar soft pairs,
 * with an optional note line under the block where each ends; a ref offers `scrollToHighlight(id)`. Import
 * `@starci/grammar/core/ext/markdown.css` once, after the Grammar's styles.
 */
export const Markdown = (props: MarkdownProps): ReactNode => {
    const { profile = "prose", source, tree, diagrams, labels, highlights, onHighlightPress, isLoading = false, measure, ariaLabel, renderPreview, ref } = props
    const read = useMemo(() => tree ?? parse(source ?? ""), [tree, source])
    const root = useRef<HTMLDivElement>(null)
    useImperativeHandle(
        ref,
        () => ({
            scrollToHighlight: (id: string): boolean => {
                const mark = [...(root.current?.querySelectorAll<HTMLElement>("[data-highlight-id]") ?? [])].find((one) => one.dataset.highlightId === id)
                if (mark === undefined) return false
                mark.scrollIntoView({ block: "center", behavior: "smooth" })
                if (mark.tabIndex >= 0) mark.focus({ preventScroll: true })
                return true
            },
        }),
        [],
    )
    const context = useMemo<Context>(
        () => ({
            profile: profileOf(profile),
            labels: { ...DEFAULT_LABELS, ...labels },
            diagrams: diagrams ?? {},
            highlights: [...(highlights ?? [])].filter((range) => range.end > range.start).sort((a, b) => a.start - b.start),
            onHighlightPress,
            renderPreview,
            inPreview: false,
        }),
        [profile, labels, diagrams, highlights, onHighlightPress, renderPreview],
    )
    const frame = { ...(measure === undefined ? {} : { measure }), ...(ariaLabel === undefined ? {} : { ariaLabel }) }
    if (isLoading) return h(MarkdownArticle, { ...frame, children: h("div", { ref: root, className: "starci-md", "data-profile": profile, "aria-busy": true }, h(Skeleton, { shape: "text", lines: 4 })) })
    return h(MarkdownArticle, { ...frame, children: h("div", { ref: root, className: "starci-md", "data-profile": profile }, blockList(read.children, context)) })
}
