import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { RUNTIME_CATALOG, judgeAnatomy } from "./anatomy-gate.js"

const put = (root: string, path: string, content: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
}

const judge = (rules: string, runtime?: string): { kinds: string[]; planned: string[] } => {
    const root = mkdtempSync(join(tmpdir(), "anatomy-gate-"))
    try {
        put(root, "contexts/hfs/rules.yaml", rules)
        put(root, "contexts/hfs/slots.yaml", "slots: []\n")
        if (runtime !== undefined) put(root, RUNTIME_CATALOG, runtime)
        mkdirSync(join(root, "contexts", "code", "be"), { recursive: true })
        put(root, "contexts/code/fe/page.md", "R100 and R101 and R102 are taught here.\n")
        const verdict = judgeAnatomy(join(root, "contexts"))
        return { kinds: verdict.red.map((gap) => gap.kind), planned: verdict.planned.map((rule) => rule.id) }
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
}

const HEAD = "enforcerKinds:\n  hfs: a check of the hfs CLI\n  eslint-be: a rule of the back-end canon\nrules:\n"

void test("a rule with no enforcer is legal: it is held by review and the gate stays green", () => {
    const verdict = judge(`${HEAD}  - id: R100\n    code: HFS_A\n    covers: review/a\n  - id: R101\n    code: HFS_B\n    enforcers: []\n    covers: review/b\n`)
    assert.deepEqual(verdict, { kinds: [], planned: [] })
})

void test("a rule judged only by planned enforcers is listed and never red; a mixed rule is not listed", () => {
    const verdict = judge(`${HEAD}  - id: R100\n    code: HFS_A\n    covers: repo/a\n    enforcers:\n      - {kind: hfs, id: a, status: planned}\n  - id: R101\n    code: HFS_B\n    covers: repo/b\n    enforcers:\n      - {kind: hfs, id: b, status: planned}\n      - {kind: hfs, id: c}\n`)
    assert.deepEqual(verdict, { kinds: [], planned: ["R100"] })
})

void test("an enforcer of an undeclared kind is still a gap", () => {
    const verdict = judge(`${HEAD}  - id: R100\n    code: HFS_A\n    covers: repo/a\n    enforcers:\n      - {kind: nowhere, id: a}\n`)
    assert.deepEqual(verdict.kinds, ["enforcer-kind-unknown"])
})

void test("one condition, one rule: a rule without covers, two rules covering one condition, or one code under two rules is red", () => {
    assert.deepEqual(judge(`${HEAD}  - id: R100\n    code: HFS_A\n`).kinds, ["rule-covers-missing"])
    assert.deepEqual(judge(`${HEAD}  - id: R100\n    code: HFS_A\n    covers: review/a\n  - id: R101\n    code: HFS_B\n    covers: review/a\n`).kinds, ["rule-covers-duplicate"])
    assert.deepEqual(judge(`${HEAD}  - id: R100\n    code: HFS_A\n    covers: review/a\n  - id: R101\n    code: HFS_B\n    failureCodes: [HFS_A]\n    covers: review/b\n`).kinds, ["code-two-rules"])
})

void test("one condition, one engine: covers names the engine its enforcers make it, and a rule two engines judge states its split", () => {
    assert.deepEqual(judge(`${HEAD}  - id: R100\n    code: HFS_A\n    covers: repo/a\n    enforcers:\n      - {kind: eslint-be, id: a}\n`).kinds, ["rule-engine-mismatch"])
    const both = `${HEAD}  - id: R100\n    code: HFS_A\n    covers: split/a\n    enforcers:\n      - {kind: eslint-be, id: a}\n      - {kind: hfs, id: a}\n`
    assert.deepEqual(judge(both).kinds, ["rule-engine-mismatch"])
    assert.deepEqual(judge(`${both}    split: the lint reads one file, hfs the tree\n`).kinds, [])
})

void test("one check, one rule: an enforcer under two rules is red unless sharedEnforcers says why, and a stale entry is red too", () => {
    const rules = `  - id: R100\n    code: HFS_A\n    covers: code/a\n    enforcers:\n      - {kind: eslint-be, id: shared}\n  - id: R101\n    code: HFS_B\n    covers: code/b\n    enforcers:\n      - {kind: eslint-be, id: shared}\n`
    assert.deepEqual(judge(`${HEAD}${rules}`).kinds, ["enforcer-two-rules"])
    const declared = HEAD.replace("rules:\n", 'sharedEnforcers:\n  "eslint-be:shared": one table, a code per row\nrules:\n')
    assert.deepEqual(judge(`${declared}${rules}`).kinds, [])
    const stale = HEAD.replace("rules:\n", 'sharedEnforcers:\n  "eslint-be:gone": no longer shared\nrules:\n')
    assert.deepEqual(judge(`${stale}  - id: R100\n    code: HFS_A\n    covers: review/a\n`).kinds, ["enforcer-two-rules"])
})

void test("the two catalogs agree: a rule, a code or a lint enforcer only one of them holds is drift; a runtime-only rule is not", () => {
    const rules = `${HEAD}  - id: R100\n    code: HFS_A\n    covers: code/a\n    enforcers:\n      - {kind: eslint-be, id: a}\n`
    const same = "rules:\n  - {id: R100, code: HFS_A, failureCodes: [HFS_A], enforcers: [{kind: eslint-be, id: a}]}\n  - {id: R200, code: RT_ONLY, enforcers: [{kind: runtime, id: r}]}\n"
    assert.deepEqual(judge(rules, same).kinds, [])
    assert.deepEqual(judge(rules, "rules:\n  - {id: R100, code: HFS_A, enforcers: [{kind: eslint-be, id: other}]}\n").kinds, ["catalog-drift"])
    assert.deepEqual(judge(rules, "rules:\n  - {id: R100, code: HFS_A, failureCodes: [HFS_A, HFS_Z], enforcers: [{kind: eslint-be, id: a}]}\n").kinds, ["catalog-drift"])
    assert.deepEqual(judge(rules, `${same}  - {id: R101, code: HFS_B, enforcers: [{kind: hfs, id: b}]}\n`).kinds, ["catalog-drift"])
})
