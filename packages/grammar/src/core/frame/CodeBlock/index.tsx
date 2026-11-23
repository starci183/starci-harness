"use client"

import { useId, useState, type ReactNode } from "react"
import { Badge } from "../../leaf/Badge/index.js"
import { Icon } from "../../leaf/Icon/index.js"
import { glyphSource } from "../../leaf/Icon/glyphs.js"
import { SkeletonPlaceholder } from "../../leaf/Skeleton/index.js"
import { CopyAction } from "../Markdown/CopyAction.js"
import { CodeLines, isHighlighted, type CodeLineRange } from "../MarkdownArticle/index.js"
import type { NoChildren } from "../../tier.js"

/** The words of a code block, in the app's language. English defaults. */
export type CodeBlockLabels = {
    readonly copy: string
    readonly copied: string
    readonly copyError: string
    /** The line range on the folded row: `lines 64–71`. */
    readonly lines: (first: number, last: number) => string
    /** How many lines are marked, on the folded row: `2 marked lines`. */
    readonly marked: (count: number) => string
}

/** `page` follows the page's theme; `dark` and `light` set the block in that theme whatever the page's (its tokens, scoped to the block). */
export type CodeBlockScheme = "page" | "dark" | "light"

export type CodeBlockProps = NoChildren & {
    /** The code, as written. */
    readonly code: string
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
}

const lineCount = (code: string): number => code.replace(/\n$/, "").split("\n").length

/**
 * FRAME - `CodeBlock`: a lesson's code on its own, outside an article (owner 2026-11-23). One bordered block: a header naming the file
 * and its language with the Copy command; the code numbered from `start`, the marked ranges in the code palette's highlight-line tint; a note under it.
 * It may fold to one row that says which lines it holds and how many are marked, so a page can keep a long excerpt one press away.
 * `scheme` sets the block in the dark or the light theme whatever the page's, from the same tokens.
 * Contract: overflow OVERFLOW-4 (the code scrolls inline, a named Tab stop), the fold FOCUS-1 and STATE-7, loading STATE-8.
 */
export const CodeBlock = ({
    code,
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
    const count = lineCount(code)
    const last = start + count - 1
    const marked = Array.from({ length: count }, (_, index) => start + index).filter((line) => isHighlighted(highlightLines, line)).length
    const summary = `${words.lines(start, last)}${marked > 0 ? ` · ${words.marked(marked)}` : ""}`
    const name = label ?? path ?? language ?? words.lines(start, last)

    const title = (
        <>
            {path === undefined ? null : <span className="starci-core-code-block-path" data-grammar-code-path="true">{path}</span>}
            {collapsed || path === undefined ? <span className="starci-core-code-block-summary">{summary}</span> : null}
        </>
    )
    const copy = copyable ? <CopyAction code={code} copyLabel={words.copy} copiedLabel={words.copied} copyErrorLabel={words.copyError} /> : null
    const body = (
        <pre className="starci-core-code-block-code" tabIndex={0} role="region" aria-label={name}>
            <CodeLines code={code} numbered={lineNumbers} ranges={highlightLines} start={start} />
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
