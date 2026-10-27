import { isRuleId } from "../../harness/contract.js"

/**
 * How a heading or a yaml entry names its anchor. One owner for the syntax: the corpus chunker and the anchor table both read
 * it from here.
 *
 * - an explicit anchor closing a heading, `## Choose {#tabs.choose}`, or an HTML anchor on the heading's line or the line
 *   above it, `<a id="tabs.choose.level"></a>`;
 * - a dotted id opening a heading, `### tabs.choose.level: page or region` (a file name such as `hfs.json` is no id);
 * - a rule id in a heading, `## R12 ...`, `### DNA-CORE-LABEL-OUTSIDE`: its first token with a digit, else an upper-case id
 *   the heading opens with;
 * - a yaml entry's `id:` value, when it has the shape of an id (a plain word such as `card` is a record key, not an id);
 * - else the fallback: the file and the GitHub slug of the heading (`contexts/ui/components/tabs.md#choose`), or the file and
 *   the yaml key or record key (`ops/checks.yaml#presets.rules-cited`, `contexts/grammars/contract.yaml#card`).
 */

const EXPLICIT_SUFFIX = /\s*\{#([A-Za-z0-9][A-Za-z0-9._-]*)\}\s*$/
const HTML_ANCHOR = /<a\s+(?:id|name)=["']([A-Za-z0-9][A-Za-z0-9._-]*)["']\s*>\s*<\/a>/
const DOTTED_ID = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/
const FILE_EXTENSION = /\.(?:md|ya?ml|json|jsonl|ts|tsx|js|mjs|cjs|css|sh|sql|toml|txt|lock|graphql|env)$/
const UPPER_ID = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/

/** A GitHub-style heading anchor: lower case, punctuation dropped, each blank run a hyphen. */
export const slug = (heading: string): string =>
    heading
        .toLowerCase()
        .replace(/[^a-z0-9 _-]/g, "")
        .trim()
        .replace(/\s+/g, "-")

/** True when `token` is a dotted anchor id (`tabs.choose.level`, `be.feature.webhooks`), not a file name. */
export const isDottedId = (token: string): boolean => DOTTED_ID.test(token) && !FILE_EXTENSION.test(token)

const CASE_PART = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * True when `id` may stand alone as an anchor: a rule id (a letter and a digit or hyphen), a dotted id, or either with
 * `/`-joined parts (`STATE-8/loading-keeps-anatomy`, `R212/case-4`); a plain word is a record key.
 */
export const isAnchorId = (id: string): boolean => {
    const [head = "", ...rest] = id.split("/")
    return (isRuleId(head) || isDottedId(head)) && rest.every((part) => CASE_PART.test(part))
}

/** A heading split into its display text and the explicit anchor it closes with or carries as an HTML anchor. */
export interface ParsedHeading {
    readonly text: string
    readonly explicit: string | undefined
}

/** Reads a heading's explicit anchor (`{#id}` at its end, or `<a id>` in it or on `above`, the line before it) and strips it. */
export const parseHeading = (heading: string, above = ""): ParsedHeading => {
    const suffix = EXPLICIT_SUFFIX.exec(heading)
    const withoutSuffix = suffix === null ? heading : heading.slice(0, suffix.index)
    const inline = HTML_ANCHOR.exec(withoutSuffix)
    const text = withoutSuffix.replace(HTML_ANCHOR, "").trim()
    const before = /^\s*<a\s/.test(above) && above.replace(HTML_ANCHOR, "").trim() === "" ? HTML_ANCHOR.exec(above) : null
    return { text, explicit: suffix?.[1] ?? inline?.[1] ?? before?.[1] }
}

/** The id a heading's text carries: a dotted id it opens with, its first rule-id token with a digit, else an upper-case id it opens with. */
export const headingId = (text: string): string | undefined => {
    const tokens = text.split(/[^A-Za-z0-9._-]+/).filter((token) => token !== "")
    const first = tokens[0]
    if (first !== undefined && text.startsWith(first) && isDottedId(first)) return first
    const ruled = tokens.filter(isRuleId)
    const opening = ruled[0]
    return ruled.find((token) => /\d/.test(token)) ?? (opening !== undefined && text.startsWith(opening) && UPPER_ID.test(opening) ? opening : undefined)
}

/** The anchors one heading carries: the primary (explicit, else its id, else the fallback) and the other forms it also resolves by. */
export const headingAnchors = (path: string, parsed: ParsedHeading, fallbackSlug: string): { readonly anchor: string; readonly aliases: readonly string[] } => {
    const fallback = `${path}#${fallbackSlug}`
    const id = headingId(parsed.text)
    const forms = [parsed.explicit, id, fallback].filter((form): form is string => form !== undefined)
    const unique = [...new Set(forms)]
    return { anchor: unique[0] ?? fallback, aliases: unique.slice(1) }
}

/** A Markdown link's fragment into a file of the corpus: `[x](../tabs.md#choose)` or `[x](#choose)`. */
export interface LinkFragment {
    /** The linked file, relative to the corpus root; the linking file itself for a bare `#fragment`. */
    readonly target: string
    readonly fragment: string
    readonly line: number
}

const LINK = /\]\(([^()\s#]*)#([^()\s]+)\)/g

const normalise = (from: string, link: string): string => {
    const parts = from.split("/").slice(0, -1)
    for (const part of link.split("/")) {
        if (part === "..") parts.pop()
        else if (part !== "." && part !== "") parts.push(part)
    }
    return parts.join("/")
}

/** The link fragments of a Markdown file (outside code fences), each resolved against the file's folder. */
export const linkFragments = (path: string, lines: readonly string[]): LinkFragment[] => {
    let fenced = false
    const links: LinkFragment[] = []
    for (const [index, line] of lines.entries()) {
        if (/^\s{0,3}(```|~~~)/.test(line)) fenced = !fenced
        if (fenced) continue
        for (const match of line.matchAll(LINK)) {
            const file = match[1] ?? ""
            const fragment = match[2]
            if (fragment === undefined || /^[a-z]+:/i.test(file)) continue
            links.push({ target: file === "" ? path : normalise(path, file), fragment, line: index + 1 })
        }
    }
    return links
}
