/**
 * The runner of the integration, e2e and contract projects: every spec file runs in a process of its own, bound to one data
 * slot of the test world.
 *
 * Why a process per file: jest runs a file in a fresh vm context, but a context still reaches the globals of the process that
 * hosts it, and jest-environment-node exposes every global the host process had when the environment loaded. The test world's
 * globalSetup runs in jest's main process and loads application code there (the migrate step and its modules), so a framework
 * that keeps its registry on a process global (`@nestjs/graphql` keeps `GqlTypeMetadataStorage` on `global`) leaks it into
 * every file jest runs in that process; and a worker that runs several files carries whatever the first one left on its own
 * global. A process per file isolates every framework at once.
 *
 * Why slots: the test world resets a slot's data (its databases, realm users, Redis DB, buckets and fakes) when a file boots,
 * so two files must never share a slot at the same time. The globalSetup of `@starci/test-world` provisions N slots, each a
 * complete, independent set of data namespaces, and publishes them in its state file (`STARCI_TEST_WORLD_STATE`, protocol
 * {@link WORLD_STATE_VERSION}). The runner runs up to `min(workers of the kind, N)` files at once (one when none are declared) and gives each a free slot: the
 * file's process is forked with `STARCI_TEST_WORLD_SLOT=<k>`; the slot goes back to the pool when the file ends.
 *
 * How: the stock jest-runner, driven one file at a time per slot with a single-worker farm (`maxWorkers: 1` per file), which
 * forks a fresh child, runs the file there and ends the child. jest-worker forks in the farm's constructor, which jest-runner
 * calls before its first `await`, so the slot variable is set on `process.env` only for that synchronous span. Never in band,
 * even when jest would choose it (`--runInBand`): the main process holds the globalSetup's state.
 *
 * Workers: the app declares how many files a kind runs at once, `tests: { integration: { workers: n }, e2e: { workers: n } }` in
 * `.starcistacks/application-stacks.yaml` (one when absent: sequential), or a run asks for them, `STARCI_TEST_WORLD_WORKERS=<n>`
 * (`starci test <kind> --workers <n>`); never jest's `--maxWorkers`, which the harness sizes for unit runs. The world's globalSetup provisions that many
 * slots and publishes the workers of each kind in its state file, so the two agree. A spec that declares itself exclusive (`useTestWorld({ ..., exclusive:
 * true })`: a latency budget, a soak, a load run) runs alone, after the parallel files of its kind. Before a file runs the integration and e2e kinds ask the result cache ({@link SpecCache}, world-cache.ts): a
 * file whose inputs are unchanged since its last green run is not run, it is reported `cached` (jest sees it as a skipped file); a changed, new or
 * previously red file runs, and its green run is recorded. Every file is a line of the report, on stderr and, when STARCI_TEST_REPORT names a file, in
 * its json.
 *
 * The pair is exact: this runner reads protocol {@link WORLD_STATE_VERSION} only. Any other state file is the wrong
 * `@starci/test-world` beside this preset, a typed failure naming both versions (re-pin both per canon-pins), never a fallback.
 */

import { createRequire } from "node:module"
import fs from "node:fs"
import path from "node:path"
import type TestRunner from "jest-runner"
import type { Test, TestEvents, TestWatcher, UnsubscribeFn } from "jest-runner"
import type { TestResult } from "@jest/test-result"
import { CACHED_KINDS, CACHE_ENV, REPORT_ENV, SpecCache, isExclusive, SpecInputs, reportLine, summary, type Plan, type ReportLine } from "./world-cache"

/** The state-file protocol of `@starci/test-world` this runner speaks (test-world 1.1 and later). */
const WORLD_STATE_VERSION = 2
/** The variable that carries the path of the world's state file (set by its globalSetup in this process). */
const STATE_FILE_ENV = "STARCI_TEST_WORLD_STATE"
/** The variable that tells a file's process which slot it owns (1-based). */
const SLOT_ENV = "STARCI_TEST_WORLD_SLOT"
/** The variable that asks for more than one file at a time (a positive integer); without it a run is one file on one slot. */
const WORKERS_ENV = "STARCI_TEST_WORLD_WORKERS"
/** The failure code of a state file this runner cannot drive. */
const WORLD_PAIR_MISMATCH = "JEST_PRESET_WORLD_PAIR_MISMATCH"

const PRESET = (() => {
  // dist/ sits one level below the package root that holds package.json
  const own: { name: string; version: string } = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"))
  return `${own.name}@${own.version}`
})()

/** A typed failure of the runner: `code` names it, the message says what to do. */
function runnerError(code: string, detail: string): Error & { code: string } {
  const error = new Error(`${code}: ${detail}`)
  return Object.assign(error, { code })
}

/** A property of an unknown value, `undefined` when the value is not an object that has it. */
const fieldOf = (value: unknown, name: string): unknown => (typeof value === "object" && value !== null && name in value ? Reflect.get(value, name) : undefined)

/** What the world published: its slot count and the spec files each kind may run at once; a missing or foreign state file is a pair mismatch. */
interface WorldState {
  readonly slots: number
  readonly workers: Readonly<Record<string, number>>
}

/** The state the world published. */
function worldState(env: NodeJS.ProcessEnv = process.env): WorldState {
  const file = env[STATE_FILE_ENV]
  const fix = `pin @starci/test-world and @starci/jest-preset together as knowledge/hfs/canon-pins.yaml pairs them (${PRESET} speaks state protocol ${WORLD_STATE_VERSION}, as @starci/test-world 1.1 and later write it)`
  if (file === undefined || file === "") {
    throw runnerError(WORLD_PAIR_MISMATCH, `${STATE_FILE_ENV} is not set: the world's globalSetup published no state file for ${PRESET}; ${fix}`)
  }
  let state: unknown
  try {
    state = JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (cause) {
    throw runnerError(WORLD_PAIR_MISMATCH, `the world state file ${file} cannot be read (${cause instanceof Error ? cause.message : String(cause)}); ${fix}`)
  }
  const published = fieldOf(state, "library")
  const library = typeof published === "string" ? published : "@starci/test-world before 1.1.0"
  const slots = fieldOf(state, "slots")
  if (fieldOf(state, "version") !== WORLD_STATE_VERSION || !Array.isArray(slots) || slots.length < 1) {
    throw runnerError(WORLD_PAIR_MISMATCH, `${library} wrote state protocol ${String(fieldOf(state, "version"))}, ${PRESET} needs ${WORLD_STATE_VERSION}; ${fix}`)
  }
  const declaredWorkers = fieldOf(state, "workers")
  const workers: Record<string, number> = {}
  if (typeof declaredWorkers === "object" && declaredWorkers !== null) {
    for (const [kind, count] of Object.entries(declaredWorkers)) if (typeof count === "number" && Number.isInteger(count) && count >= 1) workers[kind] = count
  }
  return { slots: slots.length, workers }
}

/** The slot count the world published. */
const worldSlots = (env: NodeJS.ProcessEnv = process.env): number => worldState(env).slots

/**
 * The stock jest-runner of the jest that loads this preset: resolved through jest's own dependency chain
 * (jest -> @jest/core -> jest-runner) from the repository root, so the runner always matches the running jest.
 */
function stockRunner(root = process.cwd()): typeof TestRunner {
  const fromRoot = createRequire(path.join(root, "package.json"))
  const fromJest = createRequire(fromRoot.resolve("jest/package.json"))
  const fromCore = createRequire(fromJest.resolve("@jest/core"))
  const loaded: { default?: typeof TestRunner } & typeof TestRunner = fromCore("jest-runner")
  return loaded.default ?? loaded
}

const StockRunner = stockRunner()

/** The empty result of a file jest did not run, resolved through jest's own chain like the runner: `skipped`, so a cached file counts as pending. */
function skippedResult(root: string, testFilePath: string): TestResult {
  const fromRoot = createRequire(path.join(root, "package.json"))
  const fromJest = createRequire(fromRoot.resolve("jest/package.json"))
  const fromCore = createRequire(fromJest.resolve("@jest/core"))
  const { createEmptyTestResult }: { createEmptyTestResult: () => TestResult } = fromCore("@jest/test-result")
  // jest refuses a result without a test ("must contain at least one test"), so the file stands for one pending test
  const title = "cached: inputs unchanged since the last green run"
  const pending = { title, fullName: title, ancestorTitles: [], status: "pending", numPassingAsserts: 0, duration: 0, failureMessages: [], failureDetails: [], location: null } satisfies TestResult["testResults"][number]
  return { ...createEmptyTestResult(), testFilePath, skipped: true, numPendingTests: 1, testResults: [pending] }
}

/** The workers a run asked for explicitly: a positive integer of STARCI_TEST_WORLD_WORKERS, else one. */
function requestedWorkers(env: NodeJS.ProcessEnv = process.env): number {
  const asked = Number(env[WORKERS_ENV])
  return Number.isInteger(asked) && asked >= 1 ? asked : 1
}

/** One subscription jest made before the run, replayable on the per-file runner of each file. */
interface Subscription {
  readonly name: keyof TestEvents
  readonly listener: (eventData: never) => void | Promise<void>
  attach(runner: TestRunner): UnsubscribeFn
}

/** One file of the run: its cache plan, and whether it runs alone after the parallel files of its kind. */
interface Item {
  readonly test: Test
  readonly plan: Plan | undefined
  readonly exclusive: boolean
}

/** The project name of a test (`integration`, `e2e`, `contract`, `unit`). */
const kindOf = (test: Test): string => {
  const name: unknown = test.context.config.displayName
  if (typeof name === "object" && name !== null && "name" in name && typeof name.name === "string") return name.name
  return typeof name === "string" ? name : ""
}

class WorldRunner extends StockRunner {
  static readonly WORLD_STATE_VERSION = WORLD_STATE_VERSION
  static readonly SLOT_ENV = SLOT_ENV
  static readonly WORKERS_ENV = WORKERS_ENV
  static readonly WORLD_PAIR_MISMATCH = WORLD_PAIR_MISMATCH
  static readonly worldSlots = worldSlots
  static readonly requestedWorkers = requestedWorkers

  #listeners: Subscription[] = []

  /** Whether the files are bound to the data slots of a test world; the lite runner (cache-runner.ts) has none. */
  protected get slotted(): boolean {
    return true
  }

  /** Jest subscribes before the run; the subscriptions are handed to the per-file runner of each file. */
  override on<Name extends keyof TestEvents>(eventName: Name, listener: (eventData: TestEvents[Name]) => void | Promise<void>): UnsubscribeFn {
    const entry: Subscription = { name: eventName, listener: listener as Subscription["listener"], attach: (runner) => runner.on(eventName, listener) }
    this.#listeners.push(entry)
    return () => {
      this.#listeners = this.#listeners.filter((candidate) => candidate !== entry)
    }
  }

  /** Tells what jest subscribed to `name` about a file this runner settled without forking it. */
  async #emit<Name extends keyof TestEvents>(name: Name, data: TestEvents[Name]): Promise<void> {
    for (const entry of this.#listeners.filter((candidate) => candidate.name === name)) await (entry.listener as (eventData: TestEvents[Name]) => void | Promise<void>)(data)
  }

  /** The cache of this run: consulted for the integration and e2e kinds only. */
  #cacheOf(): SpecCache {
    const config = this._globalConfig
    const patterns: unknown = Reflect.get(config, "testPathPatterns") ?? Reflect.get(config, "testPathPattern")
    const listed = typeof patterns === "object" && patterns !== null ? Reflect.get(patterns, "patterns") : patterns
    const named = Array.isArray(listed) ? listed.length > 0 : typeof listed === "string" && listed !== ""
    const partial = typeof config.testNamePattern === "string" && config.testNamePattern !== ""
    return new SpecCache(new SpecInputs(config.rootDir), { full: process.env[CACHE_ENV] === "off", named, partial })
  }

  /**
   * Runs the files of each kind on the slots the world published for it (`tests.<kind>.workers` of the app's stacks file, one when absent): the parallel files first,
   * up to `min(workers, slots)` at once, each in a fresh process bound to a free slot; then the exclusive files (`useTestWorld({ ..., exclusive: true })`) one at a
   * time on their own. Never in band. A file the cache holds green is reported `cached` and not run. An app without data slots (lite) runs one file at a time.
   */
  override async runTests(tests: Test[], watcher: TestWatcher): Promise<void> {
    const world: WorldState = this.slotted ? worldState() : { slots: 1, workers: {} }
    const widthOf = (kind: string): number => (this.slotted ? Math.max(1, Math.min(world.workers[kind] ?? requestedWorkers(), world.slots)) : 1)
    const cache = this.#cacheOf()
    const lines: ReportLine[] = []
    const queue: Item[] = []
    for (const test of tests) {
      const kind = kindOf(test)
      const plan = CACHED_KINDS.includes(kind) && cache.available ? cache.plan(test.path, kind) : undefined
      if (plan !== undefined && !plan.run) {
        const line: ReportLine = { spec: cache.relative(test.path), kind, outcome: "cached", ms: plan.record.ms, why: "inputs unchanged since the last green run" }
        lines.push(line)
        process.stderr.write(`${reportLine(line)}\n`)
        await this.#emit("test-file-start", [test])
        await this.#emit("test-file-success", [test, skippedResult(test.context.config.rootDir, test.path)])
      } else queue.push({ test, plan, exclusive: CACHED_KINDS.includes(kind) && isExclusive(test.path) })
    }
    // one lane per slot: a lane owns its slot for the whole batch and takes the next file when its current one ends
    const batch = async (items: Item[], width: number): Promise<void> => {
      const lane = async (slot: number): Promise<void> => {
        for (let next = items.shift(); next !== undefined; next = items.shift()) {
          if (watcher.isInterrupted()) return
          const started = Date.now()
          const result = await this.#runOne(next.test, watcher, this.slotted ? slot : undefined)
          const ms = Date.now() - started
          const green = result !== undefined && result.numFailingTests === 0 && result.testExecError === undefined && result.numPassingTests > 0
          if (next.plan !== undefined) {
            if (green) cache.green(next.plan, ms)
            else cache.red(next.plan)
          }
          const why = [next.plan?.run === true ? next.plan.why : "not cached", ...(next.exclusive ? ["exclusive, alone"] : [])].join(", ")
          const line: ReportLine = { spec: cache.relative(next.test.path), kind: kindOf(next.test), outcome: green ? "ran" : "failed", ms, why }
          lines.push(line)
          process.stderr.write(`${reportLine(line)}\n`)
        }
      }
      await Promise.all(Array.from({ length: Math.min(width, items.length) }, (_, index) => lane(index + 1)))
    }
    for (const kind of [...new Set(queue.map((item) => kindOf(item.test)))]) {
      const own = queue.filter((item) => kindOf(item.test) === kind)
      await batch(own.filter((item) => !item.exclusive), widthOf(kind))
      await batch(own.filter((item) => item.exclusive), 1)
    }
    if (lines.length > 0) process.stderr.write(`${summary(lines)}\n`)
    const report = process.env[REPORT_ENV]
    if (report !== undefined && report !== "") fs.writeFileSync(report, JSON.stringify({ lines, summary: summary(lines) }))
  }

  /** One file in a fresh single-worker farm whose child is forked with the slot in its environment; answers its result, undefined when the file crashed. */
  async #runOne(test: Test, watcher: TestWatcher, slot: number | undefined): Promise<TestResult | undefined> {
    const runner = new StockRunner({ ...this._globalConfig, maxWorkers: 1 }, this._context)
    const unsubscribe = this.#listeners.map(({ attach }) => attach(runner))
    let result: TestResult | undefined
    unsubscribe.push(runner.on("test-file-success", ([, settled]) => void (result = settled)))
    const before = process.env[SLOT_ENV]
    let running
    if (slot !== undefined) process.env[SLOT_ENV] = String(slot)
    try {
      // the farm (and its child) is created synchronously inside this call, before jest-runner's first await
      running = runner.runTests([test], watcher, { serial: false })
    } finally {
      if (slot !== undefined) {
        if (before === undefined) delete process.env[SLOT_ENV]
        else process.env[SLOT_ENV] = before
      }
    }
    try {
      await running
    } finally {
      for (const stop of unsubscribe) stop()
    }
    return result
  }
}

export = WorldRunner
