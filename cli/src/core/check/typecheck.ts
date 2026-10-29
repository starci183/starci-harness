import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"
import { describeScope, describeStep, resolveScope, typecheckPackage } from "./scope.js"
import type { Scope, StepResult } from "./scope.js"

interface TypecheckData {
    readonly scope: Scope
    readonly steps: readonly StepResult[]
}

/** `starci check typecheck`: tsc --noEmit for the packages the change touches. */
export const checkTypecheckVerb = defineVerb({
    path: ["check", "typecheck"],
    summary: "typecheck the packages that own a changed file (every package with --all)",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/check-typecheck@1",
    flags: {
        base: { kind: "string", summary: "compare against this ref (default the branch base: origin/main on main, else the fork point from main or origin/main)" },
        all: { kind: "boolean", summary: "check every package, not only the changed ones" },
        within: { kind: "boolean", summary: "judge only the changed files under the given paths, never the rest of the diff (a wave hands the files its tasks landed)" },
        paths: { kind: "rest", summary: "when the diff changes nothing, judge the tracked files under these repository paths instead (what a task that changes nothing proves)" },
    },
    run: async (context, flags) => {
        const scope = await resolveScope(context.cwd, flags.base, flags.all, flags.paths, {}, flags.within)
        const steps = await Promise.all(scope.targets.map((target) => typecheckPackage(scope, target)))
        const red = steps.some((step) => step.status === "red")
        const data: TypecheckData = { scope, steps }
        const details = steps.filter((step) => step.status === "red").map((step) => step.output)
        return { data, message: [describeScope(scope), ...steps.map(describeStep), ...details].join("\n"), exitCode: red ? 1 : 0 }
    },
})
