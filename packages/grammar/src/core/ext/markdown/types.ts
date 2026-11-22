/**
 * The tree `parse` returns: plain JSON (no functions, no class instances), so an importer can parse, validate and prerender at
 * import time, store the result and hand it to `<Markdown>` later, on the server or in the browser.
 */

/** Where a node starts in the source, 1-based. */
/** Where a node stands in the source: line and column 1-based, `offset` and `end` the character offsets (end exclusive). */
export interface SourcePoint { readonly line: number; readonly column: number; readonly offset?: number; readonly end?: number }

export type Inline =
    | { readonly type: "text"; readonly value: string; readonly at?: SourcePoint }
    | { readonly type: "strong"; readonly children: readonly Inline[] }
    | { readonly type: "emphasis"; readonly children: readonly Inline[] }
    | { readonly type: "delete"; readonly children: readonly Inline[] }
    | { readonly type: "inlineCode"; readonly value: string; readonly at?: SourcePoint }
    | { readonly type: "link"; readonly url: string; readonly children: readonly Inline[]; readonly at?: SourcePoint }
    | { readonly type: "image"; readonly url: string; readonly alt: string; readonly at?: SourcePoint }
    | { readonly type: "break" }

/** One token of a highlighted line: its text and the CSS colour Shiki gave it (a `var(--shiki-*)` of the css-variables theme). */
export interface CodeToken { readonly content: string; readonly color?: string; readonly fontStyle?: "italic" | "bold" }

/** A plain fenced block: ```` ```ts file=src/x.ts highlight=2,4-6 start=10 ```` */
export interface CodeBlock {
    readonly type: "code"
    readonly lang: string
    readonly code: string
    readonly file?: string
    readonly title?: string
    /** The highlighted line numbers, as written (`start` already applied: `highlight=12` with `start=10` is the third line). */
    readonly highlight: readonly number[]
    /** The number of the first line (default 1). */
    readonly start: number
    /** Filled by `highlight()` on the server: one token list per line. */
    readonly tokens?: readonly (readonly CodeToken[])[]
    readonly at?: SourcePoint
}

export interface DiffLine { readonly sign: "+" | "-" | " "; readonly text: string }

/** ```` ```diff title="A · ..." ````: each line keeps its sign; the language of the lines is `lang=` (default none). */
export interface DiffBlock {
    readonly type: "diff"
    readonly code: string
    readonly title?: string
    readonly lang?: string
    readonly lines: readonly DiffLine[]
    readonly tokens?: readonly (readonly CodeToken[])[]
    readonly at?: SourcePoint
}

/** The mark a terminal line starts with: ✓ passes (green), ✕ fails (red), nothing else is coloured. */
export type TerminalMark = "pass" | "fail" | "none"

export interface TerminalBlock {
    readonly type: "terminal"
    readonly code: string
    readonly title?: string
    readonly lines: readonly { readonly mark: TerminalMark; readonly text: string }[]
    readonly at?: SourcePoint
}

/** ```` ```mermaid caption="Figure 1: ..." ````. `key` names the prerendered SVG in `diagrams`. */
export interface MermaidBlock {
    readonly type: "mermaid"
    readonly code: string
    readonly caption: string
    readonly key: string
    readonly at?: SourcePoint
}

/** `:::compare`: what the test expected beside what it received; the differing part of each is tinted. */
export interface CompareBlock {
    readonly type: "compare"
    readonly expected: string
    readonly received: string
    readonly expectedLabel?: string
    readonly receivedLabel?: string
    readonly at?: SourcePoint
}

export type CalloutTone = "muted" | "info" | "warn" | "danger" | "tip"

/** `:::info[title]` (or `{title="..."}`): a note on the Grammar Alert of its tone; `:::muted` is a quiet label line. */
export interface CalloutBlock {
    readonly type: "callout"
    readonly tone: CalloutTone
    readonly title?: string
    readonly children: readonly Block[]
    readonly at?: SourcePoint
}

/** `::::::accordion` of `:::::panel{title="..."}`; a lone panel is an accordion of one. */
export interface AccordionBlock {
    readonly type: "accordion"
    readonly panels: readonly { readonly title: string; readonly children: readonly Block[]; readonly at?: SourcePoint }[]
    readonly at?: SourcePoint
}

/** `::::tab` of `:::code` / `:::preview` (or `:::tab{title}`) panes. */
export interface TabsBlock {
    readonly type: "tabs"
    readonly tabs: readonly { readonly kind: "code" | "preview" | "tab"; readonly title?: string; readonly children: readonly Block[] }[]
    readonly at?: SourcePoint
}

export interface TableBlock {
    readonly type: "table"
    readonly align: readonly ("left" | "right" | "center" | null)[]
    readonly header: readonly (readonly Inline[])[]
    readonly rows: readonly (readonly (readonly Inline[])[])[]
    readonly at?: SourcePoint
}

export type Block =
    | { readonly type: "heading"; readonly depth: 1 | 2 | 3 | 4 | 5 | 6; readonly children: readonly Inline[]; readonly at?: SourcePoint }
    | { readonly type: "paragraph"; readonly children: readonly Inline[]; readonly at?: SourcePoint }
    | { readonly type: "list"; readonly ordered: boolean; readonly start?: number; readonly items: readonly (readonly Block[])[]; readonly at?: SourcePoint }
    | { readonly type: "blockquote"; readonly children: readonly Block[]; readonly at?: SourcePoint }
    | { readonly type: "thematicBreak"; readonly at?: SourcePoint }
    | CodeBlock
    | DiffBlock
    | TerminalBlock
    | MermaidBlock
    | CompareBlock
    | CalloutBlock
    | AccordionBlock
    | TabsBlock
    | TableBlock

export type BlockType = Block["type"]
export type InlineType = Inline["type"]

/** What `parse` hands back: the tree, and what it found while reading it (raw HTML dropped, an unknown directive, a fence meta it does not know). */
export interface MarkdownTree {
    readonly version: 1
    readonly children: readonly Block[]
    readonly issues: readonly Issue[]
}

export type ProfileName = "prose" | "stem" | "option" | "report"

export type IssueCode =
    | "MD_RAW_HTML"
    | "MD_NOT_ALLOWED"
    | "MD_TOO_MANY"
    | "MD_MERMAID_CAPTION_MISSING"
    | "MD_DIRECTIVE_UNKNOWN"
    | "MD_FENCE_META_UNKNOWN"
    | "MD_HIGHLIGHT_OUT_OF_RANGE"
    | "MD_INLINE_CODE_TOO_LONG"
    | "MD_INLINE_CODE_MULTILINE"
    | "MD_COMPARE_INCOMPLETE"
    | "MD_PANEL_TITLE_MISSING"
    | "MD_TABS_EMPTY"
    | "MD_LINK_UNSAFE"
    | "MD_MERMAID_INVALID"
    | "MD_MERMAID_FALLBACK"

/** One finding of `validate` (or of `prerender`). An importer refuses a text with any `error`; a `warning` is reported only. */
export interface Issue {
    readonly code: IssueCode
    readonly severity: "error" | "warning"
    readonly message: string
    readonly line?: number
    readonly column?: number
}

/** A mermaid figure prerendered at import time: its SVG on the Grammar tokens, and which renderer drew it. */
export interface Diagram {
    readonly svg: string
    readonly renderer: "beautiful-mermaid" | "mermaid"
}

/** The prerendered figures of one text, by `MermaidBlock.key`. */
export type Diagrams = Readonly<Record<string, Diagram>>
