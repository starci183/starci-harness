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
 * The harness's own two-level gate, the harness counterpart of `app check --level dev|full` (owner: "rules là k check nhánh khi dev, khi nào
 * push mới check tổng 1 lần sửa 1 lần vẫn hơn"). The FAST level (`dev`) is what landing on the harness's `dev` runs once per batch, before the
 * landed packages go to the local registry: the install, build and typecheck of the packages the diff since `--base` changed and of every package
 * that needs one of them (`release affected`, CI's plan), the CLI when it is affected, the desktop app when it is, and the cheap checks a publish
 * needs (built declarations name `.js` only; a package's bundled copies match the build they copy, `bundles:check`). It runs NO test suite: tests
 * belong to the release line. The FULL level runs once at the train's dev -> main merge, before npm: every package and the CLI, with their lint
 * and their tests, and CI's light gates (anatomy, loosening, secrets, shape, pins, heavy sites, anchors, search index).
 */
export type HarnessLevel = "dev" | "full"

/** One step of the gate: where it runs and what it runs. */
export interface GateStep {
    readonly dir: string
    readonly kind: "install" | "build" | "typecheck" | "declarations" | "bundles" | "lint" | "test" | "check"
    /** A `check` step: the CLI verb CI's gates job runs (`check shape`, `contexts anchor`, ...). */
    readonly args?: readonly string[]
}

/** One blocking finding of the gate, in the shape the batch lander reads (`level: error`, a path under the folder that failed). */
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
 * typecheck and publish checks (its built declarations when it builds, its `bundles:check` when it has one), then, at full only, its lint and tests;
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
        if (level !== "full") return
        if (scripts.lint !== undefined) steps.push({ dir, kind: "lint" })
        if (scripts.test !== undefined || dir === CLI_DIR) steps.push({ dir, kind: "test" })
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
    return { ok: run.exitCode === 0, output: tail(run.stdout, run.stderr) }
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
        if (!result.ok) failures[index] = { level: "error", code: codeOf(step), path: step.dir, message: `${step.kind}${step.args === undefined ? "" : ` ${step.args.join(" ")}`} in ${step.dir} failed: ${result.output}`.slice(0, 600) }
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

/**
 * `starci release gate`: the harness's own gate (contexts/project/branches.md PROJECT-BRANCH-3). `--level dev` (the default) is the FAST level the
 * batch lander and `lane gate` run when the harness lands on dev (no test suite); `--level full` is the gate of the train's dev -> main merge, tests included.
 */
export const releaseGateVerb = defineVerb({
    path: ["release", "gate"],
    summary: "the harness's own gate: --level dev (default, the FAST level of a landing on dev) installs, builds and typechecks the packages changed since --base and their dependents, the CLI and the desktop app when affected, and runs the publish checks (declarations name .js, bundles:check), no test suite; --level full (the train's dev -> main merge) every package and the CLI with lint and tests, then CI's light gates",
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/release-gate@1",
    flags: {
        level: { kind: "string", summary: "dev (default: the packages changed since --base and their dependents, built and typechecked, no tests) or full (everything, with lint, tests and CI's light gates)" },
        base: { kind: "string", summary: "the commit the FAST level measures from (default: where HEAD forks from origin/dev, else origin/main); the full level ignores it" },
    },
    run: async (context, flags) => {
        const level = flags.level ?? "dev"
        if (level !== "dev" && level !== "full") throw new Refusal("CLI_USAGE", `--level is dev or full, not "${level}"`)
        assertPosixSh("release gate")
        const root = await repositoryRoot(context.cwd)
        if (!isHarnessCheckout(root)) throw new Refusal("RELEASE_GATE_NOT_HARNESS", `${root} is not the harness checkout (cli/, contexts/README.md, packages/); an app gates with starci app check --level dev|full`)
        const base = level === "full" ? undefined : (flags.base ?? (await defaultBase(root)))
        const plan = await affectedBy(root, base ?? "", undefined)
        const all = listPackages(root)
        const scriptsOf = (dir: string): Readonly<Record<string, string>> => all.find((pkg) => pkg.relativeDir === dir)?.scripts ?? {}
        const gate = await runHarnessGate(root, plan, level, scriptsOf, runStep, context.progress)
        const ran = gate.steps.filter((step) => step.ok !== "skipped").length
        const lines = [
            ...gate.summary,
            `${level} gate ${gate.verdict}: ${String(ran)} step(s) ran, ${String(gate.steps.length - ran)} skipped behind a red build`,
            ...gate.findings.map((finding) => `  ${finding.code} ${finding.path}: ${finding.message.split("\n")[0] ?? ""}`),
        ]
        return { data: gate, message: lines.join("\n"), exitCode: gate.verdict === "green" ? 0 : 1 }
    },
})
