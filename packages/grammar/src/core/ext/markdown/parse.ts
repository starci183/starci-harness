import type { BlockContent, Code, DefinitionContent, Html, ListItem, Nodes, PhrasingContent, Root, RootContent, Table } from "mdast"
import type { ContainerDirective, LeafDirective, TextDirective } from "mdast-util-directive"
import remarkDirective from "remark-directive"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import { unified } from "unified"
import { diagramKey } from "./key.js"
import { readLineList, readMeta, readStart, type FenceMeta } from "./meta.js"
import type { AccordionBlock, Block, CalloutTone, CompareBlock, Inline, Issue, IssueCode, MarkdownTree, SourcePoint, TabsBlock } from "./types.js"

/** The callout names and the tone each draws; `note`, `warning` and `caution` are read as their tone. */
const CALLOUTS: Readonly<Record<string, CalloutTone>> = { muted: "muted", info: "info", note: "info", warn: "warn", warning: "warn", caution: "warn", danger: "danger", tip: "tip" }

/** Every container directive a text may use. */
export const DIRECTIVE_NAMES: readonly string[] = [...Object.keys(CALLOUTS), "accordion", "panel", "tab", "code", "preview", "compare"]

/** The meta keys a fence of each kind reads; any other key is reported (MD_FENCE_META_UNKNOWN), never an error. */
const META_KEYS = {
    code: ["file", "highlight", "start", "title"],
    diff: ["title", "lang"],
    terminal: ["title"],
    mermaid: ["caption"],
} as const

const UNSAFE_URL = /^\s*(?:javascript|vbscript|data|file):/i

interface Context {
    readonly source: string
    readonly issues: Issue[]
    readonly definitions: ReadonlyMap<string, string>
    readonly caption: RegExp | undefined
}

/** How a text is read. */
export interface ParseOptions {
    /**
     * A paragraph right under a mermaid fence with no `caption=` whose words match this becomes the figure's caption (a legacy
     * caption line, e.g. `/^Figure d+:/`). Left out, no paragraph is taken.
     */
    readonly legacyCaption?: RegExp
}

interface Positioned {
    readonly position?: { readonly start: { readonly line: number; readonly column: number; readonly offset?: number | undefined }; readonly end: { readonly offset?: number | undefined } } | undefined
}

const pointOf = (node: Positioned): SourcePoint | undefined => {
    if (node.position === undefined) return undefined
    const { start, end } = node.position
    return { line: start.line, column: start.column, ...(start.offset === undefined ? {} : { offset: start.offset }), ...(end.offset === undefined ? {} : { end: end.offset }) }
}

const report = (context: Context, code: IssueCode, severity: Issue["severity"], message: string, at: SourcePoint | undefined): void => {
    context.issues.push({ code, severity, message, ...(at === undefined ? {} : { line: at.line, column: at.column }) })
}

const withAt = <T extends object>(value: T, at: SourcePoint | undefined): T & { readonly at?: SourcePoint } => (at === undefined ? value : { ...value, at })

/** The text a node covers in the source (a text directive the texts did not mean, `10:30` or `a:b`, is kept as written). */
const sliceOf = (context: Context, node: Nodes): string => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    return start === undefined || end === undefined ? "" : context.source.slice(start, end)
}

/** The plain words of inline content: a title, a label. */
export const plainText = (nodes: readonly Inline[]): string =>
    nodes
        .map((node) => {
            switch (node.type) {
                case "text":
                case "inlineCode":
                    return node.value
                case "image":
                    return node.alt
                case "break":
                    return " "
                case "strong":
                case "emphasis":
                case "delete":
                case "link":
                    return plainText(node.children)
            }
        })
        .join("")

const inlines = (context: Context, nodes: readonly PhrasingContent[]): Inline[] => nodes.flatMap((node) => inline(context, node))

const inline = (context: Context, node: PhrasingContent | TextDirective): Inline[] => {
    const at = pointOf(node)
    switch (node.type) {
        case "text":
            return [withAt({ type: "text" as const, value: node.value }, at)]
        case "strong":
        case "emphasis":
        case "delete":
            return [{ type: node.type, children: inlines(context, node.children) }]
        case "inlineCode": {
            const multiline = node.position !== undefined && node.position.start.line !== node.position.end.line
            if (multiline) report(context, "MD_INLINE_CODE_MULTILINE", "error", "inline code spans lines; multi-line code is a fenced block", at)
            return [withAt({ type: "inlineCode" as const, value: node.value }, at)]
        }
        case "break":
            return [{ type: "break" }]
        case "link":
        case "linkReference": {
            const url = node.type === "link" ? node.url : (context.definitions.get(node.identifier.toLowerCase()) ?? "")
            const children = inlines(context, node.children)
            if (url === "") return children
            if (UNSAFE_URL.test(url)) {
                report(context, "MD_LINK_UNSAFE", "error", `link to ${url.split(":")[0] ?? ""}: is not allowed; it is drawn as its words`, at)
                return children
            }
            return [withAt({ type: "link" as const, url, children }, at)]
        }
        case "image":
        case "imageReference": {
            const url = node.type === "image" ? node.url : (context.definitions.get(node.identifier.toLowerCase()) ?? "")
            const alt = node.alt ?? ""
            if (UNSAFE_URL.test(url)) {
                report(context, "MD_LINK_UNSAFE", "error", "image from a script or data url is not allowed; its alt text is drawn", at)
                return alt === "" ? [] : [{ type: "text", value: alt }]
            }
            return [withAt({ type: "image" as const, url, alt }, at)]
        }
        case "html":
            return rawHtml(context, node)
        case "footnoteReference":
            return [{ type: "text", value: `[${node.label ?? node.identifier}]` }]
        case "textDirective":
            return [{ type: "text", value: sliceOf(context, node) }]
    }
}

/** Raw HTML is never drawn. A comment (`<!-- -->`, the separators of a section file) is dropped quietly; any other tag is an error. */
const rawHtml = (context: Context, node: Html): never[] => {
    if (!node.value.trim().startsWith("<!--")) report(context, "MD_RAW_HTML", "error", "raw HTML is not drawn; write it in markdown", pointOf(node))
    return []
}

const unknownMeta = (context: Context, meta: FenceMeta, known: readonly string[], kind: string, at: SourcePoint | undefined, flags: readonly string[] = []): void => {
    for (const key of Object.keys(meta.values)) {
        if (!known.includes(key)) report(context, "MD_FENCE_META_UNKNOWN", "warning", `a ${kind} fence does not read \`${key}=\``, at)
    }
    for (const flag of meta.flags) {
        if (!flags.includes(flag)) report(context, "MD_FENCE_META_UNKNOWN", "warning", `a ${kind} fence does not read \`${flag}\``, at)
    }
}

const SIGNS = new Set(["+", "-", " "])

const fence = (context: Context, node: Code): Block => {
    const at = pointOf(node)
    const lang = (node.lang ?? "").toLowerCase()
    const meta = readMeta(node.meta)
    const title = meta.values.title
    if (lang === "mermaid") {
        unknownMeta(context, meta, META_KEYS.mermaid, "mermaid", at)
        return withAt({ type: "mermaid" as const, code: node.value, caption: meta.values.caption ?? "", key: diagramKey(node.value) }, at)
    }
    if (lang === "diff") {
        unknownMeta(context, meta, META_KEYS.diff, "diff", at)
        const lines = node.value.split("\n").map((line) => {
            const sign = line.charAt(0)
            return SIGNS.has(sign) ? { sign: sign as "+" | "-" | " ", text: line.slice(1) } : { sign: " " as const, text: line }
        })
        const diffLang = meta.values.lang
        return withAt({ type: "diff" as const, code: node.value, lines, ...(title === undefined ? {} : { title }), ...(diffLang === undefined ? {} : { lang: diffLang }) }, at)
    }
    if (lang === "terminal") {
        unknownMeta(context, meta, META_KEYS.terminal, "terminal", at)
        const lines = node.value.split("\n").map((text) => {
            const head = text.trimStart().charAt(0)
            const mark = head === "✓" || head === "✔" ? ("pass" as const) : head === "✕" || head === "✗" || head === "✖" ? ("fail" as const) : ("none" as const)
            return { mark, text }
        })
        return withAt({ type: "terminal" as const, code: node.value, lines, ...(title === undefined ? {} : { title }) }, at)
    }
    unknownMeta(context, meta, META_KEYS.code, "code", at)
    const file = meta.values.file
    const start = readStart(meta.values.start)
    const highlight = readLineList(meta.values.highlight)
    const count = node.value.split("\n").length
    const outside = highlight.filter((line) => line < start || line >= start + count)
    if (outside.length > 0) report(context, "MD_HIGHLIGHT_OUT_OF_RANGE", "error", `highlight=${outside.join(",")} is outside lines ${String(start)}-${String(start + count - 1)}`, at)
    return withAt(
        {
            type: "code" as const,
            lang,
            code: node.value,
            highlight: highlight.filter((line) => !outside.includes(line)),
            start,
            ...(file === undefined ? {} : { file }),
            ...(title === undefined ? {} : { title }),
        },
        at,
    )
}

/** A container's label (`:::info[Title]`) is its first paragraph, marked by remark-directive; it is taken off the content. */
const labelOf = (context: Context, node: ContainerDirective): { readonly label: string | undefined; readonly content: (BlockContent | DefinitionContent)[] } => {
    const [first, ...rest] = node.children
    if (first?.type === "paragraph" && (first.data as { directiveLabel?: boolean } | undefined)?.directiveLabel === true) {
        return { label: plainText(inlines(context, first.children)).trim(), content: rest }
    }
    return { label: undefined, content: node.children }
}

const titleOf = (node: ContainerDirective, label: string | undefined): string | undefined => {
    const attribute = node.attributes?.title
    if (typeof attribute === "string" && attribute.trim() !== "") return attribute.trim()
    return label === undefined || label === "" ? undefined : label
}

const panelOf = (context: Context, node: ContainerDirective): AccordionBlock["panels"][number] => {
    const { label, content } = labelOf(context, node)
    const at = pointOf(node)
    const title = titleOf(node, label)
    if (title === undefined) report(context, "MD_PANEL_TITLE_MISSING", "error", "a panel needs a title: `:::::panel{title=\"...\"}`", at)
    return withAt({ title: title ?? "", children: blocks(context, content) }, at)
}

const isContainer = (node: RootContent, name?: string): node is ContainerDirective => node.type === "containerDirective" && (name === undefined || node.name === name)

const accordion = (context: Context, node: ContainerDirective): AccordionBlock => {
    const panels: AccordionBlock["panels"][number][] = []
    for (const child of labelOf(context, node).content) {
        if (isContainer(child, "panel")) panels.push(panelOf(context, child))
        else report(context, "MD_DIRECTIVE_UNKNOWN", "warning", `an accordion holds panels; a ${child.type} inside it is not drawn`, pointOf(child))
    }
    return withAt({ type: "accordion" as const, panels }, pointOf(node))
}

const TAB_KINDS = new Set(["code", "preview", "tab"])

const tabOf = (context: Context, node: ContainerDirective): TabsBlock["tabs"][number] => {
    const { label, content } = labelOf(context, node)
    const title = titleOf(node, label)
    return { kind: node.name as "code" | "preview" | "tab", ...(title === undefined ? {} : { title }), children: blocks(context, content) }
}

const tabs = (context: Context, node: ContainerDirective): TabsBlock => {
    const at = pointOf(node)
    const { content } = labelOf(context, node)
    const list: TabsBlock["tabs"][number][] = []
    const loose: (BlockContent | DefinitionContent)[] = []
    for (const child of content) {
        if (child.type === "containerDirective" && TAB_KINDS.has(child.name)) list.push(tabOf(context, child))
        else loose.push(child)
    }
    // `::::tab` with no panes of its own is one tab (the newer `:::tab{title}` form).
    if (list.length === 0 && loose.length > 0) return withAt({ type: "tabs" as const, tabs: [tabOf(context, node)] }, at)
    if (list.length === 0) report(context, "MD_TABS_EMPTY", "error", "a tab group holds no `:::code`, `:::preview` or `:::tab` pane", at)
    return withAt({ type: "tabs" as const, tabs: list }, at)
}

const compare = (context: Context, node: ContainerDirective): CompareBlock => {
    const at = pointOf(node)
    const fences = labelOf(context, node).content.filter((child): child is Code => child.type === "code")
    const flagged = (flag: string) => fences.find((one) => readMeta(one.meta).flags.includes(flag) || readMeta(one.meta).values.title?.toLowerCase() === flag)
    const expected = flagged("expected") ?? fences[0]
    const received = flagged("received") ?? fences.find((one) => one !== expected)
    if (expected === undefined || received === undefined || expected === received) {
        report(context, "MD_COMPARE_INCOMPLETE", "error", "`:::compare` holds two fences, one `expected` and one `received`", at)
    }
    const expectedLabel = node.attributes?.expected ?? undefined
    const receivedLabel = node.attributes?.received ?? undefined
    return withAt(
        {
            type: "compare" as const,
            expected: expected?.value ?? "",
            received: received === expected ? "" : (received?.value ?? ""),
            ...(typeof expectedLabel === "string" && expectedLabel !== "" ? { expectedLabel } : {}),
            ...(typeof receivedLabel === "string" && receivedLabel !== "" ? { receivedLabel } : {}),
        },
        at,
    )
}

const container = (context: Context, node: ContainerDirective): Block[] => {
    const at = pointOf(node)
    const tone = CALLOUTS[node.name]
    if (tone !== undefined) {
        const { label, content } = labelOf(context, node)
        const title = titleOf(node, label)
        return [withAt({ type: "callout" as const, tone, ...(title === undefined ? {} : { title }), children: blocks(context, content) }, at)]
    }
    switch (node.name) {
        case "accordion":
            return [accordion(context, node)]
        case "panel":
            return [withAt({ type: "accordion" as const, panels: [panelOf(context, node)] }, at)]
        case "tab":
        case "code":
        case "preview":
            return [node.name === "tab" ? tabs(context, node) : withAt({ type: "tabs" as const, tabs: [tabOf(context, node)] }, at)]
        case "compare":
            return [compare(context, node)]
        default:
            report(context, "MD_DIRECTIVE_UNKNOWN", "error", `\`:::${node.name}\` is not a directive of @starci/grammar/core/ext/markdown (${DIRECTIVE_NAMES.join(", ")}); its content is drawn plainly`, at)
            return blocks(context, labelOf(context, node).content)
    }
}

const leaf = (context: Context, node: LeafDirective): Block[] => {
    report(context, "MD_DIRECTIVE_UNKNOWN", "error", `\`::${node.name}\` is not a directive of @starci/grammar/core/ext/markdown; it is drawn as written`, pointOf(node))
    return [withAt({ type: "paragraph" as const, children: [{ type: "text" as const, value: sliceOf(context, node) }] }, pointOf(node))]
}

const table = (context: Context, node: Table): Block => {
    const [head, ...body] = node.children
    return withAt(
        {
            type: "table" as const,
            align: (node.align ?? []).map((one) => one ?? null),
            header: (head?.children ?? []).map((cell) => inlines(context, cell.children)),
            rows: body.map((row) => row.children.map((cell) => inlines(context, cell.children))),
        },
        pointOf(node),
    )
}

const listItem = (context: Context, item: ListItem): Block[] => blocks(context, item.children)

const block = (context: Context, node: RootContent): Block[] => {
    const at = pointOf(node)
    switch (node.type) {
        case "heading":
            return [withAt({ type: "heading" as const, depth: node.depth, children: inlines(context, node.children) }, at)]
        case "paragraph": {
            const children = inlines(context, node.children)
            return children.length === 0 ? [] : [withAt({ type: "paragraph" as const, children }, at)]
        }
        case "list":
            return [withAt({ type: "list" as const, ordered: node.ordered === true, ...(typeof node.start === "number" && node.start !== 1 ? { start: node.start } : {}), items: node.children.map((item) => listItem(context, item)) }, at)]
        case "blockquote":
            return [withAt({ type: "blockquote" as const, children: blocks(context, node.children) }, at)]
        case "thematicBreak":
            return [withAt({ type: "thematicBreak" as const }, at)]
        case "code":
            return [fence(context, node)]
        case "table":
            return [table(context, node)]
        case "html":
            return rawHtml(context, node)
        case "containerDirective":
            return container(context, node)
        case "leafDirective":
            return leaf(context, node)
        case "footnoteDefinition":
            return blocks(context, node.children)
        case "listItem":
            return blocks(context, node.children)
        case "break":
        case "delete":
        case "emphasis":
        case "footnoteReference":
        case "image":
        case "imageReference":
        case "inlineCode":
        case "link":
        case "linkReference":
        case "strong":
        case "text":
        case "textDirective": {
            const children = inline(context, node)
            return children.length === 0 ? [] : [withAt({ type: "paragraph" as const, children }, at)]
        }
        case "definition":
        case "yaml":
        case "tableRow":
        case "tableCell":
            return []
    }
}

/** A mermaid fence with no `caption=` takes the legacy caption paragraph that follows it, which is then not drawn twice. */
const adoptCaptions = (list: Block[], caption: RegExp | undefined): Block[] => {
    if (caption === undefined) return list
    const out: Block[] = []
    for (const node of list) {
        const previous = out[out.length - 1]
        if (node.type === "paragraph" && previous?.type === "mermaid" && previous.caption === "") {
            const words = plainText(node.children).trim()
            if (caption.test(words)) {
                out[out.length - 1] = { ...previous, caption: words }
                continue
            }
        }
        out.push(node)
    }
    return out
}

const blocks = (context: Context, nodes: readonly RootContent[]): Block[] => adoptCaptions(nodes.flatMap((node) => block(context, node)), context.caption)

const definitionsOf = (root: Root): Map<string, string> => {
    const found = new Map<string, string>()
    const walk = (node: Nodes): void => {
        if (node.type === "definition") found.set(node.identifier.toLowerCase(), node.url)
        if ("children" in node) for (const child of node.children) walk(child)
    }
    walk(root)
    return found
}

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkDirective)

/** The mdast of a text, with GFM and directives, before it is read into the tree. */
export const parseMdast = (source: string): Root => processor.runSync(processor.parse(source)) as Root

/**
 * Reads a markdown text into the tree `<Markdown>` draws: GFM (tables, strikethrough, task lists, autolinks), the fences with meta
 * (`file=` `highlight=` `start=`, `diff title=`, `terminal`, `mermaid caption=`), `:::compare`, the callouts and the legacy
 * directives (`::::::accordion` / `:::::panel{title}`, `::::tab` / `:::code` / `:::preview`). Raw HTML is never kept. What it had to drop
 * or could not read is in `issues`; `validate` adds the rules of a profile.
 */
export const parse = (source: string, options: ParseOptions = {}): MarkdownTree => {
    const root = parseMdast(source)
    const context: Context = { source, issues: [], definitions: definitionsOf(root), caption: options.legacyCaption }
    return { version: 1, children: blocks(context, root.children), issues: context.issues }
}
