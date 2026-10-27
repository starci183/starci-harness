/**
 * What a marker reads of a file: the raw text, the text with string bodies blanked (`comments`: comments and code
 * stay), with comment bodies blanked (`strings`: string literals and code stay), or with both blanked (`code`).
 * Blanking replaces each character with a space and keeps every line break, so a line number never moves.
 */
export type TextView = "raw" | "comments" | "strings" | "code"

/** The four views of one text. */
export type TextViews = Readonly<Record<TextView, string>>

/** The class of each character: code, the body of a string (or template or regex) literal, or a comment. */
const CODE = 0
const STRING = 1
const COMMENT = 2

/** Characters after which a `/` opens a regular expression literal rather than a division. */
const REGEX_AFTER = new Set("(,=:[!&|?{};+-*%<>~^")

/** Keywords after which a `/` opens a regular expression literal. */
const REGEX_KEYWORDS = /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/

const isLineBreak = (char: string | undefined): boolean => char === "\n" || char === "\r"

/** Whether a `/` at `index` opens a regular expression, judged by the last significant code character before it. */
const opensRegex = (text: string, classes: Uint8Array, index: number): boolean => {
    let at = index - 1
    while (at >= 0 && (classes[at] !== CODE || /\s/.test(text.charAt(at)))) at -= 1
    if (at < 0) return true
    const previous = text.charAt(at)
    if (REGEX_AFTER.has(previous)) return true
    return /[\w$]/.test(previous) && REGEX_KEYWORDS.test(text.slice(Math.max(0, at - 10), at + 1))
}

/** Marks `[from, to)` with `kind`, keeping line breaks as code so that blanking never joins two lines. */
const mark = (text: string, classes: Uint8Array, from: number, to: number, kind: number): void => {
    for (let at = from; at < to; at += 1) classes[at] = isLineBreak(text.charAt(at)) ? CODE : kind
}

/** The end (exclusive) of a quoted string body starting at `from`: the closing quote's index, or the line break. */
const quotedEnd = (text: string, from: number, quote: string): number => {
    let at = from
    while (at < text.length) {
        const char = text.charAt(at)
        if (char === "\\") at += 2
        else if (char === quote || isLineBreak(char)) return at
        else at += 1
    }
    return text.length
}

/** The end (exclusive) of a regex body starting at `from`: the closing `/` outside a class, or the line break. */
const regexEnd = (text: string, from: number): number => {
    let at = from
    let inClass = false
    while (at < text.length) {
        const char = text.charAt(at)
        if (char === "\\") at += 2
        else if (isLineBreak(char)) return at
        else {
            if (char === "[") inClass = true
            else if (char === "]") inClass = false
            else if (char === "/" && !inClass) return at
            at += 1
        }
    }
    return text.length
}

/** The end (exclusive) of the line holding `from`: the index of its line break, or the end of the text. */
const lineEnd = (text: string, from: number): number => {
    let end = from
    while (end < text.length && !isLineBreak(text.charAt(end))) end += 1
    return end
}

/** Marks the comment, quoted string or regex literal opening at `at` and returns the index after it; undefined when none opens there. */
const scanLiteral = (text: string, classes: Uint8Array, at: number): number | undefined => {
    const char = text.charAt(at)
    const next = text.charAt(at + 1)
    if (char === "/" && next === "/") {
        const end = lineEnd(text, at)
        mark(text, classes, at, end, COMMENT)
        return end
    }
    if (char === "/" && next === "*") {
        const close = text.indexOf("*/", at + 2)
        const end = close === -1 ? text.length : close + 2
        mark(text, classes, at, end, COMMENT)
        return end
    }
    if (char === "'" || char === '"') {
        const end = quotedEnd(text, at + 1, char)
        mark(text, classes, at + 1, end, STRING)
        return end + 1
    }
    if (char === "/" && opensRegex(text, classes, at)) {
        const end = regexEnd(text, at + 1)
        mark(text, classes, at + 1, end, STRING)
        return end + 1
    }
    return undefined
}

/**
 * Classifies a JavaScript-family text (also CSS, Vue and Svelte, close enough for markers): line and block comments,
 * quoted strings, template literals with their `${...}` interpolations kept as code, and regex literals.
 */
const classifyScript = (text: string): Uint8Array => {
    const classes = new Uint8Array(text.length)
    // One entry per open template interpolation: the brace depth at which its closing `}` returns to the template.
    const interpolations: number[] = []
    let depth = 0
    let at = 0
    const template = (from: number): number => {
        let cursor = from
        while (cursor < text.length) {
            const char = text.charAt(cursor)
            if (char === "\\") cursor += 2
            else if (char === "`") {
                mark(text, classes, from, cursor, STRING)
                return cursor + 1
            } else if (char === "$" && text.charAt(cursor + 1) === "{") {
                mark(text, classes, from, cursor, STRING)
                interpolations.push(depth)
                depth += 1
                return cursor + 2
            } else cursor += 1
        }
        mark(text, classes, from, text.length, STRING)
        return text.length
    }
    while (at < text.length) {
        const char = text.charAt(at)
        const literalEnd = scanLiteral(text, classes, at)
        if (literalEnd !== undefined) at = literalEnd
        else if (char === "`") at = template(at + 1)
        else if (char === "{") {
            depth += 1
            at += 1
        } else if (char === "}") {
            depth -= 1
            at += 1
            if (interpolations.length > 0 && interpolations.at(-1) === depth) {
                interpolations.pop()
                at = template(at)
            }
        } else at += 1
    }
    return classes
}

/**
 * Classifies a shell, YAML or Dockerfile text line by line: a `#` outside quotes at the start of a line or after a blank
 * opens a comment to the end of the line. Quoted text stays code, since a shell runs what it quotes.
 */
const classifyHashComments = (text: string): Uint8Array => {
    const classes = new Uint8Array(text.length)
    let quote: string | undefined
    let at = 0
    while (at < text.length) {
        const char = text.charAt(at)
        if (isLineBreak(char)) quote = undefined
        else if (quote !== undefined) {
            if (char === "\\" && quote === '"') at += 1
            else if (char === quote) quote = undefined
        } else if (char === "'" || char === '"') quote = char
        else if (char === "#" && (at === 0 || /\s/.test(text.charAt(at - 1)))) {
            const end = lineEnd(text, at)
            mark(text, classes, at, end, COMMENT)
            at = end - 1
        }
        at += 1
    }
    return classes
}

/** Classifies a Java properties text: a line whose first non-blank character is `#` or `!` is a comment. */
const classifyProperties = (text: string): Uint8Array => {
    const classes = new Uint8Array(text.length)
    let start = 0
    for (const line of text.split("\n")) {
        if (/^\s*[#!]/.test(line)) mark(text, classes, start, start + line.length, COMMENT)
        start += line.length + 1
    }
    return classes
}

/** The text with every character of the given classes replaced by a space. */
const blank = (text: string, classes: Uint8Array, hidden: readonly number[]): string => {
    let result = ""
    for (let at = 0; at < text.length; at += 1) result += hidden.includes(classes[at] ?? CODE) ? " " : text.charAt(at)
    return result
}

/** How a kind of file is read: as script, with hash comments, as properties, or not tokenized (JSON). */
export type TextSyntax = "script" | "hash" | "properties" | "none"

/** The classifier of each tokenized syntax. */
const CLASSIFIERS: Readonly<Record<Exclude<TextSyntax, "none">, (text: string) => Uint8Array>> = { script: classifyScript, hash: classifyHashComments, properties: classifyProperties }

/** The four views of `text` read with `syntax`. */
export const textViews = (text: string, syntax: TextSyntax): TextViews => {
    if (syntax === "none") return { raw: text, comments: text, strings: text, code: text }
    const classes = CLASSIFIERS[syntax](text)
    return { raw: text, comments: blank(text, classes, [STRING]), strings: blank(text, classes, [COMMENT]), code: blank(text, classes, [STRING, COMMENT]) }
}

/** The text with comments blanked and trailing commas removed, so JSON.parse reads a tsconfig-style JSONC file. */
export const jsoncToJson = (text: string): string => textViews(text, "script").strings.replace(/,(\s*[}\]])/g, "$1")
