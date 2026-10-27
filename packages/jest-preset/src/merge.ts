// merge.ts - the coverage of a sharded unit run merged into the one report the coverage proof, Codecov and Sonar read (`starci app coverage merge`).
// Each shard runs with STARCI_COVERAGE_SHARD=1 (starciJestConfig): it measures ONLY the files its tests load (no collectCoverageFrom all-files
// instrumentation, whose fallback transform gives an unloaded file another function and branch set) and writes istanbul JSON (coverage-final.json).
// The maps of one file come from the same v8 transform in every shard; istanbul-lib-coverage merges them by source location (FileCoverage.merge), and the
// merged map is written as lcov through this preset's own lcov reporter (lcov.ts: stable function ids, the generated metadata source left out), exactly
// as an unsharded run writes it. A measured file no shard loaded is absent from the merged map: the coverage proof refuses it (no lcov record, 0%).
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import type { CoverageMapData } from "istanbul-lib-coverage"
import StarciLcovReport = require("./lcov.ts")

const fromJest = createRequire(require.resolve("jest"))
const fromCore = createRequire(fromJest.resolve("@jest/core"))
const fromReporters = createRequire(fromCore.resolve("@jest/reporters"))
const libCoverage: typeof import("istanbul-lib-coverage") = fromReporters("istanbul-lib-coverage")
const libReport: typeof import("istanbul-lib-report") = fromReporters("istanbul-lib-report")

/** The folder of a directory entry: `parentPath`, which Node before 20.12 calls `path`. */
function parentOf(entry: fs.Dirent): string {
  const legacy: unknown = Reflect.get(entry, "path")
  return entry.parentPath ?? (typeof legacy === "string" ? legacy : "")
}

/** Every coverage-final.json at or below `target` (a file or a directory), sorted. */
function coverageFilesUnder(target: string): string[] {
  if (!fs.statSync(target).isDirectory()) return [target]
  return fs.readdirSync(target, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name === "coverage-final.json")
    .map((entry) => path.join(parentOf(entry), entry.name))
    .sort()
}

/**
 * Merge the shard reports `inputs` (coverage-final.json files or directories holding them) and write `<outDir>/lcov.info` and `<outDir>/coverage-final.json`.
 * Returns { reports, files }; throws when no report is found (an empty merge would read as "nothing to measure").
 */
function mergeCoverage({ inputs, outDir }: { inputs: string[]; outDir: string }): { reports: number; files: number } {
  const reports = inputs.flatMap((input) => coverageFilesUnder(input))
  if (!reports.length) throw new Error(`no coverage-final.json under ${inputs.join(", ")}: the unit shards wrote none (run them with STARCI_COVERAGE_SHARD=1)`)
  const map = libCoverage.createCoverageMap({})
  for (const report of reports) {
    const data: CoverageMapData = JSON.parse(fs.readFileSync(report, "utf8"))
    map.merge(data)
  }
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, "coverage-final.json"), JSON.stringify(map.toJSON()))
  const context = libReport.createContext({ dir: outDir, coverageMap: map })
  new StarciLcovReport({ file: "lcov.info", projectRoot: process.cwd() }).execute(context)
  return { reports: reports.length, files: map.files().length }
}

export { mergeCoverage, coverageFilesUnder }
