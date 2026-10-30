/**
 * RuleTester proof of the front-end project rule that serves the slot manifest's per-path judgement (scripts/hfs/path-findings.mjs,
 * origin "repo"): slot-undeclared. The project graph runs it over `git ls-files` of the fixture and the rule reports the finding on the
 * TypeScript file ESLint visits. (source-suffix and spec-placement are back-end rules; see ../eslint-canon-be/project-graph.paths.spec.mjs.)
 *
 *   node --test src/project-graph.paths.spec.ts
 */
import test from "node:test"
import { projectFixture } from "../../eslint-canon-be/fixtures/project/tester.ts"
import { rules } from "./project-graph.ts"
import { canonTester } from "../fixtures/typed/tester.ts"
import type { Rule } from "./lib/rule.ts"

/** The rule project-graph publishes as `name`; a missing one fails the run. */
const ruleOf = (name: string): Rule => {
  const rule = rules[name]
  if (rule === undefined) throw new Error(`project-graph publishes no ${name}`)
  return rule
}

const EXPORT = "export const value = 1;\n"

test("a TypeScript file of a front end is owned by exactly one slot of the repository", (t) => {
    const rels = ["apps/web/src/x.ts", "apps/web/src/modules/api/helpers.ts", "apps/web/src/modules/hooks/x.ts"]
    const f = projectFixture({ profile: "fe", files: Object.fromEntries(rels.map((rel) => [rel, EXPORT])) })
    t.after(f.cleanup)
    const at = (rel: string) => ({ filename: f.at(rel), code: EXPORT })
    canonTester(f.tester).run("slot-undeclared", ruleOf("slot-undeclared"), {
        valid: [at("apps/web/src/modules/api/helpers.ts"), at("apps/web/src/modules/hooks/x.ts")],
        invalid: [{ ...at("apps/web/src/x.ts"), errors: [{ messageId: "finding", line: 1 }] }],
    })
})
