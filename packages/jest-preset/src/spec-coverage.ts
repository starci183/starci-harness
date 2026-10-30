// spec-coverage.ts - the per-spec coverage of the unit run, the input of the committed check cache (`starci app check --test`).
// The reporter (spec-coverage-reporter.ts) turns the v8 coverage of ONE spec file into the instrumented items of each measured source and whether this spec
// covered each: a statement, a function and every location of a branch is 1 (covered) or 0 (instrumented, not covered), never a hit count, so the same run
// writes the same bytes. This module holds that record and its other direction: `mergeSpecCoverage` is the union of the records of every spec (an item is
// covered when any spec covers it) written as the lcov and coverage-final.json an unsharded run would write, which is the total the per-file threshold,
// Codecov and Sonar read.
import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import type { CoverageMap, FileCoverageData, Range as IstanbulRange } from "istanbul-lib-coverage"
import StarciLcovReport = require("./lcov.ts")

const fromJest = createRequire(require.resolve("jest"))
const fromCore = createRequire(fromJest.resolve("@jest/core"))
const fromReporters = createRequire(fromCore.resolve("@jest/reporters"))
const libCoverage: typeof import("istanbul-lib-coverage") = fromReporters("istanbul-lib-coverage")
const libReport: typeof import("istanbul-lib-report") = fromReporters("istanbul-lib-report")

/** A source range: start line, start column, end line, end column. */
export type Range = readonly [number, number, number, number]
/** 1 when the spec covered the item, 0 when the item is instrumented and the spec did not reach it. */
export type Flag = 0 | 1
/** A statement: its range and flag. */
export type StatementItem = readonly [number, number, number, number, Flag]
/** A function: its name, declaration range, body range and flag. */
export type FunctionItem = readonly [string, Range, Range, Flag]
/** A branch: its type, range and the flag of each of its locations. */
export type BranchItem = readonly [string, Range, ReadonlyArray<readonly [Range, Flag]>]
/** What one spec says of one source: every instrumented item and whether the spec covered it. */
export interface SourceCoverage {
  readonly s: readonly StatementItem[]
  readonly f: readonly FunctionItem[]
  readonly b: readonly BranchItem[]
}
/** What the reporter writes for one spec file (`<dir>/<specCoverageFileName(spec)>`). */
export interface SpecCoverageFile {
  /** The spec's path relative to the project root, posix. */
  readonly spec: string
  /** False when a test of the spec failed or the spec could not run: it then holds no source, and its coverage is never stored. */
  readonly passed: boolean
  /** Per measured source (path relative to the project root, posix), sorted by path. */
  readonly sources: Readonly<Record<string, SourceCoverage>>
}

const rangeOf = (loc: IstanbulRange): Range => [loc.start.line, loc.start.column, loc.end.line, loc.end.column]
const locOf = (range: Range): IstanbulRange => ({ start: { line: range[0], column: range[1] }, end: { line: range[2], column: range[3] } })
const flagOf = (count: number): Flag => (count > 0 ? 1 : 0)
const compare = (left: unknown, right: unknown): number => {
  const a = JSON.stringify(left)
  const b = JSON.stringify(right)
  return a < b ? -1 : a > b ? 1 : 0
}

/** The covered/not-covered items of one file's istanbul coverage, sorted so equal coverage is equal bytes. */
export function sourceCoverageOf(data: FileCoverageData): SourceCoverage {
  const s = Object.entries(data.statementMap).map(([id, loc]): StatementItem => [loc.start.line, loc.start.column, loc.end.line, loc.end.column, flagOf(data.s[id] ?? 0)]).sort(compare)
  const f = Object.entries(data.fnMap).map(([id, meta]): FunctionItem => [meta.name, rangeOf(meta.decl), rangeOf(meta.loc), flagOf(data.f[id] ?? 0)]).sort(compare)
  const b = Object.entries(data.branchMap).map(([id, meta]): BranchItem => [meta.type, rangeOf(meta.loc), meta.locations.map((loc, index): readonly [Range, Flag] => [rangeOf(loc), flagOf(data.b[id]?.[index] ?? 0)])]).sort(compare)
  return { s, f, b }
}

/** The istanbul coverage of `source` that a record stands for: a covered item has count 1, an uncovered one 0. */
export function fileCoverageOf(source: string, coverage: SourceCoverage): FileCoverageData {
  const data: FileCoverageData = { path: source, statementMap: {}, fnMap: {}, branchMap: {}, s: {}, f: {}, b: {} }
  coverage.s.forEach((item, index) => {
    data.statementMap[String(index)] = locOf([item[0], item[1], item[2], item[3]])
    data.s[String(index)] = item[4]
  })
  coverage.f.forEach(([name, decl, loc, flag], index) => {
    data.fnMap[String(index)] = { name, decl: locOf(decl), loc: locOf(loc), line: loc[0] }
    data.f[String(index)] = flag
  })
  coverage.b.forEach(([type, loc, locations], index) => {
    data.branchMap[String(index)] = { type, loc: locOf(loc), locations: locations.map(([range]) => locOf(range)), line: loc[0] }
    data.b[String(index)] = locations.map(([, flag]) => flag)
  })
  return data
}

/** The lines a source's coverage covers (a line is covered when a covered statement starts on it), sorted. */
export function coveredLines(coverage: SourceCoverage): number[] {
  return [...new Set(coverage.s.filter((item) => item[4] === 1).map((item) => item[0]))].sort((a, b) => a - b)
}

/** The merged coverage map of per-spec records: per source the union of the instrumented items, covered when any record covers them. */
export function mergeSourceCoverage(records: Iterable<Readonly<Record<string, SourceCoverage>>>): CoverageMap {
  const map: CoverageMap = libCoverage.createCoverageMap({})
  for (const record of records) {
    for (const [source, coverage] of Object.entries(record)) map.merge({ [source]: fileCoverageOf(source, coverage) })
  }
  return map
}

/**
 * The union of the per-spec records written as `<outDir>/lcov.info` and `<outDir>/coverage-final.json`; `projectRoot` is the folder the record paths are
 * relative to (the report carries them absolute, like an unsharded run). Returns the number of sources.
 */
export function mergeSpecCoverage({ records, outDir, projectRoot }: { records: Iterable<Readonly<Record<string, SourceCoverage>>>; outDir: string; projectRoot: string }): { files: number } {
  const absolute = [...records].map((record) => Object.fromEntries(Object.entries(record).map(([source, coverage]) => [path.resolve(projectRoot, source), coverage])))
  const map = mergeSourceCoverage(absolute)
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, "coverage-final.json"), JSON.stringify(map.toJSON()))
  const context = libReport.createContext({ dir: outDir, coverageMap: map })
  new StarciLcovReport({ file: "lcov.info", projectRoot }).execute(context)
  return { files: map.files().length }
}

/** The file the reporter writes for the spec at `spec` (project-relative, posix). */
export function specCoverageFileName(spec: string): string {
  return `${createHash("sha256").update(spec).digest("hex").slice(0, 24)}.json`
}

/** Every spec file the reporter wrote into `dir`, sorted by spec path. */
export function readSpecCoverage(dir: string): SpecCoverageFile[] {
  const files: SpecCoverageFile[] = fs.readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")))
  return files.sort((a, b) => (a.spec < b.spec ? -1 : a.spec > b.spec ? 1 : 0))
}
