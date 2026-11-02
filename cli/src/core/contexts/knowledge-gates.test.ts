import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { judgeRemovedVocabulary, judgeRuleDocs, judgeShippedVocabulary, judgeVendorWrappers } from "./knowledge-gates.js"

const put = (root: string, path: string, content: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
}

const sandbox = (): { root: string; knowledge: string; source: string; done: () => void } => {
    const root = mkdtempSync(join(tmpdir(), "knowledge-gates-"))
    return { root, knowledge: join(root, "contexts"), source: join(root, "src"), done: () => { rmSync(root, { recursive: true, force: true }); } }
}

void test("a rule no living page names has no doc; decisions and the generated project folder do not count", () => {
    const { root, knowledge, done } = sandbox()
    try {
        put(root, "contexts/hfs/rules.yaml", "rules:\n  - id: R100\n  - id: R101\n  - id: R102\n")
        put(root, "contexts/code/fe/ui.md", "R100 is taught here.\n")
        put(root, "contexts/decisions/open.md", "R101 only in history.\n")
        put(root, "contexts/project/index.md", "R102 only in the index.\n")
        assert.deepEqual(judgeRuleDocs(knowledge).map((finding) => finding.subject), ["R101", "R102"])
    } finally {
        done()
    }
})

void test("a removed spelling written as code in living knowledge is refused, prose and decisions are not", () => {
    const { root, knowledge, done } = sandbox()
    try {
        put(root, "contexts/decisions/rulings.yaml", "removedVocabulary:\n  - spelling: Backdrop\n  - spelling: StatusDot with text\n  - spelling: List\n")
        put(root, "contexts/ui/card.md", "Use a `Backdrop` here.\nThe backdrop of a dialog.\nA <List> of rows.\nPlain List word.\n")
        put(root, "contexts/decisions/history.md", "`Backdrop` was removed.\n")
        const found = judgeRemovedVocabulary(knowledge).map((finding) => `${finding.subject}:${finding.detail.split(" ")[0] ?? ""}`)
        assert.deepEqual(found, ["Backdrop:ui/card.md:1", "List:ui/card.md:3"])
    } finally {
        done()
    }
})

void test("a removed spelling marked shipped is refused anywhere in packages/hfs/runtime as a whole word, one not marked is not", () => {
    const { root, knowledge, done } = sandbox()
    try {
        put(root, "contexts/decisions/rulings.yaml", "removedVocabulary:\n  - spelling: SurfaceListCard\n    shipped: true\n  - spelling: PrimaryRailLayout\n")
        put(root, "packages/hfs/runtime/knowledge/grammars/core/playbook.yaml", "  - component: SurfaceListCard\n  - component: PrimaryRailLayout\n  - component: SurfaceListCardLike\n")
        put(root, "packages/hfs/runtime/scripts/draw.mts", "const C = new Set(['SurfaceCard', 'SurfaceListCard'])\n")
        put(root, "packages/hfs/codemod/a.mts", "SurfaceListCard\n")
        const found = judgeShippedVocabulary(knowledge).map((finding) => `${finding.subject}:${finding.detail.split(" ")[0] ?? ""}`)
        found.sort((a, b) => a.localeCompare(b))
        assert.deepEqual(found, ["SurfaceListCard:../packages/hfs/runtime/knowledge/grammars/core/playbook.yaml:1", "SurfaceListCard:../packages/hfs/runtime/scripts/draw.mts:1"])
    } finally {
        done()
    }
})

void test("vendor wrappers: a stale row, an undeclared file, a wraps drift, an unknown ruling and a drifted pin are found", () => {
    const { root, knowledge, source, done } = sandbox()
    try {
        put(root, "src/core/A/index.tsx", 'import { Modal, cn } from "@heroui/react"\n')
        put(root, "src/core/B/index.tsx", 'import { Tooltip } from "@heroui/react"\nimport type { Label } from "@heroui/react"\n')
        put(root, "src/core/C/index.tsx", 'import { Select, ListBox } from "@heroui/react"\n')
        put(root, "src/core/C/index.stories.tsx", 'import { Modal } from "@heroui/react"\n')
        const wrappers = [
            "schema: starci/vendor-wrappers@1",
            "wrappers:",
            "  - { file: core/A/index.tsx, wraps: [Modal], overrides: [{ kind: style, target: x, ruling: nope, reason: r }] }",
            "  - { file: core/C/index.tsx, wraps: [Select] }",
            "  - { file: core/Gone/index.tsx, wraps: [Popover] }",
            "",
        ].join("\n")
        put(root, "contexts/vendor/wrappers.yaml", wrappers)
        put(root, "contexts/decisions/rulings.yaml", "rulings:\n  - id: pinned\n    pins:\n      contexts/vendor/wrappers.yaml: " + "0".repeat(64) + "\n")
        const kinds = judgeVendorWrappers(knowledge, source).map((finding) => `${finding.kind}:${finding.subject}`).sort((left, right) => left.localeCompare(right))
        assert.deepEqual(kinds, [
            "wrapper-pin-drift:contexts/vendor/wrappers.yaml",
            "wrapper-ruling-unknown:core/A/index.tsx",
            "wrapper-stale:core/Gone/index.tsx",
            "wrapper-undeclared:core/B/index.tsx",
            "wrapper-wraps-drift:core/C/index.tsx",
        ])
        put(root, "contexts/decisions/rulings.yaml", "rulings:\n  - id: nope\n    pins:\n      contexts/vendor/wrappers.yaml: " + createHash("sha256").update(wrappers).digest("hex") + "\n")
        assert.ok(!judgeVendorWrappers(knowledge, source).some((finding) => finding.kind === "wrapper-pin-drift"))
    } finally {
        done()
    }
})
