// `deps install-local` across install units: the root and its workspaces share the root lockfile, and a subfolder package with its own
// package-lock.json (a separate npm package, not a workspace) is installed in its own folder. Fixture trees in a scratch git repository;
// npm is a stand-in that writes what a real install would record in the unit's lockfile.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import test from "node:test"
import { captureGitSync } from "../../shared/git.js"
import { Refusal } from "../../shared/errors.js"
import { applyInstall, applyRestore, installUnitOf, planInstall } from "./install-local.js"
import type { InstallRecord, UnitNpm } from "./install-local.js"

const PORT = 4873
const LOCAL = `http://127.0.0.1:${String(PORT)}`
const NPMJS = "https://registry.npmjs.org"

const lock = (packages: Record<string, { version: string; resolved: string }>): string =>
    `${JSON.stringify({ name: "x", lockfileVersion: 3, requires: true, packages: { "": { name: "x" }, ...Object.fromEntries(Object.entries(packages).map(([name, one]) => [`node_modules/${name}`, { ...one, integrity: "sha512-fixture" }])) } }, null, 2)}\n`

const tarball = (base: string, name: string, version: string): string => `${base}/${name}/-/${name.split("/").at(-1) ?? name}-${version}.tgz`

/** A root with workspaces (packages/*), one workspace pinning the Grammar, and gallery/: a package of its own with its own lockfile. */
const fixture = (t: { after: (fn: () => void) => void }): string => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "starci-install-units-")))
    t.after(() => {
        rmSync(base, { recursive: true, force: true })
    })
    const root = join(base, "app")
    const write = (file: string, text: string): void => {
        mkdirSync(join(root, file, ".."), { recursive: true })
        writeFileSync(join(root, file), text)
    }
    write("package.json", '{\n  "name": "app",\n  "private": true,\n  "workspaces": ["packages/*"]\n}\n')
    write("package-lock.json", lock({ "@starci/grammar": { version: "0.55.0", resolved: tarball(NPMJS, "@starci/grammar", "0.55.0") }, "@starci/hfs": { version: "6.17.8", resolved: tarball(NPMJS, "@starci/hfs", "6.17.8") } }))
    write("packages/web/package.json", '{\n  "name": "web",\n  "version": "1.0.0",\n  "dependencies": {\n    "@starci/grammar": "0.55.0"\n  }\n}\n')
    write("gallery/package.json", '{\n  "name": "app-gallery",\n  "private": true,\n  "devDependencies": {\n    "@starci/gallery": "0.1.20"\n  }\n}\n')
    write("gallery/package-lock.json", lock({ "@starci/gallery": { version: "0.1.20", resolved: tarball(NPMJS, "@starci/gallery", "0.1.20") } }))
    assert.equal(captureGitSync(["init", "-q", "-b", "main", root], base).exitCode, 0)
    assert.equal(captureGitSync(["add", "-A"], root).exitCode, 0)
    return root
}

/** A stand-in npm: records each call's folder and writes the versions of `versions` into the folder's lockfile, from `from`. */
const fakeNpm = (root: string, versions: Record<string, string>, from: (folder: string) => string, calls: string[]): UnitNpm => async (folder) => {
    const unit = relative(root, folder).replaceAll("\\", "/")
    calls.push(unit)
    const file = join(folder, "package-lock.json")
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { packages: Record<string, unknown> }
    const read = (file: string): Record<string, Record<string, string> | undefined> => JSON.parse(readFileSync(join(root, file), "utf8")) as Record<string, Record<string, string> | undefined>
    const wanted: Record<string, string | undefined> = unit === "" ? { ...read("package.json").overrides, ...read("packages/web/package.json").dependencies } : { ...read(`${unit}/package.json`).devDependencies }
    for (const name of Object.keys(versions)) {
        const version = wanted[name]
        if (version !== undefined) parsed.packages[`node_modules/${name}`] = { version, resolved: tarball(from(unit), name, version), integrity: "sha512-fixture" }
    }
    writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`)
    await Promise.resolve()
}

void test("a manifest belongs to the nearest folder holding a lockfile: workspaces to the root, gallery/ to itself", (t) => {
    const root = fixture(t)
    assert.equal(installUnitOf(root, "package.json"), "")
    assert.equal(installUnitOf(root, "packages/web/package.json"), "")
    assert.equal(installUnitOf(root, "gallery/package.json"), "gallery")
})

void test("the plan edits each pin in the unit that owns it, and a name pinned nowhere keeps the root overrides", async (t) => {
    const root = fixture(t)
    const gallery = await planInstall(root, [{ name: "@starci/gallery", version: "0.1.21-dev.1" }], undefined)
    assert.deepEqual(gallery.units, [{ folder: "gallery", names: ["@starci/gallery"] }])
    assert.deepEqual([...gallery.texts.keys()], ["gallery/package.json"])
    assert.match(gallery.texts.get("gallery/package.json") ?? "", /"@starci\/gallery": "0\.1\.21-dev\.1"/)
    const both = await planInstall(root, [{ name: "@starci/grammar", version: "0.55.1-dev.1" }, { name: "@starci/gallery", version: "0.1.21-dev.1" }], undefined)
    assert.deepEqual(both.units, [{ folder: "", names: ["@starci/grammar"] }, { folder: "gallery", names: ["@starci/gallery"] }])
    const hfs = await planInstall(root, [{ name: "@starci/hfs", version: "6.17.9-dev.1" }], undefined)
    assert.deepEqual(hfs.units, [{ folder: "", names: ["@starci/hfs"] }])
    assert.deepEqual(hfs.packages[0]?.pins, [{ file: "package.json", field: "overrides", spec: null }])
})

void test("a name neither pinned nor locked is left out: an override cannot add a package the tree never installs", async (t) => {
    const root = fixture(t)
    const plan = await planInstall(root, [{ name: "@starci/eslint-grammar-offset-pop", version: "0.55.1-dev.1" }, { name: "@starci/grammar", version: "0.55.1-dev.1" }], undefined)
    assert.deepEqual(plan.absent, ["@starci/eslint-grammar-offset-pop"])
    assert.deepEqual(plan.packages.map((one) => one.name), ["@starci/grammar"])
    assert.deepEqual(plan.units, [{ folder: "", names: ["@starci/grammar"] }])
    assert.doesNotMatch(plan.texts.get("package.json") ?? "", /offset-pop/)
    const calls: string[] = []
    await applyInstall(root, plan, PORT, fakeNpm(root, { "@starci/grammar": "" }, () => LOCAL, calls))
    assert.deepEqual(calls, [""])
})

void test("an install runs npm in each unit's folder and checks each unit's lockfile", async (t) => {
    const root = fixture(t)
    const plan = await planInstall(root, [{ name: "@starci/grammar", version: "0.55.1-dev.1" }, { name: "@starci/gallery", version: "0.1.21-dev.1" }], undefined)
    const calls: string[] = []
    await applyInstall(root, plan, PORT, fakeNpm(root, { "@starci/grammar": "", "@starci/gallery": "" }, () => LOCAL, calls))
    assert.deepEqual(calls, ["", "gallery"])
    assert.match(readFileSync(join(root, "gallery/package-lock.json"), "utf8"), /127\.0\.0\.1:4873\/@starci\/gallery\/-\/gallery-0\.1\.21-dev\.1\.tgz/)
    assert.match(readFileSync(join(root, "package-lock.json"), "utf8"), /127\.0\.0\.1:4873\/@starci\/grammar/)
})

void test("a unit whose lockfile still resolves from npm refuses, and every unit's manifests and lockfile are put back", async (t) => {
    const root = fixture(t)
    const files = ["package.json", "package-lock.json", "packages/web/package.json", "gallery/package.json", "gallery/package-lock.json"]
    const before = files.map((file) => readFileSync(join(root, file), "utf8"))
    const plan = await planInstall(root, [{ name: "@starci/grammar", version: "0.55.1-dev.1" }, { name: "@starci/gallery", version: "0.1.21-dev.1" }], undefined)
    await assert.rejects(
        applyInstall(root, plan, PORT, fakeNpm(root, { "@starci/grammar": "", "@starci/gallery": "" }, (unit) => (unit === "gallery" ? NPMJS : LOCAL), [])),
        (error: unknown) => error instanceof Refusal && error.code === "INSTALL_LOCAL_NOT_RESOLVED" && error.message.includes("@starci/gallery (gallery/package-lock.json)") && !error.message.includes("@starci/grammar"),
    )
    assert.deepEqual(files.map((file) => readFileSync(join(root, file), "utf8")), before)
})

void test("a restore puts back the pins of every unit and reinstalls in each; a failed restore puts every unit's files back", async (t) => {
    const root = fixture(t)
    const plan = await planInstall(root, [{ name: "@starci/gallery", version: "0.1.21-dev.1" }], undefined)
    await applyInstall(root, plan, PORT, fakeNpm(root, { "@starci/gallery": "" }, () => LOCAL, []))
    const record: InstallRecord = { schema: "starci/deps-install-local@1", registry: LOCAL, packages: plan.packages }
    const files = ["package.json", "package-lock.json", "gallery/package.json", "gallery/package-lock.json"]
    const installed = files.map((file) => readFileSync(join(root, file), "utf8"))
    await assert.rejects(applyRestore(root, record, () => Promise.reject(new Error("npm failed"))), /npm failed/)
    assert.deepEqual(files.map((file) => readFileSync(join(root, file), "utf8")), installed)
    const calls: string[] = []
    const done = await applyRestore(root, record, fakeNpm(root, { "@starci/gallery": "" }, () => NPMJS, calls))
    assert.deepEqual(calls, ["", "gallery"])
    assert.deepEqual(done.units.map((unit) => unit.folder), ["", "gallery"])
    assert.match(readFileSync(join(root, "gallery/package.json"), "utf8"), /"@starci\/gallery": "0\.1\.20"/)
    assert.doesNotMatch(readFileSync(join(root, "gallery/package-lock.json"), "utf8"), /127\.0\.0\.1/)
})
