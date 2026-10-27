import { neverRead } from "../../harness/policy.js"
import type { LooseningMarker, Policy } from "../../harness/policy.js"
import { applyExceptions, coverageLabel } from "./exceptions.js"
import type { Coverage, StaleEntry } from "./exceptions.js"
import { markerFileKind, markersIn } from "./markers.js"
import { SONAR_FILE, appFacts, appRootOf, sonarBlock } from "./sonar-scope.js"
import { readTreeFile, treeFiles } from "./tree-files.js"
import { resolve } from "node:path"

/** One banned marker in the tree. */
export interface LooseningFinding {
    readonly file: string
    readonly line: number
    readonly marker: LooseningMarker
    readonly label: string
    /** The line as it stands, trimmed: what an exception's `match` names. */
    readonly text: string
}

/** One finding a declared exception covers, with the exception's kind and reason. */
export type ExceptedFinding = LooseningFinding & Coverage

/** The state-based loosening scan of a tree: findings, excepted findings, stale exceptions and files that could not be judged. */
export interface LooseningReport {
    readonly root: string
    readonly banned: readonly LooseningMarker[]
    readonly policy: string
    readonly overlay: string | null
    readonly scanned: number
    readonly findings: readonly LooseningFinding[]
    readonly excepted: readonly ExceptedFinding[]
    readonly stale: readonly StaleEntry[]
    readonly unjudged: readonly string[]
    readonly verdict: "green" | "red"
}

/** The findings of one file, `unjudged` when a file of a scanned kind is too large to read, or nothing when the file is not scanned. */
const judgeFile = (root: string, policy: Policy, file: string, banned: ReadonlySet<LooseningMarker>): LooseningFinding[] | "unjudged" | undefined => {
    if (neverRead(policy, file)) return undefined
    const named = markerFileKind(file, "")
    // An extensionless file may still be a shell script: its first line decides, so it is read before its kind is known.
    if (named === undefined && file.slice(file.lastIndexOf("/") + 1).includes(".")) return undefined
    const read = readTreeFile(root, file, policy.loosening.scan.maxFileBytes)
    if ("unread" in read) return read.unread === "too-large" && named !== undefined ? "unjudged" : undefined
    const kind = named ?? markerFileKind(file, read.text.split("\n", 1)[0] ?? "")
    if (kind === undefined) return undefined
    const lines = read.text.split("\n")
    return markersIn(kind, read.text, banned, kind === "properties" ? { sonarBlock: generatedSonarBlock(root, file) } : {}).map((hit) => ({ file, ...hit, text: (lines[hit.line - 1] ?? "").trim() }))
}

/**
 * The Sonar block `starci app sonar` writes for the app that holds `file` (its sonar-project.properties), or undefined when
 * the file is no app's Sonar file or the block cannot be derived; then no block is accepted and every exclusion is judged.
 */
const generatedSonarBlock = (root: string, file: string): readonly string[] | undefined => {
    if (file.slice(file.lastIndexOf("/") + 1) !== SONAR_FILE) return undefined
    try {
        const appRoot = appRootOf(root, file)
        if (appRoot === undefined || resolve(appRoot, SONAR_FILE) !== resolve(root, file)) return undefined
        const app = appFacts(appRoot)
        return app === undefined ? undefined : sonarBlock(app)
    } catch {
        return undefined
    }
}

/**
 * Reads every file of the tree as it stands and reports each banned marker, by file and line. A declared exception covers
 * the findings of its one file and marker whose line is one of its `match` texts (exceptions.ts); a `match` entry that
 * covers nothing is stale, and a file of a scanned kind too large to read is unjudged: both are red, so neither the list
 * nor the file size can widen the gate.
 */
export const scanLoosening = async (root: string, policy: Policy): Promise<LooseningReport> => {
    const banned = new Set(policy.loosening.banned)
    const findings: LooseningFinding[] = []
    const unjudged: string[] = []
    let scanned = 0
    for (const file of await treeFiles(root)) {
        const judged = judgeFile(root, policy, file, banned)
        if (judged === undefined) continue
        if (judged === "unjudged") unjudged.push(file)
        else {
            scanned += 1
            findings.push(...judged)
        }
    }
    const declared = policy.loosening.exceptions.map((exception) => ({ ...exception, rule: exception.marker }))
    const { open, excepted, stale } = applyExceptions(findings, (finding) => ({ file: finding.file, rule: finding.marker, text: finding.text }), declared)
    const verdict = open.length === 0 && stale.length === 0 && unjudged.length === 0 ? "green" : "red"
    return { root, banned: [...banned], policy: policy.dir, overlay: policy.overlay ?? null, scanned, findings: open, excepted, stale, unjudged, verdict }
}

/** The human lines of a loosening report: one `file:line marker (label)` per finding, the exceptions applied, stale entries and unjudged files. */
export const describeLoosening = (report: LooseningReport): string[] => [
    `loosening: ${report.verdict}; ${String(report.scanned)} file(s) read, ${String(report.findings.length)} finding(s), ${String(report.excepted.length)} excepted`,
    ...report.findings.map((finding) => `${finding.file}:${String(finding.line)} ${finding.marker} (${finding.label})`),
    ...report.excepted.map((finding) => `excepted ${coverageLabel(finding)}: ${finding.file}:${String(finding.line)} ${finding.marker}`),
    ...report.stale.map((entry) => `EXCEPTION_STALE: ${entry.path} ${entry.rule} (${entry.kind}) match ${JSON.stringify(entry.match)} covers no finding; remove it from policy/loosening.yaml`),
    ...report.unjudged.map((file) => `unjudged: ${file} is larger than scan.maxFileBytes; split it, the gate cannot read it`),
]
