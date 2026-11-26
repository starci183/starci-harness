// Which packages the harness FAST gate tests for a diff: `release affected` (CI's own plan) turns the diff into the packages it touches and every
// package that needs one of them, and the gate runs each one's `npm test`, the command of CI's `package (...)` job. Over a throwaway repository with
// real commits, so the diff, the plan and the steps are the ones `lane gate` uses. Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { captureGitSync } from "../../shared/git.js"
import { listPackages } from "../../shared/workspace.js"
import { affectedBy } from "./affected.js"
import { harnessGateSteps } from "./gate.js"

interface Repo {
    readonly root: string
    /** Writes the files, commits them and returns the commit before (the base the gate measures from). */
    readonly commit: (files: Readonly<Record<string, string>>) => string
    readonly done: () => void
}

const manifest = (name: string, scripts: Readonly<Record<string, string>>): string => JSON.stringify({ name, version: "1.0.0", scripts })

/** A repository shaped like the harness: grammar (static checks as its test), a lint package whose spec pins grammar's version by path, one that reads neither, and the CLI. */
const harnessLike = (): Repo => {
    const root = mkdtempSync(join(tmpdir(), "starci-gate-selection-"))
    const git = (...args: string[]): string => {
        const result = captureGitSync(["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], root)
        assert.equal(result.exitCode, 0, result.stderr)
        return result.stdout.trim()
    }
    const write = (files: Readonly<Record<string, string>>): void => {
        for (const [path, text] of Object.entries(files)) {
            mkdirSync(dirname(join(root, path)), { recursive: true })
            writeFileSync(join(root, path), text)
        }
    }
    write({
        "contexts/README.md": "# contexts\n",
        "packages/grammar/package.json": manifest("@starci/grammar", { build: "tsc", typecheck: "tsc --noEmit", test: "npm run typecheck && npm run lint && npm run build" }),
        "packages/grammar/src/tabs.ts": "export const tabs = 1\n",
        "packages/eslint-grammar-core/package.json": manifest("@starci/eslint-grammar-core", { test: "node --test" }),
        "packages/eslint-grammar-core/src/index.spec.ts": 'export const pinned = "../../grammar/package.json"\n',
        "packages/heroicons/package.json": manifest("@starci/heroicons", { test: "node --test" }),
        "packages/heroicons/src/index.ts": "export const icon = 1\n",
        "packages/tsconfig/package.json": manifest("@starci/tsconfig", {}),
        "packages/tsconfig/base.json": "{}\n",
        "cli/package.json": manifest("starci-harness", { build: "tsc", typecheck: "tsc --noEmit", test: "node --test" }),
        "cli/src/main.ts": "export {}\n",
    })
    git("init", "-q")
    git("add", ".")
    git("commit", "-q", "-m", "base")
    return {
        root,
        commit: (files) => {
            write(files)
            git("add", ".")
            git("commit", "-q", "-m", "lane")
            return git("rev-parse", "HEAD~1")
        },
        done: () => {
            rmSync(root, { recursive: true, force: true })
        },
    }
}

/** The packages the FAST gate runs `npm test` in for the diff of the last commit, in step order. */
const testedFor = async (repo: Repo, files: Readonly<Record<string, string>>): Promise<string[]> => {
    const base = repo.commit(files)
    const plan = await affectedBy(repo.root, base, undefined)
    const all = listPackages(repo.root)
    const steps = harnessGateSteps(plan, "dev", (dir) => all.find((pkg) => pkg.relativeDir === dir)?.scripts ?? {})
    return steps.filter((step) => step.kind === "test").map((step) => step.dir)
}

void test("a grammar change tests grammar and the lint package whose spec pins its version, nothing it does not reach, never the CLI suite", async () => {
    const repo = harnessLike()
    try {
        assert.deepEqual(await testedFor(repo, { "packages/grammar/src/tabs.ts": "export const tabs = 2\n" }), ["packages/eslint-grammar-core", "packages/grammar"])
    } finally {
        repo.done()
    }
})

void test("a change to a leaf package tests that package alone", async () => {
    const repo = harnessLike()
    try {
        assert.deepEqual(await testedFor(repo, { "packages/eslint-grammar-core/src/index.spec.ts": 'export const pinned = "../../grammar/package.json" // moved\n' }), ["packages/eslint-grammar-core"])
        assert.deepEqual(await testedFor(repo, { "packages/heroicons/src/index.ts": "export const icon = 2\n" }), ["packages/heroicons"])
    } finally {
        repo.done()
    }
})

void test("a change to contexts or the CLI alone tests no package, and a package without a test script is never tested", async () => {
    const repo = harnessLike()
    try {
        assert.deepEqual(await testedFor(repo, { "contexts/README.md": "# contexts, reworded\n" }), [])
        assert.deepEqual(await testedFor(repo, { "cli/src/main.ts": "export const x = 1\n" }), [])
        assert.deepEqual(await testedFor(repo, { "packages/tsconfig/base.json": '{ "compilerOptions": {} }\n' }), [])
    } finally {
        repo.done()
    }
})
