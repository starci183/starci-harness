import { canonOf, loadPolicy, resolveProfile } from "../../harness/policy.js"
import type { Policy, RuntimeGate } from "../../harness/policy.js"
import type { RunOptions } from "../../shared/exec.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"
import { baseCwd, judgeAgainstRuns, judgedAgainstBase, runAtBase } from "./base-findings.js"
import type { BaseJudgement, BaseRun } from "./base-findings.js"
import { canonPackage } from "./canon.js"
import type { CanonByTool } from "./canon.js"
import { describeLoosening, scanLoosening } from "./loosening-scan.js"
import { relaySources } from "./relay-baseline.js"
import { describeScope, describeStep, lintPackage, resolveScope, typecheckPackage } from "./scope.js"
import type { Judging, Scope, ScopeTarget, StepResult } from "./scope.js"
import { describeSecrets, scanSecrets } from "./secrets-scan.js"
import { treeFiles } from "./tree-files.js"
import { DEP_BUILD_FAILED, buildWorkspaceDependencies } from "./workspace-deps.js"
import type { DependencyBuilds } from "./workspace-deps.js"
import { inOrder } from "../../harness/sequential.js"
import { checkDigest, greenRow, recordGreen } from "../../harness/check-reuse.js"
import { listPackages } from "../../shared/workspace.js"
import { locateTree } from "../../shared/tree.js"

/** The verdict of one repository gate: it judges the tree (loosening) or the judged files (secrets), not one package. */
interface GateResult {
    readonly gate: RuntimeGate
    readonly status: "green" | "red"
    readonly findings: number
    readonly output: string
}

interface RunData {
    readonly scope: Scope
    readonly profile: { readonly name: string; readonly source: string }
    readonly policy: { readonly dir: string; readonly overlay: string | null; readonly ci: Readonly<Record<string, unknown>> }
    readonly tiers: { readonly runtime: readonly RuntimeGate[]; readonly ci: readonly string[] }
    readonly canon: CanonByTool
    readonly verdict: "green" | "red"
    readonly gates: readonly GateResult[]
    readonly steps: readonly StepResult[]
    /** The findings already at a base (base-findings.ts): a widened run's base, a relayed source's head. Evidence, never this change's red. */
    readonly baseline: BaseJudgement | null
}

/** The repository gates, run once per check; the package gates run once per package of the scope. */
const REPOSITORY_GATES: ReadonlySet<RuntimeGate> = new Set<RuntimeGate>(["secrets", "loosening"])

/** One repository gate over the tree (loosening) or the judged files (secrets). */
const repositoryGate = async (gate: RuntimeGate, scope: Scope, policy: Policy, profile: string, all: boolean): Promise<GateResult> => {
    if (gate === "secrets") {
        const files = all ? await treeFiles(scope.root) : scope.files
        const report = scanSecrets(scope.root, files, policy, profile, all)
        return { gate, status: report.verdict, findings: report.findings.length + report.stale.length + report.unjudged.length, output: describeSecrets(report).join("\n") }
    }
    const report = await scanLoosening(scope.root, policy)
    return { gate, status: report.verdict, findings: report.findings.length + report.stale.length + report.unjudged.length, output: describeLoosening(report).join("\n") }
}

/** The package gates that read a package's imports, so they run against its workspace dependencies built (workspace-deps.ts). */
const IMPORT_GATES: ReadonlySet<RuntimeGate> = new Set<RuntimeGate>(["typecheck", "lint"])

/** A gate a workspace dependency that did not build holds back: run, it would only report the module it lacks. */
const heldStep = (gate: "typecheck" | "lint", target: ScopeTarget, unbuilt: readonly string[]): StepResult => ({
    package: target.pkg.name,
    step: gate,
    command: "-",
    status: "skipped",
    reason: `${DEP_BUILD_FAILED}: held, its workspace dependency ${unbuilt.join(", ")} did not build`,
    output: "",
})

/**
 * A typecheck or lint step whose inputs (harness/check-reuse.ts checkDigest) match a green row of the project's ledger is that row,
 * reused and never rerun; a step that runs and is green is recorded for the next round (a wave, Debug's scoped round, a push).
 */
const reusing = async (gate: "typecheck" | "lint", scope: Scope, target: ScopeTarget, run: () => Promise<StepResult>): Promise<StepResult> => {
    // The composition a lint judges by (a deferral, the modules judged in full) is part of what the step checks.
    const digest = await checkDigest(scope.root, listPackages(scope.root), target.pkg, gate, `${gate} ${JSON.stringify(scope.composition)}`, target.files, scope.all)
    const row = greenRow(scope.root, digest)
    if (row !== undefined) return { package: target.pkg.name, step: gate, command: row.command, status: "green", reason: `reused: green row ${digest.slice(0, 12)} of ${row.at}, inputs unchanged (${row.reason})`, output: "" }
    const result = await run()
    if (result.status === "green") recordGreen(scope.root, digest, gate, target.pkg.name, result.command, result.reason)
    return result
}

/** The package step a gate of the tier runs on one target, as a task; the repository gates run no package step. */
const packageStep = (gate: RuntimeGate, scope: Scope, target: ScopeTarget, canon: CanonByTool, builds: DependencyBuilds, options: RunOptions): (() => Promise<StepResult>)[] => {
    const unbuilt = builds.unbuilt(target.pkg)
    switch (gate) {
        case "canon":
            return [() => Promise.resolve(canonPackage(scope, target, canon))]
        case "typecheck":
            return [() => (unbuilt.length > 0 ? Promise.resolve(heldStep(gate, target, unbuilt)) : reusing(gate, scope, target, () => typecheckPackage(scope, target, options)))]
        case "lint":
            return [() => (unbuilt.length > 0 ? Promise.resolve(heldStep(gate, target, unbuilt)) : reusing(gate, scope, target, () => lintPackage(scope, target, options)))]
        case "secrets":
        case "loosening":
            return []
    }
}

/** No dependency prepared: a tier without typecheck or lint reads no import. */
const NO_BUILDS: DependencyBuilds = { steps: [], unbuilt: () => [] }

/** The finding count of a gate as the suffix of its line. */
const findingSuffix = (gate: GateResult): string => (gate.findings === 0 ? "" : ` ${String(gate.findings)} finding(s)`)

/** A red repository gate as a step, so a verify that reads only steps still shows why it is red. */
const asStep = (gate: GateResult): StepResult => ({ package: "(repository)", step: gate.gate, command: `starci check ${gate.gate}`, status: gate.status, reason: "", output: gate.output })

/** The flags of `check run` a tier run reads. */
interface TierFlags {
    readonly base?: string | undefined
    readonly all: boolean
    readonly task?: string | undefined
    readonly workflow?: string | undefined
    readonly within: boolean
    readonly wave?: string | undefined
    readonly paths: readonly string[]
}

/** Whom the flags judge as: a task, a workflow's final verify or a wave's tasks (scope.ts Judging). */
const judgingOf = (flags: TierFlags): Judging => ({
    ...(flags.task === undefined ? {} : { task: flags.task }),
    ...(flags.workflow === undefined ? {} : { workflow: flags.workflow }),
    ...(flags.wave === undefined ? {} : { wave: flags.wave.split(",").filter((id) => id !== "") }),
})

/** One run of the profile's runtime tier from `cwd`: the scope, the repository gates, then each package step. */
const runTier = async (cwd: string, treeRoot: string | undefined, flags: TierFlags) => {
    const scope = await resolveScope(cwd, flags.base, flags.all, flags.paths, judgingOf(flags), flags.within)
    const policy = loadPolicy(scope.root)
    const choice = resolveProfile(policy, treeRoot)
    const tier = choice.profile.runtime
    const canon = canonOf(policy, choice.profile)
    const options = { timeoutMs: policy.quality.runtime.stepTimeoutSeconds * 1000 }
    const gates = await inOrder(tier.filter((name) => REPOSITORY_GATES.has(name)), (gate) => repositoryGate(gate, scope, policy, choice.name, flags.all))
    const builds = tier.some((gate) => IMPORT_GATES.has(gate)) ? await buildWorkspaceDependencies(scope, options) : NO_BUILDS
    const gated = await inOrder(scope.targets.flatMap((target) => tier.flatMap((gate) => packageStep(gate, scope, target, canon, builds, options))), (step) => step())
    return { scope, policy, choice, tier, canon, gates, steps: [...builds.steps, ...gated] }
}

/**
 * `starci check run`: the runtime tier of the project's profile (policy/quality.yaml) over the scope decided from the diff, or the
 * given paths when it changes nothing; before typecheck and lint it prepares the scope's workspace dependencies (workspace-deps.ts).
 */
export const checkRunVerb = defineVerb({
    path: ["check", "run"],
    summary: "run the runtime tier of the project's policy profile over the scope of the diff, or of the given paths when the diff changes nothing, building first the workspace dependencies whose entries are missing (the CI tier runs on CI after the push)",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: EVERYONE,
    schema: "starci/check-run@1",
    flags: {
        base: { kind: "string", summary: "compare against this ref (default the branch base: origin/main on main, else the fork point from main or origin/main)" },
        all: { kind: "boolean", summary: "check every package and scan every file, not only the changed ones" },
        task: { kind: "string", summary: "judge as this task: only the files it changed since its work began, its composition rules deferred to its composer, and the modules it composes judged in full" },
        workflow: { kind: "string", summary: "the workflow's final verify: judge every module whose composition rules a task of it deferred, with no deferral" },
        within: { kind: "boolean", summary: "judge only the changed files under the given paths, never the rest of the diff (a wave hands the files its tasks landed)" },
        wave: { kind: "string", summary: "a wave's tasks, comma-separated: each one's composition rules stay deferred on its own allowPaths unless its composer is among them, and the modules those composers answer for are judged in full" },
        paths: { kind: "rest", summary: "when the diff changes nothing, judge the tracked files under these repository paths instead (what a task that changes nothing proves)" },
    },
    run: async (context, flags) => {
        const ran = await runTier(context.cwd, context.treeRoot, flags)
        const { scope, choice, tier, canon, policy, gates } = ran
        // A red step is judged against the same run where its findings may already be: a run an app-wide configuration file
        // widened (never --all) against its base, and the files a relay node carries against the source's head it relays
        // (relay-baseline.ts), whether judged as the relay node, its composer or the final verify. Findings already there are that
        // base's, kept as baseline-findings evidence, and only new ones are red (base-findings.ts).
        const judgedRed = judgedAgainstBase(ran.steps)
        const rerun =
            (atBase: TierFlags) =>
            async (dir: string): Promise<StepResult[]> => {
                const cwd = baseCwd(scope.root, context.cwd, dir)
                return (await runTier(cwd, locateTree(cwd).root, atBase)).steps
            }
        const runs: BaseRun[] = []
        if (judgedRed && scope.all && !flags.all) runs.push(await runAtBase(scope.root, scope.base, rerun({ all: true, within: false, paths: [] })))
        // At the source's head the relayed files are judged as they stand there: tracked files under their paths, no diff.
        // Its composition findings are never the source's: the relay node defers them to its composer, which answers for them.
        const except = policy.quality.runtime.compositionRules
        for (const source of judgedRed ? relaySources(scope.root, judgingOf(flags)) : []) {
            runs.push(await runAtBase(scope.root, source.head, rerun({ base: "HEAD", all: false, within: false, paths: source.paths }), { paths: source.paths, except }))
        }
        const based = runs.length === 0 ? undefined : judgeAgainstRuns(scope.root, ran.steps, runs)
        const steps = based?.steps ?? ran.steps
        const red = [...gates, ...steps].some((result) => result.status === "red")
        const verdict = red ? "red" : "green"
        const data: RunData = {
            scope,
            profile: { name: choice.name, source: choice.source },
            policy: { dir: policy.dir, overlay: policy.overlay ?? null, ci: policy.quality.ci ?? {} },
            tiers: { runtime: tier, ci: choice.profile.ci },
            canon,
            verdict,
            gates,
            steps: [...steps, ...gates.filter((gate) => gate.status === "red").map(asStep)],
            baseline: based === undefined || based.judgement.steps.length === 0 ? null : based.judgement,
        }
        const message = [
            `profile: ${choice.name} (${choice.source}); runtime tier: ${tier.join(", ")}; CI tier after the push: ${choice.profile.ci.join(", ") || "none"}`,
            describeScope(scope),
            ...gates.map((gate) => `${gate.status.padEnd(7)} ${gate.gate.padEnd(9)} (repository)${findingSuffix(gate)}`),
            ...steps.map(describeStep),
            ...(data.baseline === null ? [] : data.baseline.steps.map((each) => [`baseline-findings ${each.package} ${each.step}, already at ${each.at.slice(0, 12)}:`, ...each.findings.map((key) => `  ${key}`)].join("\n"))),
            `verdict: ${verdict}`,
            ...gates.filter((gate) => gate.status === "red").map((gate) => `--- ${gate.gate}\n${gate.output}`),
            ...steps.filter((step) => step.status === "red").map((step) => `--- ${step.package} ${step.step}\n${step.output}`),
        ]
        return { data, message: message.join("\n"), exitCode: red ? 1 : 0 }
    },
})
