// An app puts its own workspace packages on the local registry: hfs.json `publishes` names them, an undeclared package is refused by name, a repository
// with no declaration is refused with the key named, and a declared version obeys the harness's version rule (one version, one source digest).
// Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { captureGitSync } from "../../shared/git.js"
import type { WorkspacePackage } from "../../shared/workspace.js"
import { appBuildOrder, appPackages, declaredPublishes } from "./app-publishes.js"
import { sourceDigest } from "./pack-stamped.js"
import { depsPublishLocalVerb, planOne } from "./publish-local.js"

const refusal = (code: string) => (error: unknown) => error instanceof Error && "code" in error && error.code === code

const member = (name: string, dir: string, extra: Partial<WorkspacePackage> = {}): WorkspacePackage => ({ dir: `/app/${dir}`, relativeDir: dir, name, version: "0.1.0", private: false, scripts: {}, requires: {}, peers: {}, fileDependencies: [], dependsOn: [], entries: [], hasTsconfig: false, hasEslintConfig: false, workspaceRoot: false, ...extra })

const all = [
    member("@starci/nivoos-cli", "packages/nivoos-cli", { dependsOn: ["@starci/nivoos-sdk"] }),
    member("@starci/nivoos-sdk", "packages/nivoos-sdk"),
    member("@starci/nivoos-provider-templates", "packages/provider-templates", { dependsOn: ["@starci/nivoos-sdk"] }),
    member("@starci/nivoos-seed", "packages/seed"),
    member("@starci/nivoos-secret", "packages/secret", { private: true }),
]
const DECLARED = ["packages/nivoos-cli", "packages/nivoos-sdk", "packages/provider-templates"]

const appCheckout = (t: test.TestContext, hfs: unknown): { root: string } => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "starci-app-publishes-")))
    t.after(() => {
        rmSync(root, { recursive: true, force: true })
    })
    const dir = join(root, "packages", "nivoos-sdk")
    mkdirSync(join(dir, "src"), { recursive: true })
    writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name: "@starci/nivoos-sdk", version: "0.1.0" }, null, 2)}\n`)
    writeFileSync(join(dir, "src", "a.ts"), "export const a = 1\n")
    if (hfs !== undefined) writeFileSync(join(root, "hfs.json"), `${JSON.stringify(hfs, null, 2)}\n`)
    assert.equal(captureGitSync(["init", "-q", "-b", "main", root], root).exitCode, 0)
    assert.equal(captureGitSync(["-C", root, "add", "."], root).exitCode, 0)
    assert.equal(captureGitSync(["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "x"], root).exitCode, 0)
    return { root }
}

void test("hfs.json publishes names the folders; no key (or no hfs.json) declares nothing, a malformed one is refused", (t) => {
    assert.deepEqual(declaredPublishes(appCheckout(t, { hfs: 3, publishes: DECLARED }).root), DECLARED)
    assert.equal(declaredPublishes(appCheckout(t, { hfs: 3, kind: "app" }).root), undefined)
    assert.equal(declaredPublishes(appCheckout(t, undefined).root), undefined)
    for (const bad of [[], "packages/x", ["../x"], ["packages/x", "packages/x"], [3], ["/abs"]]) {
        assert.throws(() => declaredPublishes(appCheckout(t, { hfs: 3, publishes: bad }).root), refusal("PUBLISH_LOCAL_DECLARATION_BAD"))
    }
})

void test("an app publishes exactly the declared packages, by folder or name", () => {
    assert.deepEqual(
        appPackages(all, DECLARED, []).map((pkg) => pkg.name),
        ["@starci/nivoos-cli", "@starci/nivoos-sdk", "@starci/nivoos-provider-templates"],
    )
    assert.deepEqual(
        appPackages(all, DECLARED, ["@starci/nivoos-sdk", "packages/provider-templates"]).map((pkg) => pkg.relativeDir),
        ["packages/nivoos-sdk", "packages/provider-templates"],
    )
})

void test("a package the app has but does not declare is refused by name; one it has not at all is unknown", () => {
    assert.throws(
        () => appPackages(all, DECLARED, ["@starci/nivoos-seed"]),
        (error: unknown) => refusal("PUBLISH_LOCAL_UNDECLARED")(error) && error instanceof Error && error.message.includes("@starci/nivoos-seed") && error.message.includes("publishes"),
    )
    assert.throws(() => appPackages(all, DECLARED, ["packages/seed"]), refusal("PUBLISH_LOCAL_UNDECLARED"))
    assert.throws(() => appPackages(all, DECLARED, ["@starci/nobody"]), refusal("RELEASE_PACKAGE_UNKNOWN"))
})

void test("a declared folder that is no package, or is private, is refused", () => {
    assert.throws(() => appPackages(all, ["packages/missing"], []), refusal("PUBLISH_LOCAL_DECLARATION_BAD"))
    assert.throws(
        () => appPackages(all, ["packages/secret"], []),
        (error: unknown) => refusal("PUBLISH_LOCAL_DECLARATION_BAD")(error) && error instanceof Error && error.message.includes("private"),
    )
})

void test("a declared package builds after the declared packages it depends on", () => {
    assert.deepEqual(appBuildOrder(appPackages(all, DECLARED, [])), ["packages/nivoos-sdk", "packages/nivoos-cli", "packages/provider-templates"])
})

void test("a declared package plans under the harness's version rule: its committed version, judged against npm by source digest", async (t) => {
    const { root } = appCheckout(t, { hfs: 3, publishes: ["packages/nivoos-sdk"] })
    const pkg = member("@starci/nivoos-sdk", "packages/nivoos-sdk", { dir: join(root, "packages", "nivoos-sdk") })
    const digest = await sourceDigest(root, "packages/nivoos-sdk")
    assert.equal((await planOne(root, pkg, { served: () => Promise.resolve(undefined), listed: undefined })).npm, "unserved")
    assert.equal((await planOne(root, pkg, { served: () => Promise.resolve({ integrity: "sha512-x", source: digest }), listed: () => Promise.resolve(["0.1.0"]) })).replaces, true)
    await assert.rejects(planOne(root, pkg, { served: () => Promise.resolve({ integrity: "sha512-x", source: "b".repeat(64) }), listed: undefined }), refusal("PUBLISH_LOCAL_VERSION_TAKEN"))
})

void test("publish-local in a repository with no declaration is refused with the hfs.json key named; an undeclared or unknown package is refused before any registry call", async (t) => {
    const bare = appCheckout(t, { hfs: 3, kind: "app" })
    await assert.rejects(
        Promise.resolve(depsPublishLocalVerb.run({ cwd: bare.root, progress: () => undefined } as never, { execute: false, package: [], cwd: bare.root })),
        (error: unknown) => refusal("PUBLISH_LOCAL_NOT_HARNESS")(error) && error instanceof Error && error.message.includes('"publishes"'),
    )
    const declared = appCheckout(t, { hfs: 3, publishes: ["packages/nivoos-sdk"] })
    await assert.rejects(
        Promise.resolve(depsPublishLocalVerb.run({ cwd: declared.root, progress: () => undefined } as never, { execute: false, package: ["@starci/other"], cwd: declared.root })),
        refusal("RELEASE_PACKAGE_UNKNOWN"),
    )
})
