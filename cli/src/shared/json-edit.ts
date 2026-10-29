import { isDeepStrictEqual } from "node:util"
import { Refusal } from "./errors.js"

/** Where one JSON value sits in its text: `start` at its first character, `end` just past its last. */
interface Span {
    readonly start: number
    readonly end: number
}

/** One parsed JSON value with its place, and for an object or array the places of its members. */
type Node =
    | { readonly kind: "object"; readonly span: Span; readonly members: readonly { readonly key: string; readonly keyStart: number; readonly value: Node }[] }
    | { readonly kind: "array"; readonly span: Span; readonly items: readonly Node[] }
    | { readonly kind: "scalar"; readonly span: Span }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** A positional reader of a text JSON.parse already accepted: it keeps where each value is, so an edit touches only its own bytes. */
const parseSpans = (text: string): Node => {
    let at = 0
    const skip = (): void => {
        while (at < text.length && /\s/.test(text.charAt(at))) at++
    }
    const string = (): string => {
        const start = at
        at++
        while (text.charAt(at) !== '"') at += text.charAt(at) === "\\" ? 2 : 1
        at++
        return JSON.parse(text.slice(start, at)) as string
    }
    const value = (): Node => {
        skip()
        const start = at
        const head = text.charAt(at)
        if (head === "{") {
            at++
            const members: { key: string; keyStart: number; value: Node }[] = []
            skip()
            while (text.charAt(at) !== "}") {
                skip()
                const keyStart = at
                const key = string()
                skip()
                at++ // the colon
                members.push({ key, keyStart, value: value() })
                skip()
                if (text.charAt(at) === ",") at++
                skip()
            }
            at++
            return { kind: "object", span: { start, end: at }, members }
        }
        if (head === "[") {
            at++
            const items: Node[] = []
            skip()
            while (text.charAt(at) !== "]") {
                items.push(value())
                skip()
                if (text.charAt(at) === ",") at++
                skip()
            }
            at++
            return { kind: "array", span: { start, end: at }, items }
        }
        if (head === '"') {
            string()
            return { kind: "scalar", span: { start, end: at } }
        }
        while (at < text.length && !/[\s,\]}]/.test(text.charAt(at))) at++
        return { kind: "scalar", span: { start, end: at } }
    }
    return value()
}

/** The whitespace that opens the line `offset` sits on, when only whitespace precedes it there. */
const indentAt = (text: string, offset: number): string | undefined => {
    const lineStart = text.lastIndexOf("\n", offset - 1) + 1
    const lead = text.slice(lineStart, offset)
    return /^[ \t]*$/.test(lead) ? lead : undefined
}

const memberOf = (node: Node, key: string): Node | undefined => (node.kind === "object" ? node.members.find((member) => member.key === key)?.value : undefined)

/**
 * Adds `values` to the string array at `path` of a JSON text, add only: a value already listed stays where it is, the array is
 * created as the last member of its parent object when absent, and every other byte of the text (key order, inline or broken
 * arrays, indentation, line endings) is kept. The parent object must exist. The result is proved by parsing it: it must equal the
 * original with the values appended, else JSON_EDIT_FAILED and nothing is returned.
 */
export const addToStringArray = (text: string, path: readonly string[], values: readonly string[]): string => {
    const parsed: unknown = JSON.parse(text)
    const parentPath = path.slice(0, -1)
    const leaf = path.at(-1)
    if (leaf === undefined) throw new Refusal("JSON_EDIT_FAILED", "an empty JSON path names no array")
    let parentValue: unknown = parsed
    for (const key of parentPath) parentValue = isRecord(parentValue) ? parentValue[key] : undefined
    if (!isRecord(parentValue)) throw new Refusal("JSON_EDIT_FAILED", `${parentPath.join(".")} is no object`)
    const current = parentValue[leaf]
    if (current !== undefined && !(Array.isArray(current) && current.every((item) => typeof item === "string"))) throw new Refusal("JSON_EDIT_FAILED", `${path.join(".")} is no list of strings`)
    const listed: readonly string[] = current ?? []
    const added = [...new Set(values)].filter((value) => !listed.includes(value))
    if (added.length === 0) return text
    const eol = text.includes("\r\n") ? "\r\n" : "\n"
    const parent = parentPath.reduce<Node | undefined>((node, key) => (node === undefined ? undefined : memberOf(node, key)), parseSpans(text))
    if (parent === undefined) throw new Refusal("JSON_EDIT_FAILED", `${parentPath.join(".")} is no object`)
    const quoted = added.map((value) => JSON.stringify(value))
    let edited: string
    const array = memberOf(parent, leaf)
    if (array?.kind === "array") {
        const last = array.items.at(-1)
        const inline = !text.slice(array.span.start, array.span.end).includes("\n")
        if (last === undefined || inline) {
            const items = [...array.items.map((item) => text.slice(item.span.start, item.span.end)), ...quoted]
            edited = `${text.slice(0, array.span.start)}[${items.join(", ")}]${text.slice(array.span.end)}`
        } else {
            const indent = indentAt(text, last.span.start) ?? ""
            edited = `${text.slice(0, last.span.end)}${quoted.map((item) => `,${eol}${indent}${item}`).join("")}${text.slice(last.span.end)}`
        }
    } else if (parent.kind === "object") {
        const last = parent.members.at(-1)
        const member = `${JSON.stringify(leaf)}: [${quoted.join(", ")}]`
        if (last === undefined) edited = `${text.slice(0, parent.span.start)}{ ${member} }${text.slice(parent.span.end)}`
        else {
            const indent = indentAt(text, last.keyStart)
            const gap = indent === undefined ? " " : `${eol}${indent}`
            edited = `${text.slice(0, last.value.span.end)},${gap}${member}${text.slice(last.value.span.end)}`
        }
    } else throw new Refusal("JSON_EDIT_FAILED", `${parentPath.join(".")} is no object`)
    const expected = structuredClone(parsed)
    const holder = parentPath.reduce<unknown>((node, key) => (isRecord(node) ? node[key] : undefined), expected)
    if (isRecord(holder)) holder[leaf] = [...listed, ...added]
    if (!isDeepStrictEqual(JSON.parse(edited), expected)) throw new Refusal("JSON_EDIT_FAILED", `adding ${added.join(", ")} to ${path.join(".")} would change more than that list`)
    return edited
}
