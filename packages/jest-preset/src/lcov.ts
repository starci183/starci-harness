import { createRequire } from "node:module"
import type { Context, ReportNode } from "istanbul-lib-report"

/** The lcov report of istanbul-reports: built with `{ file, projectRoot }`, driven per file by `onDetail` and as a whole by `execute`. */
interface LcovReportBase {
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

/** LCOV identifies functions by name; append their stable coverage id so same-named callbacks retain separate counts. */
class StarciLcovReport extends LcovReport {
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
