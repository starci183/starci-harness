// A tracked package.json that is a template or a vendored copy is not a manifest the deps verbs read.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { installStale, isManifest } from "./packages.js"

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
