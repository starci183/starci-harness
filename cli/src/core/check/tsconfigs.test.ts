// The tsconfigs a package really holds: `tsconfig.json`, else every `tsconfig.*.json` (a Grammar keeps only build, stories and
// scripts configs), and none is a folder to be called red, never a pass. Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { tsconfigsOf } from "../../shared/workspace.js"
import { resolveTsconfig } from "./scope.js"

const scratch = (files: readonly string[], then: (root: string) => void): void => {
    const root = mkdtempSync(join(tmpdir(), "starci-tsconfigs-"))
    try {
        for (const file of files) {
            mkdirSync(join(root, file, ".."), { recursive: true })
            writeFileSync(join(root, file), "{}")
        }
        then(root)
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
}

void test("a folder with a tsconfig.json is judged by it alone", () => {
    scratch(["pkg/tsconfig.json", "pkg/tsconfig.build.json"], (root) => { assert.deepEqual(tsconfigsOf(join(root, "pkg")), ["tsconfig.json"]); })
})

void test("a folder with only tsconfig.*.json files is judged by every one of them, sorted", () => {
    scratch(["pkg/tsconfig.stories.json", "pkg/tsconfig.build.json", "pkg/tsconfig.scripts.json", "pkg/notes.json"], (root) => { assert.deepEqual(tsconfigsOf(join(root, "pkg")), ["tsconfig.build.json", "tsconfig.scripts.json", "tsconfig.stories.json"]); },
    )
})

void test("a folder with no tsconfig holds none, and the lookup walks up to the root then stops", () => {
    scratch(["pkg/src/a.ts", "up/tsconfig.build.json", "up/deep/a.ts"], (root) => {
        assert.deepEqual(tsconfigsOf(join(root, "pkg")), [])
        assert.equal(resolveTsconfig(root, join(root, "pkg", "src")), undefined)
        assert.equal(resolveTsconfig(root, join(root, "up", "deep")), join(root, "up"))
    })
})
