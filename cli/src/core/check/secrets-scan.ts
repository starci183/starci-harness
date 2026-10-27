import { existsSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { parse } from "yaml"
import { envelopesAllowed, neverRead } from "../../harness/policy.js"
import type { Policy } from "../../harness/policy.js"
import { lineFindings, scanDiff } from "../../shared/secrets.js"
import type { SecretFinding, SecretHit } from "../../shared/secrets.js"
import { applyExceptions, coverageLabel } from "./exceptions.js"
import type { Coverage, StaleEntry } from "./exceptions.js"
import { readTreeFile } from "./tree-files.js"

/** One secret finding a declared exception covers, with the exception's kind and reason. */
export type ExceptedSecret = SecretFinding & Coverage

/** The secret scan of a set of files as they stand: findings without values, excepted ones, stale exceptions, unjudged files. */
export interface SecretReport {
    readonly files: number
    readonly unread: number
    readonly envelopes: "allowed" | "refused"
    readonly findings: readonly SecretFinding[]
    readonly excepted: readonly ExceptedSecret[]
    /** Stale entries by index: a report never shows a match text. */
    readonly stale: readonly Omit<StaleEntry, "match">[]
    readonly unjudged: readonly string[]
    readonly verdict: "green" | "red"
}

/** The synthetic diff that adds `text` as a new file, so the push scan's envelope rule judges a sops file as a whole. */
const asAddedFile = (file: string, text: string): string => {
    const lines = text.split(/\r?\n/)
    return [`+++ b/${file}`, `@@ -0,0 +1,${String(lines.length)} @@`, ...lines.map((line) => `+${line}`)].join("\n")
}

/** Every finding of the lines of one readable file. */
const lineHits = (file: string, text: string): SecretHit[] =>
    text.split(/\r?\n/).flatMap((line, index) => lineFindings(file, line).map((pattern) => ({ file, line: index + 1, pattern, text: line.trim() })))

/** Judges one readable file: a sops envelope as a whole, any other file line by line. */
const judgeFile = (file: string, text: string): SecretHit[] => (file.endsWith(".enc") ? scanDiff(asAddedFile(file, text), [], () => text) : lineHits(file, text))

/** The `:line` of a finding, empty for a finding of a whole file. */
const lineSuffix = (line: number | null): string => (line === null ? "" : ":" + String(line))

/** The value a policy line declares as a `match` entry (`match: <text>` or `- <text>`), or undefined. */
const declaredMatch = (text: string): unknown => {
    const body = /^(?:match:|-)\s+(.+)$/.exec(text)?.[1]
    if (body === undefined) return undefined
    try {
        return parse(body) as unknown
    } catch {
        return undefined
    }
}

/**
 * Splits secret hits by the declared exceptions of policy/security.yaml (exceptions.ts). A hit in the security.yaml that
 * declares the exceptions, on a line that declares one of their `match` texts, is that declaration and no finding: the
 * text is held to a covered finding elsewhere, or it is stale.
 */
export const exceptSecrets = (root: string, hits: readonly SecretHit[], policy: Policy): Pick<SecretReport, "findings" | "excepted" | "stale"> => {
    const declaring = new Set(
        [policy.dir, policy.overlay].flatMap((dir) => (dir === undefined ? [] : [relative(root, join(dir, "security.yaml")).split(sep).join("/")])).filter((file) => !file.startsWith("..")),
    )
    const matches = new Set(policy.security.exceptions.flatMap((exception) => exception.match))
    const declared = (hit: SecretHit): boolean => {
        const value = declaredMatch(hit.text)
        return declaring.has(hit.file) && typeof value === "string" && matches.has(value)
    }
    const { open, excepted, stale } = applyExceptions(
        hits.filter((hit) => !declared(hit)),
        (hit) => ({ file: hit.file, rule: hit.pattern, text: hit.text }),
        policy.security.exceptions,
    )
    const bare = ({ file, line, pattern }: SecretHit): SecretFinding => ({ file, line, pattern })
    return { findings: open.map(bare), excepted: excepted.map((hit): ExceptedSecret => ({ ...bare(hit), kind: hit.kind, decision: hit.decision, reason: hit.reason })), stale: stale.map(({ path, rule, kind, index }) => ({ path, rule, kind, index })) }
}

/**
 * Scans `files` (repository-relative) with the rules of shared/secrets.ts as the files stand: forbidden paths by name, every
 * line of every readable file by content. A neverRead file is judged by its name alone. `complete` says the files are the
 * whole tree, so a `match` entry that covers nothing there is stale.
 */
export const scanSecrets = (root: string, files: readonly string[], policy: Policy, profile: string, complete: boolean): SecretReport => {
    const maxBytes = policy.loosening.scan.maxFileBytes
    const allowed = envelopesAllowed(policy, profile)
    // A deleted file holds no secret any more; existence is asked of the file system, so a neverRead file is never opened.
    const present = files.filter((file) => existsSync(join(root, file)))
    const raw: SecretHit[] = scanDiff("", present, () => undefined)
    const unjudged: string[] = []
    let unread = 0
    for (const file of present) {
        if (file.endsWith(".enc") && !allowed) raw.push({ file, line: null, pattern: "sops-envelope-refused", text: "" })
        if (neverRead(policy, file)) {
            unread += 1
            continue
        }
        const read = readTreeFile(root, file, maxBytes)
        if ("unread" in read) {
            if (read.unread === "too-large") unjudged.push(file)
            unread += 1
            continue
        }
        raw.push(...judgeFile(file, read.text))
    }
    const judged = exceptSecrets(root, raw, policy)
    const stale = complete ? judged.stale : []
    const verdict = judged.findings.length === 0 && stale.length === 0 && unjudged.length === 0 ? "green" : "red"
    return { files: present.length, unread, envelopes: allowed ? "allowed" : "refused", findings: judged.findings, excepted: judged.excepted, stale, unjudged, verdict }
}

/** The human lines of a secret report: where and which rule, the exceptions applied and stale entries by index, never a value. */
export const describeSecrets = (report: SecretReport): string[] => [
    `secrets: ${report.verdict}; ${String(report.files)} file(s), ${String(report.unread)} judged by name only, ${String(report.findings.length)} finding(s), ${String(report.excepted.length)} excepted`,
    ...report.findings.map((finding) => `${finding.file}${lineSuffix(finding.line)} ${finding.pattern}`),
    ...report.excepted.map((finding) => `excepted ${coverageLabel(finding)}: ${finding.file}${lineSuffix(finding.line)} ${finding.pattern}`),
    ...report.stale.map((entry) => `EXCEPTION_STALE: ${entry.path} ${entry.rule} (${entry.kind}) match[${String(entry.index)}] covers no finding; remove it from policy/security.yaml`),
    ...report.unjudged.map((file) => `unjudged: ${file} is larger than scan.maxFileBytes; the scan cannot read it`),
]
