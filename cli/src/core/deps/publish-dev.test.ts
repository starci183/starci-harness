// Owner 2026-11-22: "bản thân .claude cũng tách thành dev main được không? dev code xong merge nhanh để xài local". After a harness batch lands on dev, its
// changed packages and every package that pins one of them go to the local registry as X.Y.Z-dev.N; the publish copies pin each other exactly, the committed
// files stay plain, and devSync.local names exactly those versions (core/deps/publish-dev.ts).
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { loadLocalSettings, writeDevSyncLocal } from "../../harness/local-settings.js"
import type { WorkspacePackage } from "../../shared/workspace.js"
import { changedNodes, devClosure, devManifest, devVersion, executeDevPlan, nextDevNumber, nextRelease, planDevPublish, readCounter, readDevRecord } from "./publish-dev.js"
import type { DevNode, DevQuestions } from "./publish-dev.js"

const node = (name: string, dir: string, version: string, requires: readonly string[] = []): DevNode => ({ name: `@starci/${name}`, dir, version, requires: new Set(requires.map((one) => `@starci/${one}`)) })

/** The shape of the harness's real graph: requirements in dependencies or peerDependencies (devDependencies and file: specs never count). */
const NODES: DevNode[] = [
    node("common", "packages/common", "1.0.1"),
    node("seed", "packages/seed", "0.3.0", ["common"]),
    node("hfs", "packages/hfs", "6.17.8", ["seed"]),
    node("tsconfig", "packages/tsconfig", "2.1.1"),
    node("eslint-canon-fe", "packages/eslint-canon-fe", "9.22.0", ["hfs"]),
    node("eslint-grammar-core", "packages/eslint-grammar-core", "0.55.0", ["eslint-canon-fe", "hfs"]),
    node("eslint-grammar-offset-pop", "packages/eslint-grammar-offset-pop", "0.55.0", ["eslint-grammar-core"]),
    node("grammar", "packages/grammar", "0.55.0"),
    node("gallery", "packages/gallery", "0.1.20", ["grammar"]),
    node("jest-preset", "packages/jest-preset", "2.12.0"),
    { name: "starci-harness", dir: "cli", version: "1.1.0-alpha.194", requires: new Set(["@starci/hfs", "@starci/seed"]) },
]
const ORDER = NODES.map((one) => one.dir)

void test("the closure of a change is the changed packages and every package that pins one of them, transitively", () => {
    assert.deepEqual([...devClosure(NODES, new Set(["@starci/grammar"]))].toSorted((left, right) => left.localeCompare(right)), ["@starci/gallery", "@starci/grammar"])
    assert.deepEqual(
        [...devClosure(NODES, new Set(["@starci/hfs"]))].toSorted((left, right) => left.localeCompare(right)),
        ["@starci/eslint-canon-fe", "@starci/eslint-grammar-core", "@starci/eslint-grammar-offset-pop", "@starci/hfs", "starci-harness"],
    )
    assert.deepEqual([...devClosure(NODES, new Set(["@starci/jest-preset"]))], ["@starci/jest-preset"], "a package nobody pins is published alone")
    assert.equal(devClosure(NODES, new Set(["@starci/tsconfig"])).size, 1, "devDependencies (file: tsconfig) never pull a dependent in")
})

void test("a changed file names its package, and a tree the CLI's tarball carries names the CLI", () => {
    assert.deepEqual([...changedNodes(NODES, ["packages/grammar/src/a.ts", "packages/hfs/README.md"])].toSorted((left, right) => left.localeCompare(right)), ["@starci/grammar", "@starci/hfs"])
    assert.deepEqual([...changedNodes(NODES, ["contexts/project/cicd.md"])], ["starci-harness"])
    assert.equal(changedNodes(NODES, [".github/workflows/ci.yml"]).size, 0)
})

void test("a dev build is the next release with a monotonic dev number", () => {
    assert.equal(nextRelease("0.55.0", true), "0.55.1", "npm serves the committed version: the next patch")
    assert.equal(nextRelease("0.56.0", false), "0.56.0", "a committed bump npm does not serve yet is the next release")
    assert.equal(nextRelease("1.1.0-alpha.194", true), "1.1.0-alpha.195")
    assert.equal(devVersion("0.55.1", 3), "0.55.1-dev.3")
    assert.equal(devVersion("1.1.0-alpha.195", 1), "1.1.0-alpha.195.dev.1")
    assert.equal(nextDevNumber("0.55.1", ["0.55.0", "0.55.1-dev.1", "0.55.1-dev.4", "0.55.2-dev.9"]), 5, "the registry's dev builds of that release")
    assert.equal(nextDevNumber("0.55.1", ["0.55.1-dev.1"], 7), 8, "the machine's counter wins when it counted further")
    assert.equal(nextDevNumber("0.55.1", []), 1)
})

void test("the publish copy carries the dev version and pins the dev line exactly; devDependencies and file: specs stay", () => {
    const committed = `${JSON.stringify({ name: "@starci/eslint-grammar-core", version: "0.55.0", peerDependencies: { "@starci/eslint-canon-fe": "~9.22.0", "@starci/hfs": "~6.17.0", eslint: "^10" }, devDependencies: { "@starci/hfs": "file:../hfs" } }, null, 4)}\n`
    const pins = new Map([["@starci/hfs", "6.17.9-dev.2"], ["@starci/eslint-canon-fe", "9.22.1-dev.1"]])
    const copy = JSON.parse(devManifest(committed, "0.55.1-dev.1", pins)) as Record<string, Record<string, string> | string>
    assert.equal(copy.version, "0.55.1-dev.1")
    assert.deepEqual(copy.peerDependencies, { "@starci/eslint-canon-fe": "9.22.1-dev.1", "@starci/hfs": "6.17.9-dev.2", eslint: "^10" })
    assert.deepEqual(copy.devDependencies, { "@starci/hfs": "file:../hfs" })
    assert.match(devManifest(committed, "0.55.1-dev.1", pins), /^\{\n {4}"name"/, "the file's own indent")
    const crlf = devManifest(committed.replaceAll("\n", "\r\n"), "0.55.1-dev.1", pins)
    assert.ok(crlf.endsWith("}\r\n") && !/[^\r]\n/.test(crlf), "the file's own line ending")
})

const asked = (served: ReadonlySet<string>, listed: Readonly<Record<string, readonly string[]>> = {}): DevQuestions => ({
    onNpm: (name, version) => Promise.resolve(served.has(`${name}@${version}`)),
    listed: (name) => Promise.resolve(listed[name] ?? []),
    counted: () => 0,
})

void test("a plan publishes the closure in dependency order, keeps the overlay's other dev builds pinned and drops those a release caught up with", async () => {
    const plan = await planDevPublish({
        nodes: NODES,
        changed: new Set(["@starci/grammar"]),
        order: ORDER,
        overlay: ["@starci/hfs@6.17.9-dev.1", "@starci/seed@0.3.1-dev.2", "@starci/grammar@0.55.1-dev.1", "@starci/heroicons"],
        asked: asked(new Set(["@starci/grammar@0.55.0", "@starci/gallery@0.1.20", "@starci/seed@0.3.1"]), { "@starci/grammar": ["0.55.0", "0.55.1-dev.1"] }),
    })
    assert.deepEqual(plan.rows.map((row) => [row.package, row.version, row.why]), [
        ["@starci/grammar", "0.55.1-dev.2", "changed"],
        ["@starci/gallery", "0.1.21-dev.1", "pins a dev build"],
    ])
    assert.equal(plan.pins.get("@starci/grammar"), "0.55.1-dev.2", "gallery's copy pins the grammar published with it")
    assert.equal(plan.pins.get("@starci/hfs"), "6.17.9-dev.1", "a dev build the overlay still names stays pinned")
    assert.equal(plan.pins.has("@starci/seed"), false, "npm serves seed 0.3.1: its dev build is dropped")
    assert.deepEqual(plan.dropped, ["@starci/seed@0.3.1-dev.2"])
    assert.deepEqual(plan.local, ["@starci/gallery@0.1.21-dev.1", "@starci/grammar@0.55.1-dev.2", "@starci/heroicons", "@starci/hfs@6.17.9-dev.1"])
})

const workspacePackage = (dir: string, root: string, one: DevNode): WorkspacePackage => ({
    dir: join(root, dir), relativeDir: dir, name: one.name, version: one.version, private: false, scripts: { build: "tsc" }, requires: {}, peers: {}, fileDependencies: [], dependsOn: [], entries: [], hasTsconfig: true, hasEslintConfig: false, workspaceRoot: false,
})

void test("an executed plan builds the prerequisites, publishes edited copies (never the committed files), counts each build and writes devSync.local exactly", async () => {
    const folder = mkdtempSync(join(tmpdir(), "starci-publish-dev-"))
    try {
        const settings = join(folder, "local-settings.json")
        writeFileSync(settings, `${JSON.stringify({ devSync: { afterLand: true, checkout: "D:/apps/nivo", local: ["@starci/hfs@6.17.9-dev.1"] }, other: { kept: true } }, null, 2)}\n`)
        const committed = `${JSON.stringify({ name: "@starci/gallery", version: "0.1.20", dependencies: { "@starci/grammar": "0.55.0" } }, null, 2)}\n`
        const files = { record: join(folder, "dev-publish.json"), counter: join(folder, "dev-counter.json"), settings }
        const plan = await planDevPublish({ nodes: NODES, changed: new Set(["@starci/grammar"]), order: ORDER, overlay: loadLocalSettings(settings).devSync.local, asked: asked(new Set(["@starci/grammar@0.55.0", "@starci/gallery@0.1.20"])) })
        const byDir = new Map(NODES.map((one) => [one.dir, one]))
        const packages = ORDER.map((dir) => workspacePackage(dir, folder, byDir.get(dir) ?? NODES[0] ?? node("x", dir, "0.0.0")))
        const built: string[] = []
        const copies = new Map<string, string>()
        const published = await executeDevPlan({
            plan, packages, order: ORDER, head: "f".repeat(40),
            needs: (dir) => (dir === "packages/gallery" ? ["packages/grammar", "packages/gallery"] : [dir]),
            io: {
                build: (pkg) => {
                    built.push(pkg.relativeDir)
                    return Promise.resolve()
                },
                publish: (pkg, row, edit) => {
                    copies.set(row.package, edit(pkg.name === "@starci/gallery" ? committed : `${JSON.stringify({ name: pkg.name, version: pkg.version })}\n`))
                    return Promise.resolve()
                },
                files,
                say: () => undefined,
            },
        })
        assert.deepEqual(built, ["packages/grammar", "packages/gallery"])
        assert.deepEqual(published, ["@starci/grammar@0.55.1-dev.1", "@starci/gallery@0.1.21-dev.1"])
        const gallery = JSON.parse(copies.get("@starci/gallery") ?? "{}") as { version: string; dependencies: Record<string, string> }
        assert.equal(gallery.version, "0.1.21-dev.1")
        assert.deepEqual(gallery.dependencies, { "@starci/grammar": "0.55.1-dev.1" })
        assert.match(committed, /"@starci\/grammar": "0.55.0"/, "the committed manifest is never rewritten")
        assert.deepEqual(readCounter(files.counter), { "@starci/grammar@0.55.1": 1, "@starci/gallery@0.1.21": 1 })
        assert.equal(readDevRecord(files.record)?.sha, "f".repeat(40))
        const written = JSON.parse(readFileSync(settings, "utf8")) as { devSync: { local: string[]; afterLand: boolean; checkout: string }; other: unknown }
        assert.deepEqual(written.devSync.local, ["@starci/gallery@0.1.21-dev.1", "@starci/grammar@0.55.1-dev.1", "@starci/hfs@6.17.9-dev.1"])
        assert.equal(written.devSync.afterLand, true, "every other setting is kept")
        assert.equal(written.devSync.checkout, "D:/apps/nivo")
        assert.deepEqual(written.other, { kept: true })
        const again = await planDevPublish({ nodes: NODES, changed: new Set(["@starci/grammar"]), order: ORDER, overlay: loadLocalSettings(settings).devSync.local, asked: { ...asked(new Set(["@starci/grammar@0.55.0", "@starci/gallery@0.1.20"])), counted: (name, next) => readCounter(files.counter)[`${name}@${next}`] ?? 0 } })
        assert.deepEqual(again.rows.map((row) => row.version), ["0.55.1-dev.2", "0.1.21-dev.2"], "a rerun never reuses a number, even while the registry is down")
    } finally {
        rmSync(folder, { recursive: true, force: true })
    }
})

void test("devSync.local is written into an absent settings file, and a damaged one is refused, never overwritten", () => {
    const folder = mkdtempSync(join(tmpdir(), "starci-local-settings-"))
    try {
        const file = join(folder, "local-settings.json")
        writeDevSyncLocal(file, ["@starci/grammar@0.55.1-dev.1"])
        assert.deepEqual(loadLocalSettings(file).devSync.local, ["@starci/grammar@0.55.1-dev.1"])
        assert.equal(loadLocalSettings(file).devSync.publishLocal, false, "the dev publish is off unless the machine turns it on")
        writeFileSync(file, "{ not json")
        assert.throws(() => {
            writeDevSyncLocal(file, [])
        }, /LOCAL_SETTINGS_INVALID|not JSON/)
        assert.equal(readFileSync(file, "utf8"), "{ not json")
    } finally {
        rmSync(folder, { recursive: true, force: true })
    }
})
