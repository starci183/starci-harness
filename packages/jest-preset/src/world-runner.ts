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
 * {@link WORLD_STATE_VERSION}). The runner runs up to `min(--maxWorkers, N)` files at once and gives each a free slot: the
 * file's process is forked with `STARCI_TEST_WORLD_SLOT=<k>`; the slot goes back to the pool when the file ends.
 *
 * How: the stock jest-runner, driven one file at a time per slot with a single-worker farm (`maxWorkers: 1` per file), which
 * forks a fresh child, runs the file there and ends the child. jest-worker forks in the farm's constructor, which jest-runner
 * calls before its first `await`, so the slot variable is set on `process.env` only for that synchronous span. Never in band,
 * even when jest would choose it (`--runInBand`): the main process holds the globalSetup's state.
 *
 * The pair is exact: this runner reads protocol {@link WORLD_STATE_VERSION} only. Any other state file is the wrong
 * `@starci/test-world` beside this preset, a typed failure naming both versions (re-pin both per canon-pins), never a fallback.
 */

import { createRequire } from "node:module"
import fs from "node:fs"
import path from "node:path"
import type TestRunner from "jest-runner"
import type { Test, TestEvents, TestWatcher, UnsubscribeFn } from "jest-runner"

/** The state-file protocol of `@starci/test-world` this runner speaks (test-world 1.1.x). */
const WORLD_STATE_VERSION = 2
/** The variable that carries the path of the world's state file (set by its globalSetup in this process). */
const STATE_FILE_ENV = "STARCI_TEST_WORLD_STATE"
/** The variable that tells a file's process which slot it owns (1-based). */
const SLOT_ENV = "STARCI_TEST_WORLD_SLOT"
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

/** The slot count the world published; a missing or foreign state file is a pair mismatch. */
function worldSlots(env: NodeJS.ProcessEnv = process.env): number {
  const file = env[STATE_FILE_ENV]
  const fix = `pin @starci/test-world and @starci/jest-preset together as knowledge/hfs/canon-pins.yaml pairs them (${PRESET} speaks state protocol ${WORLD_STATE_VERSION}, @starci/test-world 1.1.x)`
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
  return slots.length
}

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

/** One subscription jest made before the run, replayable on the per-file runner of each file. */
interface Subscription {
  attach(runner: TestRunner): UnsubscribeFn
}

class WorldRunner extends StockRunner {
  static readonly WORLD_STATE_VERSION = WORLD_STATE_VERSION
  static readonly SLOT_ENV = SLOT_ENV
  static readonly WORLD_PAIR_MISMATCH = WORLD_PAIR_MISMATCH
  static readonly worldSlots = worldSlots

  #listeners: Subscription[] = []

  /** Jest subscribes before the run; the subscriptions are handed to the per-file runner of each file. */
  override on<Name extends keyof TestEvents>(eventName: Name, listener: (eventData: TestEvents[Name]) => void | Promise<void>): UnsubscribeFn {
    const entry: Subscription = { attach: (runner) => runner.on(eventName, listener) }
    this.#listeners.push(entry)
    return () => {
      this.#listeners = this.#listeners.filter((candidate) => candidate !== entry)
    }
  }

  /** Runs the files up to `min(--maxWorkers, slots)` at once, each in a fresh process bound to a free slot; never in band. */
  override async runTests(tests: Test[], watcher: TestWatcher): Promise<void> {
    const slots = worldSlots()
    const width = Math.max(1, Math.min(this._globalConfig.maxWorkers ?? 1, slots))
    const queue = [...tests]
    // one lane per slot: a lane owns its slot for the whole run and takes the next file when its current one ends
    const lane = async (slot: number): Promise<void> => {
      for (let test = queue.shift(); test !== undefined; test = queue.shift()) {
        if (watcher.isInterrupted()) return
        await this.#runOne(test, watcher, slot)
      }
    }
    await Promise.all(Array.from({ length: Math.min(width, tests.length) }, (_, index) => lane(index + 1)))
  }

  /** One file in a fresh single-worker farm whose child is forked with the slot in its environment. */
  async #runOne(test: Test, watcher: TestWatcher, slot: number): Promise<void> {
    const runner = new StockRunner({ ...this._globalConfig, maxWorkers: 1 }, this._context)
    const unsubscribe = this.#listeners.map(({ attach }) => attach(runner))
    const before = process.env[SLOT_ENV]
    let running
    process.env[SLOT_ENV] = String(slot)
    try {
      // the farm (and its child) is created synchronously inside this call, before jest-runner's first await
      running = runner.runTests([test], watcher, { serial: false })
    } finally {
      if (before === undefined) delete process.env[SLOT_ENV]
      else process.env[SLOT_ENV] = before
    }
    try {
      await running
    } finally {
      for (const stop of unsubscribe) stop()
    }
  }
}

export = WorldRunner
