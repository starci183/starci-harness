import type { LooseningMarker } from "../../harness/policy.js"

/** The kind of text a file holds, which decides the markers read in it; undefined for a file no marker applies to. */
export type MarkerFileKind = "code" | "spec" | "shell" | "workflow" | "manifest" | "dockerfile" | "properties"

/** One marker found on one line. */
export interface MarkerHit {
    readonly marker: LooseningMarker
    readonly line: number
    readonly label: string
}

interface Detector {
    readonly marker: LooseningMarker
    readonly label: string
    readonly kinds: readonly MarkerFileKind[]
    readonly pattern: RegExp
}

// The words are assembled from fragments so that this file, which the gate also reads, never spells a marker itself.
const word = (...parts: readonly string[]): string => parts.join("")

/** A directive opens its comment: `//`, `/*`, or a `*` continuation line of a block comment, then only blanks. */
const OPENER = String.raw`(?:\/\/|\/\*+|^\s*\*)\s*`

const directive = (text: string): RegExp => new RegExp(`${OPENER}${text}`)

const CODE: readonly MarkerFileKind[] = ["code", "spec"]

const SCRIPTS: readonly MarkerFileKind[] = ["shell", "workflow", "manifest", "dockerfile"]

const RUNNER = "(?:it|test|describe|suite)"

const DETECTORS: readonly Detector[] = [
    { marker: "eslint-disable", label: "an inline ESLint disable", kinds: CODE, pattern: directive(word("eslint", "-disable")) },
    { marker: "eslint-disable", label: "inline ESLint configuration", kinds: CODE, pattern: directive(String.raw`(?:${word("eslint", "-env")}\b|${word("esl", "int")}\s+[@\w/.-]+\s*:)`) },
    { marker: "stylelint-disable", label: "an inline stylelint disable", kinds: CODE, pattern: directive(word("stylelint", "-disable")) },
    { marker: "ts-ignore", label: "a type error ignored", kinds: CODE, pattern: directive(word("@ts", "-ignore")) },
    { marker: "ts-nocheck", label: "a file the type checker skips", kinds: CODE, pattern: directive(word("@ts", "-nocheck")) },
    { marker: "ts-expect-error", label: "a type error expected", kinds: CODE, pattern: directive(word("@ts", "-expect-error")) },
    { marker: "nosonar", label: "a Sonar exclusion comment", kinds: CODE, pattern: new RegExp(String.raw`(?:\/\/|\/\*|^\s*\*).*\b${word("NO", "SONAR")}\b`) },
    { marker: "nosonar", label: "a Sonar exclusion comment", kinds: [...SCRIPTS, "properties"], pattern: new RegExp(String.raw`#.*\b${word("NO", "SONAR")}\b`) },
    { marker: "skipped-test", label: "a skipped test", kinds: CODE, pattern: new RegExp(String.raw`\b${RUNNER}(?:\.\w+)*\.(?:${word("sk", "ip")}|${word("to", "do")}|${word("skip", "If")})\b`) },
    { marker: "skipped-test", label: "a skipped test", kinds: ["spec"], pattern: new RegExp(String.raw`\b(?:${word("x", "it")}|${word("x", "test")}|${word("x", "describe")})\(`) },
    { marker: "focused-test", label: "a focused test", kinds: CODE, pattern: new RegExp(String.raw`\b${RUNNER}(?:\.\w+)*\.${word("on", "ly")}\b`) },
    { marker: "focused-test", label: "a focused test", kinds: ["spec"], pattern: new RegExp(String.raw`\b(?:${word("f", "it")}|${word("f", "describe")}|${word("f", "test")})\(`) },
    { marker: "or-true", label: "a failure swallowed", kinds: SCRIPTS, pattern: new RegExp(String.raw`\|\|\s*(?:${word("tr", "ue")}\b|:(?=\s*(?:$|["';)&|]))|exit\s+0\b)`) },
    { marker: "no-verify", label: "hooks skipped", kinds: SCRIPTS, pattern: new RegExp(String.raw`${word("--no", "-verify")}\b`) },
    { marker: "no-verify", label: "hooks skipped in a command a script runs", kinds: CODE, pattern: new RegExp(String.raw`(["'\x60])${word("--no", "-verify")}\1`) },
    { marker: "gate-widening", label: "a coverage or duplication ignore comment", kinds: CODE, pattern: directive(String.raw`(?:(?:istanbul|c8|v8)\s+${word("ign", "ore")}|${word("jscpd", ":ignore")})`) },
    { marker: "gate-widening", label: "a warning budget", kinds: SCRIPTS, pattern: new RegExp(String.raw`--max-warnings(?:\s+|=)(?!0\b)\d`) },
    { marker: "gate-widening", label: "a step allowed to fail", kinds: ["workflow"], pattern: new RegExp(String.raw`\b${word("continue", "-on-error")}\s*:\s*(?!false\b)\S`) },
    { marker: "gate-widening", label: "a test run that passes with no test", kinds: SCRIPTS, pattern: new RegExp(String.raw`--(?:${word("passWith", "NoTests")}|${word("pass-with", "-no-tests")})\b`) },
    { marker: "gate-widening", label: "a check narrowed on the command line", kinds: SCRIPTS, pattern: new RegExp(String.raw`--(?:${word("testPath", "IgnorePatterns")}|${word("coveragePath", "IgnorePatterns")}|${word("no-error-on", "-unmatched-pattern")})\b|--rule\s+['"]?[@\w/-]+\s*:\s*['"]?(?:off|0)\b|\beslint\b[^\n|;&]*--quiet\b`) },
    { marker: "gate-widening", label: "a Sonar scope exclusion", kinds: [...SCRIPTS, "properties"], pattern: new RegExp(String.raw`\bsonar\.(?:\w+\.)*${word("exclu", "sions")}\b`) },
    { marker: "gate-widening", label: "a gate not waited for or not failing", kinds: [...SCRIPTS, "properties"], pattern: new RegExp(String.raw`sonar\.qualitygate\.wait\s*=\s*false|\bfail_ci_if_error\s*:\s*false\b`) },
]

const CODE_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte|css|scss|less)$/
const SPEC_FILE = /(?:\.(?:spec|test|e2e-spec|integration-spec)\.[cm]?[jt]sx?$|(?:^|\/)(?:__tests__|tests?|e2e)\/.+\.[cm]?[jt]sx?$)/
const SHELL_FILE = /(?:^|\/)(?:\.(?:husky|githooks)\/(?!_\/)[^/]+|[^/]+\.(?:sh|bash))$/
const WORKFLOW_FILE = /(?:^|\/)(?:\.github\/(?:workflows|actions)\/.+\.ya?ml|\.gitlab-ci\.ya?ml|lefthook\.ya?ml)$/
const DOCKERFILE = /(?:^|\/)Dockerfile(?:\.[\w-]+)?$/
const MANIFEST_FILE = /(?:^|\/)package\.json$/
const SHEBANG = /^#!\s*(?:\/usr\/bin\/env\s+)?\S*(?:sh|bash|zsh|dash)\b/

/** The kind of `file` (repository-relative, forward slashes); `firstLine` lets an extensionless script with a shell shebang count. */
export const markerFileKind = (file: string, firstLine: string): MarkerFileKind | undefined => {
    if (SHELL_FILE.test(file)) return "shell"
    if (WORKFLOW_FILE.test(file)) return "workflow"
    if (DOCKERFILE.test(file)) return "dockerfile"
    if (MANIFEST_FILE.test(file)) return "manifest"
    if (file.endsWith(".properties")) return "properties"
    if (CODE_FILE.test(file)) return SPEC_FILE.test(file) ? "spec" : "code"
    const name = file.slice(file.lastIndexOf("/") + 1)
    return !name.includes(".") && SHEBANG.test(firstLine) ? "shell" : undefined
}

/** The banned markers on every line of a file of `kind`, one hit per marker and line. */
export const markersIn = (kind: MarkerFileKind, text: string, banned: ReadonlySet<LooseningMarker>): MarkerHit[] => {
    const detectors = DETECTORS.filter((detector) => banned.has(detector.marker) && detector.kinds.includes(kind))
    if (detectors.length === 0) return []
    const hits: MarkerHit[] = []
    text.split(/\r?\n/).forEach((content, index) => {
        const seen = new Set<LooseningMarker>()
        for (const detector of detectors) {
            if (seen.has(detector.marker) || !detector.pattern.test(content)) continue
            seen.add(detector.marker)
            hits.push({ marker: detector.marker, line: index + 1, label: detector.label })
        }
    })
    return hits
}
