// spec-loaded-runtime.ts - the Jest runtime of the check cache's unit run (STARCI_SPEC_COVERAGE_DIR, starciJestConfig sets it as each unit project's `runtime`):
// Jest's own runtime, which also records every file the spec's module registry reads (`readFileBuffer`: the source of each module it requires or imports, the
// JSON it requires, Jest's internal modules), whatever `jest.resetModules` clears in between. At teardown, before the spec's result leaves the worker, it writes
// them reduced by `loadedOf` to `<dir>/loaded/<specCoverageFileName(spec)>`; the reporter moves that list onto the spec's file, and the cache keys the spec's
// record on the installed packages among them.
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { LOADED_FOLDER, loadedOf, specCoverageFileName } from "./spec-coverage.ts"

const fromJest = createRequire(require.resolve("jest"))
const fromCore = createRequire(fromJest.resolve("@jest/core"))
const fromRunner = createRequire(fromCore.resolve("jest-runner"))

/** The part of jest-runtime this runtime extends. */
interface RuntimeBase {
  readFileBuffer(filename: string): Buffer
  teardown(): void
}
/** jest-runtime's constructor arguments, as jest-runner passes them: the spec's path and the global config are the ones read here. */
type RuntimeArgs = [config: unknown, environment: unknown, resolver: unknown, transformer: unknown, cacheFS: unknown, coverageOptions: unknown, testPath: string, globalConfig: { readonly rootDir: string }]
const JestRuntime = (fromRunner("jest-runtime") as { default: new (...args: RuntimeArgs) => RuntimeBase }).default

/** The files each runtime read; created on the first read, which may come while the base constructor runs. */
const readFiles = new WeakMap<object, Set<string>>()
/** Where each runtime writes its list, and the root its paths are relative to. */
const targets = new WeakMap<object, { readonly file: string; readonly root: string }>()

const filesOf = (runtime: object): Set<string> => {
  let files = readFiles.get(runtime)
  if (files === undefined) {
    files = new Set()
    readFiles.set(runtime, files)
  }
  return files
}

/** jest-runtime with the reads of the spec's module registry recorded and written at teardown. */
class SpecLoadedRuntime extends JestRuntime {
  constructor(...args: RuntimeArgs) {
    super(...args)
    const dir = process.env.STARCI_SPEC_COVERAGE_DIR
    const root = args[7].rootDir
    const spec = path.relative(root, args[6]).split(path.sep).join("/")
    if (dir) targets.set(this, { file: path.join(dir, LOADED_FOLDER, specCoverageFileName(spec)), root })
  }

  override readFileBuffer(filename: string): Buffer {
    filesOf(this).add(filename)
    return super.readFileBuffer(filename)
  }

  override teardown(): void {
    const target = targets.get(this)
    if (target !== undefined) {
      fs.mkdirSync(path.dirname(target.file), { recursive: true })
      fs.writeFileSync(target.file, JSON.stringify(loadedOf(filesOf(this), target.root)))
    }
    super.teardown()
  }
}

export = SpecLoadedRuntime
