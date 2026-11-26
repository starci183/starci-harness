import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { appCli, harnessProfile, lockScope, profileNameFor } from "./land-profile.js"
import { landPaths } from "./lane-state.js"

void test("the harness checkout lands with the harness profile, any other repository with the app's, and --profile overrides", () => {
    const harness = mkdtempSync(join(tmpdir(), "starci-profile-"))
    const app = mkdtempSync(join(tmpdir(), "starci-profile-app-"))
    try {
        mkdirSync(join(harness, "cli"), { recursive: true })
        mkdirSync(join(harness, "contexts"), { recursive: true })
        mkdirSync(join(harness, "packages"), { recursive: true })
        writeFileSync(join(harness, "cli", "package.json"), "{}")
        writeFileSync(join(harness, "contexts", "README.md"), "#")
        assert.equal(profileNameFor(harness, undefined), "harness", "the marker release push and publish-local read")
        assert.equal(profileNameFor(app, undefined), "app")
        assert.equal(profileNameFor(app, "harness"), "harness")
        assert.equal(profileNameFor(harness, "app"), "app")
        assert.throws(() => profileNameFor(app, "lib"), /app or harness/)
    } finally {
        rmSync(harness, { recursive: true, force: true })
        rmSync(app, { recursive: true, force: true })
    }
})

void test("the harness gates with the lane's own CLI at the FAST level from the lane's base and pushes with git", () => {
    const profile = harnessProfile("/cli/dist/main.js")
    assert.deepEqual(profile.gate("/wt", "abc123"), { file: process.execPath, args: ["/cli/dist/main.js", "check", "--level", "dev", "--base", "abc123", "--json"] })
    assert.deepEqual(profile.push("/wt", "dev"), { file: "git", args: ["push", "origin", "HEAD:dev"] })
    assert.equal(appCli("/wt").replaceAll("\\", "/"), "/wt/node_modules/starci-harness/dist/main.js")
})

void test("the harness holds its own dev lock in a shared lanes folder; an app keeps the plain name", () => {
    assert.equal(lockScope("app"), "")
    assert.match(landPaths("/lanes", lockScope("harness")).devLock, /_dev-push-harness\.lock$/)
    assert.match(landPaths("/lanes").devLock, /_dev-push\.lock$/)
    assert.equal(landPaths("/lanes", "harness").status, landPaths("/lanes").status, "one status folder for every repository")
})
