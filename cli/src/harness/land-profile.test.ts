// Owner 2026-11-22: "bản thân .claude cũng tách thành dev main được không? dev code xong merge nhanh để xài local". The lander and lane gate pick the harness
// profile in the harness checkout (the FAST gate of release gate, a plain git push of dev), keep the app's otherwise, and a lanes folder shared by the
// repositories of a machine gives each lander its own lanes and locks (harness/land-profile.ts).
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { APP_PROFILE, LANDER_GATE_ARGS, harnessProfile, landProfile, lockScope, normalRemote, profileNameFor, takesEntry } from "./land-profile.js"
import { landPaths } from "./land-queue.js"

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

void test("the harness gates with the lander's own CLI at the FAST level from the batch base and pushes dev with git; the app keeps its pinned CLI and app push", () => {
    const profile = harnessProfile("/lander/dist/main.js")
    assert.equal(profile.prepares, false, "no root npm ci, codegen or build:modules")
    assert.deepEqual(profile.gate("/wt", "abc123"), { file: process.execPath, args: ["/lander/dist/main.js", "release", "gate", "--level", "dev", "--base", "abc123", "--json"] })
    assert.deepEqual(profile.push("/wt", "dev"), { file: "git", args: ["push", "origin", "HEAD:dev"] })
    assert.equal(landProfile("app", "/x").name, "app")
    assert.equal(APP_PROFILE.prepares, true)
    assert.deepEqual(APP_PROFILE.gate("/wt", "abc").args.slice(1), [...LANDER_GATE_ARGS])
    assert.deepEqual(APP_PROFILE.push("/wt", "dev").args.slice(1), ["app", "push", "origin", "HEAD:dev"])
})

void test("each lander takes its own repository's lanes from a shared folder; an entry naming none is an app lander's", () => {
    const harness = "git@github.com:starci183/starci-harness.git"
    assert.equal(normalRemote(harness), normalRemote("https://github.com/starci183/starci-harness"))
    assert.equal(takesEntry({ repo: "https://github.com/starci183/starci-harness.git" }, harness, "harness"), true)
    assert.equal(takesEntry({ repo: "https://github.com/starci183/nivo.git" }, harness, "harness"), false)
    assert.equal(takesEntry({}, harness, "harness"), false)
    assert.equal(takesEntry({}, "https://github.com/starci183/nivo.git", "app"), true)
})

void test("the harness lander holds its own lander lock and dev lock in a shared lanes folder; the app lander keeps the plain names", () => {
    assert.equal(lockScope("app"), "")
    assert.match(landPaths("/lanes", lockScope("harness")).lander, /_batch-lander-harness\.lock$/)
    assert.match(landPaths("/lanes", lockScope("harness")).devLock, /_dev-push-harness\.lock$/)
    assert.match(landPaths("/lanes").devLock, /_dev-push\.lock$/)
    assert.equal(landPaths("/lanes", "harness").ready, landPaths("/lanes").ready, "one ready folder and one status folder for every lander")
})
