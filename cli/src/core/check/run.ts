import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"
import { describeScope, describeStep, lintPackage, resolveScope, typecheckPackage } from "./scope.js"
import type { Scope, StepResult } from "./scope.js"

interface RunData {
    readonly scope: Scope
    readonly verdict: "green" | "red"
    readonly steps: readonly StepResult[]
}

/** `starci check run`: the scope decision first, then typecheck and lint of exactly that scope; the full suite is CI's. */
export const checkRunVerb = defineVerb({
    path: ["check", "run"],
    summary: "decide the scope from the diff, then typecheck and lint exactly that scope (the full suite runs on CI)",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/check-run@1",
    flags: {
        base: { kind: "string", summary: "compare against this ref (default origin/main, else HEAD)" },
        all: { kind: "boolean", summary: "check every package, not only the changed ones" },
    },
    run: async (context, flags) => {
        const scope = await resolveScope(context.cwd, flags.base, flags.all)
        const steps: StepResult[] = []
        for (const target of scope.targets) {
            steps.push(await typecheckPackage(scope, target))
            steps.push(await lintPackage(scope, target))
        }
        const verdict = steps.some((step) => step.status === "red") ? "red" : "green"
        const data: RunData = { scope, verdict, steps }
        const details = steps.filter((step) => step.status === "red").map((step) => `--- ${step.package} ${step.step}\n${step.output}`)
        return { data, message: [describeScope(scope), ...steps.map(describeStep), `verdict: ${verdict}`, ...details].join("\n"), exitCode: verdict === "red" ? 1 : 0 }
    },
})
