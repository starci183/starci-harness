/**
 * Which destinations a course body may link to or load. Markdown is authored text, so a destination is data: only these schemes
 * become a link or an image; anything else (`javascript:`, `data:`, `vbscript:`) is shown as its words, never as a target.
 */

const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/

const LINK_SCHEMES: ReadonlySet<string> = new Set(["http", "https", "mailto", "tel"])
const IMAGE_SCHEMES: ReadonlySet<string> = new Set(["http", "https"])

const schemeOf = (url: string): string | null => {
    // Control characters and spaces inside the scheme are how `java\tscript:` slips past a check.
    const cleaned = url.replace(/[\u0000-\u0020\u007f-\u009f]/g, "")
    const match = SCHEME.exec(cleaned)
    return match === null ? null : (match[1] ?? "").toLowerCase()
}

/** True when the destination may be an anchor's `href`: a relative path, a fragment, or an allowed scheme. */
export const isSafeLink = (url: string): boolean => {
    const scheme = schemeOf(url)
    return scheme === null || LINK_SCHEMES.has(scheme)
}

/** True when the destination may be an image's `src`: a relative path or http(s). */
export const isSafeImage = (url: string): boolean => {
    const scheme = schemeOf(url)
    return scheme === null || IMAGE_SCHEMES.has(scheme)
}

/** The default test for a destination off this site: an absolute http(s) URL or a protocol-relative one. */
export const isExternalUrl = (url: string): boolean => /^(https?:)?\/\//i.test(url.trim())
