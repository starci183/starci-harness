// `starci dev sync` and the lander's auto-sync: the side a change restarts, the overlay line, a real fast-forward of a dev checkout from
// its origin (a bare repository in a scratch folder), the refusals, and the debounce of consecutive landed batches. Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { LandDebounce, landAutoSync } from "../../harness/land-dev-sync.js"
import { loadLocalSettings } from "../../harness/local-settings.js"
import type { DevSyncSettings } from "../../harness/local-settings.js"
import { captureGitSync } from "../../shared/git.js"
import { writeInstallRecord } from "../deps/install-local.js"
import { changedSides, devSync, overlayFiles, overlayLine, overlayOf, processesFor, summaryLine } from "./sync.js"
import type { DevSyncRequest } from "./sync.js"

const PROCESSES = { be: ["api"], fe: ["web"] }

void test("a change under be/ restarts the api, under fe/ the web, anything a process reads both, and docs nothing", () => {
    assert.deepEqual(changedSides(["be/apps/api/src/main.ts"]), ["be"])
    assert.deepEqual(changedSides(["fe/apps/web/app/page.tsx"]), ["fe"])
    assert.deepEqual(changedSides(["be/x.ts", "fe/y.tsx"]), ["be", "fe"])
    assert.deepEqual(changedSides(["package-lock.json"]), ["be", "fe"])
    assert.deepEqual(changedSides(["packages/ui/src/a.ts"]), ["be", "fe"])
    assert.deepEqual(changedSides(["README.md", ".starciwork/cache/x.json", ".github/workflows/ci.yml"]), [])
    assert.deepEqual(processesFor(["be"], PROCESSES), ["api"])
    assert.deepEqual(processesFor(["be", "fe"], { be: ["api", "worker"], fe: ["web"] }), ["api", "worker", "web"])
    assert.deepEqual(processesFor([], PROCESSES), [])
})

void test("the overlay is printed whether or not one is in effect, and names the files it changed", () => {
    const record = { schema: "starci/deps-install-local@1" as const, registry: "http://127.0.0.1:4873/", packages: [{ name: "@starci/grammar", version: "0.52.4-local.1", pins: [{ file: "fe/package.json", field: "dependencies", spec: "0.52.3" }] }] }
    assert.deepEqual(overlayOf(record), ["@starci/grammar@0.52.4-local.1"])
    assert.deepEqual(overlayFiles(record), ["fe/package.json", "package-lock.json"])
    assert.deepEqual(overlayOf(undefined), [])
    assert.match(overlayLine([]), /local overlay: none/u)
    assert.match(overlayLine(overlayOf(record)), /local overlay in effect: @starci\/grammar@0\.52\.4-local\.1/u)
})

const gitIn = (cwd: string, ...args: string[]): string => {
    const run = captureGitSync(["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], cwd)
    assert.equal(run.exitCode, 0, `git ${args.join(" ")}: ${run.stderr}`)
    return run.stdout.trim()
}

/** A bare origin with a dev branch, a dev checkout of it (node_modules present, so no npm ci runs), and a second clone that pushes to dev. */
const scratch = (t: { after: (fn: () => void) => void }): { readonly checkout: string; readonly pusher: string; readonly base: string } => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "starci-dev-sync-")))
    const before = process.env.STARCI_LOCAL_ROOT
    process.env.STARCI_LOCAL_ROOT = join(base, "state")
    t.after(() => {
        if (before === undefined) delete process.env.STARCI_LOCAL_ROOT
        else process.env.STARCI_LOCAL_ROOT = before
        rmSync(base, { recursive: true, force: true })
    })
    const origin = join(base, "origin.git")
    gitIn(base, "init", "-q", "--bare", "-b", "dev", origin)
    const pusher = join(base, "pusher")
    gitIn(base, "clone", "-q", origin, pusher)
    gitIn(pusher, "switch", "-q", "-c", "dev")
    writeFileSync(join(pusher, "package.json"), '{\n  "name": "app",\n  "dependencies": {\n    "@starci/grammar": "0.52.3"\n  }\n}\n')
    writeFileSync(join(pusher, "package-lock.json"), '{"name":"app","lockfileVersion":3,"requires":true,"packages":{"":{"name":"app"}}}\n')
    writeFileSync(join(pusher, ".gitignore"), "node_modules/\n")
    gitIn(pusher, "add", ".")
    gitIn(pusher, "commit", "-q", "-m", "start")
    gitIn(pusher, "push", "-q", "origin", "dev")
    const checkout = join(base, "checkout")
    gitIn(base, "clone", "-q", "-b", "dev", origin, checkout)
    mkdirSync(join(checkout, "node_modules"))
    return { checkout, pusher, base }
}

const request = (checkout: string, extra: Partial<DevSyncRequest> = {}): DevSyncRequest => ({ checkout, local: [], env: "dev", execute: false, restart: false, processes: PROCESSES, say: () => undefined, ...extra })

void test("a dry run fetches and plans the fast-forward and the side to restart; --execute moves the checkout and nothing else", async (t) => {
    const { checkout, pusher } = scratch(t)
    const start = gitIn(checkout, "rev-parse", "HEAD")
    mkdirSync(join(pusher, "be"), { recursive: true })
    writeFileSync(join(pusher, "be", "main.ts"), "export {}\n")
    gitIn(pusher, "add", ".")
    gitIn(pusher, "commit", "-q", "-m", "be change")
    gitIn(pusher, "push", "-q", "origin", "dev")
    const target = gitIn(pusher, "rev-parse", "HEAD")
    const dry = await devSync(request(checkout, { restart: true }))
    assert.equal(dry.data.dryRun, true)
    assert.equal(dry.data.commits, 1)
    assert.deepEqual(dry.data.sides, ["be"])
    assert.equal(dry.data.restart, "planned")
    assert.match(dry.message, /would rebuild and restart api: app stack restart --env dev --process api --execute/u)
    assert.match(dry.message, /npm ci: the lockfile did not change, skipped/u)
    assert.match(dry.message, /local overlay: none/u)
    assert.equal(gitIn(checkout, "rev-parse", "HEAD"), start, "a dry run never moves the checkout")
    const done = await devSync(request(checkout, { execute: true }))
    assert.equal(gitIn(checkout, "rev-parse", "HEAD"), target)
    assert.equal(done.data.restart, "skipped")
    assert.match(summaryLine(done.data), /^dev sync: moved [0-9a-f]{9} -> [0-9a-f]{9}; restart skipped; local overlay: none/u)
})

void test("a plain sync drops a recorded overlay: the committed pins come back and the record goes", async (t) => {
    const { checkout } = scratch(t)
    const pinned = readFileSync(join(checkout, "package.json"), "utf8")
    writeFileSync(join(checkout, "package.json"), pinned.replace("0.52.3", "0.52.4-local.1"))
    writeInstallRecord(checkout, { schema: "starci/deps-install-local@1", registry: "http://127.0.0.1:4873/", packages: [{ name: "@starci/grammar", version: "0.52.4-local.1", pins: [{ file: "package.json", field: "dependencies", spec: "0.52.3" }] }] })
    const dry = await devSync(request(checkout))
    assert.deepEqual(dry.data.overlayBefore, ["@starci/grammar@0.52.4-local.1"])
    assert.match(dry.message, /would restore the committed pins of package-lock\.json, package\.json \(drop the overlay @starci\/grammar@0\.52\.4-local\.1\)/u)
    assert.match(dry.message, /would run npm ci/u)
    assert.match(dry.message, /local overlay in effect: @starci\/grammar@0\.52\.4-local\.1/u)
    assert.deepEqual(dry.data.sides, ["be", "fe"], "an overlay that goes reinstalls both sides")
})

void test("a tracked change that is no overlay's, and a checkout off dev, are refused before anything moves", async (t) => {
    const { checkout } = scratch(t)
    writeFileSync(join(checkout, "package.json"), "{}\n")
    await assert.rejects(devSync(request(checkout)), (error: unknown) => error instanceof Error && "code" in error && error.code === "DEV_SYNC_DIRTY")
    gitIn(checkout, "checkout", "--", "package.json")
    gitIn(checkout, "switch", "-q", "-c", "feature")
    await assert.rejects(devSync(request(checkout)), (error: unknown) => error instanceof Error && "code" in error && error.code === "DEV_SYNC_NOT_DEV")
})

void test("consecutive landed batches give one sync, once the debounce window passed since the last of them", () => {
    const debounce = new LandDebounce(60_000)
    assert.equal(debounce.due(0), false)
    assert.equal(debounce.waitMs(0), undefined)
    debounce.landed(1_000)
    debounce.landed(30_000)
    assert.equal(debounce.due(80_000), false, "the window restarts at the last landed batch")
    assert.equal(debounce.waitMs(80_000), 10_000)
    assert.equal(debounce.due(90_000), true)
    debounce.settle()
    assert.equal(debounce.pending, false)
})

const settings = (extra: Partial<DevSyncSettings> = {}): DevSyncSettings => ({ ...loadLocalSettings(join(tmpdir(), "no-such-starci-settings.json")).devSync, ...extra })

void test("the lander's auto-sync is off by default and in a dry run; on, it syncs the configured checkout and a failure never throws", async () => {
    assert.equal(settings().afterLand, false)
    assert.equal(settings().debounceSeconds, 120)
    assert.equal(landAutoSync(settings(), "D:/app", false, () => undefined), undefined)
    assert.equal(landAutoSync(settings({ afterLand: true }), "D:/app", true, () => undefined), undefined)
    const asked: DevSyncRequest[] = []
    const said: string[] = []
    const auto = landAutoSync(settings({ afterLand: true, checkout: "D:/dev-checkout", local: ["grammar"] }), "D:/app", false, (line) => said.push(line), (one) => {
        asked.push(one)
        return Promise.reject(new Error("DEV_SYNC_DIRTY"))
    })
    assert.ok(auto)
    auto.debounce.landed(0)
    await auto.run()
    assert.equal(auto.debounce.pending, false)
    const [first] = asked
    assert.ok(first)
    assert.equal(first.checkout, "D:/dev-checkout")
    assert.equal(first.execute, true)
    assert.deepEqual(first.local, ["grammar"])
    assert.ok(said.some((line) => line.includes("not run (DEV_SYNC_DIRTY)")))
})

void test("a damaged local settings file is refused naming it", () => {
    const base = mkdtempSync(join(tmpdir(), "starci-local-settings-"))
    try {
        const file = join(base, "local-settings.json")
        writeFileSync(file, '{"devSync": {"afterLand": "yes"}}')
        assert.throws(() => loadLocalSettings(file), (error: unknown) => error instanceof Error && "code" in error && error.code === "LOCAL_SETTINGS_INVALID" && error.message.includes("devSync.afterLand"))
        writeFileSync(file, '{"devSync": {"afterLand": true, "debounceSeconds": 5}}')
        assert.equal(loadLocalSettings(file).devSync.debounceSeconds, 5)
        assert.deepEqual(loadLocalSettings(file).devSync.processes, PROCESSES)
    } finally {
        rmSync(base, { recursive: true, force: true })
    }
})
