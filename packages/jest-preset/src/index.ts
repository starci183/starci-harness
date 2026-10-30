import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { Config } from "jest"

import { mock, createMock } from "./mock.ts"
import { mockEntityManager, fakeTransaction } from "./entity-manager.ts"
import { fakeQueryBuilder, queueQueryBuilders } from "./query-builder.ts"
import { FakeClock } from "./clock.ts"
import { fakeCache } from "./cache.ts"
import { fakeLock } from "./lock.ts"
import { recordingEventBus } from "./event-bus.ts"
import { recordingQueueOutbox } from "./queue.ts"
import { fakeInbox } from "./inbox.ts"
import { builder } from "./builders.ts"
import { fakeIds, FakeIds } from "./ids.ts"
import SONAR_EXCLUSIONS = require("./sonar-exclusions.ts")

export type { MockOf } from "./mock.ts"
export type { MockEntityManager, FakeTransaction, EntityClass } from "./entity-manager.ts"
export type { FakeQueryBuilder, QueryBuilderAnswers, QueryBuilderCall, QueryBuilderHost } from "./query-builder.ts"
export type { FakeCache } from "./cache.ts"
export type { FakeLock } from "./lock.ts"
export type { RecordingEventBus } from "./event-bus.ts"
export type { RecordingQueueOutbox } from "./queue.ts"
export type { FakeInbox } from "./inbox.ts"
export type { RefusalReason } from "./matchers.ts"

/**
 * The coverage scope `starci app sync` renders from the slot manifest: the measured roots (a directory pattern per measured slot, a placeholder
 * folder written as a star), the logic roles measured in them, the logic files a slot declares (`logic`: a file that carries logic without a
 * logic-role suffix, measured like one) and the directories inside a root that are never measured (each ending in a double star).
 */
export interface StarciCoverageScope {
  readonly roots: readonly string[]
  readonly roles: readonly string[]
  readonly files?: readonly string[]
  readonly excludes: readonly string[]
}
export interface StarciJestOptions {
  readonly coverage: StarciCoverageScope
}
/** One project of the config (`unit`, `integration`, `e2e`, `contract`). */
export type StarciJestProject = Exclude<NonNullable<Config["projects"]>[number], string>
/**
 * The jest config `starciJestConfig` returns: jest's `Config` with its `projects` all objects, its `coverageReporters` allowing the path of a custom reporter (the lcov reporter of this preset is one)
 * and its `coverageThreshold` keyed by glob only: jest accepts both, its own `Config` typing requires a `global` threshold and leaves out the reporter path.
 */
export type StarciJestConfig = Omit<Config, "projects" | "coverageReporters" | "coverageThreshold"> & {
  projects: StarciJestProject[]
  coverageThreshold?: Record<string, { lines: number; branches: number; functions: number; statements: number }>
  coverageReporters: Array<string | [string, Record<string, unknown>]>
}

/**
 * Coverage is measured where logic runs: every file `<name>.<role>.ts` of a LOGIC role (service, policy, projection, guard, mapper, client, ...)
 * inside the roots the slot manifest marks `coverage: required` (the modules of the back end: domain, integrations, platform, projections), and
 * every logic file such a slot declares (`logic`: a file that carries logic without a logic-role suffix).
 * The features (handlers, resolvers, controllers, consumers, processors, steps, sagas, cli commands) are thin by rule (BE_FEATURE_THIN) and are
 * never measured. The scope is NOT written here: `starci app sync` renders it from the manifest (scripts/hfs/coverage-scope.mjs) into the repository's
 * jest.config.js as `starciJestConfig({ coverage: { roots, roles, files, excludes } })`, and the same derivation renders Sonar's
 * `sonar.coverage.exclusions` and the Codecov paths and components, so the three can never disagree. Every measured file must reach 100 on every metric.
 * The unit run also writes `coverage/lcov.info`: Sonar and Codecov import it.
 */
const COVERAGE_EXCLUDES: string[] = ["**/dist/**", "**/coverage/**"]
/** The four metrics, each held at 100 per file. */
const COVERAGE_THRESHOLD = Object.freeze({ lines: 100, branches: 100, functions: 100, statements: 100 })

/** The glob one measured root stands for: every file of a logic role below it. */
function rootGlob(root: string, roles: readonly string[]): string {
  return `${root}**/*.${roles.length === 1 ? roles[0] : `{${roles.join(",")}}`}.ts`
}

/**
 * jest's `collectCoverageFrom` of a coverage scope `{ roots, roles, files, excludes }`: the glob of every root, every declared logic file, then
 * the none directories inside a root (`excludes`, each a glob that ends in `**`) and the generated folders as negations.
 */
function collectCoverageFrom(coverage: StarciCoverageScope): string[] {
  return [
    ...coverage.roots.map((root) => rootGlob(root, coverage.roles)),
    ...(coverage.files ?? []),
    ...[...coverage.excludes, ...COVERAGE_EXCLUDES].map((glob) => `!${glob}`),
  ]
}

/** One union glob keeps Jest's per-file checks while a scoped map may contain files from only one measured root or declared logic file. */
function coverageThresholdOf(coverage: StarciCoverageScope, root: string): Record<string, { lines: number; branches: number; functions: number; statements: number }> {
  const rootGlobs = [...coverage.roots.map((entry) => rootGlob(entry, coverage.roles)), ...(coverage.files ?? [])].filter((glob) => hasCoverageSubjects(root, glob))
  if (rootGlobs.length === 0) return {}
  const glob = rootGlobs.length === 1 ? rootGlobs[0] : `{${rootGlobs.join(",")}}`
  return { [`./${glob}`]: { ...COVERAGE_THRESHOLD } }
}

/**
 * Sonar `sonar.exclusions`: specs, e2e specs, dist and coverage output are not analysed at all. The list lives in sonar-exclusions.ts, a
 * require-free module whose built file @starci/hfs also ships (packages/hfs/runtime, scripts/hfs/sync-runtime.mjs), so `starci app scaffold`
 * renders the same exclusions before any app dependency is installed.
 */
function sonarExclusions(): string {
  return SONAR_EXCLUSIONS.join(",")
}

const TS_TRANSFORM = String.raw`^.+\.ts$`

/**
 * ts-jest without a type check (`diagnostics: false`; `isolatedModules: true` comes from @starci/tsconfig, which is where
 * ts-jest 29.4 reads it — the ts-jest option of the same name is deprecated): types are checked once, by `typecheck` / `typecheck:tests`, never per test file.
 * `npm run test:e2e` (and `test:integration`, `test:contract`) runs `npm run typecheck:tests` first so nobody runs a world spec on code that
 * does not type-check.
 */
function transform(tsconfig: string | Record<string, unknown>): Record<string, [string, Record<string, unknown>]> {
  return { [TS_TRANSFORM]: ["ts-jest", { tsconfig, diagnostics: false }], ...esmDependencyTransform() }
}

/**
 * The runtime dependencies of a back end that ship ECMAScript modules only: jest's CommonJS runtime cannot load them, so their
 * files are compiled to CommonJS like the repository's own (ts-jest with `allowJs`) instead of being skipped as node_modules.
 * `jose` is the Supabase access-token verifier of every lite back end (be.integrations.supabase); a lite app keeps full's unit
 * run (ruling:R212/case-1, amended by ruling:R212/case-4), so a spec that imports its guard must load it. `@starci/ai-router`
 * is the AI pool module a back end registers in its AppModule, so a spec that builds the AppModule must load it.
 */
const ESM_ONLY_DEPENDENCIES = Object.freeze(["jose", String.raw`@starci[\\/]ai-router`])
const ESM_DEPENDENCY_TRANSFORM = String.raw`^.+[\\/]node_modules[\\/](?:${ESM_ONLY_DEPENDENCIES.join("|")})[\\/].+\.js$`

function esmDependencyTransform(): Record<string, [string, Record<string, unknown>]> {
  return { [ESM_DEPENDENCY_TRANSFORM]: ["ts-jest", { tsconfig: { allowJs: true, module: "commonjs", target: "es2022", esModuleInterop: true }, diagnostics: false }] }
}

/** node_modules stay untransformed except the ESM-only dependencies above. */
const TRANSFORM_IGNORE_PATTERNS = Object.freeze([String.raw`[\\/]node_modules[\\/](?!(?:${ESM_ONLY_DEPENDENCIES.join("|")})[\\/])`])

/** The unit project transpiles each file independently; helpers stay in tslib, source maps distinguish generated metadata, and type checks run separately. */
const UNIT_COMPILER_OPTIONS = Object.freeze({ isolatedModules: true, importHelpers: true, sourceMap: true })

/** Generated constructor metadata keeps its runtime guards, mapped to a generated-metadata coverage anchor instead of source parameters. */
function unitTransform(): Record<string, [string, Record<string, unknown>]> {
  const unitMetadata = require.resolve("./unit-metadata.js")
  return {
    [TS_TRANSFORM]: [unitMetadata, { tsconfig: { ...UNIT_COMPILER_OPTIONS }, diagnostics: false, astTransformers: { after: [unitMetadata] } }],
    ...esmDependencyTransform(),
  }
}

/**
 * The path aliases of a StarCi back end: the same three `paths` the managed `tsconfig.json` declares, so jest resolves what
 * `tsc` resolves. They are part of the preset, not an option: a repository has no other alias.
 */
const MODULE_NAME_MAPPER: Readonly<Record<string, string>> = Object.freeze({
  "^@features/(.*)$": "<rootDir>/src/features/$1",
  "^@modules/(.*)$": "<rootDir>/src/modules/$1",
  "^@tests/(.*)$": "<rootDir>/src/tests/$1",
})

/** The test folders under `src/tests/` that a project other than `unit` owns (owner test layout 2026-09-30). */
const TEST_KIND_FOLDERS: readonly string[] = Object.freeze(["world", "integration", "e2e", "contract"])
const underTests = (folder: string): string => String.raw`[\\/]src[\\/]tests[\\/]` + folder + String.raw`[\\/]`

/**
 * The whole jest config of a Nest repository: projects `unit` (colocated `<name>.spec.ts`), `integration`
 * (`src/tests/integration/<capability>/<name>.integration-spec.ts`), `e2e` (`src/tests/e2e/<area>/<name>.e2e-spec.ts`) and
 * `contract` (`src/tests/contract/<provider>/<name>.contract-spec.ts`). It takes ONE option, the coverage scope: the repository's `jest.config.js` is a managed file
 * (R05), rendered by `starci app sync` as `module.exports = require("@starci/jest-preset").starciJestConfig({ coverage: { roots, roles, excludes } })`, the scope derived from the slot manifest.
 *
 * The managed scripts select one project each (`test` = unit, `test:integration`, `test:e2e`, `test:contract`); the
 * contract project is never part of `test` or `test:e2e`, and a contract spec skips itself without sandbox config. The
 * test tree compiles against `src/tests/tsconfig.json`, the nearest config of every file under `src/tests/`. The
 * integration, e2e and contract projects share the world's `global-setup.ts`/`global-teardown.ts` (`src/tests/world/`) and
 * run their spec files up to `min(--maxWorkers, slots)` at once, each in a worker process of its own bound to one data slot
 * of the test world (`world-runner.js`; a slot's data is reset when a file boots, so no two files ever share a slot). A declared lite app instead runs its existing integration and contract specs without a world, on jest's stock runner. The unit project alone has a `setupFilesAfterEnv` (the Outcome matchers).
 * Coverage is collected from the logic roles of the measured roots only (`coverage` option), with a per-file threshold of 100 on lines, branches, functions and
 * statements: the `test` script runs the unit project with `--coverage`, fails below it and writes `coverage/lcov.info` for Sonar. It uses v8: istanbul instruments the helpers TypeScript emits (`__decorate`, `__param`, `__awaiter`, interop wrappers)
 * as thousands of branches no spec can cover, while v8 measures the real source.
 */
/** The runner of the integration, e2e and contract projects (`world-runner.js`): every spec file in a worker process of its own. */
const WORLD_RUNNER: string = require.resolve("./world-runner.js")

/** True when the repository at `root` has the test world's global setup (`src/tests/world/global-setup.ts`). */
function hasTestWorld(root: string): boolean {
  return existsSync(join(root, "src", "tests", "world", "global-setup.ts"))
}

/** The managed config runs in `be/`, one level below the app's edition declaration. */
function isLiteApp(root: string): boolean {
  try {
    const file = join(root, "..", "hfs.json")
    const declaration: unknown = JSON.parse(readFileSync(file, "utf8"))
    return typeof declaration === "object" && declaration !== null && "edition" in declaration && declaration.edition === "lite"
  } catch {
    return false
  }
}

/** Every alternative a `{a,b}` pattern spells, braces expanded left to right. */
function braceVariants(value: string): string[] {
  const match = /{([^{}]+)}/.exec(value)
  return match ? (match[1] ?? "").split(",").flatMap((part) => braceVariants(`${value.slice(0, match.index)}${part}${value.slice(match.index + match[0].length)}`)) : [value]
}

/** The anchored RegExp of one brace-free glob over a posix path: `**` spans directories, `*` and `?` stay inside a segment. */
function globRegExp(glob: string): RegExp {
  let source = ""
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob.charAt(i)
    if (c === "*" && glob.charAt(i + 1) === "*") {
      i += 1
      if (glob.charAt(i + 1) === "/") {
        i += 1
        source += "(?:.*/)?"
      } else source += ".*"
    } else if (c === "*") source += "[^/]*"
    else if (c === "?") source += "[^/]"
    else source += /[.+^${}()|[\]\\]/.test(c) ? `\\${c}` : c
  }
  return new RegExp(`^${source}$`)
}

/**
 * True when the repository at `root` holds a file the coverage glob matches: jest refuses a threshold key that matches no covered file,
 * and a back end may have no file of a measured root yet (no projection, no integration), so a root without files gets no key (its files,
 * once added, are measured and held at 100 like every other).
 */
function hasCoverageSubjects(root: string, glob: string): boolean {
  const base = glob.slice(0, Math.max(0, glob.search(/[*?{]/))).replace(/[^/]*$/, "")
  const patterns = braceVariants(glob).map(globRegExp)
  const walk = (dir: string): boolean => {
    let entries
    try {
      entries = readdirSync(join(root, dir), { withFileTypes: true })
    } catch {
      return false
    }
    return entries.some((entry) => {
      const rel = `${dir}${entry.name}`
      if (entry.isDirectory()) return !["node_modules", "dist", "coverage"].includes(entry.name) && walk(`${rel}/`)
      return patterns.some((pattern) => pattern.test(rel))
    })
  }
  return walk(base)
}

const isList = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0)

/** A property of an unknown value, `undefined` when the value is not an object that has it. */
const fieldOf = (value: unknown, name: string): unknown => (typeof value === "object" && value !== null && name in value ? Reflect.get(value, name) : undefined)

/**
 * The scope `{ roots, roles, files, excludes }` of an options object, or a refusal: the scope is rendered by `starci app sync`, never defaulted.
 * `files` (the declared logic files) is absent from a config rendered before slots could declare them, and is then empty.
 */
function coverageOf(options: unknown): StarciCoverageScope {
  const coverage = fieldOf(options, "coverage")
  const roots = fieldOf(coverage, "roots")
  const roles = fieldOf(coverage, "roles")
  const files = fieldOf(coverage, "files") ?? []
  const excludes = fieldOf(coverage, "excludes")
  if (!coverage || !isList(roots) || !isList(roles) || !roles.length || !isList(files) || !isList(excludes)) {
    throw new Error("starciJestConfig({ coverage: { roots, roles, files, excludes } }) needs the coverage scope starci app sync renders from the slot manifest; run \"npx starci app sync --write\"")
  }
  return { roots, roles, files, excludes }
}

/** The whole jest config: projects `unit`, `integration`, `e2e` and `contract`. It takes the coverage scope the managed repository config renders; without it it refuses. */
function starciJestConfig(options: StarciJestOptions): StarciJestConfig {
  const coverage = coverageOf(options)
  const root = process.cwd()
  const world = hasTestWorld(root)
  const shared = {
    preset: "ts-jest",
    testEnvironment: "node",
    rootDir: ".",
    roots: ["<rootDir>/src", "<rootDir>/apps"],
    moduleNameMapper: { ...MODULE_NAME_MAPPER },
    transformIgnorePatterns: [...TRANSFORM_IGNORE_PATTERNS],
  }
  const suite = (displayName: string, suffix: string): StarciJestProject => ({
    ...shared,
    transform: transform("src/tests/tsconfig.json"),
    displayName,
    // A glob without the root's absolute path: jest's roots (src, apps) already bound the search, and a root path that holds a dot-named folder (a checkout under `.claude`) turns its backslash separator into a glob escape on Windows, so a path-prefixed pattern would match no file.
    testMatch: [`**/src/tests/${displayName}/**/*.${suffix}.ts`],
    // Full's world gives every spec file its own process and data slot; lite needs neither its runner nor its hooks.
    ...(world ? {
      runner: WORLD_RUNNER,
      globalSetup: "<rootDir>/src/tests/world/global-setup.ts",
      globalTeardown: "<rootDir>/src/tests/world/global-teardown.ts",
    } : {}),
  })
  const testProjects = world ? [suite("integration", "integration-spec"), suite("e2e", "e2e-spec"), suite("contract", "contract-spec")] : []
  if (!world && isLiteApp(root)) {
    for (const name of ["integration", "contract"]) {
      const suffix = `${name}-spec`
      if (hasCoverageSubjects(root, `src/tests/${name}/**/*.${suffix}.ts`)) testProjects.push(suite(name, suffix))
    }
  }
  // A shard of the managed CI (STARCI_COVERAGE_SHARD=1, one of npm test -- --shard=i/N) measures only the files its tests load, without the per-file threshold, and
  // writes istanbul JSON: the coverage job merges the shards by source location (merge.ts) and the coverage proof enforces 100 per file on the merged report. The
  // all-files instrumentation of collectCoverageFrom is off there: it instruments an unloaded file with another transform (other functions and branches).
  const shard = process.env.STARCI_COVERAGE_SHARD === "1"
  return {
    coverageProvider: "v8",
    ...(shard ? {} : {
      collectCoverageFrom: collectCoverageFrom(coverage),
      // A glob key is applied to every matching file on its own: each measured file must reach 100, not the average.
      coverageThreshold: coverageThresholdOf(coverage, root),
    }),
    coverageDirectory: "coverage",
    // lcov is what Sonar imports (coverage/lcov.info); text-summary and text are what the developer reads; a shard writes the json the merge reads.
    coverageReporters: shard ? ["text-summary", "json"] : ["text-summary", "text", [require.resolve("./lcov.js"), {}]],
    projects: [
      {
        ...shared,
        transform: unitTransform(),
        displayName: "unit",
        clearMocks: true,
        // The Outcome matchers (`toBeRefused`, `toSucceedWith`) exist in the unit project only.
        setupFilesAfterEnv: [require.resolve("./matchers.js")],
        testMatch: ["**/*.spec.ts"],
        testPathIgnorePatterns: ["/node_modules/", ...TEST_KIND_FOLDERS.map(underTests)],
      },
      // Jest validates every project's world hooks even under --selectProjects unit. An unfinished full scaffold
      // keeps only unit; a lite app's present integration/contract lanes need no test world.
      ...testProjects,
    ],
  }
}

export {
  starciJestConfig,
  TEST_KIND_FOLDERS,
  MODULE_NAME_MAPPER,
  mock,
  createMock,
  mockEntityManager,
  fakeTransaction,
  fakeQueryBuilder,
  queueQueryBuilders,
  FakeClock,
  fakeCache,
  fakeLock,
  recordingEventBus,
  recordingQueueOutbox,
  fakeInbox,
  builder,
  fakeIds,
  FakeIds,
  collectCoverageFrom,
  rootGlob,
  sonarExclusions,
  hasCoverageSubjects,
  COVERAGE_EXCLUDES,
  COVERAGE_THRESHOLD,
  UNIT_COMPILER_OPTIONS,
  WORLD_RUNNER,
}
