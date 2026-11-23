import type { ReactNode } from "react"
import { SkeletonPlaceholder } from "../../leaf/Skeleton/index.js"
import { fencedCodeBlockClassName, fencedCodeHeaderClassName, markdownArticleClassName, markdownTableFrameClassName } from "./classNames.js"

export type MarkdownArticleProps = {
    readonly children: ReactNode
    readonly ariaLabel?: string
    readonly measure?: "reading" | "compact"
}

type FencedCodeBlockFrameProps = {
    readonly language?: string
    /**
     * Whether the header draws the language label (default `true`). `false` hides it for any block; independent of this, the label is hidden for a ONE-line `code` (a command to
     * copy: the label says nothing there) (0.37.15). The `action` (Copy) stays either way.
     */
    readonly showLanguage?: boolean
    readonly action?: ReactNode
    /**
     * Accessible name of the scrolling code region (e.g. "Install command"). Defaults to
     * `language`. Authored code scrolls inline and is plain text, so its `<pre>` is a Tab stop
     * (WCAG 2.1.1); a name makes it a `role="region"` a screen reader can announce.
     */
    readonly label?: string
    /** The file the code comes from (`src/orders/refund.ts`): the header names it in place of the language. */
    readonly path?: string
    /** One short note under the code (what to notice, where it runs), muted, inside the block. */
    readonly note?: ReactNode
}

/** A line number, or an inclusive range of them (`[4, 7]`), counted from 1. */
export type CodeLineRange = number | readonly [number, number]

type AuthoredCodeProps = {
    readonly code: string
    readonly children?: never
    /** Number every line in a gutter the reader cannot select or copy. */
    readonly lineNumbers?: boolean
    /** The lines to mark (a step, the fix): each takes the accent soft band across the whole block. */
    readonly highlightLines?: readonly CodeLineRange[]
}

type RenderedCodeProps = {
    readonly children: ReactNode
    readonly code?: never
    readonly lineNumbers?: never
    readonly highlightLines?: never
}

const isHighlighted = (ranges: readonly CodeLineRange[] | undefined, line: number): boolean =>
    ranges?.some((range) => typeof range === "number" ? range === line : line >= range[0] && line <= range[1]) === true

/** Authored code as one block per line, so a line can be numbered and marked; the text copies as it was written. */
const CodeLines = ({ code, numbered, ranges }: { readonly code: string; readonly numbered: boolean; readonly ranges: readonly CodeLineRange[] | undefined }) => (
    <code data-grammar-code-lines="true" {...(numbered ? { "data-grammar-line-numbers": "true" } : {})}>
        {code.replace(/\n$/, "").split("\n").map((text, index) => (
            <span key={index} className="starci-core-code-line" data-line={index + 1} {...(isHighlighted(ranges, index + 1) ? { "data-grammar-line-highlighted": "true" } : {})}>{text === "" ? "\n" : text}</span>
        ))}
    </code>
)

export type FencedCodeBlockProps = FencedCodeBlockFrameProps & (AuthoredCodeProps | RenderedCodeProps) & {
    /**
     * Unresolved code (knowledge STATE-8): the same frame and header; the code (and the action) is laid out unseen under a
     * shimmer, so the block keeps its ready box (skeleton parity). Nothing in it is focusable; the root is `aria-busy`.
     */
    readonly isLoading?: boolean
}

export type MarkdownTableFrameProps = {
    readonly children: ReactNode
    /** Accessible name of the scrolling frame; with it the frame is a `role="region"`. */
    readonly label?: string
}

/** Keyboard reachability for an inline-scrolling reading frame whose content is plain text. */
const scrollFrameProps = (label: string | undefined) => ({
    tabIndex: 0,
    ...(label === undefined ? {} : { role: "region", "aria-label": label }),
})

/** Own the business-neutral reading rhythm for one semantic Markdown document. */
export const MarkdownArticle = (props: MarkdownArticleProps) => (
    <div
        aria-label={props.ariaLabel}
        className={markdownArticleClassName}
        data-grammar-markdown-measure={props.measure ?? "reading"}
        data-component="MarkdownArticle"
        data-tier="frame"
    >
        {props.children}
    </div>
)

/** Own bounded code overflow while allowing a caller-supplied neutral action such as Copy. */
export const FencedCodeBlock = (props: FencedCodeBlockProps) => {
    const isLoading = props.isLoading === true
    const lined = "code" in props && props.code !== undefined && (props.lineNumbers === true || (props.highlightLines?.length ?? 0) > 0)
    const ready = "children" in props ? props.children : (
        <pre {...scrollFrameProps(props.label ?? props.path ?? props.language)}>
            {lined ? <CodeLines code={props.code ?? ""} numbered={props.lineNumbers === true} ranges={props.highlightLines} /> : <code>{props.code}</code>}
        </pre>
    )
    // A one-line authored block (a command) needs no language label; a rendered `children` block cannot be measured here, so only `showLanguage` hides its label.
    const isOneLine = "code" in props && props.code !== undefined && !props.code.trim().includes("\n")
    const language = props.path ?? (props.showLanguage === false || isOneLine ? undefined : props.language)
    const body = isLoading ? <SkeletonPlaceholder shape="region">{ready}</SkeletonPlaceholder> : ready
    return (
        <div
            className={fencedCodeBlockClassName}
            data-component="FencedCodeBlock"
            data-tier="frame"
            data-contract="OVERFLOW-4"
            {...(isLoading ? { "data-loading": "true", "aria-busy": true } : {})}
        >
            {language === undefined && props.action === undefined ? null : (
                <div className={fencedCodeHeaderClassName}>
                    {language === undefined ? <span /> : <span {...(props.path === undefined ? {} : { className: "starci-core-fenced-code-path", "data-grammar-code-path": "true" })}>{language}</span>}
                    {isLoading && props.action !== undefined ? <SkeletonPlaceholder shape="block">{props.action}</SkeletonPlaceholder> : props.action}
                </div>
            )}
            {body}
            {props.note === undefined ? null : <div className="starci-core-fenced-code-note" data-grammar-code-note="true">{props.note}</div>}
        </div>
    )
}

/** Keep a vendor-rendered table inside the same bounded reading frame as semantic tables. */
export const MarkdownTableFrame = (props: MarkdownTableFrameProps) => (
    <div
        className={markdownTableFrameClassName}
        data-component="MarkdownTableFrame"
        data-tier="frame"
        data-contract="OVERFLOW-4"
        {...scrollFrameProps(props.label)}
    >
        {props.children}
    </div>
)
