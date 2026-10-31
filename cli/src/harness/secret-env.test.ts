// The age identity an app's sealed members open with, found by a CLI the app installs: the installed copy carries no secret.env,
// so the harness home above the app (the nearest ancestor `.claude` that is a harness checkout) is looked in next. The key is a
// fixture written by this test; no real secret.env is read. Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { locatePolicy } from "./policy.js"
import { ageIdentityFiles, harnessHomeOf, hostAgeIdentity } from "./secret-env.js"

const FIXTURE_KEY = `AGE-SECRET-KEY-1${"Q".repeat(58)}`
const OWN_KEY = `AGE-SECRET-KEY-1${"P".repeat(58)}`

/** A host with a harness home at `<root>/.claude` and an app below it whose installed CLI points STARCI_POLICY_DIR at its own policy/. */
const host = (t: { after: (fn: () => void) => void }): { readonly root: string; readonly home: string; readonly installed: string; readonly app: string } => {
    const policy = locatePolicy()
    const root = mkdtempSync(join(tmpdir(), "starci-age-home-"))
    const home = join(root, ".claude")
    mkdirSync(join(home, "cli"), { recursive: true })
    mkdirSync(join(home, "ops"), { recursive: true })
    writeFileSync(join(home, "ops", "checks.yaml"), "schema: fixture\n")
    cpSync(policy, join(home, "policy"), { recursive: true })
    const app = join(root, "lanes", "app")
    const installed = join(app, "node_modules", "starci-harness")
    cpSync(policy, join(installed, "policy"), { recursive: true })
    const saved = { policy: process.env.STARCI_POLICY_DIR, age: process.env.SOPS_AGE_KEY }
    process.env.STARCI_POLICY_DIR = join(installed, "policy")
    delete process.env.SOPS_AGE_KEY
    t.after(() => {
        if (saved.policy === undefined) delete process.env.STARCI_POLICY_DIR
        else process.env.STARCI_POLICY_DIR = saved.policy
        if (saved.age !== undefined) process.env.SOPS_AGE_KEY = saved.age
        rmSync(root, { recursive: true, force: true })
    })
    return { root, home, installed, app }
}

void test("an app's installed CLI looks for the age identity in its own secret.env, then the harness home's", (t) => {
    const { home, installed, app } = host(t)
    assert.equal(harnessHomeOf(app), home)
    assert.deepEqual(ageIdentityFiles(app), [join(installed, "secret.env"), join(home, "secret.env")])
    writeFileSync(join(home, "secret.env"), `# host secrets\nSOPS_AGE_KEY=${FIXTURE_KEY}\n`)
    const identity = hostAgeIdentity(app)
    assert.equal(identity.label, `${join(installed, "secret.env")}, then ${join(home, "secret.env")}`)
    assert.ok(identity.read() === FIXTURE_KEY, "the harness home's SOPS_AGE_KEY is the identity")
    assert.equal(identity.label, join(home, "secret.env"))
    assert.ok(!identity.label.includes("AGE-SECRET-KEY"), "no label carries the key")
})

void test("the CLI's own secret.env wins over the harness home's, and the environment over both", (t) => {
    const { home, installed, app } = host(t)
    writeFileSync(join(home, "secret.env"), `SOPS_AGE_KEY=${FIXTURE_KEY}\n`)
    writeFileSync(join(installed, "secret.env"), `SOPS_AGE_KEY=${OWN_KEY}\n`)
    const own = hostAgeIdentity(app)
    assert.ok(own.read() === OWN_KEY)
    assert.equal(own.label, join(installed, "secret.env"))
    process.env.SOPS_AGE_KEY = FIXTURE_KEY
    const fromEnv = hostAgeIdentity(app)
    assert.ok(fromEnv.read() === FIXTURE_KEY)
    assert.equal(fromEnv.label, "the environment")
    delete process.env.SOPS_AGE_KEY
})

void test("with no harness home and no secret.env the host reads nothing, and a home equal to the CLI's own is listed once", (t) => {
    const { root, home, installed } = host(t)
    const outside = join(root, "elsewhere")
    mkdirSync(outside)
    rmSync(home, { recursive: true, force: true })
    const nothing = hostAgeIdentity(outside)
    assert.equal(nothing.read(), undefined)
    assert.equal(nothing.label, join(installed, "secret.env"))
    // a CLI run from the harness checkout itself: its own secret.env is the home's
    process.env.STARCI_POLICY_DIR = join(installed, "policy")
    mkdirSync(join(installed, "cli"), { recursive: true })
    mkdirSync(join(installed, "ops"), { recursive: true })
    writeFileSync(join(installed, "ops", "checks.yaml"), "schema: fixture\n")
    assert.deepEqual(ageIdentityFiles(installed), [join(installed, "secret.env")])
})
