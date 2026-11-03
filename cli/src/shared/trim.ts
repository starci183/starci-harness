/**
 * `text` without the run of `chars` at its end. A regular expression such as `/\/+$/` retries from every position of a long
 * run before it fails, so a trailing-run trim is a scan from the end instead.
 */
export const trimEndChars = (text: string, chars: string): string => {
    let end = text.length
    while (end > 0 && chars.includes(text.charAt(end - 1))) end -= 1
    return text.slice(0, end)
}

/** `text` without the run of `chars` at its start. */
export const trimStartChars = (text: string, chars: string): string => {
    let start = 0
    while (start < text.length && chars.includes(text.charAt(start))) start += 1
    return text.slice(start)
}
