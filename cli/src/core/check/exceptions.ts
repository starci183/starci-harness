import type { ExceptionKind } from "../../harness/policy.js"

/** A declared exception as a scan reads it: one file, one rule (a loosening marker or a secret rule), the exact texts it covers. */
export interface DeclaredException {
    readonly path: string
    readonly rule: string
    readonly kind: ExceptionKind
    /** The owner ruling a `ruling` exception rests on. */
    readonly decision?: string | undefined
    readonly match: readonly string[]
    readonly reason: string
}

/** What a scan knows of one finding: its file, its rule and the text of its line, trimmed. */
export interface FindingKey {
    readonly file: string
    readonly rule: string
    readonly text: string
}

/** One `match` entry of an exception that covers no finding of the scanned tree (EXCEPTION_STALE). */
export interface StaleEntry {
    readonly path: string
    readonly rule: string
    readonly kind: ExceptionKind
    readonly index: number
    readonly match: string
}

/** What an exception adds to a finding it covers. */
export interface Coverage {
    readonly kind: ExceptionKind
    readonly decision?: string | undefined
    readonly reason: string
}

/** How a report names the exception that covers a finding: its kind, and the ruling a `ruling` exception rests on. */
export const coverageLabel = (coverage: Coverage): string => (coverage.decision === undefined ? coverage.kind : `${coverage.kind} ${coverage.decision}`)

/** Findings split by the declared exceptions: the open ones, the covered ones with their exception, and the unused entries. */
export interface Excepted<F> {
    readonly open: F[]
    readonly excepted: (F & Coverage)[]
    readonly stale: StaleEntry[]
}

/**
 * Splits `findings` by `exceptions`. An exception covers a finding of its file and rule whose text equals one of its `match`
 * entries, and nothing else, so a new occurrence in the same file stays open; every entry that covers nothing is stale.
 */
export const applyExceptions = <F>(findings: readonly F[], keyOf: (finding: F) => FindingKey, exceptions: readonly DeclaredException[]): Excepted<F> => {
    const open: F[] = []
    const excepted: (F & Coverage)[] = []
    const used = new Set<string>()
    for (const finding of findings) {
        const key = keyOf(finding)
        const exceptionIndex = exceptions.findIndex((candidate) => candidate.path === key.file && candidate.rule === key.rule && candidate.match.includes(key.text))
        const exception = exceptions[exceptionIndex]
        if (exception === undefined) open.push(finding)
        else {
            used.add(`${String(exceptionIndex)}:${String(exception.match.indexOf(key.text))}`)
            excepted.push({ ...finding, kind: exception.kind, decision: exception.decision, reason: exception.reason })
        }
    }
    const stale = exceptions.flatMap((exception, exceptionIndex) =>
        exception.match.flatMap((match, index): StaleEntry[] => (used.has(`${String(exceptionIndex)}:${String(index)}`) ? [] : [{ path: exception.path, rule: exception.rule, kind: exception.kind, index, match }])),
    )
    return { open, excepted, stale }
}
