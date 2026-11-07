import { Refusal } from "../../shared/errors.js"
import { captureNpm } from "../../shared/exec.js"
import { captureGit, isAncestor } from "../../shared/git.js"
import { NPMJS_FLAGS } from "../deps/local-refs.js"

/**
 * The patch-or-minor judgement of a Grammar release (contexts/grammars/contributing.md "Patch or minor"). The
 * canon pins give the Grammar family a same-minor range, so a patch reaches every app without a release of @starci/hfs, the canons or the
 * CLI; a change the rest of the family reads must therefore come as a minor, which moves the range and with it the whole family. A patch
 * bump is refused when the diff since the version npm serves holds a change of a minor's kind:
 *   - a lint rule an eslint-grammar-* package owns (its src/, specs aside);
 *   - a public export of @starci/grammar removed or renamed (an `export` name on a removed line that no added line exports again);
 *   - a prop removed or renamed (a member of a component's props declaration on a removed line that no added line declares again);
 *   - a DNA law id, or a deprecated or forbidden entry, removed or changed in contexts/grammars/contract.yaml.
 * An added optional prop, a CSS or renderer fix, a story and a new law stay a patch, and so do the runtime copies of @starci/hfs data an
 * eslint-grammar-* package bundles (runtime/): they move only with a release of @starci/hfs, which releases the whole family anyway. The judgement reads source lines, so it can only
 * over-ask for a minor, never let one through as a patch: a false alarm is answered with the minor it asks for.
 */
export const GRAMMAR_PACKAGE = "@starci/grammar"
const GRAMMAR_DIR = "packages/grammar"
const LINT_DIRS = ["packages/eslint-grammar-core", "packages/eslint-grammar-offset-pop"] as const
const CONTRACT = "contexts/grammars/contract.yaml"

/** A version's major and minor, or undefined for a version this judge does not read. */
const minorOf = (version: string): string | undefined => /^(\d+)\.(\d+)\.\d+(?:-[0-9A-Za-z.-]+)?$/u.exec(version)?.slice(1, 3).join(".")

const SPEC = /\.spec\.[cm]?[jt]sx?$/u
const STORY = /(?:^|\/)stories\//u
const EXPORTED = /^\s*export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:const|let|function\*?|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/u
const EXPORT_LIST = /^\s*export\s+(?:type\s+)?\{([^}]*)\}/u
// A props member: the Grammar declares every prop `readonly` (the canon's shape), so an object literal or a local variable never reads as one.
const MEMBER = /^\s+readonly\s+([A-Za-z_$][\w$]*)\??\s*:\s*\S/u
const DNA_ID = /\bDNA-[A-Z0-9-]+\b/gu
const LISTED = /\b(?:deprecated|forbidden)\b/u

/** The names a source line exports: a declaration's name, or each name of an export list (its `as` alias). */
const exportedNames = (line: string): string[] => {
    const declared = EXPORTED.exec(line)?.[1]
    if (declared !== undefined) return [declared]
    const list = EXPORT_LIST.exec(line)?.[1]
    if (list === undefined) return []
    return list.split(",").map((part) => part.trim().replace(/^type\s+/u, "").split(/\s+as\s+/u).pop()?.trim() ?? "").filter(Boolean)
}

/** The diff lines of `paths` between `from` and HEAD, by file: removed and added, with no context. */
const diffLines = async (root: string, from: string, paths: readonly string[]): Promise<Map<string, { removed: string[]; added: string[] }>> => {
    const diff = await captureGit(["diff", "--no-renames", "-U0", from, "HEAD", "--", ...paths], root)
    const files = new Map<string, { removed: string[]; added: string[] }>()
    let current: { removed: string[]; added: string[] } | undefined
    for (const line of diff.exitCode === 0 ? diff.stdout.split("\n") : []) {
        const file = /^\+\+\+ b\/(.+)$/u.exec(line)?.[1] ?? /^--- a\/(.+)$/u.exec(line)?.[1]
        if (file !== undefined) {
            current = files.get(file) ?? { removed: [], added: [] }
            files.set(file, current)
            continue
        }
        if (current === undefined || line.startsWith("+++") || line.startsWith("---")) continue
        if (line.startsWith("-")) current.removed.push(line.slice(1))
        else if (line.startsWith("+")) current.added.push(line.slice(1))
    }
    return files
}

/** Why the change from `from` to HEAD is of a minor's kind: one reason per finding, none for a patch. */
export const minorReasons = async (root: string, from: string): Promise<string[]> => {
    const reasons: string[] = []
    const lint = await diffLines(root, from, LINT_DIRS.map((dir) => `${dir}/src`))
    for (const file of [...lint.keys()].filter((path) => !SPEC.test(path))) reasons.push(`${file} changed: a lint rule of the Grammar family is a minor`)
    const grammar = await diffLines(root, from, [`${GRAMMAR_DIR}/src`])
    const sources = [...grammar].filter(([file]) => !STORY.test(file) && !SPEC.test(file) && /\.(?:ts|tsx)$/u.test(file))
    const addedExports = new Set(sources.flatMap(([, lines]) => lines.added.flatMap(exportedNames)))
    for (const [file, lines] of sources) {
        for (const name of new Set(lines.removed.flatMap(exportedNames))) if (!addedExports.has(name)) reasons.push(`${file}: the export ${name} is removed or renamed`)
        const addedMembers = new Set(lines.added.flatMap((line) => MEMBER.exec(line)?.[1] ?? []))
        if (/\/index\.tsx?$/u.test(file)) for (const name of new Set(lines.removed.flatMap((line) => MEMBER.exec(line)?.[1] ?? []))) if (!addedMembers.has(name)) reasons.push(`${file}: the member ${name} is removed or renamed`)
    }
    const contract = (await diffLines(root, from, [CONTRACT])).get(CONTRACT)
    if (contract !== undefined) {
        const added = new Set(contract.added.flatMap((line) => line.match(DNA_ID) ?? []))
        for (const id of new Set(contract.removed.flatMap((line) => line.match(DNA_ID) ?? []))) if (!added.has(id)) reasons.push(`${CONTRACT}: the law ${id} is removed or renamed`)
        if ([...contract.removed, ...contract.added].some((line) => LISTED.test(line))) reasons.push(`${CONTRACT}: a deprecated or forbidden entry changed`)
    }
    return reasons
}

/** The version npm serves as latest and the commit it recorded (its gitHead), when this repository's history holds it. */
const servedGrammar = async (root: string): Promise<{ version: string; from: string } | undefined> => {
    const view = await captureNpm(["view", GRAMMAR_PACKAGE, "version", "gitHead", "--json", ...NPMJS_FLAGS], root)
    if (view.exitCode !== 0) return undefined
    const parsed = JSON.parse(view.stdout) as { version?: unknown; gitHead?: unknown }
    const version = typeof parsed.version === "string" ? parsed.version : undefined
    const from = typeof parsed.gitHead === "string" && /^[0-9a-f]{40}$/u.test(parsed.gitHead) ? parsed.gitHead : undefined
    if (version === undefined || from === undefined || !(await isAncestor(root, from, "HEAD"))) return undefined
    return { version, from }
}

/**
 * Refuses RELEASE_GRAMMAR_MINOR_REQUIRED when @starci/grammar is due at a patch of the version npm serves (same major and minor) while
 * the diff since that version holds a change of a minor's kind. Nothing to judge when the Grammar is not due, or npm or the history cannot
 * name the base.
 */
export const judgeGrammarBump = async (root: string, due: { readonly package: string; readonly version: string; readonly action: string } | undefined): Promise<void> => {
    if (due?.action !== "publish") return
    const served = await servedGrammar(root)
    if (served === undefined || minorOf(served.version) === undefined || minorOf(served.version) !== minorOf(due.version)) return
    const reasons = await minorReasons(root, served.from)
    if (reasons.length === 0) return
    throw new Refusal("RELEASE_GRAMMAR_MINOR_REQUIRED", `${GRAMMAR_PACKAGE}@${due.version} is a patch of ${served.version}, but the change since it is a minor's: ${reasons.slice(0, 6).join("; ")}${reasons.length > 6 ? `; and ${String(reasons.length - 6)} more` : ""}. Raise the Grammar family to the next minor, and with it the range of the canon pins and the family it moves (contexts/grammars/contributing.md "Patch or minor")`)
}
