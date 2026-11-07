// spec-coverage-reporter.ts - the Jest reporter that writes the coverage of each spec file on its own (see spec-coverage.ts). starciJestConfig adds it
// (`reporters: ["default", [require.resolve("./spec-coverage-reporter.js"), { dir, include }]]`) when STARCI_SPEC_COVERAGE_DIR names the folder. Jest runs custom
// reporters before its coverage reporter, so the spec's v8 coverage is still on the test result when it arrives: the reporter takes it off the result, so
// neither Jest's coverage reporter nor the aggregated results hold any spec's coverage, and the parent's memory stays flat however many specs run. It writes
// the spec's file with the files the spec loaded (spec-loaded-runtime.ts). A failed spec writes `passed: false` and no source.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import type { Config } from "@jest/types"
import type { TestResult } from "@jest/test-result"
import type { Test } from "@jest/reporters"
import { LOADED_FOLDER, sourceCoverageOf, specCoverageFileName } from "./spec-coverage.ts"
import type { SourceCoverage, SpecCoverageFile } from "./spec-coverage.ts"

const fromJest = createRequire(require.resolve("jest"))
const fromCore = createRequire(fromJest.resolve("@jest/core"))
const fromReporters = createRequire(fromCore.resolve("@jest/reporters"))
const v8ToIstanbul: typeof import("v8-to-istanbul") = fromReporters("v8-to-istanbul")
const micromatch: { isMatch(path: string, patterns: string[], options?: { dot?: boolean }): boolean } = fromCore("micromatch")
const mergeProcessCovs: (covs: Array<{ result: TestResultScript[] }>) => { result: Array<{ url: string; functions: Parameters<ReturnType<typeof v8ToIstanbul>["applyCoverage"]>[0] }> } = fromReporters("@bcoe/v8-coverage").mergeProcessCovs
const METADATA_SOURCE = require.resolve("./unit-metadata.generated.js")

type TestResultScript = NonNullable<TestResult["v8Coverage"]>[number]["result"]

/** The options of the reporter: the folder it writes into and the `collectCoverageFrom` globs that select the measured sources. */
interface SpecCoverageOptions {
  readonly dir: string
  readonly include: readonly string[]
}

const posix = (file: string): string => file.split(path.sep).join("/")

/** True when a test result is clean: the suite ran and no test failed. */
function isPassed(result: TestResult): boolean {
  return !result.testExecError && !result.failureMessage && result.numFailingTests === 0
}

/**
 * Writes one file per spec. A source is selected the way jest's `collectCoverageFrom` selects it, relative to the rootDir of the spec's project, and every
 * path it writes (the spec's and its sources') is relative to the jest root, so the specs of a root package's project (rootDir the app root) and of the back
 * end's land in one tree of paths.
 */
class SpecCoverageReporter {
  private readonly options: SpecCoverageOptions
  private readonly pending: Array<Promise<void>> = []
  private readonly jestRoot: string

  constructor(globalConfig: Config.GlobalConfig, options: SpecCoverageOptions) {
    if (typeof options?.dir !== "string" || !Array.isArray(options.include)) throw new Error("the spec coverage reporter needs { dir, include }")
    this.options = options
    this.jestRoot = globalConfig.rootDir
    fs.mkdirSync(options.dir, { recursive: true })
  }

  onTestResult(test: Test, result: TestResult): void {
    const coverage = result.v8Coverage
    delete result.v8Coverage
    this.pending.push(this.write(test.context.config.rootDir, posix(path.relative(this.jestRoot, test.path)), result, coverage))
  }

  async onRunComplete(): Promise<void> {
    await Promise.all(this.pending)
    // Every list was moved onto its spec's file: the folder holds nothing left to read (a spec that never reported leaves its list, and the folder, behind).
    try { fs.rmdirSync(path.join(this.options.dir, LOADED_FOLDER)) } catch { /* not empty, or never created */ }
  }

  private async write(root: string, spec: string, result: TestResult, coverage: TestResult["v8Coverage"]): Promise<void> {
    const passed = isPassed(result)
    const sources: Record<string, SourceCoverage> = {}
    if (passed && coverage) {
      const merged = mergeProcessCovs([{ result: coverage.map((entry) => entry.result) }])
      const transforms = new Map(coverage.flatMap((entry) => (entry.codeTransformResult ? [[entry.result.url, entry.codeTransformResult] as const] : [])))
      for (const script of merged.result) {
        if (this.relativeSource(root, script.url) === undefined) continue
        const transform = transforms.get(script.url)
        const sourceMap = transform?.sourceMapPath && fs.existsSync(transform.sourceMapPath) ? JSON.parse(fs.readFileSync(transform.sourceMapPath, "utf8")) : undefined
        const converter = v8ToIstanbul(script.url, transform?.wrapperLength ?? 0, transform && sourceMap
          ? { originalSource: transform.originalCode, source: transform.code, sourceMap: { sourcemap: { file: script.url, ...sourceMap } } }
          : { source: fs.readFileSync(script.url.startsWith("file:") ? fileURLToPath(script.url) : script.url, "utf8") })
        await converter.load()
        converter.applyCoverage(script.functions)
        for (const data of Object.values(converter.toIstanbul())) {
          const file = this.relativeSource(root, data.path)
          if (file !== undefined) sources[file] = sourceCoverageOf(data)
        }
      }
    }
    const record: SpecCoverageFile = { spec, passed, sources: Object.fromEntries(Object.entries(sources).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))), loaded: this.loaded(spec) }
    fs.writeFileSync(path.join(this.options.dir, specCoverageFileName(spec)), JSON.stringify(record))
  }

  /** The files the spec loaded, as its runtime wrote them before its result left the worker; the runtime's file is removed once read. Null when it wrote none. */
  private loaded(spec: string): string[] | null {
    const file = path.join(this.options.dir, LOADED_FOLDER, specCoverageFileName(spec))
    let loaded: string[]
    try {
      loaded = JSON.parse(fs.readFileSync(file, "utf8")) as string[]
    } catch {
      return null
    }
    fs.rmSync(file, { force: true })
    return loaded
  }

  /** The jest-root-relative posix path of a source (a path or file URL) measured in the project rooted at `root`, undefined when it is not measured. */
  private relativeSource(root: string, location: string): string | undefined {
    const resolved = path.resolve(location.startsWith("file:") ? fileURLToPath(location) : location)
    if (resolved === METADATA_SOURCE) return undefined
    const relative = posix(path.relative(root, resolved))
    if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined
    const positive = this.options.include.filter((glob) => !glob.startsWith("!"))
    const negative = this.options.include.filter((glob) => glob.startsWith("!")).map((glob) => glob.slice(1))
    const measured = micromatch.isMatch(relative, positive, { dot: true }) && !(negative.length > 0 && micromatch.isMatch(relative, negative, { dot: true }))
    return measured ? posix(path.relative(this.jestRoot, resolved)) : undefined
  }
}

export = SpecCoverageReporter
