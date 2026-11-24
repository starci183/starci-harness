// A tracked package.json that is a template or a vendored copy is not a manifest the deps verbs read.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { captureGitSync } from "../../shared/git.js"
import { copiesStale, fileCopies, installStale, isManifest, tail } from "./packages.js"

void test("the root and workspace package.json files are manifests", () => {
    assert.equal(isManifest("package.json"), true)
    assert.equal(isManifest("packages/grammar/package.json"), true)
})

void test("a vendored copy and a handlebars template are not manifests", () => {
    assert.equal(isManifest("node_modules/x/package.json"), false)
    assert.equal(isManifest("packages/eslint-canon-be/runtime/packages/hfs/templates/app/package-scripts/package.json"), false)
})

// A package build installs only a stale install; a worktree whose node_modules links a cached install is not stale while the packages match (DEPS_INSTALL_LINKED).
const lockOf = (packages: Record<string, { version: string }>): string => JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "x" }, ...packages } })

void test("a linked node_modules whose install holds the lockfile's packages is not stale, however new the lockfile is", () => {
    const root = mkdtempSync(join(tmpdir(), "starci-stale-"))
    try {
        const shared = join(root, "shared", "node_modules")
        mkdirSync(shared, { recursive: true })
        const packages = { "node_modules/a": { version: "1.0.0" }, "node_modules/b": { version: "2.0.0" } }
        writeFileSync(join(shared, ".package-lock.json"), lockOf(packages))
        const folder = join(root, "checkout")
        mkdirSync(folder)
        symlinkSync(shared, join(folder, "node_modules"), "junction")
        writeFileSync(join(folder, "package-lock.json"), lockOf(packages))
        const later = new Date(Date.now() + 60_000)
        utimesSync(join(folder, "package-lock.json"), later, later)
        assert.equal(installStale(folder), false, "same packages, newer lockfile: nothing to install")
        writeFileSync(join(folder, "package-lock.json"), lockOf({ ...packages, "node_modules/b": { version: "2.1.0" } }))
        assert.equal(installStale(folder), true, "a locked version the install lacks is stale, and the refusal still guards the link")
        writeFileSync(join(folder, "package-lock.json"), lockOf({ ...packages, "node_modules/c": { version: "1.0.0" } }))
        assert.equal(installStale(folder), true, "a locked package the install lacks is stale")
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

void test("a folder with no install record is stale, and one with a record but no lockfile falls back to the record's age", () => {
    const root = mkdtempSync(join(tmpdir(), "starci-stale-"))
    try {
        assert.equal(installStale(root), true)
        mkdirSync(join(root, "node_modules"))
        writeFileSync(join(root, "node_modules", ".package-lock.json"), lockOf({}))
        assert.equal(installStale(root), false)
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

void test("a file: copy (install-links) is stale once its sibling's source moves past the install that copied it; a linked sibling never is", async () => {
    const root = mkdtempSync(join(tmpdir(), "starci-file-copies-"))
    try {
        const git = (...args: string[]): void => {
            assert.equal(captureGitSync(["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], root).exitCode, 0)
        }
        git("init", "-q")
        mkdirSync(join(root, "hfs", "runtime"), { recursive: true })
        writeFileSync(join(root, "hfs", "package.json"), '{ "name": "@starci/hfs", "version": "6.17.9" }\n')
        writeFileSync(join(root, "hfs", "runtime", "a.mjs"), "export {}\n")
        const fe = join(root, "fe")
        mkdirSync(join(fe, "node_modules", "@starci", "hfs"), { recursive: true })
        mkdirSync(join(fe, "node_modules", "@starci", "tsconfig-target"), { recursive: true })
        symlinkSync(join(fe, "node_modules", "@starci", "tsconfig-target"), join(fe, "node_modules", "@starci", "tsconfig"), "junction")
        writeFileSync(join(fe, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/@starci/hfs": { version: "5.13.0", resolved: "file:../hfs" }, "node_modules/@starci/tsconfig": { version: "2.0.0", resolved: "file:../tsconfig" }, "node_modules/eslint": { version: "9.0.0", resolved: "https://registry.npmjs.org/eslint/-/eslint-9.0.0.tgz" } } }))
        git("add", ".")
        git("commit", "-q", "-m", "start")
        assert.deepEqual([...fileCopies(fe).keys()], ["@starci/hfs"], "the junction is live; a registry package is no copy")
        const first = await copiesStale(fe)
        assert.equal(first.stale, true, "no install recorded the copy's source")
        writeFileSync(join(fe, "node_modules", ".starci-file-copies"), `${first.digest ?? ""}\n`)
        assert.equal((await copiesStale(fe)).stale, false, "the install recorded the sibling as it is")
        writeFileSync(join(root, "hfs", "runtime", "project-ext.mjs"), "export const extEslintConfigs = []\n")
        git("add", ".")
        git("commit", "-q", "-m", "hfs gains a module")
        assert.equal((await copiesStale(fe)).stale, true, "the lockfile still names the copy the same, yet hfs moved")
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

void test("the output of a failed npm run leads with the lines that name a cause, far above npm's closing lines", () => {
    const stdout = ["> prepack", "> npm test", "✖ src/config.spec.ts (496ms)", "Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'project-ext.mjs'", ...Array.from({ length: 30 }, (_, at) => `line ${String(at)}`)].join("\n")
    const text = tail(stdout, "npm error code 1\nnpm error command failed")
    assert.match(text.split("\n")[0] ?? "", /✖ src\/config\.spec\.ts/u)
    assert.match(text, /ERR_MODULE_NOT_FOUND/u)
    assert.match(text, /npm error command failed$/u)
})
