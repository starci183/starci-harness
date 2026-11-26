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
        const tested = dir === CLI_DIR ? level === "full" : scripts.test !== undefined
        // A step the package's own `npm test` already runs (`npm run typecheck && npm run lint && ...`) runs once, inside that test.
        const inTest = (script: string): boolean => tested && new RegExp(String.raw`\bnpm run ${script}\b`).test(scripts.test ?? "")
        if (scripts.typecheck !== undefined && !inTest("typecheck")) steps.push({ dir, kind: "typecheck" })
        if (dir !== CLI_DIR && scripts.build !== undefined) steps.push({ dir, kind: "declarations" })
        if (scripts["bundles:check"] !== undefined) steps.push({ dir, kind: "bundles" })
        if (level === "full" && scripts.lint !== undefined && !inTest("lint")) steps.push({ dir, kind: "lint" })
        if (tested) steps.push({ dir, kind: "test" })
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

/** What one gate did. */
export interface HarnessGate {
    readonly level: HarnessLevel
    readonly base: string | null
    readonly head: string
    readonly summary: readonly string[]
    readonly steps: readonly (GateStep & { readonly ok: boolean | "skipped" })[]
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
 * Runs the steps in order. A red install or build of a folder skips every later step in that folder and in each package whose build order needs it,
 * since they would only repeat its failure; every other step still runs, so one gate names every red folder at once.
 */
export const runHarnessGate = async (root: string, plan: Affected, level: HarnessLevel, scriptsOf: (dir: string) => Readonly<Record<string, string>>, run: StepRunner = runStep, say: (line: string) => void = () => undefined): Promise<HarnessGate> => {
    const steps = harnessGateSteps(plan, level, scriptsOf)
    const broken = new Set<string>()
    const needs = new Map(plan.packages.map((pkg) => [pkg.dir, pkg.build]))
    const outcomes: (GateStep & { ok: boolean | "skipped" })[] = []
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
        const gate = await runHarnessGate(root, plan, level, scriptsOf, runStep, context.progress)
        const ran = gate.steps.filter((step) => step.ok !== "skipped").length
        const lines = [
            ...gate.summary,
            `${level} gate ${gate.verdict}: ${String(ran)} step(s) ran, ${String(gate.steps.length - ran)} skipped behind a red build`,
            ...gate.findings.flatMap((finding) => findingLines(finding)),
        ]
        return { data: gate, message: lines.join("\n"), exitCode: gate.verdict === "green" ? 0 : 1 }
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
