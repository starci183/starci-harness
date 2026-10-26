import { existsSync } from "node:fs"
import { join } from "node:path"
import { envelopesAllowed, neverRead } from "../../harness/policy.js"
import type { Policy, SecurityException } from "../../harness/policy.js"
import { lineFindings, scanDiff } from "../../shared/secrets.js"
import type { SecretFinding } from "../../shared/secrets.js"
import { readTreeFile } from "./tree-files.js"

/** One secret finding a declared exception covers, with its reason. */
export interface ExceptedSecret extends SecretFinding {
    readonly reason: string
}

/** The secret scan of a set of files as they stand: findings without values, excepted ones, stale exceptions, unjudged files. */
export interface SecretReport {
    readonly files: number
    readonly unread: number
    readonly envelopes: "allowed" | "refused"
    readonly findings: readonly SecretFinding[]
    readonly excepted: readonly ExceptedSecret[]
    readonly stale: readonly SecurityException[]
    readonly unjudged: readonly string[]
    readonly verdict: "green" | "red"
}

/** The synthetic diff that adds `text` as a new file, so the push scan's envelope rule judges a sops file as a whole. */
const asAddedFile = (file: string, text: string): string => {
    const lines = text.split(/\r?\n/)
    return [`+++ b/${file}`, `@@ -0,0 +1,${String(lines.length)} @@`, ...lines.map((line) => `+${line}`)].join("\n")
}

/**
 * Scans `files` (repository-relative) with the rules of shared/secrets.ts as the files stand: forbidden paths by name, every
 * line of every readable file by content. A neverRead file is judged by its name alone. `complete` says the files are the
 * whole tree, so an exception that matches nothing there is stale.
 */
export const scanSecrets = (root: string, files: readonly string[], policy: Policy, profile: string, complete: boolean): SecretReport => {
    const maxBytes = policy.loosening.scan.maxFileBytes
    const allowed = envelopesAllowed(policy, profile)
    // A deleted file holds no secret any more; existence is asked of the file system, so a neverRead file is never opened.
    const present = files.filter((file) => existsSync(join(root, file)))
    const raw: SecretFinding[] = scanDiff("", present, () => undefined)
    const unjudged: string[] = []
    let unread = 0
    for (const file of present) {
        if (file.endsWith(".enc") && !allowed) raw.push({ file, line: null, pattern: "sops-envelope-refused" })
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
        if (file.endsWith(".enc")) {
            raw.push(...scanDiff(asAddedFile(file, read.text), [], () => read.text))
            continue
        }
        read.text.split(/\r?\n/).forEach((line, index) => {
            for (const pattern of lineFindings(file, line)) raw.push({ file, line: index + 1, pattern })
        })
    }
    const findings: SecretFinding[] = []
    const excepted: ExceptedSecret[] = []
    const used = new Set<SecurityException>()
    for (const finding of raw) {
        const exception = policy.security.exceptions.find((candidate) => candidate.path === finding.file && candidate.rule === finding.pattern)
        if (exception === undefined) findings.push(finding)
        else {
            used.add(exception)
            excepted.push({ ...finding, reason: exception.reason })
        }
    }
    const stale = complete ? policy.security.exceptions.filter((exception) => !used.has(exception)) : []
    const verdict = findings.length === 0 && stale.length === 0 && unjudged.length === 0 ? "green" : "red"
    return { files: present.length, unread, envelopes: allowed ? "allowed" : "refused", findings, excepted, stale, unjudged, verdict }
}

/** The human lines of a secret report: where and which rule, never a value. */
export const describeSecrets = (report: SecretReport): string[] => [
    `secrets: ${report.verdict}; ${String(report.files)} file(s), ${String(report.unread)} judged by name only, ${String(report.findings.length)} finding(s), ${String(report.excepted.length)} excepted`,
    ...report.findings.map((finding) => `${finding.file}${finding.line === null ? "" : `:${String(finding.line)}`} ${finding.pattern}`),
    ...report.stale.map((exception) => `stale exception: ${exception.path} ${exception.rule} matches nothing; remove it from policy/security.yaml`),
    ...report.unjudged.map((file) => `unjudged: ${file} is larger than scan.maxFileBytes; the scan cannot read it`),
]
