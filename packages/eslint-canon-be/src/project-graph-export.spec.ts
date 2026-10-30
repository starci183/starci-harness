/** The project-graph export the result cache reads: the findings of the very graph the rules read, per file, in the shape the rules report them. */
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"
import { projectFixture } from "../fixtures/project/tester.ts"
import { projectGraph, rules } from "./project-graph.ts"
import * as canon from "./index.ts"

const ts: object = createRequire(import.meta.url)("typescript")

test("projectGraph answers the findings a project-graph rule reports, by side-relative path, and nothing of that rule for a file without the defect", (t) => {
    const files = {
        "src/modules/domain/purchase/index.ts": "export const purchase = 1;\n",
        "src/modules/domain/purchase/errors/purchase.error.ts": 'export enum PurchaseErrorCode { Missing = "PURCHASE_MISSING" }\n',
        "src/modules/domain/plan/index.ts": "export const plan = 1;\n",
        "src/modules/domain/plan/errors/plan.error.ts": 'export enum PlanErrorCode { Missing = "PLAN_MISSING", Again = "PLAN_MISSING" }\n',
    }
    const fixture = projectFixture({ edition: "full", files })
    t.after(fixture.cleanup)
    const graph = projectGraph({ repoRoot: fixture.root, injectedTypeScript: ts })
    assert.ok(graph.files > 0)
    const duplicate = graph.byFile["src/modules/domain/plan/errors/plan.error.ts"] ?? []
    const unique = duplicate.filter((finding) => finding.rule === "starci-be/error-code-unique")
    assert.equal(unique.length, 1, "the duplicated error code is a finding of the file")
    assert.ok(unique.every((finding) => finding.code === "BE_ERROR_HOME" && finding.line >= 1 && finding.column >= 1))
    assert.ok(duplicate.every((finding, at) => at === 0 || (duplicate[at - 1] as typeof finding).line <= finding.line), "sorted by line")
    assert.equal((graph.byFile["src/modules/domain/purchase/errors/purchase.error.ts"] ?? []).some((finding) => finding.rule === "starci-be/error-code-unique"), false)
    // sorted, and the same answer twice
    assert.deepEqual(projectGraph({ repoRoot: fixture.root, injectedTypeScript: ts }), graph)
})

test("the canon publishes crossFileInputs and projectGraph from its entry", () => {
    assert.equal(canon.projectGraph, projectGraph)
    assert.ok(Array.isArray(canon.crossFileInputs) && canon.crossFileInputs.length > 0)
    for (const rule of Object.keys(rules)) assert.ok(rule in canon.rules)
})
