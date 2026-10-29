import type { LooseningMarker } from "../../harness/policy.js"
import { textViews } from "./code-text.js"
import type { TextSyntax, TextView } from "./code-text.js"
import { NON_SOURCE_DIRS, judgeSonarProperties } from "./sonar-properties.js"

/** The kind of text a file holds, which decides the markers read in it; undefined for a file no marker applies to. */
export type MarkerFileKind = "code" | "spec" | "shell" | "workflow" | "manifest" | "dockerfile" | "properties" | "env"

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
    /** What the pattern reads: a directive reads comments, a code pattern reads code, never the text of a literal or a comment. */
    readonly view: TextView
}

// The words are assembled from fragments so that this file, which the gate also reads, never spells a marker itself.
const word = (...parts: readonly string[]): string => parts.join("")

/** A directive opens its comment: `//`, `/*`, or a `*` continuation line of a block comment, then only blanks. */
const OPENER = String.raw`(?:\/\/|\/\*+|^\s*\*)\s*`

const directive = (text: string): RegExp => new RegExp(`${OPENER}${text}`)

const CODE: readonly MarkerFileKind[] = ["code", "spec"]

const SCRIPTS: readonly MarkerFileKind[] = ["shell", "workflow", "manifest", "dockerfile"]

const RUNNER = "(?:it|test|describe|suite)"

/**
 * TLS verification turned off for the whole process: the environment switch set to 0, assigned in code, as an env object
 * key, on a command line, in a workflow or Dockerfile env entry or on an .env line. Reading or comparing it is no finding.
 */
const TLS_SWITCH = new RegExp(String.raw`\b${word("NODE_TLS", "_REJECT", "_UNAUTHORIZED")}["'\x60]?\]?(?:\s*(?:=(?!=)|:)\s*|\s+)(["'\x60]?)0\1(?![\w.])`)

/** TLS verification turned off for one client: the option set false, as an object key or an assigned property. */
const TLS_OPTION = new RegExp(String.raw`\b${word("reject", "Unauthorized")}["'\x60]?\s*(?:=(?!=)|:)\s*false\b`)

const DETECTORS: readonly Detector[] = [
    { marker: "eslint-disable", label: "an inline ESLint disable", kinds: CODE, view: "comments", pattern: directive(word("eslint", "-disable")) },
    { marker: "eslint-disable", label: "inline ESLint configuration", kinds: CODE, view: "comments", pattern: directive(String.raw`(?:${word("eslint", "-env")}\b|${word("esl", "int")}\s+[@\w/.-]+\s*:)`) },
    { marker: "stylelint-disable", label: "an inline stylelint disable", kinds: CODE, view: "comments", pattern: directive(word("stylelint", "-disable")) },
    { marker: "ts-ignore", label: "a type error ignored", kinds: CODE, view: "comments", pattern: directive(word("@ts", "-ignore")) },
    { marker: "ts-nocheck", label: "a file the type checker skips", kinds: CODE, view: "comments", pattern: directive(word("@ts", "-nocheck")) },
    { marker: "ts-expect-error", label: "a type error expected", kinds: CODE, view: "comments", pattern: directive(word("@ts", "-expect-error")) },
    { marker: "nosonar", label: "a Sonar exclusion comment", kinds: CODE, view: "comments", pattern: new RegExp(String.raw`(?:\/\/|\/\*|^\s*\*).*\b${word("NO", "SONAR")}\b`) },
    { marker: "nosonar", label: "a Sonar exclusion comment", kinds: [...SCRIPTS, "properties"], view: "raw", pattern: new RegExp(String.raw`#.*\b${word("NO", "SONAR")}\b`) },
    { marker: "skipped-test", label: "a skipped test", kinds: CODE, view: "code", pattern: new RegExp(String.raw`\b${RUNNER}(?:\.\w+)*\.(?:${word("sk", "ip")}|${word("to", "do")}|${word("skip", "If")})\b`) },
    { marker: "skipped-test", label: "a skipped test", kinds: ["spec"], view: "code", pattern: new RegExp(String.raw`\b(?:${word("x", "it")}|${word("x", "test")}|${word("x", "describe")})\(`) },
    { marker: "focused-test", label: "a focused test", kinds: CODE, view: "code", pattern: new RegExp(String.raw`\b${RUNNER}(?:\.\w+)*\.${word("on", "ly")}\b`) },
    { marker: "focused-test", label: "a focused test", kinds: ["spec"], view: "code", pattern: new RegExp(String.raw`\b(?:${word("f", "it")}|${word("f", "describe")}|${word("f", "test")})\(`) },
    { marker: "or-true", label: "a failure swallowed", kinds: SCRIPTS, view: "code", pattern: new RegExp(String.raw`\|\|\s*(?:${word("tr", "ue")}\b|:(?=\s*(?:$|["';)&|]))|exit\s+0\b)`) },
    { marker: "no-verify", label: "hooks skipped", kinds: SCRIPTS, view: "code", pattern: new RegExp(String.raw`${word("--no", "-verify")}\b`) },
    { marker: "no-verify", label: "hooks skipped in a command a script runs", kinds: CODE, view: "strings", pattern: new RegExp(String.raw`(["'\x60])${word("--no", "-verify")}\1`) },
    { marker: "gate-widening", label: "a coverage or duplication ignore comment", kinds: CODE, view: "comments", pattern: directive(String.raw`(?:(?:istanbul|c8|v8)\s+${word("ign", "ore")}|${word("jscpd", ":ignore")})`) },
    { marker: "gate-widening", label: "a warning budget", kinds: SCRIPTS, view: "code", pattern: /--max-warnings(?:\s+|=)(?!0\b)\d/ },
    { marker: "gate-widening", label: "a step allowed to fail", kinds: ["workflow"], view: "code", pattern: new RegExp(String.raw`\b${word("continue", "-on-error")}\s*:\s*(?!false\b)\S`) },
    { marker: "gate-widening", label: "a test run that passes with no test", kinds: SCRIPTS, view: "code", pattern: new RegExp(String.raw`--(?:${word("passWith", "NoTests")}|${word("pass-with", "-no-tests")})\b`) },
    { marker: "gate-widening", label: "a check narrowed on the command line", kinds: SCRIPTS, view: "code", pattern: new RegExp(String.raw`--(?:${word("testPath", "IgnorePatterns")}|${word("coveragePath", "IgnorePatterns")}|${word("no-error-on", "-unmatched-pattern")})\b|--rule\s+['"]?[@\w/-]+\s*:\s*['"]?(?:off|0)\b|\beslint\b[^\n|;&]*--quiet\b`) },
    // Excluding dependencies and build output narrows nothing a gate judges; any other entry on the line hides source.
    // A properties file is judged entry by entry by sonar-properties.ts, which also knows the generated block.
    {
        marker: "gate-widening",
        label: "a Sonar scope exclusion",
        kinds: SCRIPTS,
        view: "code",
        pattern: new RegExp(String.raw`\bsonar\.(?:\w+\.)*${word("exclu", "sions")}\s*[=:]\s*(?!(?:\*\*\/)?(?:${NON_SOURCE_DIRS})\/\*\*(?:\s*,\s*(?:\*\*\/)?(?:${NON_SOURCE_DIRS})\/\*\*)*\s*$)`),
    },
    // A test certificate is trusted through its client's `ca` (contexts/code/be/test.md BE-TEST-12), never by turning the check off.
    { marker: "tls-unverified", label: "TLS verification turned off for the process", kinds: [...CODE, ...SCRIPTS, "env"], view: "strings", pattern: TLS_SWITCH },
    { marker: "tls-unverified", label: "TLS verification turned off for a client", kinds: CODE, view: "strings", pattern: TLS_OPTION },
    { marker: "gate-widening", label: "a gate not waited for or not failing", kinds: [...SCRIPTS, "properties"], view: "code", pattern: /sonar\.qualitygate\.wait\s*=\s*false|\bfail_ci_if_error\s*:\s*false\b/ },
]

const CODE_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte|css|scss|less)$/
const SPEC_NAME = /\.(?:spec|test|e2e-spec|integration-spec)\.[cm]?[jt]sx?$/
const SPEC_DIR = /(?:^|\/)(?:__tests__|tests?|e2e)\/.+\.[cm]?[jt]sx?$/
const isSpecFile = (file: string): boolean => SPEC_NAME.test(file) || SPEC_DIR.test(file)
const SHELL_FILE = /(?:^|\/)(?:\.(?:husky|githooks)\/(?!_\/)[^/]+|[^/]+\.(?:sh|bash))$/
const WORKFLOW_FILE = /(?:^|\/)(?:\.github\/(?:workflows|actions)\/.+\.ya?ml|\.gitlab-ci\.ya?ml|lefthook\.ya?ml)$/
const DOCKERFILE = /(?:^|\/)Dockerfile(?:\.[\w-]+)?$/
const MANIFEST_FILE = /(?:^|\/)package\.json$/
/** An environment file or its template: `.env`, `.env.example`, `secret.env.example`, `api.env.tpl`. */
const ENV_FILE = /(?:^|\/)(?:[\w-][\w.-]*)?\.env(?:\.(?:example|sample|template|tpl|dist|defaults|local|development|production|staging|test))*$/
const SHEBANG = /^#!\s*(?:\/usr\/bin\/env\s+)?\S*(?:sh|bash|zsh|dash)\b/

/** The kind of `file` (repository-relative, forward slashes); `firstLine` lets an extensionless script with a shell shebang count. */
export const markerFileKind = (file: string, firstLine: string): MarkerFileKind | undefined => {
    if (SHELL_FILE.test(file)) return "shell"
    if (WORKFLOW_FILE.test(file)) return "workflow"
    if (DOCKERFILE.test(file)) return "dockerfile"
    if (MANIFEST_FILE.test(file)) return "manifest"
    if (file.endsWith(".properties")) return "properties"
    if (ENV_FILE.test(file)) return "env"
    if (CODE_FILE.test(file)) return isSpecFile(file) ? "spec" : "code"
    const name = file.slice(file.lastIndexOf("/") + 1)
    return !name.includes(".") && SHEBANG.test(firstLine) ? "shell" : undefined
}

/** How each kind is tokenized: JSON has no comments, so a manifest is read as it stands. */
const SYNTAX: Readonly<Record<MarkerFileKind, TextSyntax>> = {
    code: "script",
    spec: "script",
    shell: "hash",
    workflow: "hash",
    dockerfile: "hash",
    manifest: "none",
    properties: "properties",
    env: "hash",
}

/** What the scan knows beyond the file's text: for a properties file, the Sonar block the generator writes for its app. */
export interface MarkerContext {
    readonly sonarBlock?: readonly string[] | undefined
}

/** The banned markers on every line of a file of `kind`, one hit per marker and line. */
export const markersIn = (kind: MarkerFileKind, text: string, banned: ReadonlySet<LooseningMarker>, context: MarkerContext = {}): MarkerHit[] => {
    const detectors = DETECTORS.filter((detector) => banned.has(detector.marker) && detector.kinds.includes(kind))
    const views = textViews(text, SYNTAX[kind])
    const lines = Object.fromEntries((["raw", "comments", "strings", "code"] as const).map((view) => [view, views[view].split("\n")])) as Record<TextView, string[]>
    const hits: MarkerHit[] = []
    const seen = new Map<number, Set<LooseningMarker>>()
    const add = (hit: MarkerHit): void => {
        const markers = seen.get(hit.line) ?? new Set<LooseningMarker>()
        if (markers.has(hit.marker)) return
        markers.add(hit.marker)
        seen.set(hit.line, markers)
        hits.push(hit)
    }
    lines.raw.forEach((_line, index) => {
        for (const detector of detectors) {
            if (detector.pattern.test(lines[detector.view][index] ?? "")) add({ marker: detector.marker, line: index + 1, label: detector.label })
        }
    })
    if (kind === "properties" && banned.has("gate-widening")) judgeSonarProperties(lines.code, lines.raw, context.sonarBlock).forEach(add)
    return hits.sort((left, right) => left.line - right.line)
}
