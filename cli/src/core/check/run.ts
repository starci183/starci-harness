import { canonOf, loadPolicy, resolveProfile } from "../../harness/policy.js"
import type { Policy, RuntimeGate } from "../../harness/policy.js"
import type { RunOptions } from "../../shared/exec.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"
import { canonPackage } from "./canon.js"
import type { CanonByTool } from "./canon.js"
import { describeLoosening, scanLoosening } from "./loosening-scan.js"
import { describeScope, describeStep, lintPackage, resolveScope, typecheckPackage } from "./scope.js"
import type { Scope, ScopeTarget, StepResult } from "./scope.js"
import { describeSecrets, scanSecrets } from "./secrets-scan.js"
import { treeFiles } from "./tree-files.js"
import { inOrder } from "../../harness/sequential.js"

/** The verdict of one repository gate: it judges the tree (loosening) or the changed files (secrets), not one package. */
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
}

/** The repository gates, run once per check; the package gates run once per package of the scope. */
const REPOSITORY_GATES: ReadonlySet<RuntimeGate> = new Set<RuntimeGate>(["secrets", "loosening"])

/** One repository gate over the tree (loosening) or the changed files (secrets). */
const repositoryGate = async (gate: RuntimeGate, scope: Scope, policy: Policy, profile: string, all: boolean): Promise<GateResult> => {
    if (gate === "secrets") {
        const files = all ? await treeFiles(scope.root) : scope.changed
        const report = scanSecrets(scope.root, files, policy, profile, all)
        return { gate, status: report.verdict, findings: report.findings.length + report.stale.length + report.unjudged.length, output: describeSecrets(report).join("\n") }
    }
    const report = await scanLoosening(scope.root, policy)
    return { gate, status: report.verdict, findings: report.findings.length + report.stale.length + report.unjudged.length, output: describeLoosening(report).join("\n") }
}

/** The package step a gate of the tier runs on one target, as a task; the repository gates run no package step. */
const packageStep = (gate: RuntimeGate, scope: Scope, target: ScopeTarget, canon: CanonByTool, options: RunOptions): (() => Promise<StepResult>)[] => {
    switch (gate) {
        case "canon":
            return [() => Promise.resolve(canonPackage(scope, target, canon))]
        case "typecheck":
            return [() => typecheckPackage(scope, target, options)]
        case "lint":
            return [() => lintPackage(scope, target, options)]
        case "secrets":
        case "loosening":
            return []
    }
}

/** The finding count of a gate as the suffix of its line. */
const findingSuffix = (gate: GateResult): string => (gate.findings === 0 ? "" : ` ${String(gate.findings)} finding(s)`)

/** A red repository gate as a step, so a verify that reads only steps still shows why it is red. */
const asStep = (gate: GateResult): StepResult => ({ package: "(repository)", step: gate.gate, command: `starci check ${gate.gate}`, status: gate.status, reason: "", output: gate.output })

/** `starci check run`: the runtime tier of the project's profile (policy/quality.yaml) over the scope decided from the diff. */
export const checkRunVerb = defineVerb({
    path: ["check", "run"],
    summary: "run the runtime tier of the project's policy profile over the scope of the diff (the CI tier runs on CI after the push)",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/check-run@1",
    flags: {
        base: { kind: "string", summary: "compare against this ref (default origin/main, else HEAD)" },
        all: { kind: "boolean", summary: "check every package and scan every file, not only the changed ones" },
    },
    run: async (context, flags) => {
        const scope = await resolveScope(context.cwd, flags.base, flags.all)
        const policy = loadPolicy(scope.root)
        const choice = resolveProfile(policy, context.treeRoot)
        const tier = choice.profile.runtime
        const canon = canonOf(policy, choice.profile)
        const options = { timeoutMs: policy.quality.runtime.stepTimeoutSeconds * 1000 }
        const gates = await inOrder(tier.filter((name) => REPOSITORY_GATES.has(name)), (gate) => repositoryGate(gate, scope, policy, choice.name, flags.all))
        const steps = await inOrder(scope.targets.flatMap((target) => tier.flatMap((gate) => packageStep(gate, scope, target, canon, options))), (step) => step())
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
        }
        const message = [
            `profile: ${choice.name} (${choice.source}); runtime tier: ${tier.join(", ")}; CI tier after the push: ${choice.profile.ci.join(", ") || "none"}`,
            describeScope(scope),
            ...gates.map((gate) => `${gate.status.padEnd(7)} ${gate.gate.padEnd(9)} (repository)${findingSuffix(gate)}`),
            ...steps.map(describeStep),
            `verdict: ${verdict}`,
            ...gates.filter((gate) => gate.status === "red").map((gate) => `--- ${gate.gate}\n${gate.output}`),
            ...steps.filter((step) => step.status === "red").map((step) => `--- ${step.package} ${step.step}\n${step.output}`),
        ]
        return { data, message: message.join("\n"), exitCode: red ? 1 : 0 }
    },
})
