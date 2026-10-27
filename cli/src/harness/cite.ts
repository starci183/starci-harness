import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { changedFiles } from "../shared/git.js"
import { anchorResolver, chooseAnchor, isChooseOf } from "./cite-anchors.js"
import type { AnchorResolver } from "./cite-anchors.js"
import { SOURCE_FILE, familyUses } from "./cite-families.js"
import { underPaths } from "./contract.js"

/**
 * The anchor cites: layer 2 of the Grammar principle is that the author picks components, variants, intents and spacing by
 * reading the Choose sections of contexts/ui/components, and that pick is cited and graded.
 *
 * - An author (an op whose output carries `cites`: code, draw, audit) lists the ids it decided by: Choose anchors
 *   (`tabs.choose`, `tabs.choose.<term>`), DNA ids and rule ids (`R01`, `STATE-6`).
 * - A grader (an op whose output carries `citeGrades`: review, audit) answers each id the contract hands it (the author's
 *   cites) with followed, violated or not-applicable and one line of evidence.
 * - A contract's `cites` are the ids the task answers for: an author must cite each, a grader must grade each.
 *
 * The `cite` check (T0, never behavioural) is red when a cited or handed id resolves to nothing, when a changed source file
 * imports a Grammar component family (cite-families.ts) and no cite is a Choose anchor of it, when a handed id is missing
 * from the cites or the grades, when a grade is malformed, and when any grade is `violated`.
 */

/** The preset of ops/checks.yaml that runs the cite check. */
export const CITE_PRESET = "anchors-cited"

/** The output key an author lists its anchor cites under. */
export const CITES_KEY = "cites"

/** The output key a grader answers the handed cites under. */
export const GRADES_KEY = "citeGrades"

/** The grades of one cite. */
export const CITE_GRADES = ["followed", "violated", "not-applicable"] as const

/** One grade a grader files under GRADES_KEY. */
export interface CiteGrade {
    readonly cite: string
    readonly grade: (typeof CITE_GRADES)[number]
    readonly evidence: string
}

/** The cite check as resolveChecks fills it: the harness checkout, the handed ids, and which halves the op's output asks for. */
export interface CiteCheck {
    readonly harness?: string | undefined
    readonly required?: readonly string[] | undefined
    readonly author?: boolean | undefined
    readonly grade?: boolean | undefined
}

/** The longest evidence line a grade may carry. */
export const EVIDENCE_MAX = 300

/** The ids of `ids` nothing resolves. */
export const unresolved = (ids: readonly string[], resolve: AnchorResolver): string[] => ids.filter((id) => resolve(id) === undefined)

/** Problems of the ids a contract hands its task: each must resolve in the harness checkout at `root`. */
export const contractCiteProblems = (cites: readonly string[] | undefined, root: string): string[] => {
    if (cites === undefined || cites.length === 0) return []
    const unknown = unresolved(cites, anchorResolver(root))
    return unknown.length === 0 ? [] : [`cites names ids no context defines: ${unknown.join(", ")}; cite a Choose anchor (<family>.choose), a rule id or a DNA id (starci contexts search <words> finds them)`]
}

const asRecord = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {})

const isGrade = (value: unknown): value is CiteGrade["grade"] => typeof value === "string" && (CITE_GRADES as readonly string[]).includes(value)

/** The author half: every cite resolves, the handed ids are cited, and each family a changed file uses has a Choose cite. */
const authorProblems = (cites: unknown, required: readonly string[], uses: ReturnType<typeof familyUses>, resolve: AnchorResolver): { problems: string[]; notes: string[] } => {
    if (!Array.isArray(cites) || !cites.every((item) => typeof item === "string")) return { problems: [`${CITES_KEY} is not a list of ids`], notes: [] }
    const problems = unresolved(cites, resolve).map((id) => `${CITES_KEY}: ${id} resolves to no anchor, rule or DNA id in the contexts`)
    problems.push(...required.filter((id) => !cites.includes(id)).map((id) => `${CITES_KEY} lacks ${id}, which the contract hands this task`))
    const families = new Map<string, { names: Set<string>; files: Set<string>; any: readonly string[] }>()
    for (const use of uses) {
        const key = use.families.join("|")
        const entry = families.get(key) ?? { names: new Set<string>(), files: new Set<string>(), any: use.families }
        entry.names.add(use.name)
        entry.files.add(use.file)
        families.set(key, entry)
    }
    for (const entry of families.values()) {
        if (entry.any.some((family) => cites.some((id) => isChooseOf(id, family)))) continue
        const wanted = entry.any.map(chooseAnchor).join(" or ")
        problems.push(`the change uses ${[...entry.names].join(", ")} (${[...entry.files].join(", ")}) but cites no Choose anchor of ${entry.any.join(" or ")}; cite ${wanted} after reading it`)
    }
    const notes = [
        `${String(cites.length)} cite(s) resolve`,
        ...(families.size === 0 ? [] : [`Grammar families used: ${[...families.values()].map((entry) => entry.any.join("|")).join(", ")}`]),
    ]
    return { problems, notes }
}

/** The problems of one grade that names its cite: a cite not handed, a grade outside CITE_GRADES, bad evidence, a violation. */
const gradeProblems = (where: string, cite: string, entry: Readonly<Record<string, unknown>>, required: readonly string[]): string[] => {
    const problems: string[] = []
    if (!required.includes(cite)) problems.push(`${where} grades ${cite}, which the contract does not hand this task`)
    if (!isGrade(entry.grade)) problems.push(`${where} (${cite}): grade ${JSON.stringify(entry.grade)} is none of ${CITE_GRADES.join(", ")}`)
    const evidence = typeof entry.evidence === "string" ? entry.evidence.trim() : ""
    if (evidence === "" || evidence.includes("\n") || evidence.length > EVIDENCE_MAX) problems.push(`${where} (${cite}): evidence must be one line of at most ${String(EVIDENCE_MAX)} characters`)
    if (entry.grade === "violated") problems.push(`${cite} violated: ${evidence}`)
    return problems
}

/** The grader half: each handed id graded once, each grade well formed, none violated. */
const graderProblems = (grades: unknown, required: readonly string[]): { problems: string[]; notes: string[] } => {
    if (!Array.isArray(grades)) return { problems: [`${GRADES_KEY} is not a list`], notes: [] }
    const problems: string[] = []
    const seen = new Map<string, number>()
    for (const [index, raw] of grades.entries()) {
        const entry = asRecord(raw)
        const where = `${GRADES_KEY}[${String(index)}]`
        if (typeof entry.cite !== "string") {
            problems.push(`${where} names no cite`)
            continue
        }
        seen.set(entry.cite, (seen.get(entry.cite) ?? 0) + 1)
        problems.push(...gradeProblems(where, entry.cite, entry, required))
    }
    for (const id of required) {
        const count = seen.get(id) ?? 0
        if (count === 0) problems.push(`${GRADES_KEY} does not grade ${id}`)
        else if (count > 1) problems.push(`${GRADES_KEY} grades ${id} ${String(count)} times`)
    }
    return { problems, notes: [`${String(required.length)} handed cite(s) graded`] }
}

/** The changed source files of the checkout at `root` under `allowPaths`, with their text: what the family scan reads. */
const changedSources = async (root: string, base: string, allowPaths: readonly string[]): Promise<{ file: string; text: string }[]> => {
    const files = (await changedFiles(root, base)).filter((file) => SOURCE_FILE.test(file) && underPaths(file, allowPaths))
    return files.flatMap((file) => {
        const path = join(root, file)
        return existsSync(path) && statSync(path).isFile() ? [{ file, text: readFileSync(path, "utf8") }] : []
    })
}

/**
 * Judges the cite check of one filed result. `root` is the checkout the candidate stands in and `base` what its change is read
 * against (the candidate's parent in a clean verify, HEAD in the worker's dry replay).
 */
export const judgeCites = async (check: CiteCheck, result: unknown, place: { readonly root: string; readonly base: string; readonly allowPaths: readonly string[] }): Promise<{ problems: string[]; detail: string }> => {
    if (check.harness === undefined) return { problems: ["the cite check names no harness checkout to resolve ids in; it is filled by resolveChecks"], detail: "" }
    const resolve = anchorResolver(check.harness)
    const record = asRecord(result)
    const required = check.required ?? []
    const problems: string[] = unresolved(required, resolve).map((id) => `the contract hands ${id}, which resolves to nothing`)
    const notes: string[] = []
    if (check.author === true) {
        // A grader that also authors (audit) cites what it judged by; the handed ids are the ones it grades, not ones it must cite.
        const mustCite = check.grade === true ? [] : required
        const uses = familyUses(check.harness, await changedSources(place.root, place.base, place.allowPaths))
        const judged = authorProblems(record[CITES_KEY] ?? [], mustCite, uses, resolve)
        problems.push(...judged.problems)
        notes.push(...judged.notes)
    }
    if (check.grade === true) {
        const judged = graderProblems(record[GRADES_KEY] ?? [], required)
        problems.push(...judged.problems)
        notes.push(...judged.notes)
    }
    return { problems, detail: notes.join("; ") }
}

/** The cite check of a contract: the harness checkout ids resolve in, the handed ids, and which halves its output asks for. */
export const fillCiteCheck = (
    check: CiteCheck,
    harness: string,
    cites: readonly string[] | undefined,
    outputKeys: readonly string[],
): { readonly harness: string; readonly required: string[]; readonly author: boolean; readonly grade: boolean } => ({
    harness: check.harness ?? harness,
    required: [...(check.required ?? cites ?? [])],
    author: check.author ?? outputKeys.includes(CITES_KEY),
    grade: check.grade ?? outputKeys.includes(GRADES_KEY),
})

/** The longest text of one handed cite the brief quotes. */
const BRIEF_TEXT_MAX = 1200

/** The brief's section of the handed cites, each with the text it resolves to; undefined when the contract hands none. */
export const citesBriefSection = (cites: readonly string[] | undefined, harness: string, grader: boolean): string | undefined => {
    if (cites === undefined || cites.length === 0) return undefined
    const resolve = anchorResolver(harness)
    const lead = grader
        ? `Grade each of these under \`${GRADES_KEY}\`: {cite, grade: ${CITE_GRADES.join(" | ")}, evidence: one line}. Any \`violated\` is a finding: your verdict is failed.`
        : `The contract holds this task to these anchors: read each before you decide, and list every one under \`${CITES_KEY}\`.`
    const items = cites.map((id) => {
        const anchor = resolve(id)
        if (anchor === undefined) return `#### ${id}\n\n(resolves to nothing: file mismatch)`
        const text = anchor.text.length > BRIEF_TEXT_MAX ? `${anchor.text.slice(0, BRIEF_TEXT_MAX)}\n[...]` : anchor.text
        return `#### ${id} (${anchor.file}${anchor.line === undefined ? "" : ":" + String(anchor.line)})\n\n${text}`
    })
    return [lead, ...items].join("\n\n")
}
