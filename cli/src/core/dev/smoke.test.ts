// The smoke check of a swapped install: packages resolved by file the way Node does, from the root and each workspace, and from where each resolved package really
// lives (junctions followed), so a `Cannot find module` is found by the sync and not by the web's first request.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { resolveFrom, smokeInstall, smokeLine, workspaceFolders } from "./smoke.js"

const put = (file: string, content: string): void => {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content)
}
const pkg = (root: string, path: string, name: string, dependencies: Record<string, string> = {}): void => {
    put(join(root, path, "package.json"), JSON.stringify({ name, version: "1.0.0", dependencies }))
}

/** A root with the workspace fe/apps/web (next -> its own nested postcss -> picocolors hoisted at the root) and a lockfile that holds the probes. */
const tree = (t: { after: (fn: () => void) => void }): string => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "starci-smoke-")))
    t.after(() => {
        rmSync(root, { recursive: true, force: true })
    })
    put(join(root, "package.json"), JSON.stringify({ name: "app", workspaces: ["fe/apps/*"] }))
    pkg(root, "fe/apps/web", "@app/web", { next: "14.0.0", react: "18.0.0" })
    put(join(root, "package-lock.json"), JSON.stringify({ packages: { "": {}, "node_modules/next": {}, "node_modules/postcss": {}, "node_modules/picocolors": {}, "node_modules/next/node_modules/postcss": {} } }))
    pkg(root, "node_modules/next", "next", { postcss: "8.4.31", react: "18.0.0" })
    pkg(root, "node_modules/next/node_modules/postcss", "postcss", { picocolors: "1.0.0", nanoid: "3.0.0" })
    pkg(root, "node_modules/postcss", "postcss", { picocolors: "1.0.0" })
    pkg(root, "node_modules/picocolors", "picocolors")
    pkg(root, "node_modules/nanoid", "nanoid")
    pkg(root, "node_modules/react", "react")
    return root
}

void test("an install whose nested package finds its own dependencies resolves clean", (t) => {
    const root = tree(t)
    assert.deepEqual(smokeInstall(root), [])
})

void test("a hoisted package that is gone is named with the nested package that needs it (the picocolors of next/node_modules/postcss)", (t) => {
    const root = tree(t)
    rmSync(join(root, "node_modules", "picocolors"), { recursive: true })
    const failures = smokeInstall(root)
    assert.ok(failures.some((failure) => failure.name === "picocolors" && failure.from === "node_modules/next/node_modules/postcss" && failure.reason.includes("dependency of postcss")), JSON.stringify(failures))
    assert.ok(failures.some((failure) => failure.name === "picocolors" && failure.from === "."), "the root probe fails too")
    assert.match(smokeLine(failures), /picocolors from node_modules\/next\/node_modules\/postcss/u)
})

void test("a workspace's declared package that does not resolve from the workspace folder fails; a link to nothing is named", (t) => {
    const root = tree(t)
    rmSync(join(root, "node_modules", "react"), { recursive: true })
    assert.ok(smokeInstall(root).some((failure) => failure.name === "react" && failure.from === "fe/apps/web"))
    const linked = tree(t)
    rmSync(join(linked, "node_modules", "next"), { recursive: true })
    mkdirSync(join(linked, "gone"))
    symlinkSync(join(linked, "gone"), join(linked, "node_modules", "next"), process.platform === "win32" ? "junction" : "dir")
    rmSync(join(linked, "gone"), { recursive: true })
    assert.ok(smokeInstall(linked).length > 0, "a package whose link points nowhere is not resolved")
})

void test("workspace patterns expand to the folders that hold a package.json, and resolution walks the chain up", (t) => {
    const root = tree(t)
    pkg(root, "fe/apps/api", "@app/api")
    mkdirSync(join(root, "fe", "apps", "empty"))
    assert.deepEqual(workspaceFolders(root).map((folder) => folder.replaceAll("\\", "/").split("/").slice(-1)[0]), ["api", "web"])
    assert.equal(resolveFrom(join(root, "fe", "apps", "web"), "react"), join(root, "node_modules", "react"))
    assert.equal(resolveFrom(join(root, "fe", "apps", "web"), "nope"), undefined)
})
