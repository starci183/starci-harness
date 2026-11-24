// `starci dev sync` and the lander's auto-sync: the side a change restarts, the overlay line, a real fast-forward of a dev checkout from
// its origin (a bare repository in a scratch folder), the refusals, and the debounce of consecutive landed batches. Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { Refusal } from "../../shared/errors.js"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { LandDebounce, landAutoSync } from "../../harness/land-dev-sync.js"
import { loadLocalSettings } from "../../harness/local-settings.js"
import type { DevSyncSettings } from "../../harness/local-settings.js"
import { captureGitSync } from "../../shared/git.js"
import { writeInstallRecord } from "../deps/install-local.js"
import type { InstallRecord } from "../deps/install-local.js"
import { ASIDE, installPlaces, realInstallFs } from "./safe-install.js"
import type { InstallFs } from "./safe-install.js"
import { parseStackStatus, stopTargets } from "./stack-stop.js"
import type { StackProcesses, StackStop } from "./stack-stop.js"
import { PREPARE_SCRIPTS, prepareTree } from "../../harness/prepare-tree.js"
import { changedSides, devSync,overlayFiles, overlayLine, overlayOf, processesFor, summaryLine, syncLocal } from "./sync.js"
import type { DevSyncDeps, DevSyncRequest } from "./sync.js"

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
    // a pin in a subfolder package with its own lockfile (gallery/) owns that lockfile too, so the next sync never reads it as a stray change
    const gallery: InstallRecord = { ...record, packages: [...record.packages, { name: "@starci/gallery", version: "0.1.21-dev.2", pins: [{ file: "gallery/package.json", field: "devDependencies", spec: "0.1.20" }] }] }
    assert.deepEqual(overlayFiles(gallery, (file) => (file.startsWith("gallery/") ? "gallery" : "")), ["fe/package.json", "gallery/package-lock.json", "gallery/package.json", "package-lock.json"])
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

void test("a checkout detached at origin/dev, where the lander leaves it, syncs and ends on dev tracking origin/dev", async (t) => {
    const { checkout } = scratch(t)
    const at = gitIn(checkout, "rev-parse", "HEAD")
    gitIn(checkout, "checkout", "-q", "--detach", "origin/dev")
    gitIn(checkout, "branch", "-q", "-D", "dev")
    const dry = await devSync(request(checkout))
    assert.match(dry.message, /would put .* back on dev at origin\/dev/u)
    assert.equal(gitIn(checkout, "branch", "--show-current"), "", "a dry run leaves it detached")
    await devSync(request(checkout, { execute: true }))
    assert.equal(gitIn(checkout, "branch", "--show-current"), "dev")
    assert.equal(gitIn(checkout, "rev-parse", "HEAD"), at)
    assert.equal(gitIn(checkout, "rev-parse", "--abbrev-ref", "dev@{upstream}"), "origin/dev")
})

void test("a checkout detached behind origin/dev fast-forwards onto dev", async (t) => {
    const { checkout, pusher } = scratch(t)
    gitIn(checkout, "checkout", "-q", "--detach", "HEAD")
    writeFileSync(join(pusher, "README.md"), "x\n")
    gitIn(pusher, "add", ".")
    gitIn(pusher, "commit", "-q", "-m", "docs")
    gitIn(pusher, "push", "-q", "origin", "dev")
    const target = gitIn(pusher, "rev-parse", "HEAD")
    const done = await devSync(request(checkout, { execute: true }))
    assert.equal(done.data.commits, 1)
    assert.equal(gitIn(checkout, "branch", "--show-current"), "dev")
    assert.equal(gitIn(checkout, "rev-parse", "HEAD"), target)
})

void test("a checkout detached on a commit origin/dev does not hold is refused, and nothing moves", async (t) => {
    const { checkout } = scratch(t)
    gitIn(checkout, "checkout", "-q", "--detach", "HEAD")
    writeFileSync(join(checkout, "other.txt"), "x\n")
    gitIn(checkout, "add", ".")
    gitIn(checkout, "commit", "-q", "-m", "unrelated")
    const head = gitIn(checkout, "rev-parse", "HEAD")
    await assert.rejects(devSync(request(checkout, { execute: true })), (error: unknown) => error instanceof Error && "code" in error && error.code === "DEV_SYNC_NOT_DEV" && error.message.includes("detached HEAD"))
    assert.equal(gitIn(checkout, "rev-parse", "HEAD"), head)
    assert.equal(gitIn(checkout, "branch", "--show-current"), "")
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

/** A lockfile change pushed to dev (and `manifest`, when given), so the next sync installs; the checkout's node_modules holds an `old` marker. */
const lockfileMoved = (pusher: string, checkout: string, manifest?: Record<string, unknown>): void => {
    writeFileSync(join(pusher, "package-lock.json"), '{"name":"app","lockfileVersion":3,"requires":true,"packages":{"":{"name":"app","version":"1.0.1"}}}\n')
    if (manifest !== undefined) writeFileSync(join(pusher, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`)
    gitIn(pusher, "add", ".")
    gitIn(pusher, "commit", "-q", "-m", "lockfile")
    gitIn(pusher, "push", "-q", "origin", "dev")
    writeFileSync(join(checkout, "node_modules", "old"), "the previous install\n")
}

const RUNNING: StackProcesses = { api: { pid: 101, startedAt: "2026-11-21T08:00:00.000Z" }, web: { pid: 102, startedAt: "2026-11-21T08:00:01.000Z" } }

/** Fake seams that log every step in order. The fs is the real one with each rename logged; the first `refuseRenames` moves aside refuse with EPERM. */
const fakeDeps = (log: string[], extra: Partial<DevSyncDeps> & { readonly refuseRenames?: number } = {}): DevSyncDeps => {
    let refusals = extra.refuseRenames ?? 0
    const fs: InstallFs = {
        ...realInstallFs,
        rename: (from, to) => {
            if (refusals > 0 && to.endsWith(ASIDE)) {
                refusals -= 1
                log.push("rename refused")
                throw Object.assign(new Error("EPERM: operation not permitted, rename lightningcss.win32-x64-msvc.node"), { code: "EPERM" })
            }
            log.push(`rename ${from.endsWith(ASIDE) && !to.includes(".starci-trash-") ? "back" : to.endsWith(ASIDE) ? "aside" : "trash"}`)
            renameSync(from, to)
        },
    }
    const seams: Partial<DevSyncDeps> = { ...extra }
    Reflect.deleteProperty(seams, "refuseRenames")
    return {
        stackProcesses: () => {
            log.push("status")
            return Promise.resolve(RUNNING)
        },
        stop: (processes): Promise<StackStop> => {
            log.push(`stop ${Object.keys(processes).join(",")}`)
            return Promise.resolve({ stopped: Object.keys(processes), alive: [] })
        },
        npmCi: (root) => {
            log.push(`npm ci (node_modules ${existsSync(join(root, "node_modules")) ? "present" : "moved aside"})`)
            mkdirSync(join(root, "node_modules"), { recursive: true })
            writeFileSync(join(root, "node_modules", "new"), "the new install\n")
            return Promise.resolve()
        },
        prepare: () => {
            log.push("prepare")
            return Promise.resolve(undefined)
        },
        fs,
        pause: () => {
            log.push("pause")
            return Promise.resolve()
        },
        appRun: (_root, args) => {
            log.push(`restart ${args[args.indexOf("--process") + 1] ?? ""}`)
            return Promise.resolve({ exitCode: 0, stdout: "", stderr: "", timedOut: false })
        },
        ...seams,
    }
}

const refused = (code: string, text = "") => (error: unknown): boolean => error instanceof Error && "code" in error && error.code === code && error.message.includes(text)

void test("an install stops the recorded dev stack processes first, moves node_modules aside, installs, then restarts them", async (t) => {
    const { checkout, pusher } = scratch(t)
    lockfileMoved(pusher, checkout)
    const log: string[] = []
    const done = await devSync(request(checkout, { execute: true, restart: true }), fakeDeps(log))
    assert.deepEqual(log, ["status", "stop api,web", "rename aside", "npm ci (node_modules moved aside)", "rename trash", "prepare", "restart api,web"])
    assert.deepEqual(done.data.stopped, ["api", "web"])
    assert.equal(done.data.restart, "done")
    assert.ok(existsSync(join(checkout, "node_modules", "new")))
    assert.equal(existsSync(join(checkout, "node_modules", "old")), false, "the old copy goes once the new one is in place")
    assert.equal(existsSync(join(checkout, `node_modules${ASIDE}`)), false)
})

void test("--no-restart still brings back what the install stopped; a sync that installs nothing stops nothing", async (t) => {
    const { checkout, pusher } = scratch(t)
    lockfileMoved(pusher, checkout)
    const log: string[] = []
    const done = await devSync(request(checkout, { execute: true, restart: false }), fakeDeps(log))
    assert.equal(log.at(-1), "restart api,web")
    assert.deepEqual(done.data.restarted, ["api", "web"])
    const again: string[] = []
    const quiet = await devSync(request(checkout, { execute: true, restart: false }), fakeDeps(again))
    assert.deepEqual(again, [], "nothing moved, nothing installed: the stack is left as it is")
    assert.equal(quiet.data.installed, false)
})

void test("a failed npm ci puts the previous node_modules back whole, removes what it wrote, and restarts the stopped processes", async (t) => {
    const { checkout, pusher } = scratch(t)
    lockfileMoved(pusher, checkout)
    const log: string[] = []
    const failing = fakeDeps(log, {
        npmCi: (root) => {
            log.push("npm ci fails halfway")
            mkdirSync(join(root, "node_modules"), { recursive: true })
            writeFileSync(join(root, "node_modules", "half"), "")
            return Promise.reject(new Error("npm ci: EPERM: operation not permitted, unlink lightningcss.win32-x64-msvc.node"))
        },
    })
    await assert.rejects(devSync(request(checkout, { execute: true, restart: true }), failing), /EPERM/u)
    assert.ok(existsSync(join(checkout, "node_modules", "old")), "the previous install is back")
    assert.equal(existsSync(join(checkout, "node_modules", "half")), false)
    assert.equal(existsSync(join(checkout, `node_modules${ASIDE}`)), false)
    assert.deepEqual(log, ["status", "stop api,web", "rename aside", "npm ci fails halfway", "rename back", "restart api,web"])
})

void test("a node_modules still held after the stop gets one retry, then refuses DEV_SYNC_BUSY with nothing installed or deleted", async (t) => {
    const { checkout, pusher } = scratch(t)
    lockfileMoved(pusher, checkout)
    const once: string[] = []
    await devSync(request(checkout, { execute: true }), fakeDeps(once, { refuseRenames: 1 }))
    assert.deepEqual(once.slice(2, 5), ["rename refused", "pause", "rename aside"])
    const { checkout: held, pusher: other } = scratch(t)
    lockfileMoved(other, held)
    const log: string[] = []
    await assert.rejects(devSync(request(held, { execute: true }), fakeDeps(log, { refuseRenames: 2 })), refused("DEV_SYNC_BUSY", "Nothing was installed or deleted"))
    assert.equal(log.some((line) => line.startsWith("npm ci")), false)
    assert.ok(existsSync(join(held, "node_modules", "old")))
})

void test("a dev stack that cannot be stopped, or read, refuses DEV_SYNC_STOP before the checkout moves or anything installs", async (t) => {
    const { checkout, pusher } = scratch(t)
    lockfileMoved(pusher, checkout)
    const start = gitIn(checkout, "rev-parse", "HEAD")
    const log: string[] = []
    const stuck = fakeDeps(log, { stop: () => Promise.resolve({ stopped: ["api"], alive: ["web (pid 102)"] }) })
    await assert.rejects(devSync(request(checkout, { execute: true }), stuck), refused("DEV_SYNC_STOP", "web (pid 102)"))
    const unread = fakeDeps(log, { stackProcesses: () => Promise.resolve("STACK_USAGE: no such env") })
    await assert.rejects(devSync(request(checkout, { execute: true }), unread), refused("DEV_SYNC_STOP", "STACK_USAGE"))
    assert.equal(log.some((line) => line.startsWith("npm ci") || line.startsWith("rename")), false)
    assert.equal(gitIn(checkout, "rev-parse", "HEAD"), start)
})

void test("a copy an interrupted sync left aside is the last whole install: the next sync moves it back and installs again", async (t) => {
    const { checkout } = scratch(t)
    mkdirSync(join(checkout, `node_modules${ASIDE}`))
    writeFileSync(join(checkout, `node_modules${ASIDE}`, "old"), "")
    writeFileSync(join(checkout, "node_modules", "half"), "")
    const dry = await devSync(request(checkout), fakeDeps([]))
    assert.match(dry.message, /would move back the copy an earlier sync left aside/u)
    assert.match(dry.message, /would run npm ci/u)
    const log: string[] = []
    await devSync(request(checkout, { execute: true }), fakeDeps(log))
    assert.deepEqual(log.slice(0, 4), ["status", "stop api,web", "rename back", "rename aside"])
    assert.ok(existsSync(join(checkout, "node_modules", "new")))
    assert.equal(existsSync(join(checkout, `node_modules${ASIDE}`)), false)
})

void test("the places an install replaces are the root node_modules and each workspace's: all move aside, and all come back on failure", async (t) => {
    const { checkout, pusher } = scratch(t)
    assert.deepEqual(installPlaces(checkout), [join(checkout, "node_modules")])
    const manifest = JSON.parse(readFileSync(join(pusher, "package.json"), "utf8")) as Record<string, unknown>
    lockfileMoved(pusher, checkout, { ...manifest, workspaces: ["fe/apps/*", "packages/**"] })
    mkdirSync(join(checkout, "fe", "apps", "web", "node_modules"), { recursive: true })
    writeFileSync(join(checkout, "fe", "apps", "web", "node_modules", "old"), "")
    const log: string[] = []
    await assert.rejects(devSync(request(checkout, { execute: true }), fakeDeps(log, { npmCi: () => Promise.reject(new Error("npm ci failed")) })), /npm ci failed/u)
    assert.deepEqual(installPlaces(checkout), [join(checkout, "node_modules"), join(checkout, "fe", "apps", "web", "node_modules")])
    assert.deepEqual(log.filter((line) => line.startsWith("rename")), ["rename aside", "rename aside", "rename back", "rename back"])
    assert.ok(existsSync(join(checkout, "node_modules", "old")))
    assert.ok(existsSync(join(checkout, "fe", "apps", "web", "node_modules", "old")))
})

void test("a new workspace package is built (the app's codegen and build:modules) after the install and before the restart; a code-only change builds without installing", async (t) => {
    const { checkout, pusher } = scratch(t)
    // The commit that adds a workspace package whose main is its dist: the lockfile moves with it.
    mkdirSync(join(pusher, "packages", "nivo-icons"), { recursive: true })
    writeFileSync(join(pusher, "packages", "nivo-icons", "package.json"), '{"name":"@starci/nivo-icons","main":"./dist/index.js"}\n')
    lockfileMoved(pusher, checkout)
    const dry = await devSync(request(checkout, { restart: true }), fakeDeps([]))
    assert.match(dry.message, /would run the app's codegen and build:modules \(each one it declares\) before the restart/u)
    const log: string[] = []
    await devSync(request(checkout, { execute: true, restart: true }), fakeDeps(log))
    assert.deepEqual(log.slice(-3), ["rename trash", "prepare", "restart api,web"], "built after the install, before the web restarts on it")
    writeFileSync(join(pusher, "packages", "nivo-icons", "index.ts"), "export const icon = 1\n")
    gitIn(pusher, "add", ".")
    gitIn(pusher, "commit", "-q", "-m", "icon source")
    gitIn(pusher, "push", "-q", "origin", "dev")
    const code: string[] = []
    await devSync(request(checkout, { execute: true, restart: true }), fakeDeps(code))
    assert.deepEqual(code, ["prepare", "restart api,web"], "a package's source moved without the lockfile: no install, still built before the restart")
})

void test("a build of the workspace packages that fails restarts the stopped processes and refuses DEV_SYNC_BUILD with its output", async (t) => {
    const { checkout, pusher } = scratch(t)
    lockfileMoved(pusher, checkout)
    const log: string[] = []
    const failing = fakeDeps(log, {
        prepare: () => {
            log.push("prepare fails")
            return Promise.resolve({ command: "npm run build:modules", exitCode: 2, output: "packages/nivo-icons: error TS2307: Cannot find module './glyphs'" })
        },
    })
    await assert.rejects(devSync(request(checkout, { execute: true, restart: true }), failing), refused("DEV_SYNC_BUILD", "npm run build:modules exited 2"))
    assert.deepEqual(log, ["status", "stop api,web", "rename aside", "npm ci (node_modules moved aside)", "rename trash", "prepare fails", "restart api,web"], "the processes stopped for the install come back")
    assert.ok(existsSync(join(checkout, "node_modules", "new")), "the install itself stands: only the build failed")
    // The checkout no longer moves, yet the next sync builds again and restarts both sides once the build passes.
    const dry = await devSync(request(checkout, { restart: true }), fakeDeps([]))
    assert.match(dry.message, /the last sync could not build the workspace packages/u)
    await assert.rejects(devSync(request(checkout, { execute: true, restart: true }), fakeDeps([], { prepare: failing.prepare })), refused("DEV_SYNC_BUILD", "Cannot find module './glyphs'"))
    const fixed: string[] = []
    const done = await devSync(request(checkout, { execute: true, restart: true }), fakeDeps(fixed))
    assert.deepEqual(fixed, ["prepare", "restart api,web"])
    assert.equal(done.data.restart, "done")
    const quiet: string[] = []
    await devSync(request(checkout, { execute: true, restart: true }), fakeDeps(quiet))
    assert.deepEqual(quiet, [], "a passing build clears the mark: nothing moved, nothing runs")
})

/** Pushes a new migration file (and, with `lockfile`, a lockfile change) to dev. */
const migrationPushed = (pusher: string, name: string): void => {
    mkdirSync(join(pusher, "db", "migrations"), { recursive: true })
    writeFileSync(join(pusher, "db", "migrations", name), "alter table webhooks add column expires_at timestamptz;\n")
    gitIn(pusher, "add", ".")
    gitIn(pusher, "commit", "-q", "-m", name)
    gitIn(pusher, "push", "-q", "origin", "dev")
}

/** Fake seams whose appRun logs `up` for `app stack up` and fails it while `failUp` holds. */
const migratingDeps = (log: string[], failUp: { now: boolean }): DevSyncDeps => fakeDeps(log, {
    appRun: (_root, args) => {
        if (args.includes("up")) {
            log.push(failUp.now ? "up fails" : "up")
            return Promise.resolve({ exitCode: failUp.now ? 1 : 0, stdout: failUp.now ? "STACK_LOCAL_MIGRATE: starci app db migrate exited 1: column card_figures already exists" : "migrate: applied, receipt abc", stderr: "", timedOut: false })
        }
        log.push(`restart ${args[args.indexOf("--process") + 1] ?? ""}`)
        return Promise.resolve({ exitCode: 0, stdout: "", stderr: "", timedOut: false })
    },
})

void test("new migrations are applied by the stack's migrate step (app stack up) after the build and before the api restarts on the code that needs them", async (t) => {
    const { checkout, pusher } = scratch(t)
    migrationPushed(pusher, "20261122090000_webhook_expiry.sql")
    const dry = await devSync(request(checkout, { restart: true }), fakeDeps([]))
    assert.match(dry.message, /would migrate the dev database before the restart \(1 migration file\(s\) changed\): app stack up --env dev --execute/u)
    const log: string[] = []
    const done = await devSync(request(checkout, { execute: true, restart: true }), migratingDeps(log, { now: false }))
    assert.deepEqual(log, ["prepare", "up", "restart api,web"])
    assert.equal(done.data.migrated, true)
    // With an install, the processes stopped for it are started again by stack up on the new code: not restarted twice.
    const { checkout: other, pusher: second } = scratch(t)
    migrationPushed(second, "20261122100000_card_figures.sql")
    lockfileMoved(second, other)
    const installed: string[] = []
    const both = await devSync(request(other, { execute: true, restart: true }), migratingDeps(installed, { now: false }))
    assert.deepEqual(installed.slice(-3), ["rename trash", "prepare", "up"])
    assert.deepEqual(both.data.restarted, ["api", "web"])
    assert.equal(both.data.restart, "done")
})

void test("a failed migration refuses DEV_SYNC_MIGRATE, restarts nothing new, and the next sync migrates again though nothing moved", async (t) => {
    const { checkout, pusher } = scratch(t)
    migrationPushed(pusher, "20261122130000_card_figures.sql")
    const failUp = { now: true }
    const log: string[] = []
    await assert.rejects(devSync(request(checkout, { execute: true, restart: true }), migratingDeps(log, failUp)), refused("DEV_SYNC_MIGRATE", "column card_figures already exists"))
    assert.deepEqual(log, ["prepare", "up fails"], "no process restarts on code whose migration failed")
    const dry = await devSync(request(checkout, { restart: true }), fakeDeps([]))
    assert.match(dry.message, /the last sync's migration failed/u)
    failUp.now = false
    const again: string[] = []
    const done = await devSync(request(checkout, { execute: true, restart: true }), migratingDeps(again, failUp))
    assert.deepEqual(again, ["prepare", "up", "restart api,web"], "nothing moved, yet the migration runs again and the api restarts on the code that needs it")
    assert.equal(done.data.migrated, true)
    const quiet: string[] = []
    await devSync(request(checkout, { execute: true, restart: true }), migratingDeps(quiet, failUp))
    assert.deepEqual(quiet, [], "a migration that passed clears the mark")
})

void test("prepareTree runs codegen then build:modules and stops at the first that fails, quoting its output", async () => {
    const ran: string[] = []
    const runner = (exits: Record<string, number>) => (_root: string, script: string) => {
        ran.push(script)
        return Promise.resolve({ exitCode: exits[script] ?? 0, stdout: `${script} out`, stderr: exits[script] === undefined ? "" : "Module not found: Can't resolve '@starci/nivo-icons'", timedOut: false })
    }
    const green = await prepareTree("/app", "spec", PREPARE_SCRIPTS, runner({}))
    assert.deepEqual(green.ran, ["codegen", "build:modules"])
    assert.equal(green.failure, undefined)
    ran.length = 0
    const red = await prepareTree("/app", "spec", PREPARE_SCRIPTS, runner({ codegen: 1 }))
    assert.deepEqual(ran, ["codegen"], "build:modules never runs on a failed codegen")
    assert.deepEqual(red.failure, { command: "npm run codegen", exitCode: 1, output: "codegen out\nModule not found: Can't resolve '@starci/nivo-icons'" })
})

void test("the stack's processes are read from the pinned CLI's status envelope, and a stop takes each recorded process with its children only", () => {
    const envelope = JSON.stringify({ schema: "starci/app-stack@1", ok: true, data: { verb: "stack", exitCode: 1, output: { verb: "status", ok: false, processes: { web: { pid: 7, startedAt: "2026-11-21T08:00:00.000Z", port: 3000, command: "npm run start" } } } } })
    assert.deepEqual(parseStackStatus(envelope), { web: { pid: 7, startedAt: "2026-11-21T08:00:00.000Z", command: "npm run start" } })
    assert.equal(parseStackStatus(JSON.stringify({ schema: "starci/refusal@1", ok: false, code: "STACK_USAGE", message: "no env" })), "STACK_USAGE: no env")
    assert.equal(parseStackStatus("not json"), "it printed no json (not json)")
    const at = Date.parse("2026-11-21T08:00:00.000Z")
    const row = (pid: number, ppid: number, startedMs: number | null): Parameters<typeof stopTargets>[1][number] => ({ pid, ppid, name: "node.exe", workingSetMb: 1, commandLine: "node", cpuMs: null, startedMs, cwd: null })
    const table = [row(7, 1, at + 500), row(8, 7, at + 2_000), row(9, 8, at + 3_000), row(10, 7, at - 3_600_000), row(20, 1, at + 9_999_999)]
    const targets = stopTargets({ web: { pid: 7, startedAt: "2026-11-21T08:00:00.000Z" }, api: { pid: 20, startedAt: "2026-11-21T08:00:00.000Z" }, gone: { pid: 30, startedAt: "2026-11-21T08:00:00.000Z" } }, table)
    assert.deepEqual(targets.running, ["web"], "a reused pid (20) and a gone one (30) are not the stack's")
    assert.deepEqual([...targets.pids].toSorted((left, right) => left - right), [7, 8, 9], "a child older than its parent (10) is a stranger")
})

void test("a sync with no --local keeps this machine's standing overlay (devSync.local); naming packages overrides it; an empty setting means npm", () => {
    assert.deepEqual(syncLocal([], { local: ["grammar@0.55.0-content.4"] }), ["grammar@0.55.0-content.4"])
    assert.deepEqual(syncLocal(["@starci/hfs@6.18.0-local.1"], { local: ["grammar@0.55.0-content.4"] }), ["@starci/hfs@6.18.0-local.1"])
    assert.deepEqual(syncLocal([], { local: [] }), [])
})

void test("a sync that asks for the overlay already installed leaves the running web alone: nothing restored, installed, stopped or restarted", async (t) => {
    const { checkout, pusher } = scratch(t)
    const pinned = readFileSync(join(checkout, "package.json"), "utf8")
    writeFileSync(join(checkout, "package.json"), pinned.replace("0.52.3", "0.57.1-dev.1"))
    writeInstallRecord(checkout, { schema: "starci/deps-install-local@1", registry: "http://127.0.0.1:4873/", packages: [{ name: "@starci/grammar", version: "0.57.1-dev.1", pins: [{ file: "package.json", field: "dependencies", spec: "0.52.3" }] }] })
    const log: string[] = []
    const same = await devSync(request(checkout, { execute: true, restart: true, local: ["@starci/grammar@0.57.1-dev.1"] }), fakeDeps(log))
    assert.deepEqual(log, [], "no stop, no install, no prepare, no restart")
    assert.equal(same.data.restart, "none")
    assert.deepEqual(same.data.overlay, ["@starci/grammar@0.57.1-dev.1"], "the overlay stays in effect")
    assert.match(same.message, /the local overlay is already installed \(@starci\/grammar@0\.57\.1-dev\.1\): nothing restored, reinstalled or restarted for it/u)
    assert.match(readFileSync(join(checkout, "package.json"), "utf8"), /0\.57\.1-dev\.1/u, "the overlay pin is kept")
    // a code change under be/ alone restarts the api only; the web keeps running
    mkdirSync(join(pusher, "be"), { recursive: true })
    writeFileSync(join(pusher, "be", "main.ts"), "export {}\n")
    gitIn(pusher, "add", ".")
    gitIn(pusher, "commit", "-q", "-m", "be change")
    gitIn(pusher, "push", "-q", "origin", "dev")
    const api: string[] = []
    const be = await devSync(request(checkout, { execute: true, restart: true, local: ["@starci/grammar@0.57.1-dev.1"] }), fakeDeps(api))
    assert.deepEqual(api, ["prepare", "restart api"])
    assert.deepEqual(be.data.restarted, ["api"])
    // a new version of the overlay is a change the web consumes: restored, installed and both sides restarted, as before
    const dry = await devSync(request(checkout, { local: ["@starci/grammar@0.57.2-dev.1"] }))
    assert.match(dry.message, /would restore the committed pins of package-lock\.json, package\.json/u)
    assert.deepEqual(dry.data.sides, ["be", "fe"])
})

void test("with the staging seam the new tree is installed and built before the stop, and only the swap and the restart happen after it", async (t) => {
    const { checkout, pusher, base } = scratch(t)
    lockfileMoved(pusher, checkout)
    const log: string[] = []
    const staging = join(base, ".checkout.starci-next")
    const stage: NonNullable<DevSyncDeps["stage"]> = {
        tree: (_root, to) => {
            log.push(`stage ${to.slice(0, 7)}`)
            mkdirSync(staging, { recursive: true })
            return Promise.resolve(staging)
        },
        outputs: () => Promise.resolve(["node_modules"]),
        tracked: () => Promise.resolve([]),
        swap: () => {
            log.push("swap")
            return Promise.resolve({ moved: ["node_modules"], copied: [], relinked: 0, leftover: [] })
        },
    }
    const target = gitIn(pusher, "rev-parse", "HEAD")
    const done = await devSync(request(checkout, { execute: true, restart: true }), fakeDeps(log, { stage }))
    assert.deepEqual(log, [`stage ${target.slice(0, 7)}`, "npm ci (node_modules moved aside)", "prepare", "status", "stop api,web", "swap", "restart api,web"])
    assert.equal(done.data.restart, "done")
    assert.equal(gitIn(checkout, "rev-parse", "HEAD"), target)
    // A staged build that fails stops nothing and moves nothing: the stack keeps serving the old tree.
    writeFileSync(join(pusher, "package-lock.json"), '{"name":"app","lockfileVersion":3,"requires":true,"packages":{"":{"name":"app","version":"1.0.2"}}}\n')
    gitIn(pusher, "add", ".")
    gitIn(pusher, "commit", "-q", "-m", "lockfile again")
    gitIn(pusher, "push", "-q", "origin", "dev")
    const failed: string[] = []
    const before = gitIn(checkout, "rev-parse", "HEAD")
    await assert.rejects(devSync(request(checkout, { execute: true, restart: true }), fakeDeps(failed, { stage, prepare: () => Promise.resolve({ command: "npm run codegen", exitCode: 1, output: "boom" }) })), refused("DEV_SYNC_BUILD", "nothing was stopped"))
    assert.equal(failed.some((line) => line.startsWith("stop") || line === "swap"), false)
    assert.equal(gitIn(checkout, "rev-parse", "HEAD"), before)
})

void test("a swap that fails after the fast-forward leaves a mark: the next sync, with nothing new on dev, installs and swaps the new tree whole", async (t) => {
    const { checkout, pusher, base } = scratch(t)
    lockfileMoved(pusher, checkout)
    const log: string[] = []
    const staging = join(base, ".checkout.starci-next")
    let refuse = true
    const stage: NonNullable<DevSyncDeps["stage"]> = {
        tree: () => {
            log.push("stage")
            mkdirSync(staging, { recursive: true })
            return Promise.resolve(staging)
        },
        outputs: () => Promise.resolve(["node_modules"]),
        tracked: () => Promise.resolve([]),
        swap: () => {
            log.push("swap")
            if (!refuse) return Promise.resolve({ moved: ["node_modules"], copied: [], relinked: 0, leftover: [] })
            refuse = false
            return Promise.reject(new Refusal("DEV_SYNC_SWAP", "the staged build could not be moved: ENOENT"))
        },
    }
    const target = gitIn(pusher, "rev-parse", "HEAD")
    await assert.rejects(devSync(request(checkout, { execute: true, restart: true }), fakeDeps(log, { stage })), (error: { code?: string }) => error.code === "DEV_SYNC_SWAP")
    assert.equal(gitIn(checkout, "rev-parse", "HEAD"), target, "the checkout is on the new commit, with the old install")
    const mark = gitIn(checkout, "rev-parse", "--path-format=absolute", "--git-path", "starci-dev-sync-unswapped")
    assert.ok(existsSync(mark), "the failed swap is marked")
    const first = log.length
    const done = await devSync(request(checkout, { execute: true, restart: true }), fakeDeps(log, { stage }))
    const again = log.slice(first)
    assert.ok(again.includes("stage") && again.includes("swap"), `the retry stages and swaps again: ${again.join(", ")}`)
    assert.equal(done.data.installed, true)
    assert.equal(existsSync(mark), false, "a swap that passed clears the mark")
})
