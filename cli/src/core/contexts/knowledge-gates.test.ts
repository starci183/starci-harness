import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { judgeRemovedVocabulary, judgeRuleDocs, judgeRulingHistory, judgeShippedVocabulary, judgeVendorWrappers } from "./knowledge-gates.js"

const put = (root: string, path: string, content: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
}

const sandbox = (): { root: string; knowledge: string; source: string; done: () => void } => {
    const root = mkdtempSync(join(tmpdir(), "knowledge-gates-"))
    return { root, knowledge: join(root, "contexts"), source: join(root, "src"), done: () => { rmSync(root, { recursive: true, force: true }); } }
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

void test("a removed grammar name written as code in living knowledge is refused, prose and other kinds are not", () => {
    const { root, knowledge, done } = sandbox()
    try {
        put(root, "packages/hfs/runtime/modules/kernel/removed-vocabulary.yaml", "removed:\n  - {kind: grammar, name: Backdrop}\n  - {kind: grammar, name: StatusDot with text}\n  - {kind: grammar, name: List}\n  - {kind: code, name: OldCode}\n")
        put(root, "contexts/ui/card.md", "Use a `Backdrop` here.\nThe backdrop of a dialog.\nA <List> of rows.\nPlain List word.\nThe `OldCode` code.\n")
        const found = judgeRemovedVocabulary(knowledge).map((finding) => `${finding.subject}:${finding.detail.split(" ")[0] ?? ""}`)
        assert.deepEqual(found, ["Backdrop:ui/card.md:1", "List:ui/card.md:3"])
    } finally {
        done()
    }
})

void test("a removed spelling marked shipped is refused anywhere in packages/hfs/runtime as a whole word, one not marked is not", () => {
    const { root, knowledge, done } = sandbox()
    try {
        put(root, "packages/hfs/runtime/modules/kernel/removed-vocabulary.yaml", "removed:\n  - {kind: grammar, name: SurfaceListCard, shipped: true}\n  - {kind: grammar, name: PrimaryRailLayout}\n")
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

void test("vendor wrappers: a stale row, an undeclared file, a wraps drift, an unknown rule, a removed ruling key, a missing reason and a drifted pin are found", () => {
    const { root, knowledge, source, done } = sandbox()
    try {
        put(root, "src/core/A/index.tsx", 'import { Modal, cn } from "@heroui/react"\n')
        put(root, "src/core/B/index.tsx", 'import { Tooltip } from "@heroui/react"\nimport type { Label } from "@heroui/react"\n')
        put(root, "src/core/C/index.tsx", 'import { Select, ListBox } from "@heroui/react"\n')
        put(root, "src/core/C/index.stories.tsx", 'import { Modal } from "@heroui/react"\n')
        const wrappers = [
            "schema: starci/vendor-wrappers@1",
            "wrappers:",
            "  - { file: core/A/index.tsx, wraps: [Modal], overrides: [{ kind: style, target: x, rule: R999, reason: r }, { kind: style, target: y, rule: R100, reason: r }, { kind: style, target: z, ruling: old, reason: r }, { kind: style, target: w } ] }",
            "  - { file: core/C/index.tsx, wraps: [Select] }",
            "  - { file: core/Gone/index.tsx, wraps: [Popover] }",
            "",
        ].join("\n")
        put(root, "contexts/vendor/wrappers.yaml", wrappers)
        put(root, "contexts/hfs/rules.yaml", "rules:\n  - id: R100\n")
        put(root, "contexts/vendor/pins.yaml", "pins:\n  wrappers.yaml: " + "0".repeat(64) + "\n")
        const kinds = judgeVendorWrappers(knowledge, source).map((finding) => `${finding.kind}:${finding.subject}`).sort((left, right) => left.localeCompare(right))
        assert.deepEqual(kinds, [
            "wrapper-pin-drift:contexts/vendor/wrappers.yaml",
            "wrapper-rule-unknown:core/A/index.tsx",
            "wrapper-rule-unknown:core/A/index.tsx",
            "wrapper-rule-unknown:core/A/index.tsx",
            "wrapper-stale:core/Gone/index.tsx",
            "wrapper-undeclared:core/B/index.tsx",
            "wrapper-wraps-drift:core/C/index.tsx",
        ])
        put(root, "contexts/vendor/pins.yaml", "pins:\n  wrappers.yaml: " + createHash("sha256").update(wrappers).digest("hex") + "\n")
        assert.ok(!judgeVendorWrappers(knowledge, source).some((finding) => finding.kind === "wrapper-pin-drift"))
    } finally {
        done()
    }
})


void test("ruling history: a citation of an owner ruling, a decision id or its date is refused in prose, yaml, comments and printed strings; identifiers and the Supervisor's vocabulary are not", () => {
    const { root, done } = sandbox()
    try {
        put(root, "contexts/ui/a.md", "A card is raised (owner ruling card-depth, 2026-10-24).\nThe Supervisor rules on it and records the ruling.\nSee R12 and CONTRIB-5.\n")
        put(root, "policy/b.yaml", "reason: \"the CLI is proven by runs (decision `cli-proven`)\"\n")
        put(root, "packages/x/src/c.ts", "// the cap holds (ruling:R212/case-3)\nconst ruling: string = \"see decision grammar-patch-range\"\n/* a block\n   (owner 2026-10-14) */\nconst entry = { ruling: id, rulings: (ruling: string) => ruling }\nthrow new Error(`decision ${id} is the Supervisor's to rule, by decision `handUndecided``)\n")
        put(root, "packages/x/CHANGELOG.md", "- owner ruling x\n")
        put(root, "packages/x/node_modules/y/README.md", "owner ruling y\n")
        const found = judgeRulingHistory(root).map((finding) => finding.subject).sort((left, right) => left.localeCompare(right))
        assert.deepEqual(found, ["contexts/ui/a.md:1", "packages/x/src/c.ts:1", "packages/x/src/c.ts:2", "packages/x/src/c.ts:4", "policy/b.yaml:1"])
    } finally {
        done()
    }
})
