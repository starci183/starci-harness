// `starci hotfix land` (contexts/authority/lanes.md "Hotfix"): the scope guard (the owner's two limits and the refusal "quá lớn cho hotfix (N file / M dòng), mở lane"), the
// one `Hotfix:` commit on dev, the pass that lets that one push through the pre-push gate, the restart (light, or the full sync steps), the refusals that put the edit back,
// and `status` / `abort`. It runs real git against a bare origin in a scratch folder and fake restart, health and CI-watch seams. Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { captureTool } from "../../shared/exec.js"
import { captureGitSync } from "../../shared/git.js"
import { landPaths } from "../../harness/land-queue.js"
import { hotfixAbort, hotfixLand, hotfixMessage, hotfixStatus } from "./land.js"
import type { HotfixDeps } from "./land.js"
import { passFile, passFor } from "./pass.js"
import { loadHotfixRules } from "./rules.js"
import type { HotfixRules } from "./rules.js"
import { escalationOf, readChanges, scopeOf, tooBigMessage } from "./scope.js"
import { cliCopyNeeded, cliCurrent, linkTarget, rebuildCliCopy, repoint } from "./cli-copy.js"
import type { CliCopyPorts } from "./cli-copy.js"

const gitIn = (cwd: string, ...args: string[]): string => {
    const run = captureGitSync(["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], cwd)
    assert.equal(run.exitCode, 0, `git ${args.join(" ")}: ${run.stderr}`)
    return run.stdout.trim()
}

const RULES: HotfixRules = { schema: "starci/hotfix@1", maxFiles: 5, maxLines: 200, healthWaitSeconds: 1 }

interface World {
    readonly checkout: string
    readonly pusher: string
    readonly origin: string
    readonly dir: string
}

/** A bare origin with dev, the app's dev checkout on dev, a second clone that pushes to dev and a lanes folder. */
const scratch = (t: { after: (fn: () => void) => void }): World => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "starci-hotfix-")))
    for (const name of ["GIT_AUTHOR_NAME", "GIT_COMMITTER_NAME"]) process.env[name] = "t"
    for (const name of ["GIT_AUTHOR_EMAIL", "GIT_COMMITTER_EMAIL"]) process.env[name] = "t@example.invalid"
    t.after(() => {
        rmSync(base, { recursive: true, force: true })
    })
    const origin = join(base, "origin.git")
    gitIn(base, "init", "-q", "--bare", "-b", "dev", origin)
    const pusher = join(base, "pusher")
    gitIn(base, "clone", "-q", origin, pusher)
    gitIn(pusher, "switch", "-q", "-c", "dev")
    mkdirSync(join(pusher, "fe"), { recursive: true })
    writeFileSync(join(pusher, "fe", "copy.ts"), "export const hello = 'helo'\n")
    writeFileSync(join(pusher, "a.txt"), "one\n")
    gitIn(pusher, "add", ".")
    gitIn(pusher, "commit", "-q", "-m", "start")
    gitIn(pusher, "push", "-q", "origin", "dev")
    const checkout = join(base, "checkout")
    gitIn(base, "clone", "-q", "-b", "dev", origin, checkout)
    return { checkout, pusher, origin, dir: join(base, "lanes") }
}

interface Seen {
    readonly log: string[]
    readonly restarts: { readonly checkout: string; readonly since?: string | undefined; readonly light: boolean }[]
    readonly passes: (string | undefined)[]
}

const fakeDeps = (seen: Seen, extra: Partial<HotfixDeps> = {}): HotfixDeps => ({
    push: (root, _profile, sha) => {
        seen.log.push("push")
        seen.passes.push(passFor(root, `refs/heads/dev ${sha} refs/heads/dev ${"0".repeat(40)}`))
        return captureTool("git", ["push", "origin", `${sha}:refs/heads/dev`], root)
    },
    publish: () => Promise.resolve([]),
    watchCi: (_root, _dir, sha, lanes) => {
        seen.log.push(`watch ${lanes.join(",")} ${sha.length === 40 ? "sha" : sha}`)
        return Promise.resolve()
    },
    restart: (checkout, request) => {
        seen.log.push("restart")
        seen.restarts.push({ checkout, since: request.since, light: request.light })
        return Promise.resolve({ checkout, state: "done", note: "restarted api" })
    },
    busy: () => Promise.resolve(undefined),
    syncTargets: () => Promise.resolve([]),
    cliCopy: () => Promise.resolve({ state: "skipped", note: "unused" }),
    health: (url) => {
        seen.log.push(`health ${url}`)
        return Promise.resolve(undefined)
    },
    ...extra,
})

const seenOf = (): Seen => ({ log: [], restarts: [], passes: [] })

const land = (world: World, deps: HotfixDeps, extra: { readonly healthUrl?: string; readonly rules?: HotfixRules; readonly dryRun?: boolean; readonly only?: readonly string[] } = {}): ReturnType<typeof hotfixLand> =>
    hotfixLand({ root: world.checkout, dir: world.dir, profile: "app", message: "fix the typo", rules: extra.rules ?? RULES, say: () => undefined, ...extra }, deps)

const refusedWith = (code: string, text = "") => (error: unknown): boolean => error instanceof Error && "code" in error && error.code === code && error.message.includes(text)

void test("ops/hotfix.yaml holds the owner's limits: 5 files and 200 changed lines", () => {
    const rules = loadHotfixRules()
    assert.equal(rules.maxFiles, 5)
    assert.equal(rules.maxLines, 200)
})

void test("scope: five files or 200 lines pass, one more of either is over; a binary file is over; the message is the owner's", () => {
    const text = (path: string, added: number, deleted = 0): { path: string; added: number; deleted: number; binary: boolean } => ({ path, added, deleted, binary: false })
    assert.deepEqual(scopeOf([text("a", 100, 100)], RULES), { files: 1, lines: 200, ok: true })
    assert.equal(scopeOf([text("a", 100, 101)], RULES).ok, false, "201 lines (added plus deleted)")
    assert.equal(scopeOf(["a", "b", "c", "d", "e"].map((name) => text(name, 1)), RULES).ok, true)
    assert.equal(scopeOf(["a", "b", "c", "d", "e", "f"].map((name) => text(name, 1)), RULES).ok, false, "six files")
    assert.equal(scopeOf([{ path: "logo.png", added: 0, deleted: 0, binary: true }], RULES).ok, false)
    const over = scopeOf(["a", "b", "c", "d", "e", "f"].map((name) => text(name, 2)), RULES)
    assert.equal(tooBigMessage(over, RULES).split("\n")[0], "quá lớn cho hotfix (6 file / 12 dòng), mở lane")
})

void test("what makes the restart full: a lockfile or manifest, a migration, a schema or a workspace package; code alone is light", () => {
    assert.deepEqual(escalationOf(["fe/copy.ts", "be/x.ts", "README.md"]), [])
    assert.equal(escalationOf(["package-lock.json"]).length, 1)
    assert.equal(escalationOf(["be/package.json"]).length, 1)
    assert.equal(escalationOf(["db/migrations/002_x.sql"]).length, 1)
    assert.equal(escalationOf(["be/schema.graphql"]).length, 1)
    assert.equal(escalationOf(["packages/icons/src/a.ts"]).length, 1)
    assert.equal(escalationOf(["package-lock.json", "db/migrations/002_x.sql"]).length, 2)
})

void test("a hotfix lands as ONE commit with a Hotfix: trailer on origin/dev, the pre-push gate is passed for that push only, dev restarts light, then health and the CI watch, and the checkout is clean", async (t) => {
    const world = scratch(t)
    const before = gitIn(world.checkout, "rev-parse", "HEAD")
    writeFileSync(join(world.checkout, "fe", "copy.ts"), "export const hello = 'hello'\n")
    writeFileSync(join(world.checkout, "fe", "copy.test.ts"), "export {}\n")
    const seen = seenOf()
    const done = await land(world, fakeDeps(seen), { healthUrl: "http://127.0.0.1:1/health", only: ["fe/copy.ts", "fe/copy.test.ts"] })
    assert.deepEqual(seen.log, ["push", "restart", "health http://127.0.0.1:1/health", "watch hotfix sha"])
    assert.equal(seen.passes.length, 1)
    assert.match(seen.passes[0] ?? "", /the pre-push gate is skipped for this push/u, "the hook's own check finds the pass during the push")
    assert.equal(existsSync(passFile(world.checkout) ?? ""), false, "the pass goes with the push")
    assert.equal(passFor(world.checkout, `refs/heads/dev ${done.sha} refs/heads/dev ${before}`), undefined, "and it is not left for another push")
    assert.equal(gitIn(world.origin, "rev-parse", "dev"), done.sha)
    assert.equal(gitIn(world.origin, "rev-parse", "dev^"), before, "one commit on the dev it landed on")
    assert.equal(gitIn(world.origin, "rev-list", "--count", `${before}..dev`), "1")
    const message = gitIn(world.origin, "log", "-1", "--format=%B", "dev")
    assert.match(message, /^hotfix: fix the typo/u)
    assert.match(message, /\nHotfix: 2 file\(s\) \/ 3 line\(s\)\s*$/u)
    assert.deepEqual(seen.restarts, [{ checkout: world.checkout, since: before, light: true }], "told where the checkout was before the hotfix; light")
    assert.deepEqual(done.escalation, [])
    assert.equal(done.health, "http://127.0.0.1:1/health answered 200")
    assert.equal(gitIn(world.checkout, "status", "--porcelain"), "", "the dev checkout is clean and on the pushed commit")
    assert.equal(gitIn(world.checkout, "rev-parse", "HEAD"), done.sha)
    assert.equal(existsSync(landPaths(world.dir).devLock), false, "the dev lock is released")
})

void test("a hotfix over the limit is refused before the lock, any commit or any restart: files, then lines", async (t) => {
    const world = scratch(t)
    const before = gitIn(world.checkout, "rev-parse", "HEAD")
    for (const name of ["1", "2", "3", "4", "5", "6"]) writeFileSync(join(world.checkout, `n${name}.txt`), "x\n")
    const seen = seenOf()
    const six = ["n1.txt", "n2.txt", "n3.txt", "n4.txt", "n5.txt", "n6.txt"]
    await assert.rejects(land(world, fakeDeps(seen), { only: six }), refusedWith("HOTFIX_SCOPE", "quá lớn cho hotfix (6 file / 6 dòng), mở lane"))
    rmSync(world.checkout + "/n1.txt")
    rmSync(world.checkout + "/n2.txt")
    rmSync(world.checkout + "/n3.txt")
    rmSync(world.checkout + "/n4.txt")
    rmSync(world.checkout + "/n5.txt")
    writeFileSync(join(world.checkout, "n6.txt"), "line\n".repeat(201))
    await assert.rejects(land(world, fakeDeps(seen), { only: ["n6.txt"] }), refusedWith("HOTFIX_SCOPE", "quá lớn cho hotfix (1 file / 201 dòng), mở lane"))
    assert.deepEqual(seen.log, [], "nothing ran")
    assert.equal(gitIn(world.checkout, "rev-parse", "HEAD"), before)
    assert.equal(existsSync(landPaths(world.dir).devLock), false, "the lock was never taken")
    assert.equal(existsSync(join(world.checkout, "n6.txt")), true, "the edit stays")
})

void test("adding, deleting, a migration and a lockfile are all allowed inside the limits; the restart then runs the full steps and says why", async (t) => {
    const world = scratch(t)
    const before = gitIn(world.checkout, "rev-parse", "HEAD")
    rmSync(join(world.checkout, "a.txt"))
    mkdirSync(join(world.checkout, "db", "migrations"), { recursive: true })
    writeFileSync(join(world.checkout, "db", "migrations", "002_seed.sql"), "select 2;\n")
    writeFileSync(join(world.checkout, "package-lock.json"), "{}\n")
    const seen = seenOf()
    const lines: string[] = []
    const done = await hotfixLand({ root: world.checkout, dir: world.dir, profile: "app", message: "seed fix", rules: RULES, only: ["a.txt", "db/migrations/002_seed.sql", "package-lock.json"], say: (line) => lines.push(line) }, fakeDeps(seen))
    assert.equal(done.escalation.length, 2)
    assert.deepEqual(seen.restarts, [{ checkout: world.checkout, since: before, light: false }])
    assert.ok(lines.some((line) => line.includes("restart: the FULL sync steps, not the light restart (a manifest or lockfile changed: npm ci; a migration changed")), lines.join("\n"))
    assert.equal(gitIn(world.origin, "show", "--stat", "--format=", "dev").includes("a.txt"), true, "the deletion landed")
})

void test("a dev sync that is running refuses the hotfix with nothing committed and the lock released", async (t) => {
    const world = scratch(t)
    const before = gitIn(world.checkout, "rev-parse", "HEAD")
    writeFileSync(join(world.checkout, "a.txt"), "two\n")
    const seen = seenOf()
    await assert.rejects(land(world, fakeDeps(seen, { busy: () => Promise.resolve("the dev sync runner (pid 1) is syncing") })), refusedWith("HOTFIX_SYNC_BUSY", "is syncing"))
    assert.equal(gitIn(world.checkout, "rev-parse", "HEAD"), before)
    assert.equal(readFileSync(join(world.checkout, "a.txt"), "utf8").replace(/\r/g, ""), "two\n")
    assert.deepEqual(seen.log, [])
    assert.equal(existsSync(landPaths(world.dir).devLock), false)
})

void test("dev that moved is pulled in: the hotfix is rebased onto it, and the restart reads the changes from where the checkout was", async (t) => {
    const world = scratch(t)
    const before = gitIn(world.checkout, "rev-parse", "HEAD")
    writeFileSync(join(world.pusher, "other.txt"), "another landing\n")
    gitIn(world.pusher, "add", ".")
    gitIn(world.pusher, "commit", "-q", "-m", "another landing")
    gitIn(world.pusher, "push", "-q", "origin", "dev")
    const moved = gitIn(world.origin, "rev-parse", "dev")
    writeFileSync(join(world.checkout, "a.txt"), "two\n")
    const seen = seenOf()
    const done = await land(world, fakeDeps(seen))
    assert.equal(gitIn(world.origin, "rev-parse", "dev^"), moved, "on top of the dev that moved")
    assert.equal(done.base, moved)
    assert.deepEqual(seen.restarts.map((restart) => restart.since), [before])
    assert.ok(existsSync(join(world.checkout, "other.txt")), "the checkout holds the other landing too")
})

void test("a conflict with the newest dev gives the edit back and lands nothing", async (t) => {
    const world = scratch(t)
    const before = gitIn(world.checkout, "rev-parse", "HEAD")
    writeFileSync(join(world.pusher, "a.txt"), "dev's own\n")
    gitIn(world.pusher, "add", ".")
    gitIn(world.pusher, "commit", "-q", "-m", "a on dev")
    gitIn(world.pusher, "push", "-q", "origin", "dev")
    const moved = gitIn(world.origin, "rev-parse", "dev")
    writeFileSync(join(world.checkout, "a.txt"), "hotfix's own\n")
    const seen = seenOf()
    await assert.rejects(land(world, fakeDeps(seen)), refusedWith("HOTFIX_CONFLICT", "a.txt"))
    assert.deepEqual(seen.log, [])
    assert.equal(gitIn(world.origin, "rev-parse", "dev"), moved)
    assert.equal(gitIn(world.checkout, "rev-parse", "HEAD"), before, "the commit is undone")
    assert.equal(readFileSync(join(world.checkout, "a.txt"), "utf8").replace(/\r/g, ""), "hotfix's own\n", "the edit is back in the working tree")
    assert.equal(existsSync(landPaths(world.dir).devLock), false)
})

void test("a refused push undoes the commit, gives the edit back, removes the pass and restarts nothing", async (t) => {
    const world = scratch(t)
    const before = gitIn(world.checkout, "rev-parse", "HEAD")
    writeFileSync(join(world.checkout, "a.txt"), "two\n")
    const seen = seenOf()
    await assert.rejects(land(world, fakeDeps(seen, { push: () => Promise.resolve({ exitCode: 1, stdout: "", stderr: "remote rejected", timedOut: false }) })), refusedWith("HOTFIX_PUSH", "remote rejected"))
    assert.equal(gitIn(world.checkout, "rev-parse", "HEAD"), before)
    assert.equal(readFileSync(join(world.checkout, "a.txt"), "utf8").replace(/\r/g, ""), "two\n")
    assert.equal(existsSync(passFile(world.checkout) ?? ""), false)
    assert.deepEqual(seen.log, [])
    assert.equal(existsSync(landPaths(world.dir).devLock), false)
})

void test("a restart or a health wait that fails does not undo the landing: it is reported, the CI watch still starts", async (t) => {
    const world = scratch(t)
    writeFileSync(join(world.checkout, "a.txt"), "two\n")
    const seen = seenOf()
    const done = await land(world, fakeDeps(seen, { restart: (checkout) => Promise.resolve({ checkout, state: "failed", note: "DEV_SYNC_BUILD: boom" }), health: () => Promise.resolve("http://x answered 502 after 1 s") }), { healthUrl: "http://x" })
    assert.equal(done.restarts[0]?.state, "failed")
    assert.match(done.health, /^FAILED: http:\/\/x answered 502/u)
    assert.deepEqual(seen.log, ["push", "watch hotfix sha"])
    assert.equal(gitIn(world.origin, "rev-parse", "dev"), done.sha, "it stays landed")
})

void test("a harness hotfix rebuilds the CLI copy, publishes the dev line and syncs EVERY app of devSync.repos at once with a plain sync, naming its files with --only", async (t) => {
    const world = scratch(t)
    mkdirSync(join(world.checkout, "cli"), { recursive: true })
    writeFileSync(join(world.checkout, "cli", "x.ts"), "export {}\n")
    writeFileSync(join(world.checkout, "stray.txt"), "someone else's untracked file\n")
    writeFileSync(join(world.checkout, "a.txt"), "two\n")
    const seen = seenOf()
    const lines: string[] = []
    const harness = fakeDeps(seen, {
        publish: () => Promise.resolve(["@starci/hfs"]),
        syncTargets: () => Promise.resolve(["D:/app-one", "D:/app-two"]),
        cliCopy: (_root, _dir, sha, files) => {
            seen.log.push(`cli copy ${sha.length === 40 ? "sha" : sha}: ${files.join(",")}`)
            return Promise.resolve({ state: "built", note: "_cli-current now points to the copy", path: "x" })
        },
    })
    await assert.rejects(hotfixLand({ root: world.checkout, dir: world.dir, profile: "harness", message: "harness fix", rules: RULES, say: () => undefined }, harness), refusedWith("HOTFIX_ONLY_REQUIRED"))
    const done = await hotfixLand({ root: world.checkout, dir: world.dir, profile: "harness", message: "harness fix", rules: RULES, only: ["a.txt", "cli/x.ts"], say: (line) => lines.push(line) }, harness)
    assert.deepEqual(seen.log.slice(0, 2), ["push", "cli copy sha: a.txt,cli/x.ts"], "the CLI copy is rebuilt right after the push, before the publish")
    assert.deepEqual(seen.restarts, [{ checkout: "D:/app-one", since: undefined, light: false }, { checkout: "D:/app-two", since: undefined, light: false }])
    assert.deepEqual(done.published, ["@starci/hfs"])
    assert.equal(done.cliCopy?.state, "built")
    assert.ok(lines.some((line) => line.includes("syncing every app dev checkout of devSync.repos now, no debounce")))
    assert.equal(gitIn(world.checkout, "ls-files", "stray.txt"), "", "an untracked file that is not named is never swept in")
    assert.equal(existsSync(landPaths(world.dir, "harness").devLock), false, "the harness lock scope is released")
})

void test("tracked changes outside --only stop the hotfix, a named path with no change is a typo, and a new file lands only when named", async (t) => {
    const world = scratch(t)
    writeFileSync(join(world.checkout, "a.txt"), "two\n")
    writeFileSync(join(world.checkout, "fe", "copy.ts"), "export const hello = 'hello'\n")
    writeFileSync(join(world.checkout, "fresh.txt"), "new\n")
    const seen = seenOf()
    await assert.rejects(land(world, fakeDeps(seen), { only: ["a.txt"] }), refusedWith("HOTFIX_FOREIGN", "fe/copy.ts"))
    await assert.rejects(land(world, fakeDeps(seen), { only: ["a.txt", "fe/copy.ts", "typo.txt"] }), refusedWith("HOTFIX_ONLY_UNCHANGED", "typo.txt"))
    const done = await land(world, fakeDeps(seen), {})
    assert.deepEqual(done.files, ["a.txt", "fe/copy.ts"], "without --only the tracked changes are the hotfix and the untracked file is left alone")
    assert.equal(existsSync(join(world.checkout, "fresh.txt")), true)
    assert.equal(gitIn(world.checkout, "ls-files", "fresh.txt"), "")
})

void test("the CLI copy: rebuilt only when the hotfix touches what the CLI is built from; a failed build leaves _cli-current alone; the junction is repointed whole", async (t) => {
    assert.equal(cliCopyNeeded(["cli/src/a.ts"]), true)
    assert.equal(cliCopyNeeded(["contexts/authority/lanes.md"]), true)
    assert.equal(cliCopyNeeded(["packages/grammar/src/a.ts", "README.md"]), false)
    const base = realpathSync(mkdtempSync(join(tmpdir(), "starci-cli-copy-")))
    t.after(() => {
        rmSync(base, { recursive: true, force: true })
    })
    const dir = join(base, "lanes")
    const old = join(dir, "_cli-old000000")
    mkdirSync(old, { recursive: true })
    repoint(cliCurrent(dir), old)
    assert.equal(realpathSync(cliCurrent(dir)), realpathSync(old))
    const calls: string[] = []
    const ports = (fail?: "npm" | "build"): CliCopyPorts => ({
        git: (_cwd, args) => {
            calls.push(`git ${args.slice(0, 3).join(" ")}`)
            mkdirSync(String(args[3]), { recursive: true })
            return Promise.resolve({ exitCode: 0, stdout: "", stderr: "", timedOut: false })
        },
        npm: (args, _cwd, _label, kind) => {
            calls.push(`npm ${args[0] ?? ""}`)
            return Promise.resolve({ exitCode: (fail === "npm" && kind === "install") || (fail === "build" && kind === "build") ? 1 : 0, stdout: "", stderr: "boom", timedOut: false })
        },
        built: () => false,
        exists: (path) => existsSync(path),
        repoint,
    })
    const sha = "a".repeat(40)
    const skipped = await rebuildCliCopy({ root: base, dir, sha, files: ["README.md"], say: () => undefined }, ports())
    assert.equal(skipped.state, "skipped")
    const failed = await rebuildCliCopy({ root: base, dir, sha, files: ["cli/a.ts"], say: () => undefined }, ports("build"))
    assert.equal(failed.state, "failed")
    assert.match(failed.note, /npm run build exited 1.*_cli-current is unchanged/u)
    assert.equal(realpathSync(cliCurrent(dir)), realpathSync(old), "the machine's CLI is not moved by a failed build")
    const built = await rebuildCliCopy({ root: base, dir, sha: "b".repeat(40), files: ["cli/a.ts"], say: () => undefined }, ports())
    assert.equal(built.state, "built")
    assert.deepEqual(calls.slice(-3), ["git worktree add --detach", "npm ci", "npm run"])
    assert.equal(realpathSync(cliCurrent(dir)), realpathSync(join(dir, "_cli-bbbbbbbbb")))
    assert.ok(linkTarget(cliCurrent(dir)) !== undefined)
    assert.equal(existsSync(old), true, "the old copy stays; only the link moved")
    assert.deepEqual(readdirSync(dir).toSorted((a, b) => a.localeCompare(b)), ["_cli-aaaaaaaaa", "_cli-bbbbbbbbb", "_cli-current", "_cli-old000000"], "a failed build leaves its worktree for the retry, and no half-made link is left beside the junction")
})

void test("a hotfix is made in the dev checkout, on dev: a lane worktree, another branch or no edit is refused", async (t) => {
    const world = scratch(t)
    const seen = seenOf()
    await assert.rejects(land(world, fakeDeps(seen)), refusedWith("HOTFIX_EMPTY"))
    const tree = join(world.dir, "wt")
    gitIn(world.checkout, "worktree", "add", "-q", "-b", "lane/wt", tree)
    writeFileSync(join(tree, "a.txt"), "two\n")
    await assert.rejects(hotfixLand({ root: tree, dir: world.dir, profile: "app", message: "x", rules: RULES, say: () => undefined }, fakeDeps(seen)), refusedWith("HOTFIX_NOT_CHECKOUT"))
    gitIn(world.checkout, "switch", "-q", "-c", "other")
    writeFileSync(join(world.checkout, "a.txt"), "two\n")
    await assert.rejects(land(world, fakeDeps(seen)), refusedWith("HOTFIX_NOT_DEV", "other"))
    assert.deepEqual(seen.log, [])
})

void test("--dry-run prints the size and the plan and takes no lock; the check-cache records are no part of the size", async (t) => {
    const world = scratch(t)
    mkdirSync(join(world.checkout, ".starcistacks", "cache"), { recursive: true })
    writeFileSync(join(world.checkout, ".starcistacks", "cache", "record.json"), "x\n".repeat(500))
    writeFileSync(join(world.checkout, "a.txt"), "two\n")
    const lines: string[] = []
    const done = await hotfixLand({ root: world.checkout, dir: world.dir, profile: "app", message: "x", rules: RULES, dryRun: true, say: (line) => lines.push(line) }, fakeDeps(seenOf()))
    assert.equal(done.dryRun, true)
    assert.deepEqual(done.files, ["a.txt"])
    assert.deepEqual(done.scope, { files: 1, lines: 2, ok: true })
    assert.match(lines.join("\n"), /restart: light/u)
    assert.equal(existsSync(landPaths(world.dir).devLock), false)
})

void test("status reads the edit against the limits; abort restores tracked files from HEAD and deletes new ones, dry until --execute", async (t) => {
    const world = scratch(t)
    writeFileSync(join(world.checkout, "a.txt"), "two\n")
    writeFileSync(join(world.checkout, "new.txt"), "new\n")
    const status = await hotfixStatus({ root: world.checkout, dir: world.dir, profile: "app", rules: RULES, only: ["a.txt", "new.txt"] }, { busy: () => Promise.resolve(undefined) })
    assert.deepEqual(status.files, ["a.txt", "new.txt"])
    assert.equal(status.scope.ok, true)
    assert.equal(status.branch, "dev")
    assert.equal(status.devLock, null)
    const dry = await hotfixAbort({ root: world.checkout, execute: false, only: ["a.txt", "new.txt"] })
    assert.deepEqual(dry, { restore: ["a.txt"], remove: ["new.txt"] })
    assert.equal(existsSync(join(world.checkout, "new.txt")), true, "a dry run changes nothing")
    await hotfixAbort({ root: world.checkout, execute: true, only: ["a.txt", "new.txt"] })
    assert.equal(existsSync(join(world.checkout, "new.txt")), false)
    assert.equal(readFileSync(join(world.checkout, "a.txt"), "utf8").replace(/\r/g, ""), "one\n")
    assert.deepEqual((await readChanges(world.checkout)).changes, [])
})

void test("the pass covers one push of one commit to dev while its process lives, and nothing else", async (t) => {
    const world = scratch(t)
    writeFileSync(join(world.checkout, "a.txt"), "two\n")
    const seen = seenOf()
    let sha = ""
    await land(world, fakeDeps(seen, { push: (root, _profile, commit) => {
        sha = commit
        const line = (ref: string, local = commit): string => `refs/heads/dev ${local} ${ref} ${"0".repeat(40)}`
        seen.log.push([passFor(root, line("refs/heads/dev")), passFor(root, line("refs/heads/main")), passFor(root, `${line("refs/heads/dev")}\n${line("refs/heads/lane/x")}`), passFor(root, line("refs/heads/dev", "b".repeat(40)))].map((one) => (one === undefined ? "closed" : "open")).join(","))
        return Promise.resolve({ exitCode: 0, stdout: "", stderr: "", timedOut: false })
    } }))
    assert.equal(seen.log[0], "open,closed,closed,closed", "dev alone at that commit: open; main, a second ref or another commit: closed")
    assert.equal(sha.length, 40)
})

void test("the commit message carries the subject and the Hotfix: trailer", () => {
    assert.equal(hotfixMessage("  fix x ", { files: 2, lines: 7, ok: true }), "hotfix: fix x\n\nHotfix: 2 file(s) / 7 line(s)\n")
})
