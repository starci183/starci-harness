/** The project-graph export the result cache reads: the findings of the very graph the rules read, per file, in the shape the rules report them. */
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { writeFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { projectFixture } from "../../eslint-canon-be/fixtures/project/tester.ts"
import * as canon from "./index.ts"
import { projectGraph, projectGraphSnapshot, rules } from "./project-graph.ts"

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

test("projectGraphSnapshot hands out the graph this process built, equal to a fresh projectGraph, and builds nothing again", (t) => {
  const fixture = projectFixture({ profile: "fe", edition: "full", files: { "apps/web/src/lib/orphan.ts": "export const orphan = 1\n" } })
  t.after(fixture.cleanup)
  const built = projectGraph({ repoRoot: fixture.root, injectedTypeScript: ts })
  assert.deepEqual(projectGraphSnapshot({ repoRoot: fixture.root }), built)
  // the tree grows: a fresh build sees it, the snapshot is the graph the process already holds
  writeFileSync(path.join(fixture.root, "apps/web/src/lib/orphan2.ts"), "export const orphan2 = 2\n")
  assert.deepEqual(projectGraphSnapshot({ repoRoot: fixture.root }), built)
  assert.notDeepEqual(projectGraph({ repoRoot: fixture.root, injectedTypeScript: ts }), built)
})

test("the canon publishes crossFileInputs, projectGraph and projectGraphSnapshot from its entry", () => {
  assert.equal(canon.projectGraph, projectGraph)
  assert.equal(canon.projectGraphSnapshot, projectGraphSnapshot)
  assert.ok(Array.isArray(canon.crossFileInputs) && canon.crossFileInputs.length > 0)
})
