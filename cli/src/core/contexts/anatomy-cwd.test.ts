import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { BEGIN_MARKER, END_MARKER } from "./anatomy-render.js"
import { contextsAnatomyVerb, harnessRootOf, regenerateContexts } from "./anatomy.js"
import type { VerbContext } from "../../shared/verb.js"

const put = (root: string, path: string, content: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
}

/** A minimal harness checkout: the slot catalog, the rule catalog, the ops marker and an anatomy.md holding a stale generated block. */
const harness = (): string => {
    const root = mkdtempSync(join(tmpdir(), "anatomy-cwd-"))
    put(root, "ops/checks.yaml", "checks: []\n")
    put(root, "contexts/hfs/slots.yaml", "slots: []\n")
    put(root, "contexts/hfs/rules.yaml", "enforcerKinds:\n  hfs: a check of the hfs CLI\nrules: []\n")
    mkdirSync(join(root, "contexts/code/be"), { recursive: true })
    mkdirSync(join(root, "contexts/code/fe"), { recursive: true })
    put(root, "contexts/project/anatomy.md", `# Anatomy\n\n${BEGIN_MARKER}\nstale\n${END_MARKER}\n`)
    return root
}

const contextAt = (cwd: string): VerbContext => ({ cwd, tree: "runtime", treeRoot: cwd, verbs: [], json: false, progress: () => undefined }) as unknown as VerbContext

void test("contexts anatomy --execute writes into the harness of --cwd, never into the checkout the CLI runs from", async () => {
    const root = harness()
    try {
        const result = await contextsAnatomyVerb.run(contextAt(root), { execute: true } as never)
        assert.equal(result.exitCode ?? 0, 0)
        const anatomy = readFileSync(join(root, "contexts/project/anatomy.md"), "utf8")
        assert.ok(!anatomy.includes("stale"), "the stale block of the --cwd tree was regenerated")
        assert.ok(existsSync(join(root, "contexts/project/index.md")), "the contexts index was written into --cwd")
        assert.ok(readFileSync(join(root, "contexts/project/index.md"), "utf8").includes("anatomy.md"))
        assert.ok(!(result as { message: string }).message.includes("starci-harness"), "no path of another checkout")
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

void test("harnessRootOf finds the harness above a sub folder and regenerateContexts lists only what changed", () => {
    const root = harness()
    try {
        mkdirSync(join(root, "contexts", "project", "deeper"), { recursive: true })
        assert.equal(harnessRootOf(join(root, "contexts", "project", "deeper")), root)
        assert.deepEqual(regenerateContexts(join(root, "contexts")).sort((left, right) => left.localeCompare(right)), ["contexts/project/anatomy-be.md", "contexts/project/anatomy-fe.md", "contexts/project/anatomy.md", "contexts/project/index.md"])
        assert.deepEqual(regenerateContexts(join(root, "contexts")), [], "a second run changes nothing")
        // Stale again: only the index drifts (a new page changes its listing), and only it is reported.
        put(root, "contexts/harness/extra.md", "# Extra\n\nA new page.\n")
        assert.deepEqual(regenerateContexts(join(root, "contexts")), ["contexts/project/index.md"])
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})
