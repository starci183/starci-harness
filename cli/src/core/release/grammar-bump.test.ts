// The patch-or-minor judgement of a Grammar release (decision grammar-patch-range): a CSS fix, a renderer fix, a new optional prop, a story and
// a new DNA law and a runtime copy of @starci/hfs data are a patch; a lint rule, a removed export or prop and a removed law are a minor's.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { minorReasons } from "./grammar-bump.js"
import { meetsPin } from "./pin-range.js"

const BASE: Readonly<Record<string, string>> = {
    "packages/grammar/src/core/composite/Alert/index.tsx": "export interface AlertProps {\n    readonly title: string\n    readonly tone?: string\n}\nexport const Alert = () => null\n",
    "packages/grammar/src/common/styles.css": ".alert { padding: 4px; }\n",
    "packages/grammar/src/stories/Alert.stories.tsx": "export const Ready = {}\n",
    "packages/eslint-grammar-core/src/choice-controls.ts": "export const rule = 1\n",
    "packages/eslint-grammar-core/src/choice-controls.spec.ts": "// spec\n",
    "contexts/grammars/contract.yaml": "dna:\n  - id: DNA-COMMON-ONE\n  - id: DNA-COMMON-TWO\ndeprecated: [ButtonGroup]\n",
    "packages/eslint-grammar-core/runtime/knowledge/hfs/canon-pins.yaml": "pins: {}\n",
}

/** A git repository holding BASE at its first commit and `change` applied on top; the first commit's sha. */
const repoWith = (change: Readonly<Record<string, string | null>>) => {
    const root = mkdtempSync(join(tmpdir(), "starci-grammar-bump-"))
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=spec", "-c", "user.email=spec@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8" }).trim()
    const write = (files: Readonly<Record<string, string | null>>) => {
        for (const [file, text] of Object.entries(files)) {
            if (text === null) { rmSync(join(root, file)); continue }
            mkdirSync(dirname(join(root, file)), { recursive: true })
            writeFileSync(join(root, file), text)
        }
    }
    git("init", "-q")
    write(BASE)
    git("add", "-A")
    git("commit", "-qm", "base")
    const base = git("rev-parse", "HEAD")
    write(change)
    git("add", "-A")
    git("commit", "-qm", "change", "--allow-empty")
    return { root, base, cleanup: () => { rmSync(root, { recursive: true, force: true }) } }
}

const reasonsOf = async (change: Readonly<Record<string, string | null>>): Promise<string[]> => {
    const repo = repoWith(change)
    try { return await minorReasons(repo.root, repo.base) } finally { repo.cleanup() }
}

void test("a CSS fix, a new optional prop, a story, a lint spec, a new law and a runtime copy of @starci/hfs data are a patch", async () => {
    assert.deepEqual(await reasonsOf({
        "packages/grammar/src/common/styles.css": ".alert { padding: 8px; }\n",
        "packages/grammar/src/core/composite/Alert/index.tsx": BASE["packages/grammar/src/core/composite/Alert/index.tsx"]?.replace("    readonly tone?: string\n", "    readonly tone?: string\n    readonly leading?: string\n") ?? "",
        "packages/grammar/src/stories/Alert.stories.tsx": "export const Loading = {}\n",
        "packages/eslint-grammar-core/src/choice-controls.spec.ts": "// spec, more cases\n",
        "packages/eslint-grammar-core/runtime/knowledge/hfs/canon-pins.yaml": "pins: { moved: 1 }\n",
        "contexts/grammars/contract.yaml": "dna:\n  - id: DNA-COMMON-ONE\n  - id: DNA-COMMON-TWO\n  - id: DNA-COMMON-THREE\ndeprecated: [ButtonGroup]\n",
    }), [])
})

void test("a lint rule, a removed prop, a removed export, a removed law and a changed deprecated list are each a minor's", async () => {
    const reasons = await reasonsOf({
        "packages/eslint-grammar-core/src/choice-controls.ts": "export const rule = 2\n",
        "packages/grammar/src/core/composite/Alert/index.tsx": "export interface AlertProps {\n    readonly heading: string\n    readonly tone?: string\n}\nexport const Banner = () => null\n",
        "contexts/grammars/contract.yaml": "dna:\n  - id: DNA-COMMON-ONE\ndeprecated: [ButtonGroup, SegmentedControl]\n",
    })
    for (const expected of [
        /packages\/eslint-grammar-core\/src\/choice-controls\.ts changed: a lint rule of the Grammar family is a minor/u,
        /the member title is removed or renamed/u,
        /the export Alert is removed or renamed/u,
        /the law DNA-COMMON-TWO is removed or renamed/u,
        /a deprecated or forbidden entry changed/u,
    ]) assert.ok(reasons.some((reason) => expected.test(reason)), `${String(expected)}: ${reasons.join(" | ")}`)
})

void test("the CLI's pin judge reads a same-minor range as @starci/hfs does", () => {
    assert.equal(meetsPin("~0.21.38", "0.21.40"), true)
    assert.equal(meetsPin("~0.21.38", "0.22.0"), false)
    assert.equal(meetsPin("~0.21.38", "0.21.39-beta.1"), false)
    assert.equal(meetsPin("~0.21.39-beta.0", "0.21.39-beta.2"), true)
    assert.equal(meetsPin("5.11.3", "5.11.4"), false)
})
