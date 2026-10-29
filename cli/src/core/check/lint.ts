import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"
import { describeScope, describeStep, lintPackage, resolveScope } from "./scope.js"
import type { Scope, StepResult } from "./scope.js"

interface LintData {
    readonly scope: Scope
    readonly steps: readonly StepResult[]
}

/** `starci check lint`: ESLint on the changed source files of each package that owns one, each file with its nearest config. */
export const checkLintVerb = defineVerb({
    path: ["check", "lint"],
    summary: "lint the changed source files, each with the nearest ESLint config up to the repository root (every file of each package with --all)",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/check-lint@1",
    flags: {
        base: { kind: "string", summary: "compare against this ref (default the branch base: origin/main on main, else the fork point from main or origin/main)" },
        all: { kind: "boolean", summary: "lint every package in full" },
        within: { kind: "boolean", summary: "judge only the changed files under the given paths, never the rest of the diff (a wave hands the files its tasks landed)" },
        paths: { kind: "rest", summary: "when the diff changes nothing, judge the tracked files under these repository paths instead (what a task that changes nothing proves)" },
    },
    run: async (context, flags) => {
        const scope = await resolveScope(context.cwd, flags.base, flags.all, flags.paths, {}, flags.within)
        const steps = await Promise.all(scope.targets.map((target) => lintPackage(scope, target)))
        const red = steps.some((step) => step.status === "red")
        const data: LintData = { scope, steps }
        const details = steps.filter((step) => step.status === "red").map((step) => step.output)
        return { data, message: [describeScope(scope), ...steps.map(describeStep), ...details].join("\n"), exitCode: red ? 1 : 0 }
    },
})
