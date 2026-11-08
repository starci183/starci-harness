import { createRequire } from "node:module"
import type { Context, ReportNode } from "istanbul-lib-report"

/** The lcov report of istanbul-reports (a composite: its `lcov` part writes lcov.info): built with `{ file, projectRoot }`, driven per file by `onDetail` and as a whole by `execute`. */
interface LcovReportBase {
  lcov: { contentWriter: { println(line: string): void } }
  onStart(root: ReportNode, context: Context): void
  onDetail(node: ReportNode, context: Context): void
  execute(context: Context): void
}
type LcovReportConstructor = new (options: { file: string; projectRoot: string }) => LcovReportBase

const fromJest = createRequire(require.resolve("jest"))
const fromCore = createRequire(fromJest.resolve("@jest/core"))
const fromReporters = createRequire(fromCore.resolve("@jest/reporters"))
const reports: typeof import("istanbul-reports") = fromReporters("istanbul-reports")
const LcovReport: LcovReportConstructor = reports.create("lcov").constructor as LcovReportConstructor
const METADATA_SOURCE = require.resolve("./unit-metadata.generated.js")

/**
 * A source path the way a Sonar import resolves it. SonarJS sanitizes an lcov path (backslashes to slashes, `..` segments resolved) and looks the result up by
 * its tail among the project files; a path that climbs out of its base (`..\packages\x.ts`, a root package seen from `be/`) sanitizes to nothing and is never
 * matched, so the file reads uncovered. The path is therefore written with forward slashes and without the leading `..` segments the climb leaves
 * (`packages/x.ts`), which the tail lookup, Codecov and the coverage proof all resolve to the same file.
 */
function sourceOf(file: string): string {
  const slashed = file.replaceAll("\\", "/")
  return /^(?:[a-z]:)?\//iu.test(slashed) ? slashed : slashed.replace(/^(?:\.\.\/)+/u, "")
}

/** LCOV identifies functions by name; append their stable coverage id so same-named callbacks retain separate counts. */
class StarciLcovReport extends LcovReport {
  override onStart(root: ReportNode, context: Context): void {
    super.onStart(root, context)
    const writer = this.lcov.contentWriter
    const println = writer.println.bind(writer)
    writer.println = (line: string): void => println(line.startsWith("SF:") ? `SF:${sourceOf(line.slice(3))}` : line)
  }

  override onDetail(node: ReportNode, context: Context): void {
    if (node.getFileCoverage().path === METADATA_SOURCE) return
    const entries = Object.entries(node.getFileCoverage().fnMap)
    const originals = entries.map(([, meta]) => ({ meta, name: meta.name }))
    try {
      entries.forEach(([id, meta]) => { meta.name = `${meta.name}#${id}` })
      super.onDetail(node, context)
    } finally {
      originals.forEach(({ meta, name }) => { meta.name = name })
    }
  }
}

export = StarciLcovReport
