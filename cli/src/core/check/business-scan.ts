import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"
import { Refusal } from "../../shared/errors.js"
import { readTreeFile } from "./tree-files.js"

/** The policy file `check business` reads: the identifiers the owner named, the exact exceptions and the paths left unread. */
export const BUSINESS_TERMS = "policy/business-terms.yaml"
/** The schema of the policy file. */
export const BUSINESS_TERMS_SCHEMA = "starci/business-terms@1"
/** The finding codes of the business gate; each is red. */
export const BUSINESS_CODES = ["BUSINESS_TERM", "BUSINESS_ALLOW_STALE"] as const
/** One business finding code. */
export type BusinessCode = (typeof BUSINESS_CODES)[number]
/** No source file the gate reads is larger than this; a larger text file is named unread. */
const MAX_BYTES = 4 * 1024 * 1024

/** One identifier the owner named: a product or app name, or a provider an app integrates. */
export interface DeniedTerm {
    readonly term: string
    readonly kind: "product" | "provider"
    readonly reason: string
}

/** One exact exception: this term in this file, with the reason it stays. */
export interface AllowedTerm {
    readonly path: string
    readonly term: string
    readonly reason: string
}

/** The policy as read: the denied terms, the exceptions and the path prefixes and suffixes outside the scan. */
export interface BusinessPolicy {
    readonly deny: readonly DeniedTerm[]
    readonly allow: readonly AllowedTerm[]
    readonly outside: readonly { readonly path: string; readonly reason: string }[]
}

/** One red finding: a denied term in a file, or an exception nothing uses. */
export interface BusinessFinding {
    /** `<code> <path> <term>`: the finding's stable key. */
    readonly key: string
    readonly code: BusinessCode
    readonly path: string
    readonly term: string
    readonly line: number | null
    readonly detail: string
}

/** The report of one run. */
export interface BusinessReport {
    readonly verdict: "green" | "red"
    readonly files: number
    readonly unread: readonly string[]
    readonly excepted: number
    readonly findings: readonly BusinessFinding[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== ""

/** Reads and validates `policy/business-terms.yaml` of `root`; refuses a tree without one or with an invalid one. */
export const loadBusinessPolicy = (root: string): BusinessPolicy => {
    const file = join(root, BUSINESS_TERMS)
    if (!existsSync(file)) throw new Refusal("BUSINESS_TERMS_MISSING", `${BUSINESS_TERMS} is missing: check business judges the harness repository's own sources against the identifiers its owner named`)
    const doc: unknown = parse(readFileSync(file, "utf8"))
    const invalid = (why: string): never => { throw new Refusal("BUSINESS_TERMS_INVALID", `${BUSINESS_TERMS} ${why}`) }
    if (!isRecord(doc) || doc.schema !== BUSINESS_TERMS_SCHEMA) return invalid(`is not a ${BUSINESS_TERMS_SCHEMA} file`)
    const extra = Object.keys(doc).filter((key) => !["schema", "deny", "allow", "outside"].includes(key))
    if (extra.length > 0) return invalid(`has unknown key ${extra.join(", ")} (schema, deny, allow, outside)`)
    const entries = (key: string, fields: readonly string[]): Record<string, string>[] => {
        const list: unknown = doc[key] ?? []
        if (!Array.isArray(list)) return invalid(`${key} is a list`)
        return list.map((entry: unknown, at) => {
            if (!isRecord(entry) || Object.keys(entry).length !== fields.length || fields.some((field) => !isText(entry[field]))) return invalid(`${key}[${String(at)}] holds exactly ${fields.join(", ")}`)
            return Object.fromEntries(fields.map((field) => [field, String(entry[field]).trim()]))
        })
    }
    const deny = entries("deny", ["term", "kind", "reason"]).map((entry, at): DeniedTerm => {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(entry.term ?? "")) invalid(`deny[${String(at)}].term is lower-case words joined by hyphens (${String(entry.term)})`)
        if (entry.kind !== "product" && entry.kind !== "provider") invalid(`deny[${String(at)}].kind is product or provider (${String(entry.kind)})`)
        return { term: entry.term ?? "", kind: entry.kind === "provider" ? "provider" : "product", reason: entry.reason ?? "" }
    })
    if (deny.length === 0) return invalid("denies no term")
    if (new Set(deny.map((entry) => entry.term)).size !== deny.length) return invalid("denies a term twice")
    const allow = entries("allow", ["path", "term", "reason"]).map((entry, at): AllowedTerm => {
        if (!deny.some((denied) => denied.term === entry.term)) invalid(`allow[${String(at)}].term ${String(entry.term)} is no denied term`)
        return { path: entry.path ?? "", term: entry.term ?? "", reason: entry.reason ?? "" }
    })
    const outside = entries("outside", ["path", "reason"]).map((entry) => ({ path: entry.path ?? "", reason: entry.reason ?? "" }))
    return { deny, allow, outside }
}

/**
 * The expression of one denied term: its words, joined by a hyphen, an underscore or nothing (`ui-kit`, `ui_kit`, `uiKit`), matched
 * without regard to case. Whether a match is a whole token is judged by `wholeToken`.
 */
const termExpression = (term: string): RegExp => new RegExp(term.split("-").join("[-_]?"), "giu")

const isAlnum = (char: string | undefined): boolean => char !== undefined && /[A-Za-z0-9]/u.test(char)
const isUpper = (char: string | undefined): boolean => char !== undefined && /[A-Z]/u.test(char)
const isLower = (char: string | undefined): boolean => char !== undefined && /[a-z0-9]/u.test(char)

/**
 * A match is a whole token when it is bounded on both sides by a character that is no letter or digit, by the edge of the text, or by a
 * camelCase boundary (a lower-case letter or digit, then an upper-case letter): `AcmeInboxEntity`, `acme-feed` and `ACME_KEY` hold the
 * token `acme`; `parseAcmeConfig` holds it too, `macmedia` and `acmes` do not.
 */
export const wholeToken = (text: string, start: number, end: number): boolean => {
    const before = text[start - 1], first = text[start], last = text[end - 1], after = text[end]
    const opens = !isAlnum(before) || (isLower(before) && isUpper(first))
    const closes = !isAlnum(after) || (isLower(last) && isUpper(after))
    return opens && closes
}

/** The first line (1-based) of each denied term that `text` holds as a whole token. */
export const deniedTermsIn = (text: string, deny: readonly DeniedTerm[]): Map<string, number> => {
    const found = new Map<string, number>()
    for (const { term } of deny) {
        for (const match of text.matchAll(termExpression(term))) {
            if (!wholeToken(text, match.index, match.index + match[0].length)) continue
            found.set(term, text.slice(0, match.index).split("\n").length)
            break
        }
    }
    return found
}

/** Whether `file` is outside the scan: an `outside` path that ends in `/` is a folder prefix, one that starts with `*` a suffix, any other one file. */
const isOutside = (file: string, outside: BusinessPolicy["outside"]): boolean => outside.some(({ path }) =>
    path.endsWith("/") ? file.startsWith(path) : path.startsWith("*") ? file.endsWith(path.slice(1)) : file === path)

/**
 * Judges the files of the tree at `root` against the policy: a denied term held as a whole token by a file is red unless an `allow` entry names
 * that file and that term; an `allow` entry whose file no longer holds its term is red too. The policy file itself and the `outside` paths are
 * not read. The decision is membership in the list: nothing here reads a text for what it means.
 */
export const scanBusiness = (root: string, policy: BusinessPolicy, files: readonly string[]): BusinessReport => {
    const findings: BusinessFinding[] = []
    const unread: string[] = []
    const used = new Set<string>()
    let read = 0
    for (const file of files) {
        if (file === BUSINESS_TERMS || isOutside(file, policy.outside)) continue
        const content = readTreeFile(root, file, MAX_BYTES)
        if ("unread" in content) { if (content.unread === "too-large") unread.push(file); continue }
        read += 1
        // The path is judged with the text: a folder or file named after an app is content of the tree as well.
        for (const [term, line] of deniedTermsIn(`${file}\n${content.text}`, policy.deny)) {
            if (policy.allow.some((entry) => entry.path === file && entry.term === term)) { used.add(`${file}\n${term}`); continue }
            const at = line === 1 ? null : line - 1
            findings.push({ key: `BUSINESS_TERM ${file} ${term}`, code: "BUSINESS_TERM", path: file, term, line: at, detail: `${file}${at === null ? " (its path)" : `:${String(at)}`} holds ${term}, an identifier ${BUSINESS_TERMS} denies; the harness names no app, product or provider (contexts/harness/rules.md rule 9): write the mechanism with a neutral name, or move what serves one app to that app` })
        }
    }
    for (const entry of policy.allow) {
        if (!used.has(`${entry.path}\n${entry.term}`)) findings.push({ key: `BUSINESS_ALLOW_STALE ${entry.path} ${entry.term}`, code: "BUSINESS_ALLOW_STALE", path: entry.path, term: entry.term, line: null, detail: `${BUSINESS_TERMS} allows ${entry.term} in ${entry.path}, which no longer holds it; delete the entry` })
    }
    return { verdict: findings.length === 0 ? "green" : "red", files: read, unread, excepted: used.size, findings }
}

/** The lines `check business` prints: each finding, the unread files, and the verdict with its counts. */
export const describeBusiness = (report: BusinessReport): string[] => [
    ...report.findings.map((finding) => `${finding.code}: ${finding.detail}`),
    ...report.unread.map((file) => `unread (too large): ${file}`),
    `business: ${report.verdict}; ${String(report.files)} file(s) read, ${String(report.findings.length)} finding(s), ${String(report.excepted)} allowed`,
]
