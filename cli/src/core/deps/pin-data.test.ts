// The pin data hfs ships (runtime/knowledge/hfs/canon-pins.yaml) is what `app sync` renders into an app's package.json files: gallery/package.json's
// @starci/gallery, the Grammar, the canons. A publish copy of hfs carries the batch's versions in it by the rule of its manifest pins, so hfs
// 6.17.9-dev.1 renders the gallery 0.1.21-dev.1 published beside it instead of the committed 0.1.20. The committed file is never written.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { gunzipSync, gzipSync } from "node:zlib"
import type { WorkspacePackage } from "../../shared/workspace.js"
import { devClosure, devDataEdit, devNodes } from "./publish-dev.js"
import { pinRows } from "./publish-local.js"
import { dataPins, pinDataEdit, pinDataRows, pinnedData } from "./publish-pins.js"
import { withManifest } from "./tarball.js"

const here = dirname(fileURLToPath(import.meta.url))
/** The tree's own pin data, as the hfs folder commits it (dist/core/deps -> the repository root). */
const TREE_DATA = join(here, "..", "..", "..", "..", "packages", "hfs", "runtime", "knowledge", "hfs", "canon-pins.yaml")
const committed = readFileSync(TREE_DATA, "utf8")
const rowOf = (text: string, name: string) => pinDataRows(text).find((row) => row.name === name)

const BATCH = new Map([["@starci/hfs", "6.17.9-dev.1"], ["@starci/gallery", "0.1.21-dev.1"], ["@starci/grammar", "0.55.1-dev.1"]])

void test("a dev copy of hfs names the batch's gallery, Grammar and hfs in its pin data, ranges too, and keeps every other line", () => {
    const pins = dataPins(committed, BATCH, new Map(), () => false)
    assert.deepEqual([...pins.keys()].toSorted((left, right) => left.localeCompare(right)), ["@starci/gallery", "@starci/grammar", "@starci/hfs"])
    const copy = pinnedData(committed, pins, true)
    assert.equal(rowOf(copy, "@starci/gallery")?.version, "0.1.21-dev.1")
    assert.equal(rowOf(copy, "@starci/grammar")?.version, "0.55.1-dev.1")
    assert.equal(rowOf(copy, "@starci/grammar")?.range, "0.55.1-dev.1", "no range admits a prerelease")
    assert.equal(rowOf(copy, "@starci/hfs")?.version, "6.17.9-dev.1")
    assert.equal(rowOf(copy, "@starci/eslint-canon-fe")?.version, rowOf(committed, "@starci/eslint-canon-fe")?.version, "a package outside the batch stays")
    const before = committed.split("\n")
    const after = copy.split("\n")
    assert.equal(after.length, before.length)
    assert.equal(after.filter((line, at) => line !== before[at]).length, 4, "the gallery, Grammar (version and range) and hfs lines only")
    assert.equal(readFileSync(TREE_DATA, "utf8"), committed, "the committed file is never written")
})

void test("a real-version copy moves exact versions only, and a sibling outside the batch moves to the tree's version the registry serves", () => {
    const grammar = rowOf(committed, "@starci/grammar")?.version ?? ""
    const tree = new Map([["@starci/gallery", "0.1.99"]])
    const pins = dataPins(committed, new Map([["@starci/grammar", grammar.replace(/\d+$/u, (patch) => String(Number(patch) + 1))]]), tree, (name, version) => name === "@starci/gallery" && version === "0.1.99")
    const copy = pinnedData(committed, pins, false)
    assert.equal(rowOf(copy, "@starci/gallery")?.version, "0.1.99")
    assert.equal(rowOf(copy, "@starci/grammar")?.range, rowOf(committed, "@starci/grammar")?.range, "a release keeps its same-minor range")
    assert.equal(dataPins(committed, new Map(), tree, () => false).size, 0, "a tree version no registry serves is never pinned")
})

const header = (name: string, size: number): Buffer => {
    const block = Buffer.alloc(512)
    block.write(name, 0, "utf8")
    block.write("0000644\0", 100, "latin1")
    block.write(`${size.toString(8).padStart(11, "0")}\0`, 124, "latin1")
    block.write("0", 156, "latin1")
    block.fill(0x20, 148, 156)
    const sum = block.reduce((total, byte) => total + byte, 0)
    block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "latin1")
    return block
}
const entry = (name: string, body: string): Buffer => {
    const bytes = Buffer.from(body)
    return Buffer.concat([header(name, bytes.length), bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512)])
}
const fileIn = (gz: Buffer, wanted: string): string | undefined => {
    const tar = gunzipSync(gz)
    let offset = 0
    while (offset + 512 <= tar.length && tar[offset] !== 0) {
        const name = tar.subarray(offset, offset + 100).toString("utf8").replace(/\0.*$/su, "")
        const size = Number.parseInt(tar.subarray(offset + 124, offset + 135).toString("latin1"), 8)
        if (name === wanted) return tar.subarray(offset + 512, offset + 512 + size).toString("utf8")
        offset += 512 + Math.ceil(size / 512) * 512
    }
    return undefined
}

interface HfsRuntime {
    readonly bundledPins: (root: string) => Record<string, { readonly version: string } | undefined>
}
interface HfsSync {
    readonly render: (text: string, vars: Record<string, string>) => string
}

void test("the hfs copy of a batch of hfs, gallery and Grammar renders gallery/package.json pinning the batch's gallery", async () => {
    const data = "runtime/knowledge/hfs/canon-pins.yaml"
    const packed = gzipSync(Buffer.concat([entry("package/package.json", '{"name":"@starci/hfs","version":"6.17.8"}'), entry(`package/${data}`, committed), entry("package/README.md", "readme"), Buffer.alloc(1024)]))
    const copy = withManifest(packed, (text) => text.replace("6.17.8", "6.17.9-dev.1"), devDataEdit(BATCH, undefined))
    const shipped = fileIn(copy, `package/${data}`) ?? ""
    assert.equal(rowOf(shipped, "@starci/gallery")?.version, "0.1.21-dev.1")
    assert.equal(fileIn(copy, "package/README.md"), "readme")
    // The renderer of the installed hfs reads the copy's pin data from its runtime root, as a published hfs does from its own.
    const runtime = mkdtempSync(join(tmpdir(), "starci-pin-data-"))
    try {
        mkdirSync(join(runtime, "knowledge", "hfs"), { recursive: true })
        writeFileSync(join(runtime, "knowledge", "hfs", "canon-pins.yaml"), shipped)
        const hfsRoot = dirname(createRequire(import.meta.url).resolve("@starci/hfs/package.json"))
        const pinsModule = (await import(pathToFileURL(join(hfsRoot, "runtime", "scripts", "hfs", "canon-pins.mjs")).href)) as HfsRuntime
        const syncModule = (await import(pathToFileURL(join(hfsRoot, "sync", "index.mjs")).href)) as HfsSync
        const template = readFileSync(join(hfsRoot, "templates", "app", "gallery", "gallery", "package.json"), "utf8")
        const rendered = syncModule.render(template, { project: "app", galleryPort: "3550", galleryVite: "6.3.5", galleryPackage: pinsModule.bundledPins(runtime)["@starci/gallery"]?.version ?? "" })
        const manifest = JSON.parse(rendered) as { devDependencies: Record<string, string> }
        assert.equal(manifest.devDependencies["@starci/gallery"], "0.1.21-dev.1")
    } finally {
        rmSync(runtime, { recursive: true, force: true })
    }
})

void test("pin data nothing moves, and any other file, is kept byte for byte", () => {
    const edit = pinDataEdit(() => new Map(), true)
    assert.equal(edit("runtime/knowledge/hfs/canon-pins.yaml", committed), undefined)
    assert.equal(pinDataEdit(() => BATCH, true)("README.md", "x"), undefined)
})

/** The plain version one patch past `version` (a pin data row's version may be a range such as `^0.56.0`). */
const nextPatch = (version: string | undefined): string => {
    const match = /(\d+)\.(\d+)\.(\d+)/u.exec(version ?? "")
    assert.ok(match !== null, `a committed version, found ${String(version)}`)
    const [, major = "", minor = "", patch = ""] = match
    return `${major}.${minor}.${String(Number(patch) + 1)}`
}

const pkgAt = (root: string, dir: string, manifest: { readonly name: string; readonly version: string }): WorkspacePackage => {
    mkdirSync(join(root, dir), { recursive: true })
    writeFileSync(join(root, dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`)
    return { dir: join(root, dir), relativeDir: dir, name: manifest.name, version: manifest.version, private: false, scripts: {}, requires: {}, peers: {}, fileDependencies: [], dependsOn: [], entries: [], hasTsconfig: false, hasEslintConfig: false, workspaceRoot: false }
}

void test("a gallery change republishes hfs on the dev line, and deps publish-local reports the pin data rows its hfs copy moves", async () => {
    const root = mkdtempSync(join(tmpdir(), "starci-pin-data-tree-"))
    try {
        const hfs = pkgAt(root, "packages/hfs", { name: "@starci/hfs", version: "6.17.8" })
        // One past what the tree commits, so the rows move whatever release the committed pin data is at.
        const galleryNext = nextPatch(rowOf(committed, "@starci/gallery")?.version)
        const grammarNext = nextPatch(rowOf(committed, "@starci/grammar")?.version)
        const gallery = pkgAt(root, "packages/gallery", { name: "@starci/gallery", version: galleryNext })
        const grammar = pkgAt(root, "packages/grammar", { name: "@starci/grammar", version: grammarNext })
        const dataOf = (pkg: WorkspacePackage): string[] => (pkg.name === "@starci/hfs" ? [committed] : [])
        const nodes = devNodes([hfs, gallery, grammar], dataOf)
        assert.deepEqual([...devClosure(nodes, new Set(["@starci/gallery"]))].toSorted((left, right) => left.localeCompare(right)), ["@starci/gallery", "@starci/hfs"])
        const row = (pkg: WorkspacePackage) => ({ package: pkg.name, version: pkg.version, dir: pkg.relativeDir, npm: "unserved" as const, replaces: false, served: undefined, pins: [], pinned: new Map<string, string>() })
        const rows = await pinRows([row(hfs), row(gallery), row(grammar)], [hfs, gallery, grammar], undefined, dataOf)
        const hfsRow = rows.find((one) => one.package === "@starci/hfs")
        assert.equal(hfsRow?.dataPinned?.get("@starci/gallery"), galleryNext)
        assert.equal(hfsRow.dataPinned.get("@starci/grammar"), grammarNext)
        assert.ok(hfsRow.pins.some((line) => line.startsWith("@starci/gallery ") && line.endsWith(`-> ${galleryNext} (canon-pins.yaml)`)), hfsRow.pins.join("\n"))
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})
