// The governed command runner @starci/hfs gets (`stackIo.heavy`): a release gate row of the `test` kind is sized with the workers its slot was admitted with,
// whether it names jest or is an npm script (also behind cmd.exe on Windows); any other kind runs its argv as it was asked.
import assert from "node:assert/strict"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { HEAVY_PARENTS_ENV, governed, loadHeavyRules, testRunSizing, testWorkerCap, type Held, type HeavyKind, type withHeavySlot } from "../../harness/heavy.js"
import type { captureCommand, RunOptions } from "../../shared/exec.js"
import { hfsCommandRunner, sizedTestArgv } from "./hfs.js"

const state = mkdtempSync(join(tmpdir(), "starci-runner-"))
process.env.STARCI_LOCAL_ROOT = state
Reflect.deleteProperty(process.env, HEAVY_PARENTS_ENV)
delete process.env.CI
test.after(() => {
    rmSync(state, { recursive: true, force: true })
})

const GB = 1024
const rules = loadHeavyRules(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "ops"))
const pace = { ...rules, pollSeconds: 0.05, maxCpuPercent: 100, cpuStarveMinutes: 100_000, testWorkers: "50%" }
const sizing = testRunSizing(rules, 22 * 1024, 12)
const held: Held = { options: { env: { NODE_OPTIONS: "--max-old-space-size=1234" } }, roomMb: 22 * 1024, rules, test: sizing, heapMb: sizing.parentMb }
const flags = [`--maxWorkers=${String(sizing.workers)}`, `--workerIdleMemoryLimit=${String(sizing.workerMb)}MB`]

void test("a test row that is an npm script gets the workers and the worker heap after --", () => {
    assert.deepEqual(sizedTestArgv(["npm", "run", "test:integration"], held), ["npm", "run", "test:integration", "--", ...flags])
    assert.deepEqual(sizedTestArgv(["cmd.exe", "/d", "/s", "/c", "npm", "run", "test:e2e"], held), ["cmd.exe", "/d", "/s", "/c", "npm", "run", "test:e2e", "--", ...flags])
})

void test("a script that already passes -- or the flags keeps what it set", () => {
    assert.deepEqual(sizedTestArgv(["npm", "run", "test", "--", "--ci"], held), ["npm", "run", "test", "--", "--ci", ...flags])
    assert.deepEqual(sizedTestArgv(["npm", "run", "test", "--", "--maxWorkers=2"], held), ["npm", "run", "test", "--", "--maxWorkers=2", flags[1]])
})

void test("a jest argv gets the same flags without --, and an unrelated argv is returned as it is", () => {
    assert.deepEqual(sizedTestArgv(["node", "jest", "--coverage"], held), ["node", "jest", "--coverage", ...flags])
    assert.deepEqual(sizedTestArgv(["docker", "compose", "up"], held), ["docker", "compose", "up"])
})

void test("through the real governor, a test request runs under the parent's heap, the worker heap and the workers its room holds, and a build under its heap cap", async () => {
    const calls: { readonly argv: readonly string[]; readonly env: Readonly<Record<string, string>> | undefined }[] = []
    const admit = (async <T,>(kind: HeavyKind, label: string, cwd: string, options: RunOptions, work: (held: Held) => Promise<T>): Promise<T> =>
        governed({ rules: pace, freeMb: () => 22 * GB }, kind, label, cwd, options, work)) as typeof withHeavySlot
    const capture = (async (argv: readonly string[], _cwd: string, options: RunOptions = {}) => {
        calls.push({ argv, env: options.env })
        return { exitCode: 0, stdout: "", stderr: "", timedOut: false }
    }) as unknown as typeof captureCommand
    const run = hfsCommandRunner(admit, capture)
    await run({ kind: "test", label: "release gate test:e2e", cwd: state, argv: ["npm", "run", "test:e2e"], env: {} })
    await run({ kind: "build", label: "release gate build-be", cwd: state, argv: ["npm", "run", "build:be"], env: {} })
    const [tested, built] = [calls[0], calls[1]]
    assert.ok(tested && built)
    const workers = Math.max(1, Math.min(testWorkerCap(pace), Math.floor((22 * GB - pace.reserveMb - pace.testRun.parentMb) / pace.testRun.workerMb)))
    assert.deepEqual(tested.argv, ["npm", "run", "test:e2e", "--", `--maxWorkers=${String(workers)}`, `--workerIdleMemoryLimit=${String(pace.testRun.workerMb)}MB`])
    assert.match(tested.env?.NODE_OPTIONS ?? "", new RegExp(`--max-old-space-size=${String(pace.testRun.parentMb)} --require=.*starci-jest-worker-heap`, "u"))
    assert.equal(tested.env?.STARCI_WORKER_HEAP_MB, String(pace.testRun.workerMb))
    assert.deepEqual(built.argv, ["npm", "run", "build:be"])
    assert.match(built.env?.NODE_OPTIONS ?? "", /--max-old-space-size=\d+/u, "a build runs under a heap cap")
})
