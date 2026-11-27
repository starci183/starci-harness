"use client"

import { useId, useState, type CSSProperties, type ReactNode } from "react"
import { Badge } from "../../leaf/Badge/index.js"
import { Icon } from "../../leaf/Icon/index.js"
import { glyphSource } from "../../leaf/Icon/glyphs.js"
import { SkeletonPlaceholder } from "../../leaf/Skeleton/index.js"
import { CopyAction } from "../Markdown/CopyAction.js"
import { CodeLines, isHighlighted, tokenSpans, type CodeBlockToken, type CodeLineRange, type CodeLineTokens } from "../MarkdownArticle/index.js"
import type { NoChildren } from "../../tier.js"
import { diffAfter, diffRows, type CodeDiff, type CodeDiffKind, type CodeDiffLine } from "./diff.js"

/** The words of a code block, in the app's language. English defaults. */
export type CodeBlockLabels = {
    readonly copy: string
    readonly copied: string
    readonly copyError: string
    /** The line range on the folded row: `lines 64–71`. */
    readonly lines: (first: number, last: number) => string
    /** How many lines are marked, on the folded row: `2 marked lines`. */
    readonly marked: (count: number) => string
    /** What a diff changes, on its header row: `2 added · 1 removed`. */
    readonly changes: (added: number, removed: number) => string
    /** Read before an added row of a diff by a screen reader (the `+` and the tint are not read): `Added`. */
    readonly added: string
    /** Read before a removed row of a diff by a screen reader (the `−` and the tint are not read): `Removed`. */
    readonly removed: string
}

/** `page` follows the page's theme; `dark` and `light` set the block in that theme whatever the page's (its tokens, scoped to the block). */
export type CodeBlockScheme = "page" | "dark" | "light"

/**
 * What the block shows: `code` as written, or a `diff` (its rows, or a unified diff string) drawn as one block, each added row on the code
 * palette's inserted tint with a `+`, each removed row on its `deleted` tint with a `−`, the rest plain. Exactly one of the two.
 */
export type CodeBlockSource =
    | {
          /** The code, as written. */
          readonly code: string
          readonly diff?: never
      }
    | {
          /**
           * The change, as rows (`{ kind: "add" | "del" | "same", text }`) or as a unified diff (`git diff` output; its file and hunk headers
           * are skipped). Copy copies the code after the change. Each changed row's kind is also spoken (`labels.added`, `labels.removed`), never
           * colour only. In a diff `lineNumbers` and `highlightLines` are not drawn: the gutter carries the sign, the tint carries the change.
           */
          readonly diff: CodeDiff
          readonly code?: never
      }

export type CodeBlockProps = NoChildren & CodeBlockSource & {
    /** The language, a small badge in the header (`ts`). */
    readonly language?: string
    /** The file the code comes from (`bugs/source/src/products.ts`), named first in the header. */
    readonly path?: string
    /** The number of the first line: an excerpt of a file numbers its lines as the file does. Default 1. */
    readonly start?: number
    /** Number every line in a gutter the reader cannot select or copy. Default true. */
    readonly lineNumbers?: boolean
    /** The lines to mark (a step, the fix), by their numbers (counted from `start`): the code palette's highlight-line tint and edge across the block (never the brand). */
    readonly highlightLines?: readonly CodeLineRange[]
    /** One short note under the code: what to notice. */
    readonly note?: ReactNode
    /** Accessible name of the scrolling code. Default: `path`, else `language`. */
    readonly label?: string
    /**
     * The block folds to one row (its file, `lines 64–71 · 2 marked lines`, the badge) that a press opens. Controlled by `isCollapsed`
     * with `onCollapsedChange`, or uncontrolled from `defaultCollapsed`. Without either the block is always open and draws no fold control.
     */
    readonly isCollapsed?: boolean
    readonly defaultCollapsed?: boolean
    readonly onCollapsedChange?: (isCollapsed: boolean) => void
    /**
     * Shiki's tokens, one list per line of `code` (or per row of `diff`: highlight `diffCode(diff)`), from `highlightCode(code, language)` of
     * `@starci/grammar/core/ext/markdown/server` (run it on the server, hand the JSON down) or from the client hook `useCodeTokens(code, language)`
     * of `@starci/grammar/core/ext/markdown/react` (Shiki loads lazily in the browser, only on a page that draws code). Their colours are
     * `var(--shiki-token-*)`, which the block maps onto the code palette, so light and dark follow the page (or `scheme`). Without tokens (until the
     * hook is ready, or for a language Shiki does not ship), or for a line they do not spell, the code is plain. Copy copies the code either way.
     */
    readonly tokens?: CodeLineTokens
    /** At most this many lines tall: past it the code scrolls inside the block (the header and note stay). Unset, the block is as tall as its code. */
    readonly maxLines?: number
    /** Whether the header carries the Copy command. Default true. */
    readonly copyable?: boolean
    readonly scheme?: CodeBlockScheme
    readonly labels?: Partial<CodeBlockLabels>
    /** Unresolved code (STATE-8): the frame and header keep their box; the code is laid out unseen under a shimmer, `aria-busy`. */
    readonly isLoading?: boolean
}

const LABELS: CodeBlockLabels = {
    copy: "Copy",
    copied: "Copied",
    copyError: "Could not copy",
    lines: (first, last) => (first === last ? `line ${String(first)}` : `lines ${String(first)}–${String(last)}`),
    marked: (count) => (count === 1 ? "1 marked line" : `${String(count)} marked lines`),
    changes: (added, removed) => `${String(added)} added · ${String(removed)} removed`,
    added: "Added",
    removed: "Removed",
}

/** The sign each row kind shows in the diff gutter: a plus, a true minus (U+2212) or nothing. */
const SIGN: Readonly<Record<CodeDiffKind, string>> = { add: "+", del: "−", same: " " }

/**
 * The rows of a diff, one block per row like `CodeLines`: the sign in a gutter nobody selects or hears, the row's kind as hidden words a
 * screen reader says first (`Added: `, `Removed: `), then its Shiki tokens (or its plain text). CSS tints each row by `data-grammar-diff`.
 */
const DiffLines = ({ rows, tokens, words }: { readonly rows: readonly CodeDiffLine[]; readonly tokens: CodeLineTokens | undefined; readonly words: CodeBlockLabels }) => (
    <code data-grammar-code-lines="true" data-grammar-code-diff="true">
        {rows.map((row, index) => (
            <span key={index} className="starci-core-code-line" data-grammar-diff={row.kind}>
                <span className="starci-core-code-diff-sign" aria-hidden="true">{SIGN[row.kind]}</span>
                {row.kind === "same" ? null : <span className="starci-core-visually-hidden starci-core-code-diff-kind">{`${row.kind === "add" ? words.added : words.removed}: `}</span>}
                {row.text === "" ? null : tokenSpans(tokens?.[index], row.text)}
            </span>
        ))}
    </code>
)

const lineCount = (code: string): number => code.replace(/\n$/, "").split("\n").length

/**
 * FRAME - `CodeBlock`: a lesson's code on its own, outside an article (owner 2026-11-23). One bordered block: a header naming the file
 * and its language with the Copy command; the code numbered from `start`, the marked ranges in the code palette's highlight-line tint; a note under it.
 * It may fold to one row that says which lines it holds and how many are marked, so a page can keep a long excerpt one press away.
 * `scheme` sets the block in the dark or the light theme whatever the page's, from the same tokens. With `diff` in place of `code` it draws one
 * change: added rows on the code palette's inserted tint, removed rows on its `deleted` tint, a `+`/`−` gutter, each changed row's kind in words
 * for a screen reader, the header counting the rows added and removed. `tokens` colour either through the code palette.
 * Contract: overflow OVERFLOW-4 (the code scrolls inline, a named Tab stop), the fold FOCUS-1 and STATE-7, loading STATE-8.
 */
export const CodeBlock = ({
    code,
    diff,
    language,
    path,
    start = 1,
    lineNumbers = true,
    highlightLines,
    note,
    label,
    isCollapsed,
    defaultCollapsed,
    onCollapsedChange,
    copyable = true,
    scheme = "page",
    labels,
    isLoading = false,
    tokens,
    maxLines,
}: CodeBlockProps) => {
    const words = { ...LABELS, ...labels }
    const bodyId = useId()
    const isFoldable = isCollapsed !== undefined || defaultCollapsed !== undefined
    const [ownCollapsed, setOwnCollapsed] = useState(defaultCollapsed ?? false)
    const collapsed = isFoldable && (isCollapsed ?? ownCollapsed)
    const toggle = () => {
        const next = !collapsed
        if (isCollapsed === undefined) setOwnCollapsed(next)
        onCollapsedChange?.(next)
    }
    const rows = diff === undefined ? undefined : diffRows(diff)
    const text = rows === undefined ? (code ?? "") : diffAfter(rows)
    const count = rows === undefined ? lineCount(text) : rows.length
    const last = start + count - 1
    const marked = rows === undefined ? Array.from({ length: count }, (_, index) => start + index).filter((line) => isHighlighted(highlightLines, line)).length : 0
    const summary = rows === undefined
        ? `${words.lines(start, last)}${marked > 0 ? ` · ${words.marked(marked)}` : ""}`
        : words.changes(rows.filter((row) => row.kind === "add").length, rows.filter((row) => row.kind === "del").length)
    const name = label ?? path ?? language ?? words.lines(start, last)

    const title = (
        <>
            {path === undefined ? null : <span className="starci-core-code-block-path" data-grammar-code-path="true">{path}</span>}
            {collapsed || path === undefined || rows !== undefined ? <span className="starci-core-code-block-summary">{summary}</span> : null}
        </>
    )
    const copy = copyable ? <CopyAction code={text}copyLabel={words.copy} copiedLabel={words.copied} copyErrorLabel={words.copyError} /> : null
    const body = (
        <pre
            className="starci-core-code-block-code"
            tabIndex={0}
            role="region"
            aria-label={name}
            {...(maxLines === undefined ? {} : { "data-grammar-code-bounded": "true", style: { "--starci-code-max-lines": maxLines } as CSSProperties })}
        >
            {rows === undefined
                ? <CodeLines code={text} numbered={lineNumbers} ranges={highlightLines} start={start} {...(tokens === undefined ? {} : { tokens })} />
                : <DiffLines rows={rows} tokens={tokens} words={words} />}
        </pre>
    )
    return (
        <div
            className={scheme === "page" ? "starci-core-code-block" : `starci-core-code-block ${scheme}`}
            data-component="CodeBlock"
            data-tier="frame"
            data-contract={isLoading ? "OVERFLOW-4 STATE-8" : isFoldable ? "OVERFLOW-4 FOCUS-1 STATE-7" : "OVERFLOW-4"}
            data-grammar-code-collapsed={collapsed ? "true" : "false"}
            {...(scheme === "page" ? {} : { "data-theme": scheme })}
            {...(isLoading ? { "data-loading": "true", "aria-busy": true } : {})}
        >
            <div className="starci-core-code-block-head">
                {isFoldable ? (
                    <button type="button" className="starci-core-code-block-fold" aria-expanded={!collapsed} aria-controls={bodyId} onClick={toggle} disabled={isLoading}>
                        <span className="starci-core-code-block-caret" aria-hidden="true"><Icon source={glyphSource("chevron-end")} usage="text" /></span>
                        {title}
                    </button>
                ) : <span className="starci-core-code-block-title">{title}</span>}
                {language === undefined ? null : <Badge>{language}</Badge>}
                {collapsed || copy === null ? null : isLoading ? <SkeletonPlaceholder shape="block">{copy}</SkeletonPlaceholder> : copy}
            </div>
            {collapsed ? null : (
                <div id={bodyId} className="starci-core-code-block-body">
                    {isLoading ? <SkeletonPlaceholder shape="region">{body}</SkeletonPlaceholder> : body}
                    {note === undefined ? null : <div className="starci-core-code-block-note" data-grammar-code-note="true">{note}</div>}
                </div>
            )}
        </div>
    )
}
export type { CodeBlockToken, CodeDiff, CodeDiffKind, CodeDiffLine, CodeLineTokens }
export { diffAfter, diffCode, diffRows, parseUnifiedDiff } from "./diff.js"
