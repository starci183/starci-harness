// The harness check cache (contexts/harness/check-cache.md, core/release/check-cache.ts): its keying, its reuse by the harness gate, its invalidation
// when a workspace dependency changes, its reuse by CI's plan from the trusted base only, and forged-record detection. Over a throwaway repository with
// real commits shaped like the harness, through the real plan (`release affected`), keys, record writer and gate loop; only the steps' commands are
// replaced by a runner that records what ran. Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { captureGitSync } from "../../shared/git.js"
import { listPackages } from "../../shared/workspace.js"
import { affectedBy, outsideReads } from "./affected.js"
import type { Affected } from "./affected.js"
import { bookOf, ciReuse, closureOf, FORGED, loadPrimitives, readTreeFiles, recordFile, treeKeys, verifyTrust } from "./check-cache.js"
import type { VerifyRun } from "./check-cache.js"
import { openGateCache, runHarnessGate } from "./gate.js"
import type { GateStep, StepRunner } from "./gate.js"

interface Repo {
    readonly root: string
    readonly write: (files: Readonly<Record<string, string>>) => void
    readonly commit: (files?: Readonly<Record<string, string>>) => string
    readonly done: () => void
}

const manifest = (name: string, scripts: Readonly<Record<string, string>>, extra: object = {}): string => JSON.stringify({ name, version: "1.0.0", scripts, ...extra })

/** grammar; gallery, which installs grammar as a `file:` copy; heroicons, which reads neither; hfs, whose spec reads ops/ from the root; the CLI. */
const harnessLike = (): Repo => {
    const root = mkdtempSync(join(tmpdir(), "starci-check-cache-"))
    const git = (...args: string[]): string => {
        const result = captureGitSync(["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], root)
        assert.equal(result.exitCode, 0, result.stderr)
        return result.stdout.trim()
    }
    const write = (files: Readonly<Record<string, string>>): void => {
        for (const [path, text] of Object.entries(files)) {
            mkdirSync(dirname(join(root, path)), { recursive: true })
            writeFileSync(join(root, path), text)
        }
    }
    write({
        "contexts/README.md": "# contexts\n",
        "ops/vps/recipients.yaml": "recipients: []\n",
        "packages/grammar/package.json": manifest("@starci/grammar", { build: "tsc", typecheck: "tsc --noEmit" }),
        "packages/grammar/src/tabs.ts": "export const tabs = 1\n",
        "packages/gallery/package.json": manifest("@starci/gallery", { build: "tsc", typecheck: "tsc --noEmit", test: "node --test" }, { devDependencies: { "@starci/grammar": "file:../grammar" } }),
        "packages/gallery/src/board.ts": "export const board = 1\n",
        "packages/heroicons/package.json": manifest("@starci/heroicons", { build: "tsc", test: "node --test" }),
        "packages/heroicons/src/index.ts": "export const icon = 1\n",
        "packages/hfs/package.json": manifest("@starci/hfs", { test: "node --test" }),
        "packages/hfs/src/recipients.spec.mts": "const owner = new URL('../../../ops/vps/recipients.yaml', import.meta.url)\n",
        "cli/package.json": manifest("starci-harness", { build: "tsc", typecheck: "tsc --noEmit", test: "node --test" }),
        "cli/src/main.ts": "export {}\n",
    })
    git("init", "-q")
    git("add", ".")
    git("commit", "-q", "-m", "base")
    return {
        root,
        write,
        commit: (files = {}) => {
            write(files)
            git("add", "--all", ".")
            git("commit", "-q", "--allow-empty", "-m", "change")
            return git("rev-parse", "HEAD")
        },
        done: () => {
            rmSync(root, { recursive: true, force: true })
        },
    }
}

/** The full plan of the repository (every node), as the full gate and the keys see it. */
const fullPlan = (repo: Repo): Promise<Affected> => affectedBy(repo.root, undefined, undefined)

const scriptsIn = (repo: Repo) => {
    const all = listPackages(repo.root)
    return (dir: string): Readonly<Record<string, string>> => all.find((pkg) => pkg.relativeDir === dir)?.scripts ?? {}
}

/** A runner that runs nothing and answers green, except the steps `red` names (`<kind> <dir>`); it keeps what it was asked to run. */
const fakeRunner = (red: readonly string[] = []): { readonly run: StepRunner; readonly ran: string[] } => {
    const ran: string[] = []
    return {
        ran,
        run: (_root: string, step: GateStep) => {
            ran.push(`${step.kind} ${step.dir}`)
            return Promise.resolve({ ok: !red.includes(`${step.kind} ${step.dir}`), output: "" })
        },
    }
}

/** One FAST-level gate over the full plan with the cache, the way `release gate` runs it: open, run, record. */
const gateOnce = async (repo: Repo, options: { readonly fresh?: boolean; readonly red?: readonly string[] } = {}) => {
    const plan = await fullPlan(repo)
    const cache = await openGateCache(repo.root, plan, "dev", options.fresh === true, plan.head)
    const runner = fakeRunner(options.red)
    const gate = await runHarnessGate(repo.root, plan, "dev", scriptsIn(repo), runner.run, () => undefined, cache.reusable)
    const written = await cache.record(gate)
    return { gate, ran: runner.ran, written, forged: cache.forged }
}

void test("outside reads: a package's spec that climbs to the root names that top-level tree, and nothing it does not climb to", () => {
    const tops = ["contexts", "ops", "packages", "cli", "README.md"]
    assert.deepEqual(outsideReads("packages/hfs", ["const owner = new URL('../../../ops/vps/recipients.yaml', import.meta.url)"], tops), ["ops"])
    assert.deepEqual(outsideReads("packages/grammar", ['readFileSync(join(here, "..", "..", "..", "contexts", "ui"))'], tops), ["contexts"])
    assert.deepEqual(outsideReads("packages/gallery", ['import "../grammar/dist/index.js"', "const ops = 1"], tops), [])
    assert.deepEqual(outsideReads("app", ['import type { Contract } from "../cli/src/core/ui/contract.js"'], tops), ["cli"])
})

void test("keying: a key is stable, portable between an uncommitted edit and its commit, and moves only for the node whose tree changed", async () => {
    const repo = harnessLike()
    try {
        const plan = await fullPlan(repo)
        const before = await treeKeys(repo.root, plan.graph)
        const again = await treeKeys(repo.root, plan.graph)
        for (const node of plan.graph) assert.equal(again.key(node.dir, "test"), before.key(node.dir, "test"), `${node.dir} keys alike twice`)
        assert.notEqual(before.key("packages/heroicons", "test"), before.key("packages/heroicons", "build"), "each step has its own key")
        repo.write({ "packages/heroicons/src/index.ts": "export const icon = 2\n" })
        const dirty = await treeKeys(repo.root, plan.graph)
        assert.notEqual(dirty.key("packages/heroicons", "test"), before.key("packages/heroicons", "test"), "an uncommitted edit moves its node's key")
        assert.equal(dirty.key("packages/grammar", "test"), before.key("packages/grammar", "test"), "a node that does not read heroicons keeps its key")
        repo.commit()
        const committed = await treeKeys(repo.root, plan.graph)
        assert.equal(committed.key("packages/heroicons", "test"), dirty.key("packages/heroicons", "test"), "the commit of the edit keys as the edit did")
        repo.write({ "packages/heroicons/node_modules/x/index.js": "x\n", "packages/heroicons/dist/index.js": "built\n", ".cache/check/test/packages-heroicons.jsonl": "" })
        const noise = await treeKeys(repo.root, plan.graph)
        assert.equal(noise.key("packages/heroicons", "test"), committed.key("packages/heroicons", "test"), "node_modules, dist and .cache never join a key")
    } finally {
        repo.done()
    }
})

void test("keying: a root tree a package's spec reads joins its key, so an edit there reruns it", async () => {
    const repo = harnessLike()
    try {
        const plan = await fullPlan(repo)
        assert.deepEqual(plan.graph.find((node) => node.dir === "packages/hfs")?.reads, ["ops"])
        const before = await treeKeys(repo.root, plan.graph)
        repo.commit({ "ops/vps/recipients.yaml": "recipients: [age1]\n" })
        const after = await treeKeys(repo.root, plan.graph)
        assert.notEqual(after.key("packages/hfs", "test"), before.key("packages/hfs", "test"))
        assert.equal(after.key("packages/heroicons", "test"), before.key("packages/heroicons", "test"))
    } finally {
        repo.done()
    }
})

void test("reuse: the second gate over an unchanged tree reuses every cached step and installs and builds nothing", async () => {
    const repo = harnessLike()
    try {
        const first = await gateOnce(repo)
        assert.ok(first.ran.includes("test packages/gallery") && first.ran.includes("build packages/grammar"), "a cold cache runs every step")
        assert.ok(first.written.files.includes(recordFile("test", "packages/gallery")), "a green step writes its record")
        const line = readFileSync(join(repo.root, recordFile("test", "packages/gallery")), "utf8")
        assert.match(line, /^\{"data":\{"parts":\{.*\},"verdict":"green"\},"findings":\[\],"hash":"[0-9a-f]{64}","path":"packages\/gallery","step":"test"\}\n$/u, "the record is hfs's canonical line, one per file")
        repo.commit()
        const second = await gateOnce(repo)
        assert.deepEqual(second.ran, [], "nothing runs: every cached step has a green record under its key")
        assert.ok(second.gate.steps.every((step) => step.ok === "reused"))
        assert.deepEqual(second.written.files, [], "a reused step rewrites nothing")
    } finally {
        repo.done()
    }
})

void test("invalidation: a change in a workspace dependency reruns its dependents, which rebuild it first; an unrelated package stays reused", async () => {
    const repo = harnessLike()
    try {
        await gateOnce(repo)
        repo.commit({ "packages/grammar/src/tabs.ts": "export const tabs = 2\n" })
        const plan = await fullPlan(repo)
        assert.deepEqual(closureOf("packages/gallery", plan.graph), ["packages/gallery", "packages/grammar"])
        const next = await gateOnce(repo)
        assert.ok(next.ran.includes("typecheck packages/grammar"), "the changed package reruns")
        assert.ok(next.ran.includes("test packages/gallery") && next.ran.includes("typecheck packages/gallery"), "its dependent's key moved with it, so it reruns")
        assert.ok(next.ran.indexOf("build packages/grammar") < next.ran.indexOf("test packages/gallery"), "the dependency is built before the dependent runs")
        assert.ok(!next.ran.some((step) => step.endsWith("packages/heroicons")), "heroicons reads neither: reused, not even installed")
    } finally {
        repo.done()
    }
})

void test("a red step writes no record and reruns next time; the green steps beside it keep theirs", async () => {
    const repo = harnessLike()
    try {
        const first = await gateOnce(repo, { red: ["test packages/heroicons"] })
        assert.ok(!first.written.files.includes(recordFile("test", "packages/heroicons")))
        assert.ok(first.written.files.includes(recordFile("build", "packages/heroicons")))
        const second = await gateOnce(repo)
        assert.deepEqual(second.ran, ["install packages/heroicons", "build packages/heroicons", "test packages/heroicons"], "only the red step reruns, after the preparation it needs")
    } finally {
        repo.done()
    }
})

void test("forged: an edited record is HARNESS_CHECK_CACHE_FORGED and never reused; a green record a fresh run contradicts is FORGED and removed", async () => {
    const repo = harnessLike()
    try {
        await gateOnce(repo)
        const file = join(repo.root, recordFile("test", "packages/heroicons"))
        const p = await loadPrimitives()
        const green = readFileSync(file, "utf8")
        writeFileSync(file, green.replace('"verdict":"green"', '"verdict":"red"'))
        assert.equal(bookOf(readTreeFiles(repo.root), p).forged[0]?.code, FORGED, "a verdict edited by hand")
        writeFileSync(file, green.replace(/"source":"[0-9a-f]{8}/u, '"source":"00000000'))
        const edited = await gateOnce(repo)
        assert.ok(edited.forged.some((finding) => finding.code === FORGED && finding.message.includes("hash its own parts do not make")), "parts that no longer make the hash")
        assert.ok(edited.ran.includes("test packages/heroicons"), "a forged record is never reused")
        writeFileSync(join(repo.root, recordFile("test", "packages/grammar")), "not a record\n")
        assert.ok(bookOf(readTreeFiles(repo.root), p).forged.some((finding) => finding.message.includes("are not records")), "a line that is no record")
        rmSync(join(repo.root, recordFile("test", "packages/grammar")))
        const lied = await gateOnce(repo, { fresh: true, red: ["test packages/gallery"] })
        assert.ok(lied.written.contradicted.some((finding) => finding.code === FORGED && finding.path === "packages/gallery"), "a committed green record whose step now runs red")
        assert.ok(!existsSync(join(repo.root, recordFile("test", "packages/gallery"))), "the contradicted record is removed")
    } finally {
        repo.done()
    }
})

void test("CI reuses only the records of the trusted base, never the commit's own, and fails the plan on a forged one", async () => {
    const repo = harnessLike()
    try {
        await gateOnce(repo)
        const base = repo.commit()
        repo.commit({ "packages/heroicons/src/index.ts": "export const icon = 3\n" })
        await gateOnce(repo)
        repo.commit()
        const plan = await fullPlan(repo)
        const reuse = await ciReuse(repo.root, base, plan.graph, ["packages/gallery", "packages/heroicons"], scriptsIn(repo))
        assert.deepEqual(reuse.reused, ["packages/gallery"], "heroicons' new record is the commit's own claim: CI runs it")
        assert.deepEqual(reuse.forged, [])
        const file = join(repo.root, recordFile("test", "packages/heroicons"))
        writeFileSync(file, readFileSync(file, "utf8").replace('"findings":[]', '"findings":[1]'))
        const forged = await ciReuse(repo.root, base, plan.graph, ["packages/heroicons"], scriptsIn(repo))
        assert.equal(forged.forged[0]?.code, FORGED)
    } finally {
        repo.done()
    }
})

void test("the full gate trusts the records while the newest finished verify run of main or of the sha is green, or none ran", () => {
    const run = (over: Partial<VerifyRun>): VerifyRun => ({ status: "completed", conclusion: "success", headSha: "a", headBranch: "main", url: "u", createdAt: "2026-11-26T00:00:00Z", ...over })
    assert.equal(verifyTrust([], "h").trusted, true)
    assert.equal(verifyTrust(undefined, "h").trusted, false, "an unreadable list proves nothing")
    assert.equal(verifyTrust([run({ conclusion: "failure" })], "h").trusted, false)
    assert.equal(verifyTrust([run({ conclusion: "failure" }), run({ createdAt: "2026-11-27T00:00:00Z", headBranch: "dev", headSha: "h" })], "h").trusted, true, "a newer green run for the gated sha clears a red main")
    assert.equal(verifyTrust([run({ conclusion: "cancelled", createdAt: "2026-11-27T00:00:00Z" }), run({ conclusion: "failure" })], "h").trusted, false, "a cancelled run is no verdict")
    assert.equal(verifyTrust([run({ headBranch: "lane/x", headSha: "z", conclusion: "failure" })], "h").trusted, true, "a run of another branch and sha does not speak for the release")
})
