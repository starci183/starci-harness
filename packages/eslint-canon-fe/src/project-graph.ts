/**
 * The rules that read the project graph: the findings of the architecture machine that sit on a TypeScript file.
 *
 * One graph per lint run: `scripts/hfs/project-graph.mjs` (a byte copy in this package's runtime/) builds the machine's module
 * graph and slot manifest once for the repository, caches it, and each rule below reports the findings of its own codes on
 * the file ESLint is visiting, on the line the machine names. There is no second graph and no second judge: the list of
 * rules and their codes is `LINT_ENFORCERS` of the machine (scripts/hfs/architecture/surface.mjs); `starci app check` keeps the
 * findings that have no TypeScript file to sit on. A graph that cannot be built stops the run with the machine's message.
 */
import { LINT_ENFORCERS, belongsTo, codeOf } from "#runtime/scripts/hfs/architecture/surface.mjs"
import { projectGraph as buildProjectGraph, resetProjectGraphs } from "#runtime/scripts/hfs/project-graph.mjs"
import { projectRule } from "#runtime/scripts/hfs/project-rule.mjs"
import { hfsOf } from "./lib/hfs.ts"
import { RUNTIME_ROOT } from "./lib/package-root.ts"
import type { Recommended, Rules } from "./lib/rule.ts"

const RUNTIME = RUNTIME_ROOT
const mine = LINT_ENFORCERS.filter((enforcer) => enforcer.plugins.includes("fe"))

/** The rules this law contributes to the plugin: one per graph enforcer of this profile. */
export const rules: Rules = Object.fromEntries(mine.map((e) => [e.id, projectRule({ enforcer: e, runtimeRoot: RUNTIME, hfsOf })]))

/** Every one at error. */
export const recommended: Recommended = Object.fromEntries(mine.map((e) => [`starci-fe/${e.id}`, "error" as const]))

/** One finding of the project graph on a file, as the rule of its enforcer reports it. Lines and columns count from 1, the way the machine names them. */
export interface ProjectGraphFinding {
  readonly rule: string
  readonly code: string
  readonly line: number
  readonly column: number
  readonly message: string
}

/** The project-graph findings of one side, by side-relative posix path, each list sorted by line, column, code and message. */
export interface ProjectGraphSnapshot {
  readonly files: number
  readonly byFile: Readonly<Record<string, readonly ProjectGraphFinding[]>>
}

/**
 * The findings every project-graph rule of this canon reports, per file, from one fresh build of the side's graph.
 *
 * The result cache of `starci app check --gate lint` calls this once for a side whose files changed and compares each file's findings with the recorded
 * ones: a file whose graph findings differ is linted again by ESLint itself, so ESLint stays the only emitter of each message. It is the very
 * graph the rules read (same machine, same manifest, same filter), never a second judge.
 *
 * @param input - The side folder (`repoRoot`, the folder of the side's `eslint.config.mjs`); `injectedTypeScript` is for hermetic fixtures only.
 * @returns The findings of the rules of `recommended`, keyed by path relative to the side folder.
 */
export const projectGraph = ({ repoRoot, injectedTypeScript }: { repoRoot: string; injectedTypeScript?: object }): ProjectGraphSnapshot => {
  resetProjectGraphs()
  return snapshotOf(buildProjectGraph({ repoRoot, ...(injectedTypeScript === undefined ? {} : { injectedTypeScript }), runtimeRoot: RUNTIME }))
}

/**
 * The same findings from the graph this process has already built, so a process that linted the side hands them out without building the graph again.
 *
 * The rules read one graph per process and per side, built when the first file is linted. The ESLint child of `starci app check --gate lint` calls
 * this after its run and writes the result beside its report; the result cache keeps the graph findings from it instead of building the graph a
 * second time in the CLI. A process that has not built the graph yet builds it here, once, exactly as `projectGraph` does, and the value is the
 * same: `projectGraph` is a fresh build, this is the build the rules used.
 *
 * @param input - The side folder (`repoRoot`, the folder of the side's `eslint.config.mjs`).
 * @returns The findings of the rules of `recommended`, keyed by path relative to the side folder.
 */
export const projectGraphSnapshot = ({ repoRoot }: { repoRoot: string }): ProjectGraphSnapshot => snapshotOf(buildProjectGraph({ repoRoot, runtimeRoot: RUNTIME }))

/** The findings of the rules of this canon in a built graph, by side-relative path, each list sorted by line, column, code and message. */
const snapshotOf = (graph: ReturnType<typeof buildProjectGraph>): ProjectGraphSnapshot => {
  const byFile: Record<string, ProjectGraphFinding[]> = {}
  for (const [file, findings] of graph.byFile) {
    for (const finding of findings) {
      for (const enforcer of mine.filter((entry) => belongsTo(entry, finding))) {
        const line = finding.line !== undefined && Number.isInteger(finding.line) && finding.line >= 1 ? finding.line : 1
        const column = finding.column !== undefined && Number.isInteger(finding.column) && finding.column >= 1 ? finding.column : 1
        ;(byFile[file] ??= []).push({ rule: `starci-fe/${enforcer.id}`, code: String(codeOf(finding)), line, column, message: String(finding.message) })
      }
    }
  }
  const order = (a: ProjectGraphFinding, b: ProjectGraphFinding): number => a.line - b.line || a.column - b.column || a.code.localeCompare(b.code) || a.message.localeCompare(b.message)
  for (const list of Object.values(byFile)) list.sort(order)
  return { files: graph.files, byFile }
}
