/** The project-graph export the result cache reads: the findings of the very graph the rules read, per file, in the shape the rules report them. */
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"
import { projectFixture } from "../../eslint-canon-be/fixtures/project/tester.ts"
import * as canon from "./index.ts"
import { projectGraph, rules } from "./project-graph.ts"

const ts: object = createRequire(import.meta.url)("typescript")

test("projectGraph answers the project-graph findings of a front end by side-relative path, under the rules' own names", (t) => {
  const fixture = projectFixture({ profile: "fe", edition: "full", files: { "apps/web/src/lib/orphan.ts": "export const orphan = 1\n" } })
  t.after(fixture.cleanup)
  const graph = projectGraph({ repoRoot: fixture.root, injectedTypeScript: ts })
  assert.ok(graph.files > 0)
  const found = Object.entries(graph.byFile).flatMap(([file, findings]) => findings.map((finding) => ({ file, ...finding })))
  assert.ok(found.length > 0, "an unreached file is a finding")
  for (const finding of found) {
    assert.ok(finding.rule.slice("starci-fe/".length) in rules, `${finding.rule} is a project-graph rule of this canon`)
    assert.ok(finding.line >= 1 && finding.column >= 1 && finding.code !== "")
  }
  assert.deepEqual(projectGraph({ repoRoot: fixture.root, injectedTypeScript: ts }), graph)
})

test("the canon publishes crossFileInputs and projectGraph from its entry", () => {
  assert.equal(canon.projectGraph, projectGraph)
  assert.ok(Array.isArray(canon.crossFileInputs) && canon.crossFileInputs.length > 0)
})
