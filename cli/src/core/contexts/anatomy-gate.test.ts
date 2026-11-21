import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { judgeAnatomy } from "./anatomy-gate.js"

const put = (root: string, path: string, content: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
}

const judge = (rules: string): { kinds: string[]; planned: string[] } => {
    const root = mkdtempSync(join(tmpdir(), "anatomy-gate-"))
    try {
        put(root, "contexts/hfs/rules.yaml", rules)
        put(root, "contexts/hfs/slots.yaml", "slots: []\n")
        mkdirSync(join(root, "contexts", "code", "be"), { recursive: true })
        put(root, "contexts/code/fe/page.md", "R100 and R101 and R102 are taught here.\n")
        const verdict = judgeAnatomy(join(root, "contexts"))
        return { kinds: verdict.red.map((gap) => gap.kind), planned: verdict.planned.map((rule) => rule.id) }
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
}

const HEAD = "enforcerKinds:\n  hfs: a check of the hfs CLI\nrules:\n"

void test("a rule with no enforcer is legal: it is held by review and the gate stays green", () => {
    const verdict = judge(`${HEAD}  - id: R100\n    code: HFS_A\n  - id: R101\n    code: HFS_B\n    enforcers: []\n`)
    assert.deepEqual(verdict, { kinds: [], planned: [] })
})

void test("a rule judged only by planned enforcers is listed and never red; a mixed rule is not listed", () => {
    const verdict = judge(`${HEAD}  - id: R100\n    code: HFS_A\n    enforcers:\n      - {kind: hfs, id: a, status: planned}\n  - id: R101\n    code: HFS_B\n    enforcers:\n      - {kind: hfs, id: b, status: planned}\n      - {kind: hfs, id: c}\n`)
    assert.deepEqual(verdict, { kinds: [], planned: ["R100"] })
})

void test("an enforcer of an undeclared kind is still a gap", () => {
    const verdict = judge(`${HEAD}  - id: R100\n    code: HFS_A\n    enforcers:\n      - {kind: nowhere, id: a}\n`)
    assert.deepEqual(verdict.kinds, ["enforcer-kind-unknown"])
})
