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
}

type AuthoredCodeProps = {
    readonly code: string
    readonly children?: never
}

type RenderedCodeProps = {
    readonly children: ReactNode
    readonly code?: never
}

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
    const ready = "children" in props ? props.children : <pre {...scrollFrameProps(props.label ?? props.language)}><code>{props.code}</code></pre>
    // A one-line authored block (a command) needs no language label; a rendered `children` block cannot be measured here, so only `showLanguage` hides its label.
    const isOneLine = "code" in props && props.code !== undefined && !props.code.trim().includes("\n")
    const language = props.showLanguage === false || isOneLine ? undefined : props.language
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
                    {language === undefined ? <span /> : <span>{language}</span>}
                    {isLoading && props.action !== undefined ? <SkeletonPlaceholder shape="block">{props.action}</SkeletonPlaceholder> : props.action}
                </div>
            )}
            {body}
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
