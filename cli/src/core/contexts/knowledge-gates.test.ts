import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { judgeRuleDocs } from "./knowledge-gates.js"

const put = (root: string, path: string, content: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
}

const sandbox = (): { root: string; knowledge: string; done: () => void } => {
    const root = mkdtempSync(join(tmpdir(), "knowledge-gates-"))
    return { root, knowledge: join(root, "contexts"), done: () => { rmSync(root, { recursive: true, force: true }); } }
}

void test("a rule no living page names has no doc; the generated project folder does not count", () => {
    const { root, knowledge, done } = sandbox()
    try {
        put(root, "contexts/hfs/rules.yaml", "rules:\n  - id: R100\n  - id: R101\n  - id: R102\n")
        put(root, "contexts/code/fe/ui.md", "R100 is taught here.\n")
        put(root, "contexts/hfs/notes.yaml", "R101 only in data.\n")
        put(root, "contexts/project/index.md", "R102 only in the index.\n")
        assert.deepEqual(judgeRuleDocs(knowledge).map((finding) => finding.subject), ["R101", "R102"])
    } finally {
        done()
    }
})
