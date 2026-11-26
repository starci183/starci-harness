import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { capabilityGaps } from "./capability-owners.js"

const REGISTRY = `schema: starci/capabilities@1
capabilities:
  - id: git-merge-or-abort
    summary: merge a ref and abort on a conflict
    scope: [src]
    marks: ['"merge", "--abort"']
    owners: [src/git.ts]
    known:
      src/old.ts: still merges itself
`

const world = (files: Readonly<Record<string, string>>): { readonly kinds: string[]; readonly subjects: string[] } => {
    const root = mkdtempSync(join(tmpdir(), "capability-owners-"))
    try {
        for (const [path, text] of Object.entries({ "contexts/harness/capabilities.yaml": REGISTRY, ...files })) {
            mkdirSync(dirname(join(root, path)), { recursive: true })
            writeFileSync(join(root, path), text)
        }
        const gaps = capabilityGaps(root, join(root, "contexts", "harness", "capabilities.yaml"))
        return { kinds: gaps.map((one) => one.kind), subjects: gaps.map((one) => one.subject) }
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
}

const MERGE = 'await git(root, ["merge", "--abort"])\n'

void test("the owner and a known reimplementation hold the mark; specs and node_modules are never read", () => {
    assert.deepEqual(world({ "src/git.ts": MERGE, "src/old.ts": MERGE, "src/git.test.ts": MERGE, "src/node_modules/x/index.ts": MERGE }), { kinds: [], subjects: [] })
})

void test("a new file that reimplements a capability is red: one capability, one owner", () => {
    assert.deepEqual(world({ "src/git.ts": MERGE, "src/old.ts": MERGE, "src/lane.ts": MERGE }), { kinds: ["capability-reimplemented"], subjects: ["src/lane.ts"] })
})

void test("the known list only shrinks: an entry whose file now calls the owner is red until it is deleted", () => {
    assert.deepEqual(world({ "src/git.ts": MERGE, "src/old.ts": "await mergeOrAbort(root, ref)\n" }), { kinds: ["capability-known-stale"], subjects: ["src/old.ts"] })
})

void test("no registry, no gap", () => {
    const root = mkdtempSync(join(tmpdir(), "capability-owners-"))
    try {
        assert.deepEqual(capabilityGaps(root, join(root, "missing.yaml")), [])
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})
