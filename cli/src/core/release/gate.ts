import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { withHeavySlot } from "../../harness/heavy.js"
import { inOrder } from "../../harness/sequential.js"
import { Refusal } from "../../shared/errors.js"
import { captureNpm, captureTool } from "../../shared/exec.js"
import { captureGit, refExists, repositoryRoot } from "../../shared/git.js"
import { defineVerb, WRITERS } from "../../shared/verb.js"
import { listPackages } from "../../shared/workspace.js"
import { assertPosixSh } from "../../shared/posix-sh.js"
import { installPackage, tail } from "../deps/packages.js"
import { affectedBy } from "./affected.js"
import type { Affected } from "./affected.js"
import { isHarnessCheckout } from "./harness-checkout.js"
import { bookOf, CACHED_STEPS, FORGED, hasGreen, isCachedKind, listVerifyRuns, loadPrimitives, readTreeFiles, treeKeys, verifyTrust, writeRecords } from "./check-cache.js"
import type { KeyParts, VerifyRun } from "./check-cache.js"

/**
 * The harness's own two-level gate, the harness counterpart of `app check --level dev|full`. The FAST level (`dev`) is what landing on the harness's `dev` runs once per lane, before the
 * landed packages go to the local registry: the install, build and typecheck of the packages the diff since `--base` changed and of every package
 * that needs one of them (`release affected`, CI's plan), the CLI when it is affected, the desktop app when it is, the cheap checks a publish
 * needs (built declarations name `.js` only; a package's bundled copies match the build they copy, `bundles:check`), and each of those packages'
 * own `npm test`: the same packages and the same command as CI's `package (...)` jobs on the push to dev, so a package spec the lane breaks is red
 * here, before the landing, and never first in dev's CI. The CLI's own suite, lint and the light gates are not run at this level. The FULL level runs
 * once at the train's dev -> main merge, before npm: every package and the CLI, with their lint and their tests, and CI's light gates (anatomy,
 * loosening, secrets, shape, pins, heavy sites, anchors, search index).
 */
export type HarnessLevel = "dev" | "full"

/** One step of the gate: where it runs and what it runs. */
export interface GateStep {
    readonly dir: string
    readonly kind: "install" | "build" | "typecheck" | "declarations" | "bundles" | "lint" | "test" | "check"
    /** A `check` step: the CLI verb CI's gates job runs (`check shape`, `contexts anchor`, ...). */
    readonly args?: readonly string[]
}

/** One blocking finding of the gate, in the shape `lane gate` reads (`level: error`, a path under the folder that failed). */
export interface GateFinding {
    readonly level: "error"
    readonly code: string
    readonly path: string
    readonly message: string
}

/** The light gates of ci.yml's `gates` job, each a verb of the tree's own built CLI. */
export const CI_LIGHT_GATES: readonly (readonly string[])[] = [
    ["contexts", "anatomy"],
    ["check", "loosening"],
    ["check", "secrets", "--all"],
    ["check", "shape"],
    ["check", "pins"],
    ["check", "heavy-sites"],
    ["contexts", "anchor"],
    ["contexts", "search"],
]

const CLI_DIR = "cli"
const APP_DIR = "app"

/**
 * The steps of one gate over a plan, in order and each once: every folder of a package's build order is installed and built before the package's own
 * typecheck and publish checks (its built declarations when it builds, its `bundles:check` when it has one), then, at full only, its lint, and at
 * both levels its `npm test` when it declares one (CI's `package (...)` job of the same plan runs exactly that);
 * the CLI is installed, built and typechecked when the plan names it (linted and tested at full only); the desktop app is installed and built after
 * the packages it needs; the full level then runs CI's light gates with the tree's built CLI. `scriptsOf` reads a folder's npm scripts: a step whose
 * script a folder lacks is left out. Pure.
 */
export const harnessGateSteps = (
    plan: Pick<Affected, "packages" | "harness" | "app" | "appBuild">,
    level: HarnessLevel,
    scriptsOf: (dir: string) => Readonly<Record<string, string>>,
): GateStep[] => {
    const steps: GateStep[] = []
    const prepared = new Set<string>()
    const prepare = (dir: string): void => {
        if (prepared.has(dir)) return
        prepared.add(dir)
        steps.push({ dir, kind: "install" })
        if (scriptsOf(dir).build !== undefined) steps.push({ dir, kind: "build" })
    }
    const own = (dir: string): void => {
        const scripts = scriptsOf(dir)
        if (scripts.typecheck !== undefined) steps.push({ dir, kind: "typecheck" })
        if (dir !== CLI_DIR && scripts.build !== undefined) steps.push({ dir, kind: "declarations" })
        if (scripts["bundles:check"] !== undefined) steps.push({ dir, kind: "bundles" })
        if (level === "full" && scripts.lint !== undefined) steps.push({ dir, kind: "lint" })
        if (dir === CLI_DIR ? level === "full" : scripts.test !== undefined) steps.push({ dir, kind: "test" })
    }
    for (const pkg of plan.packages) {
        for (const dir of pkg.build) prepare(dir)
        own(pkg.dir)
    }
    const cli = plan.harness || level === "full"
    if (cli) {
        prepare(CLI_DIR)
        own(CLI_DIR)
    }
    if (plan.app) {
        for (const dir of plan.appBuild) prepare(dir)
        prepare(APP_DIR)
    }
    if (level === "full") for (const args of CI_LIGHT_GATES) steps.push({ dir: ".", kind: "check", args })
    return steps
}

/** How one step ran: green, or red with the output that says why. */
export interface StepRun {
    readonly ok: boolean
    readonly output: string
}

/** The seam a spec replaces: runs one step in the repository `root`. */
export type StepRunner = (root: string, step: GateStep) => Promise<StepRun>

const npmStep = async (root: string, dir: string, kind: "tsc" | "eslint" | "test" | "build", script: string): Promise<StepRun> => {
    const folder = join(root, dir)
    const run = await withHeavySlot(kind, `release gate: npm run ${script} ${dir}`, folder, {}, (held) => captureNpm(["run", script], folder, held.options))
    // A test run hands back its whole output: the names of its failed tests sit anywhere in it, and failureMessage keeps the names and the last lines.
    return { ok: run.exitCode === 0, output: kind === "test" ? [run.stdout, run.stderr].join("\n") : tail(run.stdout, run.stderr) }
}

/** A built declaration that imports a `.ts` specifier, which a consumer's tsc cannot read (ci.yml "Declarations name .js", packages/README.md). */
const TS_SPECIFIER = /(from |import\()["']\.\.?\/[^"']+\.ts["']/

/** The built declarations under `folder`/dist that import a `.ts` specifier, as `dist/<file>:<line>`; none when it has no dist. */
export const tsSpecifierDeclarations = (folder: string): string[] => {
    const dist = join(folder, "dist")
    if (!existsSync(dist)) return []
    const hits: string[] = []
    for (const file of readdirSync(dist, { recursive: true, encoding: "utf8" })) {
        if (!file.endsWith(".d.ts")) continue
        readFileSync(join(dist, file), "utf8")
            .split("\n")
            .forEach((line, index) => {
                if (TS_SPECIFIER.test(line)) hits.push(`dist/${file.replaceAll("\\", "/")}:${String(index + 1)}`)
            })
    }
    return hits
}

/** The real steps: npm in the folder under the heavy-command governor; the CLI's tests over its build, as CI's harness job runs them. */
export const runStep: StepRunner = async (root, step) => {
    const folder = join(root, step.dir)
    try {
        if (step.kind === "install") {
            await installPackage({ name: step.dir, folder })
            return { ok: true, output: "" }
        }
        if (step.kind === "build") return await npmStep(root, step.dir, "build", "build")
        if (step.kind === "typecheck") return await npmStep(root, step.dir, "tsc", "typecheck")
        if (step.kind === "declarations") {
            const hits = tsSpecifierDeclarations(folder)
            return { ok: hits.length === 0, output: hits.length === 0 ? "" : `a built declaration imports a .ts specifier: ${hits.slice(0, 10).join(", ")}` }
        }
        if (step.kind === "bundles") return await npmStep(root, step.dir, "build", "bundles:check")
        if (step.kind === "lint") return await npmStep(root, step.dir, "eslint", "lint")
        if (step.kind === "test" && step.dir === CLI_DIR) {
            const run = await withHeavySlot("test", "release gate: the CLI's tests", folder, {}, (held) => captureTool(process.execPath, ["--test", "--test-concurrency=2", "dist/**/*.test.js"], folder, held.options))
            return { ok: run.exitCode === 0, output: tail(run.stdout, run.stderr) }
        }
        if (step.kind === "test") return await npmStep(root, step.dir, "test", "test")
        const run = await captureTool(process.execPath, [join(root, CLI_DIR, "dist", "main.js"), ...(step.args ?? [])], root)
        return { ok: run.exitCode === 0, output: tail(run.stdout, run.stderr) }
    } catch (error) {
        return { ok: false, output: error instanceof Error ? error.message : String(error) }
    }
}

/** How one step ended: green or red, skipped behind a red build, or reused from a green record (or unneeded preparation) without running. */
export type StepOutcome = boolean | "skipped" | "reused"

/** What one gate did. */
export interface HarnessGate {
    readonly level: HarnessLevel
    readonly base: string | null
    readonly head: string
    readonly summary: readonly string[]
    readonly steps: readonly (GateStep & { readonly ok: StepOutcome })[]
    readonly findings: readonly GateFinding[]
    readonly verdict: "green" | "red"
}

const codeOf = (step: GateStep): string => `HARNESS_GATE_${step.kind.toUpperCase()}`

/** A failed test in `node --test` output: a TAP `not ok N - <name>` line, or a spec reporter `✖ <name> (<ms>)` line. */
const TAP_FAIL = /^\s*not ok \d+ - (.+?)\s*(?:#.*)?$/
const SPEC_FAIL = /^\s*✖ (.+?)(?: \([\d.]+m?s\))?\s*$/
/** Spec reporter headings that are not tests. */
const NOT_A_TEST = /^(?:failing tests:?|fail(?:ed)? \d+)$/i
/** How many failing test names a finding lists, and how long a finding may grow (a test's: the names, then the last lines of its run). */
const NAMED_FAILURES = 8
/** How many of a red test's last lines its finding keeps and a report prints under it. */
const TAIL_LINES = 15
const TEST_FINDING_CHARS = 2400
const FINDING_CHARS = 600

/**
 * The names of the failed tests in the output of a package's `npm test`, in order and each once: node's TAP and spec reporters both mark a
 * failed test (and the suite holding it) on a line of its own. Empty when the run failed before any test ran (a typecheck, a lint). Pure.
 */
export const failingTests = (output: string): string[] => {
    const names: string[] = []
    for (const line of output.split(/\r?\n/)) {
        const name = (TAP_FAIL.exec(line) ?? SPEC_FAIL.exec(line))?.[1]?.trim()
        if (name === undefined || name === "" || NOT_A_TEST.test(name) || names.includes(name)) continue
        names.push(name)
    }
    return names
}

/** The message of a red step; a red test's first line names its failing tests and the lines after it are the run's last lines. Pure. */
export const failureMessage = (step: GateStep, output: string): string => {
    const head = `${step.kind}${step.args === undefined ? "" : ` ${step.args.join(" ")}`} in ${step.dir} failed`
    if (step.kind !== "test") return `${head}: ${output}`.slice(0, FINDING_CHARS)
    const names = failingTests(output)
    const named =
        names.length === 0
            ? "no failing test named (the run stopped before or outside its tests: see its last lines)"
            : `${String(names.length)} failing: ${names.slice(0, NAMED_FAILURES).join("; ")}${names.length > NAMED_FAILURES ? `; +${String(names.length - NAMED_FAILURES)} more` : ""}`
    const lines = output.split(/\r?\n/).filter((line) => line.trim() !== "")
    // The last lines are kept whole when the output is long: the cut falls on the oldest lines, never on the end of the run.
    let tail = lines.slice(-TAIL_LINES).join("\n")
    while (tail.length + named.length + head.length > TEST_FINDING_CHARS && tail.includes("\n")) tail = tail.slice(tail.indexOf("\n") + 1)
    return `${head}: ${named}\n${tail}`.slice(0, TEST_FINDING_CHARS)
}

/**
 * The report lines of one finding: its code, folder and first line; a red test (HARNESS_GATE_TEST) also prints, indented, the last lines of its
 * run, so the refusal shows what broke without opening a log. `lane gate` prints its findings with this too. Pure.
 */
export const findingLines = (finding: { readonly code: string; readonly path: string; readonly message: string }): string[] => {
    const [first = "", ...rest] = finding.message.split("\n")
    const head = `  ${finding.code} ${finding.path} ${first}`.trimEnd()
    if (finding.code !== codeOf({ dir: "", kind: "test" })) return [head]
    return [head, ...rest.filter((line) => line.trim() !== "").slice(-TAIL_LINES).map((line) => `      ${line.trimEnd()}`)]
}

/**
 * The folders a gate must install and build for the steps that run: for every step that is not reused (`reused[i]`), the build order of its folder (a
 * package's, the desktop app's after the packages it needs, the CLI alone), and the CLI for the light gates, which run its build. An install or build
 * of a folder outside this set is only preparation nobody needs (its own build verdict reused), so the gate skips it. Pure.
 */
export const neededFolders = (steps: readonly GateStep[], reused: readonly boolean[], plan: Pick<Affected, "packages" | "appBuild">): Set<string> => {
    const orders = new Map(plan.packages.map((pkg) => [pkg.dir, pkg.build]))
    const orderOf = (dir: string): readonly string[] => orders.get(dir) ?? (dir === APP_DIR ? [...plan.appBuild, APP_DIR] : [dir])
    const needed = new Set<string>()
    steps.forEach((step, index) => {
        if (step.kind === "install" || reused[index] === true) return
        for (const dir of step.kind === "check" ? [CLI_DIR] : orderOf(step.dir)) needed.add(dir)
    })
    return needed
}

/**
 * Runs the steps in order. A red install or build of a folder skips every later step in that folder and in each package whose build order needs it,
 * since they would only repeat its failure; every other step still runs, so one gate names every red folder at once. `reusable` says which steps a
 * green record of the harness check cache already proves for the tree (check-cache.ts): those report `reused` and run nothing, and the installs and
 * builds no running step needs are skipped with them (`neededFolders`).
 */
export const runHarnessGate = async (root: string, plan: Affected, level: HarnessLevel, scriptsOf: (dir: string) => Readonly<Record<string, string>>, run: StepRunner = runStep, say: (line: string) => void = () => undefined, reusable: (step: GateStep) => boolean = () => false): Promise<HarnessGate> => {
    const steps = harnessGateSteps(plan, level, scriptsOf)
    const reused = steps.map((step) => isCachedKind(step.kind) && reusable(step))
    const needed = neededFolders(steps, reused, plan)
    const broken = new Set<string>()
    const needs = new Map(plan.packages.map((pkg) => [pkg.dir, pkg.build]))
    const outcomes: (GateStep & { ok: StepOutcome })[] = []
    const failures: (GateFinding | undefined)[] = []
    // A typecheck reads what its folder and the packages of its build order built before it, and writes nothing, so it starts at its place in the order and the next
    // steps go on while it runs: the typechecks of the folders run together, each tsc taking its own heavy slot (cli/src/harness/heavy.ts), so the host's slots bound them.
    const pending: Promise<void>[] = []
    const record = (index: number, step: GateStep, result: StepRun): void => {
        outcomes[index] = { ...step, ok: result.ok }
        if (!result.ok) failures[index] = { level: "error", code: codeOf(step), path: step.dir, message: failureMessage(step, result.output) }
    }
    const execute = async (index: number, step: GateStep): Promise<void> => {
        say(`${step.kind} ${step.dir}${step.args === undefined ? "" : ` (${step.args.join(" ")})`}`)
        record(index, step, await run(root, step))
    }
    try {
        await inOrder(steps.map((step, index) => ({ step, index })), async ({ step, index }) => {
            const prepOnly = step.kind === "install" || step.kind === "build"
            if ((reused[index] === true || step.kind === "install") && !(prepOnly && needed.has(step.dir))) {
                outcomes[index] = { ...step, ok: "reused" }
                return
            }
            const blocked = broken.has(step.dir) || (needs.get(step.dir) ?? []).some((dir) => dir !== step.dir && broken.has(dir)) || (step.kind === "check" && broken.has(CLI_DIR))
            if (blocked) {
                outcomes[index] = { ...step, ok: "skipped" }
                return
            }
            if (step.kind === "typecheck") {
                pending.push(execute(index, step))
                return
            }
            await execute(index, step)
            if (outcomes[index]?.ok === false && (step.kind === "install" || step.kind === "build")) broken.add(step.dir)
        })
    } finally {
        await Promise.allSettled(pending)
    }
    await Promise.all(pending)
    const findings = failures.filter((each): each is GateFinding => each !== undefined)
    return { level, base: plan.base, head: plan.head, summary: plan.summary, steps: outcomes, findings, verdict: findings.length === 0 ? "green" : "red" }
}

/** The harness check cache as one gate uses it: which steps it reuses, and the records it writes afterwards. */
interface GateCache {
    readonly line: string
    readonly forged: readonly GateFinding[]
    readonly reusable: (step: GateStep) => boolean
    readonly record: (gate: HarnessGate) => Promise<{ readonly files: readonly string[]; readonly contradicted: readonly GateFinding[] }>
}

/**
 * Opens the harness check cache for a gate over `root` (contexts/harness/check-cache.md): every node's key over the work tree, and the committed records,
 * each checked (an edited or malformed record is a HARNESS_CHECK_CACHE_FORGED finding and is never reused). The FAST level trusts the work tree's records,
 * as an app's host run does; the full level trusts them only while the nightly verify (`cache-verify.yml`) is green or has not run, and `--fresh` trusts
 * none. After the gate, every cached step that ran green writes its record, and a step that ran red under a key a committed record claims green is a
 * FORGED finding, its record removed.
 */
export const openGateCache = async (root: string, plan: Pick<Affected, "graph">, level: HarnessLevel, fresh: boolean, head: string, runs: () => Promise<VerifyRun[] | undefined> = () => listVerifyRuns(root)): Promise<GateCache> => {
    const p = await loadPrimitives()
    const keys = await treeKeys(root, plan.graph)
    const book = bookOf(readTreeFiles(root), p)
    const trust = fresh ? { trusted: false, reason: "--fresh: every step runs" } : level === "full" ? verifyTrust(await runs(), head) : { trusted: true, reason: "the work tree's records (the FAST level)" }
    const stepOf = (step: GateStep): string | undefined => (isCachedKind(step.kind) ? CACHED_STEPS[step.kind] : undefined)
    const keyOfStep = (step: GateStep): string | undefined => {
        const name = stepOf(step)
        return name === undefined ? undefined : keys.key(step.dir, name)
    }
    return {
        line: trust.reason,
        forged: book.forged,
        reusable: (step) => {
            const name = stepOf(step)
            const key = keyOfStep(step)
            return trust.trusted && name !== undefined && key !== undefined && hasGreen(book, name, step.dir, key)
        },
        record: async (gate) => {
            const green: { dir: string; step: string; parts: KeyParts }[] = []
            const red: { dir: string; step: string }[] = []
            const contradicted: GateFinding[] = []
            for (const step of gate.steps) {
                const name = stepOf(step)
                const parts = keys.parts.get(step.dir)
                const key = keyOfStep(step)
                if (name === undefined || parts === undefined || key === undefined) continue
                if (step.ok === true) green.push({ dir: step.dir, step: name, parts })
                if (step.ok === false && hasGreen(book, name, step.dir, key)) {
                    red.push({ dir: step.dir, step: name })
                    contradicted.push({ level: "error", code: FORGED, path: step.dir, message: `the committed record of ${step.dir} ${name} says green under the key this tree computes, and the step ran red: the record was forged or the step is not deterministic` })
                }
            }
            return { files: await writeRecords(root, green, red), contradicted }
        },
    }
}

/** The base of a FAST gate when none is given: where HEAD forks from origin/dev (the branch it lands on), else from origin/main. */
const defaultBase = async (root: string): Promise<string | undefined> => {
    for (const trunk of ["origin/dev", "origin/main"]) {
        if (!(await refExists(root, trunk))) continue
        const fork = await captureGit(["merge-base", "HEAD", trunk], root)
        if (fork.exitCode === 0 && fork.stdout.trim() !== "") return fork.stdout.trim()
    }
    return undefined
}

/** What the deprecated `starci release gate` prints on stderr before it runs `starci check` with the same flags. */
export const renamedGateNotice = (level: string | undefined): string => `renamed: use starci check${level === "full" ? " --release" : ""}`

/**
 * `starci check [--release]`: the harness's own check (contexts/project/branches.md PROJECT-BRANCH-3). `--level dev` (the default) is the FAST level
 * `lane gate` runs when the harness lands on dev (the affected packages' own `npm test`, as CI's package jobs; not the CLI's suite); `--release`, the same
 * as `--level full`, is the check of the train's dev -> main merge, tests included. `starci release gate` is its deprecated spelling.
 */
export const checkVerb = defineVerb({
    path: ["check"],
    summary: "the harness's own check (starci release gate is its deprecated spelling): --release (= --level full, the train's dev -> main merge) every package and the CLI with lint and tests, then CI's light gates; --level dev (default, the FAST level of a landing on dev) installs, builds and typechecks the packages changed since --base and their dependents, the CLI and the desktop app when affected, runs the publish checks (declarations name .js, bundles:check) and each of those packages' own npm test (CI's package jobs; not the CLI's suite); --level full (the train's dev -> main merge) every package and the CLI with lint and tests, then CI's light gates",
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/release-gate@1",
    flags: {
        release: { kind: "boolean", summary: "the release check of the train: the same as --level full" },
        level: { kind: "string", summary: "dev (default: the packages changed since --base and their dependents, built, typechecked and their npm test run) or full (everything, with lint, tests and CI's light gates)" },
        base: { kind: "string", summary: "the commit the FAST level measures from (default: where HEAD forks from origin/dev, else origin/main); the full level ignores it" },
        fresh: { kind: "boolean", summary: "ignore the harness check cache (.cache/check): run every step, rewrite the records, and report a committed record the run contradicts as HARNESS_CHECK_CACHE_FORGED (the nightly verify runs --level full --fresh)" },
    },
    run: async (context, flags) => {
        if (flags.release === true && flags.level !== undefined && flags.level !== "full") throw new Refusal("CLI_USAGE", `--release is the full level; it takes no --level ${flags.level}`)
        const level = flags.release === true ? "full" : (flags.level ?? "dev")
        if (level !== "dev" && level !== "full") throw new Refusal("CLI_USAGE", `--level is dev or full, not "${level}"`)
        assertPosixSh("check")
        const root = await repositoryRoot(context.cwd)
        if (!isHarnessCheckout(root)) throw new Refusal("RELEASE_GATE_NOT_HARNESS", `${root} is not the harness checkout (cli/, contexts/README.md, packages/); an app checks with starci app check [--level dev|full] [--release]`)
        const base = level === "full" ? undefined : (flags.base ?? (await defaultBase(root)))
        const plan = await affectedBy(root, base ?? "", undefined)
        const all = listPackages(root)
        const scriptsOf = (dir: string): Readonly<Record<string, string>> => all.find((pkg) => pkg.relativeDir === dir)?.scripts ?? {}
        const cache = await openGateCache(root, plan, level, flags.fresh === true, plan.head)
        const gate = await runHarnessGate(root, plan, level, scriptsOf, runStep, context.progress, cache.reusable)
        const written = await cache.record(gate)
        const findings = [...gate.findings, ...cache.forged, ...written.contradicted]
        const verdict = findings.length === 0 ? "green" : "red"
        const ran = gate.steps.filter((step) => step.ok === true || step.ok === false).length
        const reusedCount = gate.steps.filter((step) => step.ok === "reused").length
        const skipped = gate.steps.filter((step) => step.ok === "skipped").length
        const lines = [
            ...gate.summary,
            `cache: ${cache.line}; ${String(reusedCount)} step(s) reused, ${String(written.files.length)} record file(s) written`,
            `${level} gate ${verdict}: ${String(ran)} step(s) ran, ${String(reusedCount)} reused, ${String(skipped)} skipped behind a red build`,
            ...findings.flatMap((finding) => findingLines(finding)),
        ]
        const data: HarnessGate & { readonly cache: { readonly line: string; readonly written: readonly string[] } } = { ...gate, findings, verdict, cache: { line: cache.line, written: written.files } }
        return { data, message: lines.join("\n"), exitCode: verdict === "green" ? 0 : 1 }
    },
})

/** `starci release gate`: the deprecated spelling of `starci check`; it prints the rename on stderr and runs the same check with the same flags. */
export const releaseGateVerb = defineVerb({
    ...checkVerb,
    path: ["release", "gate"],
    summary: "renamed: use starci check (--level dev) or starci check --release (--level full); this deprecated spelling prints the rename and runs the same check",
    run: async (context, flags) => {
        process.stderr.write(`${renamedGateNotice(flags.release === true ? "full" : flags.level)}\n`)
        return checkVerb.run(context, flags)
    },
})
