// The Grammar carries no tests (owner 2026-11-26: "xóa tests grammars và ghi rules chặt vì useless"; contexts/ui/proof.md
// GRAMMAR-NO-TESTS). The harness shape's gate slot `never.grammar-tests` (contexts/hfs/harness.yaml) holds the rule, and CI's
// `check shape` row runs it. These specs read the real manifest, so a slot loosened or given an exception turns them red.
// They belong to the harness's own suite, never to the Grammar's. Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { loadShapeManifest } from "./shape-manifest.js"
import { scanShape } from "./shape-scan.js"

const root = fileURLToPath(new URL("../../../../", import.meta.url))
const manifest = loadShapeManifest(root)
const SLOT = "never.grammar-tests"

const findingOf = (file: string): { readonly code: string; readonly slot: string | null } | undefined => {
    const report = scanShape(root, manifest, [file], "2026-11-26")
    return report.findings.find((finding) => finding.path === file)
}

void test("the slot is a gate slot with no exception", () => {
    const slot = manifest.slots.find((entry) => entry.id === SLOT)
    assert.ok(slot, `${SLOT} is declared`)
    assert.equal(slot.presence, "forbidden")
    assert.equal(slot.enforce, "gate")
    assert.equal(slot.except, undefined)
    assert.equal(slot.exceptions, undefined)
})

void test("every spec, test, snapshot, test folder and runner config in the Grammar is SHAPE_FORBIDDEN by it", () => {
    for (const file of [
        "packages/grammar/specs/avatar.spec.mts",
        "packages/grammar/specs/support/register.mts",
        "packages/grammar/specs/fixtures/ext-markdown/a.md",
        "packages/grammar/src/core/branch/Tabs/index.test.tsx",
        "packages/grammar/src/common/tone.spec.ts",
        "packages/grammar/codemods/v0610/index.spec.mts",
        "packages/grammar/ext-demo/graph/e2e/graph.spec.ts",
        "packages/grammar/ext-demo/graph/e2e/positions.snap.json",
        "packages/grammar/proof/baselines/390/core-light-x.png",
        "packages/grammar/src/__tests__/helper.ts",
        "packages/grammar/playwright.config.ts",
        "packages/grammar/vitest.config.mts",
        "packages/grammar/ext-demo/graph/playwright.config.ts",
        "packages/grammar/tsconfig.specs.json",
        "packages/grammar/tsconfig.codemods-spec.json",
    ]) {
        const finding = findingOf(file)
        assert.equal(finding?.code, "SHAPE_FORBIDDEN", file)
        assert.equal(finding.slot, SLOT, file)
    }
})

void test("the Grammar's source, stories, static checks and the other packages' specs are not judged by it", () => {
    for (const file of [
        "packages/grammar/src/core/branch/Tabs/index.tsx",
        "packages/grammar/src/core/branch/Tabs/Tabs.stories.tsx",
        "packages/grammar/scripts/check-tone-tokens.mts",
        "packages/grammar/scripts/shoot.mts",
        "packages/grammar/tsconfig.build.json",
        "packages/hfs/src/new-code.spec.mts",
        "cli/src/core/check/ci.test.ts",
    ]) assert.notEqual(findingOf(file)?.slot, SLOT, file)
})
