// Dev-only local-registry pins: an app that declares hfs.json deps.devAllowsLocalRegistry may push exact local-registry pins and their
// lockfile entries to dev (or a lane branch), never to main, a release branch or through a release verb. Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { captureGitSync } from "../../shared/git.js"
import { landsOnDev, namesLocalRegistry, prePushTarget } from "./dev-local.js"
import type { PushTarget } from "./dev-local.js"
import { judgePush } from "./push-gate.js"
import type { PushGateOptions } from "./push-gate.js"

const LOCAL = "0.55.0-content.4"
const lock = JSON.stringify({ name: "app", lockfileVersion: 3, packages: { "": { name: "app" }, "node_modules/@starci/grammar": { version: LOCAL, resolved: `http://127.0.0.1:4873/@starci/grammar/-/grammar-${LOCAL}.tgz`, integrity: "sha512-localbuildlocalbuildlocalbuild" } } }, null, 2)

/** An app whose last commit pins @starci/grammar to a version only the local registry serves, with its lockfile entry. */
const app = (declared: boolean): { readonly root: string; readonly done: () => void } => {
    const root = mkdtempSync(join(tmpdir(), "starci-dev-local-"))
    const run = (...args: string[]): void => {
        const result = captureGitSync(["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], root)
        assert.equal(result.exitCode, 0, result.stderr)
    }
    run("init", "-q")
    writeFileSync(join(root, "hfs.json"), JSON.stringify({ kind: "app", project: "demo", ...(declared ? { deps: { devAllowsLocalRegistry: true } } : {}) }))
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "app", dependencies: { "@starci/grammar": LOCAL } }))
    writeFileSync(join(root, "package-lock.json"), `${lock}\n`)
    run("add", ".")
    run("commit", "-q", "-m", "local pins")
    return { root, done: () => { rmSync(root, { recursive: true, force: true }) } }
}

/** No network: npm serves no prerelease and another integrity for it; the local registry serves exactly LOCAL. */
const seams = (target?: PushTarget): PushGateOptions => ({
    ...(target === undefined ? {} : { target }),
    published: () => Promise.resolve(false),
    servedLocally: (_root, _name, version) => Promise.resolve(version === LOCAL),
    served: () => Promise.resolve({ integrity: "sha512-npmtarballnpmtarballnpmtarball", source: undefined }),
})

const refs = (...remote: string[]): string => remote.map((ref) => `refs/heads/x 1111111111111111111111111111111111111111 ${ref} 0000000000000000000000000000000000000000`).join("\n")

void test("the target lands on dev only when every pushed ref is dev or a lane branch", () => {
    assert.equal(landsOnDev(prePushTarget(refs("refs/heads/dev"))), true)
    assert.equal(landsOnDev(prePushTarget(refs("refs/heads/lane/t194-x"))), true)
    assert.equal(landsOnDev(prePushTarget(refs("refs/heads/dev", "refs/heads/main"))), false)
    assert.equal(landsOnDev(prePushTarget(refs("refs/heads/release/1.2"))), false)
    assert.equal(landsOnDev(prePushTarget(refs("refs/heads/dev2"))), false, "an integration branch lands on a dev line only when the settings name it")
    assert.equal(landsOnDev(prePushTarget(refs("refs/heads/dev2", "refs/heads/lane/t194-x")), ["refs/heads/dev2"]), true)
    assert.equal(landsOnDev(prePushTarget(refs("refs/heads/dev2", "refs/heads/main")), ["refs/heads/dev2"]), false)
    assert.equal(landsOnDev(prePushTarget(refs("refs/tags/v1.0.0"))), false)
    assert.equal(landsOnDev(prePushTarget("")), false)
    assert.equal(landsOnDev(undefined), false)
    assert.equal(namesLocalRegistry("http://127.0.0.1:4873/@starci/x/-/x-1.0.0.tgz"), true)
    assert.equal(namesLocalRegistry("http://localhost:5000/@starci/x/-/x-1.0.0.tgz"), false)
})

void test("a declared app's dev push accepts the local pins, the local lockfile entry and its integrity, with one note naming them", async () => {
    const { root, done } = app(true)
    try {
        for (const target of [refs("refs/heads/dev"), refs("refs/heads/lane/t194-x")]) {
            const judged = await judgePush(root, "HEAD", seams(prePushTarget(target)))
            assert.deepEqual([...(judged.accepted ?? [])].sort((a, b) => a.localeCompare(b)), ["DEPS_LOCAL_REGISTRY_COMMITTED", "DEPS_LOCK_INTEGRITY", "DEPS_PIN_UNPUBLISHED"])
            assert.equal(judged.notes.length, 1)
            assert.match(judged.notes[0] ?? "", /^dev-local: .*DEPS_PIN_UNPUBLISHED/)
            assert.equal(judged.pins[0]?.local, true)
        }
    } finally {
        done()
    }
})

void test("a declared dev push still refuses a pin the local registry does not serve", async () => {
    const { root, done } = app(true)
    try {
        const options = { ...seams(prePushTarget(refs("refs/heads/dev"))), servedLocally: () => Promise.resolve(false) }
        await assert.rejects(judgePush(root, "HEAD", options), (error: unknown) => error instanceof Error && "code" in error && error.code === "DEPS_PIN_UNPUBLISHED")
    } finally {
        done()
    }
})

void test("an app that does not declare it refuses the same dev push", async () => {
    const { root, done } = app(false)
    try {
        await assert.rejects(judgePush(root, "HEAD", seams(prePushTarget(refs("refs/heads/dev")))), (error: unknown) => error instanceof Error && "code" in error && error.code === "DEPS_LOCAL_REGISTRY_COMMITTED")
    } finally {
        done()
    }
})

void test("a declared app refuses on main, a release branch, a tag, a mixed push and a release verb (no target)", async () => {
    const { root, done } = app(true)
    try {
        for (const target of [refs("refs/heads/main"), refs("refs/heads/release/0.55"), refs("refs/tags/v1.0.0"), refs("refs/heads/dev", "refs/heads/main"), undefined]) {
            await assert.rejects(judgePush(root, "HEAD", seams(target === undefined ? undefined : prePushTarget(target))), (error: unknown) => error instanceof Error && "code" in error && error.code === "DEPS_LOCAL_REGISTRY_COMMITTED", String(target))
        }
    } finally {
        done()
    }
})
