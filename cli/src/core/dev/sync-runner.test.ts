// The debounced dev sync of a checkout: a landing only marks it; one runner waits out the window, syncs once to the newest dev, writes its status (a
// failure with its reason) and syncs again only for a landing that marked it meanwhile; a second runner never runs beside it; only stray dev servers of the
// checkout are stopped. Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { captureGitSync } from "../../shared/git.js"
import { loadLocalSettings } from "../../harness/local-settings.js"
import type { DevSyncSettings } from "../../harness/local-settings.js"
import type { HostProcess } from "../../harness/process-table.js"
import { DEV_SYNC_STALLED, readRunnerStatus, readWanted, reasonLine, requestDevSync, runDevSyncRunner, runnerPaths, settingsForCheckout, strayDevServers, watchedSync } from "./sync-runner.js"
import type { RunnerDeps } from "./sync-runner.js"

const repo = (t: { after: (fn: () => void) => void }): string => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "starci-sync-runner-")))
    t.after(() => {
        rmSync(base, { recursive: true, force: true })
    })
    const run = captureGitSync(["init", "-q", "-b", "dev", base], base)
    assert.equal(run.exitCode, 0, run.stderr)
    return base
}

const SETTINGS: DevSyncSettings = { ...loadLocalSettings(join(tmpdir(), "starci-no-such-settings.json")).devSync, debounceSeconds: 120 }

/** A clock the runner sleeps on: each sleep moves it forward, `during` runs inside the sync. */
const fakeDeps = (log: string[], options: { readonly start: number; readonly fail?: boolean; readonly during?: () => void } = { start: 0 }): RunnerDeps => {
    let now = options.start
    return {
        now: () => now,
        sleep: (ms) => {
            log.push(`sleep ${String(Math.round(ms / 1000))}s`)
            now += ms
            return Promise.resolve()
        },
        strays: () => Promise.resolve([]),
        sync: () => {
            log.push("sync")
            options.during?.()
            if (options.fail === true) return Promise.reject(Object.assign(new Error("npm ci failed: ENOTEMPTY, rmdir node_modules/ajv"), { code: "DEV_SYNC_INSTALL" }))
            return Promise.resolve({ data: { to: "0123456789abcdef", restart: "done" } })
        },
        settings: () => SETTINGS,
    }
}

void test("a mark waits out the debounce window, then ONE sync runs to the newest dev and the mark is cleared", async (t) => {
    const checkout = repo(t)
    const paths = await runnerPaths(checkout)
    const marked = Date.parse("2026-11-23T10:00:00.000Z")
    await requestDevSync(checkout, "lane-a landed as abc", () => undefined, () => Promise.resolve(4242))
    writeFileSync(paths.wanted, JSON.stringify({ at: new Date(marked).toISOString(), reason: "lane-a landed as abc" }))
    const log: string[] = []
    const written = await runDevSyncRunner(checkout, paths, fakeDeps(log, { start: marked + 30_000 }))
    assert.deepEqual(log, ["sleep 15s", "sleep 15s", "sleep 15s", "sleep 15s", "sleep 15s", "sleep 15s", "sync"], "90 s left of the 120 s window, in steps, then one sync")
    assert.deepEqual(written.map((status) => status.state), ["synced"])
    assert.equal(readWanted(paths), undefined, "the mark the sync served is cleared")
    assert.equal(readRunnerStatus(paths)?.state, "synced")
    assert.equal(existsSync(paths.lock), false, "the runner lets go of its lock")
})

void test("a landing that marks the checkout during the sync gets a sync of its own; a failure is written with its reason", async (t) => {
    const checkout = repo(t)
    const paths = await runnerPaths(checkout)
    const marked = Date.parse("2026-11-23T10:00:00.000Z")
    await requestDevSync(checkout, "lane-a landed", () => undefined, () => Promise.resolve(1))
    writeFileSync(paths.wanted, JSON.stringify({ at: new Date(marked).toISOString(), reason: "lane-a landed" }))
    let again = true
    const log: string[] = []
    const deps = fakeDeps(log, {
        start: marked + 300_000,
        fail: true,
        during: () => {
            if (!again) return
            again = false
            writeFileSync(paths.wanted, JSON.stringify({ at: new Date(marked + 150_000).toISOString(), reason: "lane-b landed" }))
        },
    })
    const written = await runDevSyncRunner(checkout, paths, deps)
    assert.deepEqual(log, ["sync", "sync"], "the second landing is synced too, once its window passed")
    assert.deepEqual(written.map((status) => status.state), ["failed", "failed"])
    assert.match(written[0]?.reason ?? "", /lane-a landed; dev sync refused: DEV_SYNC_INSTALL: npm ci failed: ENOTEMPTY/u)
    assert.match(readRunnerStatus(paths)?.reason ?? "", /lane-b landed/u)
})

void test("a second runner while one holds the lock syncs nothing; a mark with a live runner starts none", async (t) => {
    const checkout = repo(t)
    const paths = await runnerPaths(checkout)
    await requestDevSync(checkout, "first", () => undefined, () => Promise.resolve(1))
    writeFileSync(paths.lock, `dev-sync-runner ${new Date().toISOString()} pid=${String(process.pid)}`)
    const log: string[] = []
    assert.deepEqual(await runDevSyncRunner(checkout, paths, fakeDeps(log, { start: Date.now() + 600_000 })), [])
    assert.deepEqual(log, [])
    let started = 0
    const requested = await requestDevSync(checkout, "second", () => undefined, () => {
        started += 1
        return Promise.resolve(2)
    })
    assert.equal(started, 0, "the live runner picks the new mark up")
    assert.equal(requested.started, undefined)
    assert.equal(readWanted(paths)?.reason, "second")
})

void test("only a dev server of the checkout that its stack does not record is stray; a checkout's settings are its devSync.repos entry", () => {
    const row = (pid: number, commandLine: string): HostProcess => ({ pid, ppid: 1, name: "node.exe", workingSetMb: 100, commandLine, cpuMs: null, startedMs: null, cwd: null })
    const table = [
        row(10, String.raw`node D:\Repositories\app\node_modules\next\dist\bin\next dev -p 3500`),
        row(11, String.raw`node D:\Repositories\app\node_modules\next\dist\bin\next start -p 3500`),
        row(12, String.raw`node D:\Repositories\other\node_modules\.bin\ts-node-dev src/main.ts`),
        row(13, String.raw`node D:\Repositories\app\node_modules\typescript\bin\tsc -p .`),
        row(14, String.raw`node D:\Repositories\app\node_modules\.bin\ts-node-dev be/main.ts`),
    ]
    assert.deepEqual(strayDevServers(table, "D:/Repositories/app", new Set([11])).map((one) => one.pid), [10, 14])
    const settings: DevSyncSettings = { ...SETTINGS, repos: { "D:/Repositories/next-app": { afterLand: true, checkout: "D:/starci-lanes/_next/devstack", env: "dev", debounceSeconds: 60 } } }
    assert.equal(settingsForCheckout(settings, String.raw`D:\starci-lanes\_next\devstack`).debounceSeconds, 60)
    assert.equal(settingsForCheckout(settings, "D:/Repositories/app").debounceSeconds, 120)
})

void test("a refused swap is retried once after a pause, with the same mark; a second refusal is written and the mark cleared", async (t) => {
    const checkout = repo(t)
    const paths = await runnerPaths(checkout)
    const marked = Date.parse("2026-11-24T00:00:00.000Z")
    await requestDevSync(checkout, "lane-a landed", () => undefined, () => Promise.resolve(1))
    writeFileSync(paths.wanted, JSON.stringify({ at: new Date(marked).toISOString(), reason: "lane-a landed" }))
    const log: string[] = []
    let calls = 0
    const base = fakeDeps(log, { start: marked + 300_000 })
    const deps: RunnerDeps = { ...base, sync: (...args) => {
        calls += 1
        if (calls === 1) {
            log.push("sync")
            return Promise.reject(Object.assign(new Error("rename ENOENT"), { code: "DEV_SYNC_SWAP" }))
        }
        return base.sync(...args)
    } }
    const written = await runDevSyncRunner(checkout, paths, deps)
    assert.deepEqual(log, ["sync", "sleep 20s", "sync"], "one refusal, a pause, one more sync")
    assert.deepEqual(written.map((status) => status.state), ["failed", "synced"])
    assert.equal(readWanted(paths), undefined)
    // A swap refused twice is not retried a third time.
    await requestDevSync(checkout, "lane-b landed", () => undefined, () => Promise.resolve(1))
    writeFileSync(paths.wanted, JSON.stringify({ at: new Date(marked).toISOString(), reason: "lane-b landed" }))
    const twice: string[] = []
    const always: RunnerDeps = { ...fakeDeps(twice, { start: marked + 300_000 }), sync: () => {
        twice.push("sync")
        return Promise.reject(Object.assign(new Error("rename ENOENT"), { code: "DEV_SYNC_SWAP" }))
    } }
    await runDevSyncRunner(checkout, paths, always)
    assert.deepEqual(twice, ["sync", "sleep 20s", "sync"])
    assert.equal(readWanted(paths), undefined)
})

void test("after a failed sync every declared process is checked and brought up; a sync that fails to check says so and the runner goes on", async (t) => {
    const checkout = repo(t)
    const paths = await runnerPaths(checkout)
    const marked = Date.parse("2026-11-24T00:00:00.000Z")
    await requestDevSync(checkout, "lane-a landed", () => undefined, () => Promise.resolve(1))
    writeFileSync(paths.wanted, JSON.stringify({ at: new Date(marked).toISOString(), reason: "lane-a landed" }))
    const log: string[] = []
    const deps: RunnerDeps = { ...fakeDeps(log, { start: marked + 300_000, fail: true }), ensureUp: () => {
        log.push("ensureUp")
        return Promise.resolve(["nothing listened for app, landing: app stack up exited 0"])
    } }
    const written = await runDevSyncRunner(checkout, paths, deps)
    assert.deepEqual(log, ["sync", "ensureUp"], "the stack is checked after the failure")
    assert.deepEqual(written.map((status) => status.state), ["failed"])
    writeFileSync(paths.wanted, JSON.stringify({ at: new Date(marked).toISOString(), reason: "lane-b landed" }))
    const broken: string[] = []
    await runDevSyncRunner(checkout, paths, { ...fakeDeps(broken, { start: marked + 300_000, fail: true }), ensureUp: () => Promise.reject(new Error("powershell gone")) })
    assert.deepEqual(broken, ["sync"])
    assert.equal(readWanted(paths), undefined)
})

void test("a refusal whose first line only opens its reason keeps the reason in the status, and the log keeps every line", async (t) => {
    assert.equal(reasonLine("dev sync: npm ci in D:/app failed:\n\nnpm error code ENOSPC\nmore"), "dev sync: npm ci in D:/app failed: npm error code ENOSPC")
    assert.equal(reasonLine("dev sync: npm ci in D:/app exited 124: killed past its time budget\ntail"), "dev sync: npm ci in D:/app exited 124: killed past its time budget")
    assert.equal(reasonLine("x".repeat(700)).length, 600)
    const checkout = repo(t)
    const paths = await runnerPaths(checkout)
    const marked = Date.parse("2026-11-23T10:00:00.000Z")
    await requestDevSync(checkout, "lane-a landed", () => undefined, () => Promise.resolve(1))
    writeFileSync(paths.wanted, JSON.stringify({ at: new Date(marked).toISOString(), reason: "lane-a landed" }))
    const deps: RunnerDeps = {
        ...fakeDeps([], { start: marked + 300_000 }),
        sync: () => Promise.reject(Object.assign(new Error("dev sync: npm ci in D:/app failed:\nnpm error code ENOSPC\nnpm error syscall write"), { code: "DEPS_INSTALL_FAILED" })),
    }
    const said: string[] = []
    const written = await runDevSyncRunner(checkout, paths, deps, (line) => said.push(line))
    assert.match(written[0]?.reason ?? "", /dev sync refused: DEPS_INSTALL_FAILED: dev sync: npm ci in D:\/app failed: npm error code ENOSPC$/u)
    assert.ok(said.includes("  npm error syscall write"), said.join("\n"))
})

void test("the watchdog judges only the window with stack processes stopped: a long quiet wait before the stop passes, a quiet stop past stallMs ends as DEV_SYNC_STALLED", async () => {
    let clock = 0
    const quietBeforeStop = await watchedSync(async (watch) => {
        clock += 60 * 60_000
        await new Promise((settle) => setTimeout(settle, 30))
        watch.onStack("stopped")
        watch.progress("swapped the staged build in")
        watch.onStack("running")
        return "synced"
    }, () => clock, 20 * 60_000, 5)
    assert.equal(quietBeforeStop, "synced", "an hour in the heavy queue with the stack serving is no stall")
    await assert.rejects(
        watchedSync((watch) => {
            watch.onStack("stopped")
            watch.progress("fast-forwarded the checkout")
            clock += 21 * 60_000
            return new Promise<string>(() => undefined)
        }, () => clock, 20 * 60_000, 5),
        (error: { code?: string; message?: string }) => error.code === DEV_SYNC_STALLED && (error.message ?? "").includes("fast-forwarded the checkout"),
    )
})

void test("a stalled sync is written failed with its reason, the stack is brought up, the checkout marked whole, and the runner ends", async (t) => {
    const checkout = repo(t)
    const paths = await runnerPaths(checkout)
    await requestDevSync(checkout, "lane-a landed", () => undefined, () => Promise.resolve(1))
    writeFileSync(paths.wanted, JSON.stringify({ at: new Date(0).toISOString(), reason: "lane-a landed" }))
    const log: string[] = []
    let clock = 10 * 60_000
    const deps: RunnerDeps = {
        ...fakeDeps(log, { start: clock }),
        now: () => clock,
        settings: () => ({ ...SETTINGS, stallMinutes: 1 }),
        sync: (_checkout, _settings, watch) => {
            watch.onStack("stopped")
            clock += 2 * 60_000
            return new Promise(() => undefined)
        },
        ensureUp: () => {
            log.push("ensureUp")
            return Promise.resolve(["app stack up exited 0"])
        },
        markWhole: () => {
            log.push("markWhole")
            return Promise.resolve()
        },
        exit: (code) => log.push(`exit ${String(code)}`),
        watchEveryMs: 5,
    }
    const written = await runDevSyncRunner(checkout, paths, deps)
    assert.deepEqual(log, ["ensureUp", "markWhole", "exit 1"])
    assert.equal(written[0]?.state, "failed")
    assert.match(String(written.at(0)?.reason), /DEV_SYNC_STALLED/u)
    assert.equal(existsSync(paths.lock), false)
})
