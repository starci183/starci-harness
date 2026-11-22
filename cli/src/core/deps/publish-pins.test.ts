// The root fix of HFS_CLI_HFS_SKEW on the local registry: the train-194 local publish shipped starci-harness 1.1.0-alpha.194 requiring @starci/hfs 6.17.7
// while the same batch published hfs 6.17.8. A publish copy now pins the siblings of its own batch (as publish.yml's cli-follow does on npm), and a CLI
// published alone pins the newer hfs the tree holds once the registry serves it; one implementation for real versions and dev builds (publish-pins.ts).
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import type { WorkspacePackage } from "../../shared/workspace.js"
import { compareVersions, copyPins, movedPins, pinnedManifest } from "./publish-pins.js"
import { pinRows } from "./publish-local.js"

const CLI = { name: "starci-harness", version: "1.1.0-alpha.194", dependencies: { "@starci/hfs": "6.17.7", "@starci/seed": "0.3.0", zod: "4.6.7" } }
const CANON = { name: "@starci/eslint-canon-fe", version: "9.22.0", peerDependencies: { "@starci/hfs": "~6.17.0" }, devDependencies: { "@starci/hfs": "file:../hfs" } }

void test("versions compare by semver precedence, a prerelease below its release", () => {
    assert.equal(compareVersions("6.17.8", "6.17.7"), 1)
    assert.equal(compareVersions("6.17.7", "6.17.7"), 0)
    assert.equal(compareVersions("6.17.8-dev.1", "6.17.8"), -1)
    assert.equal(compareVersions("1.1.0-alpha.195", "1.1.0-alpha.194"), 1)
    assert.equal(compareVersions("1.1.0-alpha.10", "1.1.0-alpha.9"), 1, "numeric identifiers compare as numbers")
})

void test("a copy pins each sibling of its batch, and an exact sibling outside it at the tree's newer version only when the registry serves it", () => {
    const tree = new Map([["@starci/hfs", "6.17.8"], ["@starci/seed", "0.3.0"]])
    assert.deepEqual([...copyPins(CLI, new Map([["@starci/hfs", "6.17.8"]]), tree, () => false)], [["@starci/hfs", "6.17.8"]], "published together: the batch's version")
    assert.deepEqual([...copyPins(CLI, new Map(), tree, (name, version) => name === "@starci/hfs" && version === "6.17.8")], [["@starci/hfs", "6.17.8"]], "the CLI alone: the hfs the tree published before")
    assert.equal(copyPins(CLI, new Map(), tree, () => false).size, 0, "a tree version no registry serves is never pinned")
    assert.equal(copyPins(CLI, new Map(), new Map([["@starci/hfs", "6.17.6"]]), () => true).size, 0, "never pinned backwards")
    assert.equal(copyPins(CANON, new Map(), tree, () => true).size, 0, "a range is no exact pin: it already admits the tree's version")
})

void test("the copy moves exact pins only for a release, ranges too for a dev build, and never devDependencies or file: specs", () => {
    const text = `${JSON.stringify(CANON, null, 2)}\n`
    const pins = new Map([["@starci/hfs", "6.17.8"]])
    const release = JSON.parse(pinnedManifest(text, undefined, pins, false)) as typeof CANON
    assert.equal(release.version, "9.22.0", "a release keeps its committed version")
    assert.deepEqual(release.peerDependencies, { "@starci/hfs": "~6.17.0" })
    const dev = JSON.parse(pinnedManifest(text, "9.22.1-dev.1", new Map([["@starci/hfs", "6.17.9-dev.1"]]), true)) as typeof CANON
    assert.deepEqual(dev.peerDependencies, { "@starci/hfs": "6.17.9-dev.1" })
    assert.deepEqual(dev.devDependencies, { "@starci/hfs": "file:../hfs" })
    const cli = JSON.parse(pinnedManifest(`${JSON.stringify(CLI)}\n`, undefined, pins, false)) as typeof CLI
    assert.deepEqual(cli.dependencies, { "@starci/hfs": "6.17.8", "@starci/seed": "0.3.0", zod: "4.6.7" })
    assert.deepEqual(movedPins(CLI, pins, false), ["@starci/hfs 6.17.7 -> 6.17.8"])
})

const pkgAt = (root: string, dir: string, manifest: { readonly name: string; readonly version: string }): WorkspacePackage => {
    mkdirSync(join(root, dir), { recursive: true })
    writeFileSync(join(root, dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`)
    return { dir: join(root, dir), relativeDir: dir, name: manifest.name, version: manifest.version, private: false, scripts: {}, requires: {}, peers: {}, fileDependencies: [], dependsOn: [], entries: [], hasTsconfig: false, hasEslintConfig: false, workspaceRoot: false }
}

void test("deps publish-local plans the train-194 batch with the CLI pinning the hfs it publishes, and the CLI alone pinning the hfs the registry already serves", async () => {
    const root = mkdtempSync(join(tmpdir(), "starci-publish-pins-"))
    try {
        const cli = pkgAt(root, "cli", CLI)
        const hfs = pkgAt(root, "packages/hfs", { name: "@starci/hfs", version: "6.17.8" })
        const seed = pkgAt(root, "packages/seed", { name: "@starci/seed", version: "0.3.0" })
        const all = [cli, hfs, seed]
        const row = (pkg: WorkspacePackage) => ({ package: pkg.name, version: pkg.version, dir: pkg.relativeDir, npm: "unserved" as const, replaces: false, served: undefined, pins: [], pinned: new Map<string, string>() })
        const batch = await pinRows([row(hfs), row(cli)], all, undefined)
        assert.deepEqual(batch.find((one) => one.package === "starci-harness")?.pins, ["@starci/hfs 6.17.7 -> 6.17.8"], "even with the registry down: the batch is known")
        assert.deepEqual(batch.find((one) => one.package === "@starci/hfs")?.pins, [])
        const alone = await pinRows([row(cli)], all, (name) => Promise.resolve(name === "@starci/hfs" ? ["6.17.7", "6.17.8"] : ["0.3.0"]))
        assert.deepEqual(alone[0]?.pins, ["@starci/hfs 6.17.7 -> 6.17.8"], "--package cli alone")
        assert.equal(alone[0].pinned.get("@starci/hfs"), "6.17.8")
        const unserved = await pinRows([row(cli)], all, () => Promise.resolve(["6.17.7"]))
        assert.deepEqual(unserved[0]?.pins, [], "the hfs no registry serves yet stays as committed")
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})
