import { neverRead } from "../../harness/policy.js"
import type { LooseningException, LooseningMarker, Policy } from "../../harness/policy.js"
import { markerFileKind, markersIn } from "./markers.js"
import { readTreeFile, treeFiles } from "./tree-files.js"

/** One banned marker in the tree. */
export interface LooseningFinding {
    readonly file: string
    readonly line: number
    readonly marker: LooseningMarker
    readonly label: string
}

/** One finding a declared exception covers, with the exception's reason. */
export interface ExceptedFinding extends LooseningFinding {
    readonly reason: string
}

/** The state-based loosening scan of a tree: findings, excepted findings, stale exceptions and files that could not be judged. */
export interface LooseningReport {
    readonly root: string
    readonly banned: readonly LooseningMarker[]
    readonly policy: string
    readonly overlay: string | null
    readonly scanned: number
    readonly findings: readonly LooseningFinding[]
    readonly excepted: readonly ExceptedFinding[]
    readonly stale: readonly LooseningException[]
    readonly unjudged: readonly string[]
    readonly verdict: "green" | "red"
}

/**
 * Reads every file of the tree as it stands and reports each banned marker, by file and line. A declared exception covers
 * its one file and marker; an exception nothing matches is stale, and a file of a scanned kind too large to read is
 * unjudged: both are red, so neither the list nor the file size can widen the gate.
 */
export const scanLoosening = async (root: string, policy: Policy): Promise<LooseningReport> => {
    const banned = new Set(policy.loosening.banned)
    const findings: LooseningFinding[] = []
    const unjudged: string[] = []
    let scanned = 0
    for (const file of await treeFiles(root)) {
        if (neverRead(policy, file)) continue
        const named = markerFileKind(file, "")
        // An extensionless file may still be a shell script: its first line decides, so it is read before its kind is known.
        if (named === undefined && file.slice(file.lastIndexOf("/") + 1).includes(".")) continue
        const read = readTreeFile(root, file, policy.loosening.scan.maxFileBytes)
        if ("unread" in read) {
            if (read.unread === "too-large" && named !== undefined) unjudged.push(file)
            continue
        }
        const kind = named ?? markerFileKind(file, read.text.split("\n", 1)[0] ?? "")
        if (kind === undefined) continue
        scanned += 1
        for (const hit of markersIn(kind, read.text, banned)) findings.push({ file, ...hit })
    }
    const excepted: ExceptedFinding[] = []
    const open: LooseningFinding[] = []
    const used = new Set<LooseningException>()
    for (const finding of findings) {
        const exception = policy.loosening.exceptions.find((candidate) => candidate.path === finding.file && candidate.marker === finding.marker)
        if (exception === undefined) open.push(finding)
        else {
            used.add(exception)
            excepted.push({ ...finding, reason: exception.reason })
        }
    }
    const stale = policy.loosening.exceptions.filter((exception) => !used.has(exception))
    const verdict = open.length === 0 && stale.length === 0 && unjudged.length === 0 ? "green" : "red"
    return { root, banned: [...banned], policy: policy.dir, overlay: policy.overlay ?? null, scanned, findings: open, excepted, stale, unjudged, verdict }
}

/** The human lines of a loosening report: one `file:line marker (label)` per finding, then stale exceptions and unjudged files. */
export const describeLoosening = (report: LooseningReport): string[] => [
    `loosening: ${report.verdict}; ${String(report.scanned)} file(s) read, ${String(report.findings.length)} finding(s), ${String(report.excepted.length)} excepted`,
    ...report.findings.map((finding) => `${finding.file}:${String(finding.line)} ${finding.marker} (${finding.label})`),
    ...report.stale.map((exception) => `stale exception: ${exception.path} ${exception.marker} matches nothing; remove it from policy/loosening.yaml`),
    ...report.unjudged.map((file) => `unjudged: ${file} is larger than scan.maxFileBytes; split it, the gate cannot read it`),
]
