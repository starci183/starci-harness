import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"
import { exportOnce, memorySpool } from "../copies.ts"
import type { CopyRef, DriverAdapter, ExportSource, OpenContext, WriteContext } from "../driver.ts"
import { DataRefusal } from "../driver.ts"
import type { ManifestHeader } from "../manifest.ts"
import type { MemorySets } from "../testing/memory.ts"
import { memoryStore } from "../testing/memory.ts"
import { driverContract } from "../testing/contract.ts"
import { GIT_SHARD_BYTES } from "../words.ts"
import type { Runner, RunResult } from "./driver.ts"
import { createGitDriver } from "./driver.ts"

/* ---------------------------------------------------------------------------------------------------------------
 * The real tools (git always; sops + age when installed: the specs that need them say so when they are skipped, so a
 * CI image without them reports it instead of failing; CI must install sops and age for those specs to run) and a
 * fake sops (a deterministic envelope) for the branches that need a sealed copy without the tool.
 * ------------------------------------------------------------------------------------------------------------- */

const root = mkdtempSync(join(tmpdir(), "git-driver-spec-"))
after(() => {
    rmSync(root, { recursive: true, force: true })
})

const gitEnv: Record<string, string> = {
    GIT_AUTHOR_NAME: "spec",
    GIT_AUTHOR_EMAIL: "spec@example.test",
    GIT_COMMITTER_NAME: "spec",
    GIT_COMMITTER_EMAIL: "spec@example.test",
}

let counter = 0
const fresh = (name: string): string => join(root, `${name}-${String((counter += 1))}`)

const toolsMissing = ((): string | false => {
    const sops = spawnSync("sops", ["--version"]).status === 0
    const age = spawnSync("age-keygen", ["--version"]).status === 0
    return sops && age ? false : "sops and age-keygen are not both on PATH"
})()

interface ThrowawayKey {
    readonly recipient: string
    readonly open: OpenContext
}

/** A throwaway age key generated inside the temp dir; the secret never leaves its file and is never printed. */
function throwawayKey(name: string): ThrowawayKey | null {
    if (toolsMissing !== false) return null
    const file = join(root, `${name}.txt`)
    const made = spawnSync("age-keygen", ["-o", file])
    assert.equal(made.status, 0)
    const recipient = /# public key: (age1\S+)/u.exec(readFileSync(file, "utf8"))?.[1]
    assert.ok(recipient !== undefined)
    return { recipient, open: { identity: { kind: "age-identity", env: { SOPS_AGE_KEY_FILE: file } } } }
}
const key = throwawayKey("key")
const otherKey = throwawayKey("other")

const realRun: Runner = (program, args, options) => {
    const result = spawnSync(program, [...args], { cwd: options.cwd, input: options.input, env: { ...process.env, ...options.env } })
    return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

const ok = (stdout = ""): RunResult => ({ status: 0, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0) })
const failed: RunResult = { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
const fakeIdentity: OpenContext = { identity: { kind: "age-identity", env: { FAKE_AGE_KEY: "ok" } } }
const fakeWrong: OpenContext = { identity: { kind: "age-identity", env: { FAKE_AGE_KEY: "no" } } }

/** A stand-in for sops: a random-nonce envelope holding the plaintext, opened only with the right identity. */
function fakeSops(args: readonly string[], options: { readonly input?: Buffer; readonly env?: Readonly<Record<string, string>> }): RunResult {
    if (args[0] === "encrypt")
        return ok(JSON.stringify({ data: `ENC[AES256_GCM,data:${(options.input ?? Buffer.alloc(0)).toString("base64")},iv:${randomBytes(8).toString("hex")}]`, sops: { age: [] } }))
    if (options.env?.FAKE_AGE_KEY !== "ok") return failed
    try {
        const data = (JSON.parse((options.input ?? Buffer.alloc(0)).toString("utf8")) as { data: string }).data
        const body = /data:([^,]+),/u.exec(data)?.[1]
        return body === undefined ? failed : { status: 0, stdout: Buffer.from(body, "base64"), stderr: Buffer.alloc(0) }
    } catch {
        return failed
    }
}

type Override = (program: string, args: readonly string[]) => RunResult | undefined

/** Real git, a fake sops, and an override that may answer any call first; every call is logged. */
function traced(override?: Override): { readonly run: Runner; readonly calls: string[] } {
    const calls: string[] = []
    const run: Runner = (program, args, options) => {
        calls.push(`${program} ${args.join(" ")}`)
        return override?.(program, args) ?? (program === "sops" ? fakeSops(args, options) : realRun(program, args, options))
    }
    return { run, calls }
}

function git(cwd: string, ...args: string[]): string {
    const result = spawnSync("git", args, { cwd, env: { ...process.env, ...gitEnv }, encoding: "utf8" })
    assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`)
    return result.stdout
}

const commitCount = (dir: string): number => Number(git(dir, "rev-list", "--count", "HEAD").trim())

function listFiles(dir: string, sub: string): string[] {
    const base = join(dir, sub)
    return existsSync(base) ? readdirSync(base, { recursive: true, encoding: "utf8" }).filter((name) => statSync(join(base, name)).isFile()).map((name) => `${sub}/${name.split("\\").join("/")}`).sort() : []
}

function commitEdit(dir: string, edit: () => void): string {
    edit()
    git(dir, "add", "-A")
    git(dir, "commit", "-q", "-m", "edit")
    return git(dir, "rev-parse", "HEAD").trim()
}

function editManifest(dir: string, change: (manifest: Record<string, unknown>) => void): string {
    return commitEdit(dir, () => {
        const file = join(dir, "manifest.json")
        const manifest = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
        change(manifest)
        writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`)
    })
}

async function refusal(run: () => Promise<unknown>): Promise<DataRefusal> {
    try {
        await run()
    } catch (error) {
        assert.ok(error instanceof DataRefusal)
        return error
    }
    return assert.fail("expected a DataRefusal")
}

const standardHeader = (takenAt = "2026-01-01T00:00:00.000Z"): ManifestHeader => ({ format: "shop-seed-standard@1", purpose: "seed-standard", takenAt, source: { project: "shop", environment: "dev" } })
const backupHeader = (takenAt = "2026-01-01T00:00:00.000Z"): ManifestHeader => ({ format: "shop-seed-backup@1", purpose: "seed-backup", takenAt, source: { project: "shop", environment: "dev" } })
const sourceOf = (sets: MemorySets, header: ManifestHeader): Promise<ExportSource> => exportOnce([memoryStore({ id: "db", sets })], {}, memorySpool(), header)

const smallSets: MemorySets = { files: { "a.bin": new Uint8Array([1, 2, 3]) }, orders: { "o-1": { total: 1 }, "o-2": { total: 2 } } }
const plainWrite: WriteContext = { recipients: [], dryRun: false }
const fakeWrite: WriteContext = { recipients: ["age1fake"], dryRun: false }

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
    const out: T[] = []
    for await (const item of items) out.push(item)
    return out
}

const standardDriver = (checkout: string, extra: Partial<Parameters<typeof createGitDriver>[0]> = {}): DriverAdapter => createGitDriver({ id: "std", checkout, env: gitEnv, ...extra })
const fakeDriver = (checkout: string, override?: Override, extra: Partial<Parameters<typeof createGitDriver>[0]> = {}): DriverAdapter => createGitDriver({ id: "fake", checkout, env: gitEnv, run: traced(override).run, ...extra })

function check(verdict: { readonly checks: readonly { readonly name: string; readonly ok: boolean; readonly detail: string }[] }, name: string): { readonly name: string; readonly ok: boolean; readonly detail: string } {
    const found = verdict.checks.find((item) => item.name === name)
    assert.ok(found !== undefined, `no check named ${name}`)
    return found
}

const contractStore = (): Promise<ReturnType<typeof memoryStore>> => Promise.resolve(memoryStore({ id: "db", sets: smallSets }))

/* --------------------------------------------------------------------------------------------------------------
 * The contract every driver keeps: the fake-sealed driver always, the real sops one when the tools are installed.
 * ------------------------------------------------------------------------------------------------------------ */

for (const item of driverContract(() => Promise.resolve(fakeDriver(fresh("contract-fake"))), contractStore, fakeWrite, fakeIdentity)) {
    test(`contract (fake sops): ${item.name}`, item.run)
}

for (const item of driverContract(() => Promise.resolve(createGitDriver({ id: "real", checkout: fresh("contract-real"), env: gitEnv })), contractStore, { recipients: [key?.recipient ?? ""], dryRun: false }, key?.open)) {
    test(`contract (real sops, throwaway age key): ${item.name}`, { skip: toolsMissing }, item.run)
}

/* --------------------------------------------------------------------------------------------------------------
 * seed-standard: plaintext, real git.
 * ------------------------------------------------------------------------------------------------------------ */

test("a seed-standard writes plaintext files, lists, reads back and verifies healthy; .gitattributes pins bytes", async () => {
    const checkout = fresh("std")
    const driver = standardDriver(checkout)
    assert.deepEqual(driver.limits().forms, ["record", "blob"])
    assert.equal(driver.limits().maxFileBytes, GIT_SHARD_BYTES)
    assert.equal(driver.kind, "git")
    assert.deepEqual(await driver.list(), [])
    const source = await sourceOf(smallSets, standardHeader())
    const receipt = await driver.write(source, plainWrite)
    assert.equal(receipt.changed, 3)
    assert.equal(readFileSync(join(checkout, ".gitattributes"), "utf8"), "* -text\n")
    const files = [...listFiles(checkout, "data"), ...listFiles(checkout, "index"), ...listFiles(checkout, "blobs")]
    assert.deepEqual(files.filter((name) => !name.startsWith("blobs")), ["data/db/orders/all.json", "index/db/files.json"])
    assert.ok(files.some((name) => /^blobs\/db\/files\/[0-9a-f]{2}\/[0-9a-f]{64}\.bin$/u.test(name)))
    assert.ok(!files.some((name) => name.endsWith(".sops.json")))
    assert.ok(!readFileSync(join(checkout, "manifest.json"), "utf8").includes('"total"'))
    const [ref] = await driver.list()
    assert.ok(ref !== undefined)
    assert.equal(ref.locator, receipt.ref.locator)
    const back = await collect((await driver.read(ref, { identity: { kind: "age-identity", env: {} } })).entries())
    assert.deepEqual(back.map((item) => `${item.store}/${item.entry.set}/${item.entry.key}`), ["db/files/a.bin", "db/orders/o-1", "db/orders/o-2"])
    const verdict = await driver.verify(ref, null)
    assert.equal(verdict.healthy, true)
    assert.deepEqual(verdict.checks.map((item) => item.name), ["manifest", "sealing", "files", "cap", "digests"])
    assert.equal(verdict.manifest?.exportDigest, source.manifest.exportDigest)
})

test("an unchanged second write changes nothing and adds no commit, even when only takenAt differs", async () => {
    const checkout = fresh("std-same")
    const driver = standardDriver(checkout)
    await driver.write(await sourceOf(smallSets, standardHeader()), plainWrite)
    assert.equal(commitCount(checkout), 1)
    const same = await driver.write(await sourceOf(smallSets, standardHeader()), plainWrite)
    assert.equal(same.changed, 0)
    assert.equal(commitCount(checkout), 1)
    const later = await driver.write(await sourceOf(smallSets, standardHeader("2026-02-02T00:00:00.000Z")), plainWrite)
    assert.equal(later.changed, 0)
    assert.equal(commitCount(checkout), 1)
    assert.ok(readFileSync(join(checkout, "manifest.json"), "utf8").includes("2026-01-01"), "the working tree was reset to the held copy")
})

test("a receipt falls back to the manifest in hand when the working tree lost manifest.json after the reset", async () => {
    const checkout = fresh("std-lost-manifest")
    await standardDriver(checkout).write(await sourceOf(smallSets, standardHeader()), plainWrite)
    const losing = fakeDriver(checkout, (program, args) => {
        if (program !== "git" || args[0] !== "reset") return undefined
        rmSync(join(checkout, "manifest.json"))
        return ok()
    })
    const receipt = await losing.write(await sourceOf(smallSets, standardHeader("2026-02-02T00:00:00.000Z")), plainWrite)
    assert.equal(receipt.changed, 0)
    assert.equal(receipt.ref.takenAt, "2026-02-02T00:00:00.000Z")
})

test("a missing file is rewritten and a stray file removed, even when the export digest is unchanged", async () => {
    const checkout = fresh("std-repair")
    const driver = standardDriver(checkout)
    await driver.write(await sourceOf(smallSets, standardHeader()), plainWrite)
    rmSync(join(checkout, "data/db/orders/all.json"))
    const repaired = await driver.write(await sourceOf(smallSets, standardHeader("2026-02-02T00:00:00.000Z")), plainWrite)
    assert.equal(repaired.changed, 1)
    assert.equal(commitCount(checkout), 2)
    mkdirSync(join(checkout, "data/db"), { recursive: true })
    writeFileSync(join(checkout, "data/db/stray.json"), "{}")
    const cleaned = await driver.write(await sourceOf(smallSets, standardHeader("2026-03-03T00:00:00.000Z")), plainWrite)
    assert.equal(cleaned.changed, 1)
    assert.equal(commitCount(checkout), 3)
    assert.ok(!existsSync(join(checkout, "data/db/stray.json")))
})

test("a changed digest commits; a different .gitattributes is rewritten", async () => {
    const checkout = fresh("std-attrs")
    mkdirSync(checkout, { recursive: true })
    git(checkout, "init", "-q", "-b", "main")
    writeFileSync(join(checkout, ".gitattributes"), "* text=auto\n")
    const driver = standardDriver(checkout)
    await driver.write(await sourceOf(smallSets, standardHeader()), plainWrite)
    assert.equal(readFileSync(join(checkout, ".gitattributes"), "utf8"), "* -text\n")
    const next = await driver.write(await sourceOf({ ...smallSets, orders: { "o-1": { total: 9 } } }, standardHeader()), plainWrite)
    assert.equal(next.changed, 1)
    assert.equal(commitCount(checkout), 2)
    assert.equal((await driver.list()).length, 2)
})

test("a set the export names but holds no entries of is an empty set whose digest verify reports as differing", async () => {
    const checkout = fresh("std-empty-set")
    const driver = standardDriver(checkout)
    const real = await sourceOf(smallSets, standardHeader())
    const lying: ExportSource = { manifest: real.manifest, entries: (selection) => real.entries({ ...selection, sets: ["orders"] }) }
    const receipt = await driver.write(lying, plainWrite)
    const verdict = await driver.verify(receipt.ref, null)
    assert.equal(verdict.healthy, false)
    assert.match(check(verdict, "digests").detail, /differ: db\/files/u)
    const other = standardDriver(fresh("std-empty-records"))
    const noRecords: ExportSource = { manifest: real.manifest, entries: (selection) => real.entries({ ...selection, sets: ["files"] }) }
    const second = await other.write(noRecords, plainWrite)
    assert.match(check(await other.verify(second.ref, null), "digests").detail, /differ: db\/orders/u)
})

test("many records widen the shard prefix, a changed record touches one shard only, and the width never shrinks", async () => {
    const checkout = fresh("std-shards")
    const driver = standardDriver(checkout)
    const records = (changed: number): MemorySets => ({
        orders: Object.fromEntries(Array.from({ length: 40 }, (_, at) => [`order-${String(at).padStart(3, "0")}`, { n: at, pad: `${"x".repeat(100_000)}${at === changed ? "!" : ""}` }])),
    })
    await driver.write(await sourceOf(records(-1), standardHeader()), plainWrite)
    const manifestOf = (): { shards: Record<string, number> } => JSON.parse(readFileSync(join(checkout, "manifest.json"), "utf8")) as { shards: Record<string, number> }
    assert.equal(manifestOf().shards["db/orders"], 1)
    const before = new Map(listFiles(checkout, "data").map((name) => [name, readFileSync(join(checkout, name))]))
    assert.ok(before.size > 1)
    const touched = await driver.write(await sourceOf(records(7), standardHeader()), plainWrite)
    assert.equal(touched.changed, 1)
    const differing = [...before].filter(([name, bytes]) => !readFileSync(join(checkout, name)).equals(bytes))
    assert.equal(differing.length, 1)
    const small = await driver.write(await sourceOf({ orders: { "order-001": { n: 1 }, "order-002": { n: 2 }, "order-003": { n: 3 } } }, standardHeader()), plainWrite)
    assert.equal(manifestOf().shards["db/orders"], 1, "the width does not shrink")
    assert.ok(small.changed >= 1)
    assert.ok(listFiles(checkout, "data").length <= 3, "the emptied shards were removed")
    assert.equal((await driver.verify(small.ref, null)).healthy, true)
})

test("one record larger than a shard goes to the widest prefix and still round-trips", async () => {
    const checkout = fresh("std-wide")
    const driver = standardDriver(checkout)
    const receipt = await driver.write(await sourceOf({ orders: { huge: { pad: "y".repeat(3_000_000) } } }, standardHeader()), plainWrite)
    const manifest = JSON.parse(readFileSync(join(checkout, "manifest.json"), "utf8")) as { shards: Record<string, number> }
    assert.equal(manifest.shards["db/orders"], 8)
    assert.equal(listFiles(checkout, "data").length, 1)
    assert.equal((await driver.verify(receipt.ref, null)).healthy, true)
})

test("a blob over a shard's worth is chunked, an empty blob is one chunk, and both read back byte for byte", async () => {
    const checkout = fresh("std-blob")
    const driver = standardDriver(checkout)
    const big = Uint8Array.from({ length: 3_000_000 }, (_, at) => at % 251)
    const receipt = await driver.write(await sourceOf({ files: { big, empty: new Uint8Array(0) } }, standardHeader()), plainWrite)
    const blobs = listFiles(checkout, "blobs")
    assert.equal(blobs.filter((name) => name.endsWith(".0.bin")).length, 1)
    assert.equal(blobs.filter((name) => name.endsWith(".1.bin")).length, 1)
    assert.equal(blobs.length, 3)
    const back = await collect((await driver.read(receipt.ref, fakeIdentity)).entries())
    const bigBack = back.find((item) => item.entry.key === "big")
    assert.ok(bigBack !== undefined)
    assert.ok(Buffer.from(bigBack.entry.body).equals(Buffer.from(big)))
    assert.equal(back.find((item) => item.entry.key === "empty")?.entry.body.byteLength, 0)
    assert.equal((await driver.verify(receipt.ref, null)).healthy, true)
})

test("a file over the shard limit is refused with DATA_GIT_CAP_EXCEEDED, naming the file", async () => {
    const driver = standardDriver(fresh("std-big"))
    const error = await refusal(async () => driver.write(await sourceOf({ orders: { huge: { pad: "z".repeat(4_500_000) } } }, standardHeader()), plainWrite))
    assert.equal(error.code, "DATA_GIT_CAP_EXCEEDED")
    assert.equal(error.retry, "configuration")
    assert.equal(typeof error.params.file, "string")
})

test("a write past the cap is refused with next: s3 and nothing is written; a warning threshold warns", async () => {
    const checkout = fresh("std-cap")
    const driver = standardDriver(checkout, { capBytes: 10 })
    const error = await refusal(async () => driver.write(await sourceOf(smallSets, standardHeader()), plainWrite))
    assert.equal(error.code, "DATA_GIT_CAP_EXCEEDED")
    assert.equal(error.retry, "configuration")
    assert.equal(error.params.next, "s3")
    assert.ok(!existsSync(join(checkout, "manifest.json")))
    assert.equal(listFiles(checkout, "data").length, 0)
    assert.deepEqual(await driver.list(), [])
    const warned = await standardDriver(fresh("std-warn"), { warnBytes: 10 }).write(await sourceOf(smallSets, standardHeader()), plainWrite)
    assert.deepEqual(warned.warnings, ["DATA_GIT_CAP_NEAR"])
    const quiet = await standardDriver(fresh("std-quiet")).write(await sourceOf(smallSets, standardHeader()), plainWrite)
    assert.deepEqual(quiet.warnings, [])
})

test("a dry run commits nothing, writes no copy file and answers locator dry-run, counting what it would change", async () => {
    const checkout = fresh("std-dry")
    const driver = standardDriver(checkout)
    const dry = await driver.write(await sourceOf(smallSets, standardHeader()), { recipients: [], dryRun: true })
    assert.equal(dry.ref.locator, "dry-run")
    assert.equal(dry.changed, 3)
    assert.equal(listFiles(checkout, "data").length + listFiles(checkout, "index").length + listFiles(checkout, "blobs").length, 0)
    assert.ok(!existsSync(join(checkout, "manifest.json")))
    assert.deepEqual(await driver.list(), [])
    await driver.write(await sourceOf(smallSets, standardHeader()), plainWrite)
    const manifestBefore = readFileSync(join(checkout, "manifest.json"))
    const next = await driver.write(await sourceOf({ orders: { "o-9": { total: 9 } } }, standardHeader()), { recipients: [], dryRun: true })
    assert.equal(next.changed, 3, "one new file, two stale")
    assert.ok(readFileSync(join(checkout, "manifest.json")).equals(manifestBefore))
    assert.equal(commitCount(checkout), 1)
})

test("verify of a plaintext copy finds a corrupted, altered, stray or missing file and an unreadable or invalid manifest", async () => {
    const checkout = fresh("std-verify")
    const driver = standardDriver(checkout)
    const receipt = await driver.write(await sourceOf(smallSets, standardHeader()), plainWrite)
    const at = (locator: string): CopyRef => ({ ...receipt.ref, locator })
    const blob = listFiles(checkout, "blobs")[0]
    assert.ok(blob !== undefined)

    const corrupted = commitEdit(checkout, () => {
        writeFileSync(join(checkout, "data/db/orders/all.json"), "not json")
    })
    const corruptVerdict = await driver.verify(at(corrupted), null)
    assert.equal(corruptVerdict.healthy, false)
    assert.equal(check(corruptVerdict, "digests").detail, "a file cannot be read or parsed")

    const altered = commitEdit(checkout, () => {
        writeFileSync(join(checkout, "data/db/orders/all.json"), '{\n"o-1":{"total":99},\n"o-2":{"total":2}\n}\n')
    })
    const alteredVerdict = await driver.verify(at(altered), null)
    assert.equal(alteredVerdict.healthy, false)
    assert.equal(check(alteredVerdict, "digests").detail, "differ: db/orders")

    const stray = commitEdit(checkout, () => {
        writeFileSync(join(checkout, "data/db/orders/all.json"), '{\n"o-1":{"total":1},\n"o-2":{"total":2}\n}\n')
        writeFileSync(join(checkout, "data/stray.json"), "{}")
    })
    const strayVerdict = await driver.verify(at(stray), null)
    assert.equal(check(strayVerdict, "files").ok, false)
    assert.match(check(strayVerdict, "files").detail, /stray 1, missing 0/u)

    const missing = commitEdit(checkout, () => {
        rmSync(join(checkout, "data/stray.json"))
        rmSync(join(checkout, blob))
    })
    const missingVerdict = await driver.verify(at(missing), null)
    assert.equal(check(missingVerdict, "files").ok, false)
    assert.match(check(missingVerdict, "files").detail, /stray 0, missing 1/u)
    assert.equal(check(missingVerdict, "digests").detail, "DATA_DRIVER_UNAVAILABLE")

    commitEdit(checkout, () => {
        writeFileSync(join(checkout, "manifest.json"), "{")
    })
    const unreadableVerdict = await driver.verify(at(git(checkout, "rev-parse", "HEAD").trim()), null)
    assert.equal(unreadableVerdict.healthy, false)
    assert.equal(unreadableVerdict.manifest, null)
    assert.deepEqual(unreadableVerdict.checks.map((item) => [item.name, item.ok]), [["manifest", false]])
    const nowhere = await driver.verify(at("0".repeat(40)), null)
    assert.equal(nowhere.manifest, null)

    commitEdit(checkout, () => {
        writeFileSync(join(checkout, "manifest.json"), JSON.stringify({ ...(JSON.parse(git(checkout, "show", `${receipt.ref.locator}:manifest.json`)) as object), schema: "other" }))
    })
    const invalid = await driver.verify(at(git(checkout, "rev-parse", "HEAD").trim()), null)
    assert.equal(check(invalid, "manifest").ok, false)
    assert.match(check(invalid, "manifest").detail, /schema is not/u)

    const smaller = await standardDriver(checkout, { capBytes: 5 }).verify(receipt.ref, null)
    assert.equal(check(smaller, "cap").ok, false)
    assert.equal(smaller.healthy, false)
})

test("verify checks the sealing policy against the purpose", async () => {
    const checkout = fresh("std-policy")
    const driver = standardDriver(checkout)
    const receipt = await driver.write(await sourceOf(smallSets, standardHeader()), plainWrite)
    const sealedClaim = editManifest(checkout, (manifest) => {
        manifest.sealing = "sops-age"
        manifest.recipients = []
    })
    const verdict = await driver.verify({ ...receipt.ref, locator: sealedClaim }, null)
    assert.equal(check(verdict, "sealing").ok, false)
    assert.equal(check(verdict, "sealed").ok, true)
    assert.equal(check(verdict, "files").ok, false, "a copy claiming to be sealed holds plaintext files")
    assert.ok(!verdict.checks.some((item) => item.name === "digests"), "no identity, a sealed claim: no digests")
})

test("a list stops at what git log answers: no repository, a failing log, an empty repository", async () => {
    const checkout = fresh("std-list")
    assert.deepEqual(await standardDriver(checkout).list(), [])
    mkdirSync(checkout, { recursive: true })
    git(checkout, "init", "-q", "-b", "main")
    assert.deepEqual(await standardDriver(checkout).list(), [])
    assert.deepEqual(await fakeDriver(checkout, (_program, args) => (args[0] === "log" ? failed : undefined)).list(), [])
    assert.deepEqual(await createGitDriver({ id: "bare-options", checkout: fresh("std-list-missing") }).list(), [])
})

/* --------------------------------------------------------------------------------------------------------------
 * seed-backup: sealed, fake sops (always) and real sops (when installed).
 * ------------------------------------------------------------------------------------------------------------ */

test("a seed-backup without recipients is refused DATA_SEAL_FAILED before any repository exists", async () => {
    const checkout = fresh("backup-none")
    const error = await refusal(async () => fakeDriver(checkout).write(await sourceOf(smallSets, backupHeader()), plainWrite))
    assert.equal(error.code, "DATA_SEAL_FAILED")
    assert.equal(error.retry, "configuration")
    assert.ok(!existsSync(checkout))
})

test("sops failing while sealing or opening is DATA_SEAL_FAILED", async () => {
    const sealFails = await refusal(async () => fakeDriver(fresh("seal-fails"), (program) => (program === "sops" ? failed : undefined)).write(await sourceOf(smallSets, backupHeader()), fakeWrite))
    assert.equal(sealFails.code, "DATA_SEAL_FAILED")
    assert.equal(sealFails.params.step, "sops encrypt")
    const checkout = fresh("open-fails")
    const receipt = await fakeDriver(checkout).write(await sourceOf(smallSets, backupHeader()), fakeWrite)
    const opener = fakeDriver(checkout, (program, args) => (program === "sops" && args[0] === "decrypt" ? failed : undefined))
    const openFails = await refusal(() => opener.read(receipt.ref, fakeIdentity))
    assert.equal(openFails.code, "DATA_SEAL_FAILED")
    const wrong = await refusal(() => fakeDriver(checkout).read(receipt.ref, fakeWrong))
    assert.equal(wrong.code, "DATA_SEAL_FAILED")
})

test("a sealed copy cannot be read without an identity", async () => {
    const checkout = fresh("no-identity")
    const driver = fakeDriver(checkout)
    const receipt = await driver.write(await sourceOf(smallSets, backupHeader()), fakeWrite)
    const error = await refusal(() => driver.read(receipt.ref, null as unknown as OpenContext))
    assert.equal(error.code, "DATA_SEAL_FAILED")
})

test("a sealed copy: every file is named .sops.json; unchanged files are not re-sealed; a changed set re-seals only its files", async () => {
    const checkout = fresh("sealed")
    const driver = fakeDriver(checkout)
    const first = await driver.write(await sourceOf(smallSets, backupHeader()), fakeWrite)
    const names = [...listFiles(checkout, "data"), ...listFiles(checkout, "index"), ...listFiles(checkout, "blobs")]
    assert.equal(names.length, 3)
    assert.ok(names.every((name) => name.endsWith(".sops.json")))
    const bytes = new Map(names.map((name) => [name, readFileSync(join(checkout, name))]))
    const same = await driver.write(await sourceOf(smallSets, backupHeader()), fakeWrite)
    assert.equal(same.changed, 0)
    assert.equal(same.ref.locator, first.ref.locator)
    assert.ok(names.every((name) => readFileSync(join(checkout, name)).equals(bytes.get(name) ?? Buffer.alloc(0))))
    const changed = await driver.write(await sourceOf({ ...smallSets, orders: { "o-1": { total: 7 } } }, backupHeader()), fakeWrite)
    assert.equal(changed.changed, 1)
    assert.ok(readFileSync(join(checkout, "index/db/files.json.sops.json")).equals(bytes.get("index/db/files.json.sops.json") ?? Buffer.alloc(0)))
    assert.ok(!readFileSync(join(checkout, "data/db/orders/all.json.sops.json")).equals(bytes.get("data/db/orders/all.json.sops.json") ?? Buffer.alloc(0)))
    const manifest = JSON.parse(readFileSync(join(checkout, "manifest.json"), "utf8")) as { sealing: string; recipients: string[] }
    assert.equal(manifest.sealing, "sops-age")
    assert.deepEqual(manifest.recipients, ["age1fake"])
})

test("switching a checkout between plaintext and sealed re-writes every file and removes the other form", async () => {
    const checkout = fresh("switch")
    const driver = fakeDriver(checkout)
    await driver.write(await sourceOf(smallSets, standardHeader()), plainWrite)
    const sealed = await driver.write(await sourceOf(smallSets, backupHeader()), fakeWrite)
    assert.equal(sealed.changed, 6, "3 sealed written, 3 plaintext removed")
    assert.ok(listFiles(checkout, "data").every((name) => name.endsWith(".sops.json")))
    const plain = await driver.write(await sourceOf(smallSets, standardHeader()), plainWrite)
    assert.equal(plain.changed, 6)
    assert.ok(listFiles(checkout, "data").every((name) => !name.endsWith(".sops.json")))
})

test("verify of a sealed copy: no identity skips digests, an identity checks them, a wrong one fails, damage is named", async () => {
    const checkout = fresh("sealed-verify")
    const driver = fakeDriver(checkout)
    const receipt = await driver.write(await sourceOf(smallSets, backupHeader()), fakeWrite)
    const at = (locator: string): CopyRef => ({ ...receipt.ref, locator })
    const blind = await driver.verify(receipt.ref, null)
    assert.equal(blind.healthy, true)
    assert.deepEqual(blind.checks.map((item) => item.name), ["manifest", "sealing", "files", "sealed", "cap"])
    const sighted = await driver.verify(receipt.ref, fakeIdentity)
    assert.equal(sighted.healthy, true)
    assert.equal(check(sighted, "digests").ok, true)
    const wrong = await driver.verify(receipt.ref, fakeWrong)
    assert.equal(wrong.healthy, false)
    assert.equal(check(wrong, "digests").detail, "DATA_SEAL_FAILED")

    const bad = commitEdit(checkout, () => {
        writeFileSync(join(checkout, "data/db/orders/all.json.sops.json"), "{}")
        writeFileSync(join(checkout, "index/db/files.json.sops.json"), '{"sops":{}}')
    })
    const badVerdict = await driver.verify(at(bad), null)
    assert.equal(check(badVerdict, "sealed").ok, false)
    assert.equal(check(badVerdict, "sealed").detail, "2 files are not sops envelopes")

    const plainFile = commitEdit(checkout, () => {
        git(checkout, "checkout", "-q", receipt.ref.locator, "--", ".")
        writeFileSync(join(checkout, "data/db/orders/plain.json"), "{}")
    })
    const plainVerdict = await driver.verify(at(plainFile), null)
    assert.equal(check(plainVerdict, "files").ok, false)
    assert.match(check(plainVerdict, "files").detail, /stray 1, missing 0, unsealed 1/u)

    const noRecipients = editManifest(checkout, (manifest) => {
        manifest.recipients = []
    })
    const noRecipientsVerdict = await driver.verify(at(noRecipients), null)
    assert.equal(check(noRecipientsVerdict, "sealing").ok, false)
})

test("a checkout whose remote cannot be cloned starts a repository on the branch and pushes", async () => {
    const checkout = fresh("clone-fails")
    const { run, calls } = traced((program, args) => (program === "git" && args[0] === "clone" ? failed : program === "git" && args[0] === "push" ? ok() : undefined))
    await createGitDriver({ id: "remote", checkout, env: gitEnv, run, remote: join(root, "nowhere.git"), branch: "trunk" }).write(await sourceOf(smallSets, standardHeader()), plainWrite)
    assert.ok(calls.some((call) => call.startsWith("git clone -q -b trunk ")))
    assert.ok(calls.includes("git init -q -b trunk"))
    assert.ok(calls.includes("git push -q origin HEAD:trunk"))
})

test("git failing is DATA_DRIVER_UNAVAILABLE (transient); a failing pull refuses unless the checkout has no commit yet", async () => {
    const error = await refusal(async () => fakeDriver(fresh("git-fails"), (program) => (program === "git" ? failed : undefined)).write(await sourceOf(smallSets, standardHeader()), plainWrite))
    assert.equal(error.code, "DATA_DRIVER_UNAVAILABLE")
    assert.equal(error.retry, "transient")
    assert.equal(error.params.step, "git init")

    const held = fresh("pull-fails")
    await standardDriver(held).write(await sourceOf(smallSets, standardHeader()), plainWrite)
    const pullFails = (program: string, args: readonly string[]): RunResult | undefined => (program === "git" && args[0] === "pull" ? failed : undefined)
    const refused = await refusal(async () => fakeDriver(held, pullFails, { remote: "unused" }).write(await sourceOf(smallSets, standardHeader()), plainWrite))
    assert.equal(refused.params.step, "git pull")

    const empty = fresh("pull-empty")
    mkdirSync(empty, { recursive: true })
    git(empty, "init", "-q", "-b", "main")
    const pushed = (program: string, args: readonly string[]): RunResult | undefined => pullFails(program, args) ?? (program === "git" && args[0] === "push" ? ok() : undefined)
    const receipt = await fakeDriver(empty, pushed, { remote: "unused" }).write(await sourceOf(smallSets, standardHeader()), plainWrite)
    assert.equal(receipt.changed, 3)
})

test("verify reads sizes from ls-tree lines and tolerates a line without a tab", async () => {
    const checkout = fresh("tree")
    const receipt = await standardDriver(checkout).write(await sourceOf(smallSets, standardHeader()), plainWrite)
    const odd = fakeDriver(checkout, (program, args) => (program === "git" && args[0] === "ls-tree" ? ok("no-tab-line\n") : undefined))
    const verdict = await odd.verify(receipt.ref, null)
    assert.equal(check(verdict, "files").ok, false)
    assert.match(check(verdict, "files").detail, /0 files; stray 0, missing 3/u)
    assert.equal(check(verdict, "cap").detail, "0 bytes of 524288000")
})

test("the commit of a write carries the export digest and the format in its message", async () => {
    const checkout = fresh("message")
    const receipt = await standardDriver(checkout).write(await sourceOf(smallSets, standardHeader()), plainWrite)
    assert.match(git(checkout, "log", "-1", "--format=%s"), new RegExp(`^shop-seed-standard@1 ${receipt.ref.exportDigest.slice(0, 12)} 2026-01-01`, "u"))
})

/* --------------------------------------------------------------------------------------------------------------
 * A remote: a bare repository, two checkouts.
 * ------------------------------------------------------------------------------------------------------------ */

test("a write pushes to the remote; a second checkout clones it, lists the copy and pulls before its own write", async () => {
    const bare = fresh("remote.git")
    mkdirSync(bare, { recursive: true })
    git(bare, "init", "-q", "--bare", "-b", "main")
    const first = fresh("checkout-a")
    mkdirSync(first, { recursive: true })
    git(first, "init", "-q", "-b", "main")
    git(first, "remote", "add", "origin", bare)
    const a = standardDriver(first, { remote: bare })
    const receipt = await a.write(await sourceOf(smallSets, standardHeader()), plainWrite)
    assert.equal(git(bare, "rev-parse", "main").trim(), receipt.ref.locator)

    const b = standardDriver(fresh("checkout-b"), { remote: bare })
    const listed = await b.list()
    assert.deepEqual(listed, [])
    const received = await b.write(await sourceOf(smallSets, standardHeader()), plainWrite)
    assert.equal(received.changed, 0, "the clone already holds this export")
    assert.deepEqual((await b.list()).map((ref) => ref.locator), [receipt.ref.locator])

    await a.write(await sourceOf({ ...smallSets, orders: { "o-1": { total: 5 } } }, standardHeader()), plainWrite)
    const third = await b.write(await sourceOf({ ...smallSets, orders: { "o-1": { total: 6 } } }, standardHeader()), plainWrite)
    assert.equal(git(bare, "rev-parse", "main").trim(), third.ref.locator)
    assert.equal(Number(git(bare, "rev-list", "--count", "main").trim()), 3)
})

/* --------------------------------------------------------------------------------------------------------------
 * Real sops and a throwaway age key.
 * ------------------------------------------------------------------------------------------------------------ */

function realBackup(checkout: string, extra: Partial<Parameters<typeof createGitDriver>[0]> = {}): { driver: DriverAdapter; ctx: WriteContext; open: OpenContext; other: OpenContext } {
    assert.ok(key !== null && otherKey !== null)
    return { driver: createGitDriver({ id: "real", checkout, env: gitEnv, ...extra }), ctx: { recipients: [key.recipient], dryRun: false }, open: key.open, other: otherKey.open }
}

test("real sops: a seed-backup is sealed to the age recipient, unchanged files are kept, one set re-seals on change", { skip: toolsMissing }, async () => {
    const checkout = fresh("real-backup")
    const { driver, ctx, open } = realBackup(checkout)
    const first = await driver.write(await sourceOf(smallSets, backupHeader()), ctx)
    const names = [...listFiles(checkout, "data"), ...listFiles(checkout, "index"), ...listFiles(checkout, "blobs")]
    assert.equal(names.length, 3)
    assert.ok(names.every((name) => name.endsWith(".sops.json")))
    assert.ok(names.every((name) => readFileSync(join(checkout, name), "utf8").includes("ENC[AES256_GCM")))
    assert.ok(!readFileSync(join(checkout, "data/db/orders/all.json.sops.json"), "utf8").includes('"total"'))
    const bytes = new Map(names.map((name) => [name, readFileSync(join(checkout, name))]))
    const same = await driver.write(await sourceOf(smallSets, backupHeader()), ctx)
    assert.equal(same.changed, 0)
    assert.equal(same.ref.locator, first.ref.locator)
    assert.equal(commitCount(checkout), 1)
    const changed = await driver.write(await sourceOf({ ...smallSets, orders: { "o-1": { total: 7 } } }, backupHeader()), ctx)
    assert.equal(changed.changed, 1)
    assert.ok(readFileSync(join(checkout, "index/db/files.json.sops.json")).equals(bytes.get("index/db/files.json.sops.json") ?? Buffer.alloc(0)))
    const verdict = await driver.verify(changed.ref, open)
    assert.equal(verdict.healthy, true)
    assert.equal(check(verdict, "sealed").ok, true)
    assert.equal(check(verdict, "digests").ok, true)
})

test("real sops: verify without an identity skips digests, with one checks them, with another key fails, a damaged file is unhealthy", { skip: toolsMissing }, async () => {
    const checkout = fresh("real-verify")
    const { driver, ctx, open, other } = realBackup(checkout)
    const receipt = await driver.write(await sourceOf(smallSets, backupHeader()), ctx)
    const blind = await driver.verify(receipt.ref, null)
    assert.equal(blind.healthy, true)
    assert.ok(!blind.checks.some((item) => item.name === "digests"))
    assert.equal(check(await driver.verify(receipt.ref, open), "digests").ok, true)
    const wrong = await driver.verify(receipt.ref, other)
    assert.equal(wrong.healthy, false)
    assert.equal(check(wrong, "digests").detail, "DATA_SEAL_FAILED")
    const damaged = commitEdit(checkout, () => {
        writeFileSync(join(checkout, "data/db/orders/all.json.sops.json"), "damaged")
    })
    const damagedVerdict = await driver.verify({ ...receipt.ref, locator: damaged }, open)
    assert.equal(damagedVerdict.healthy, false)
    assert.equal(check(damagedVerdict, "sealed").ok, false)
    assert.equal(check(damagedVerdict, "digests").ok, false)
    const extra = commitEdit(checkout, () => {
        git(checkout, "checkout", "-q", receipt.ref.locator, "--", ".")
        writeFileSync(join(checkout, "data/db/orders/plain.json"), "{}")
        rmSync(join(checkout, "index/db/files.json.sops.json"))
    })
    const extraVerdict = await driver.verify({ ...receipt.ref, locator: extra }, null)
    assert.equal(check(extraVerdict, "files").ok, false)
    assert.match(check(extraVerdict, "files").detail, /stray 1, missing 1, unsealed 1/u)
})

test("real sops: a large sealed export stays under the shard limit per file, widens its shards and round-trips", { skip: toolsMissing }, async () => {
    const checkout = fresh("real-large")
    const { driver, ctx, open } = realBackup(checkout)
    const sets: MemorySets = { orders: Object.fromEntries(Array.from({ length: 36 }, (_, at) => [`order-${String(at).padStart(3, "0")}`, { n: at, pad: "q".repeat(100_000) + String(at) }])) }
    const receipt = await driver.write(await sourceOf(sets, backupHeader()), ctx)
    const manifest = JSON.parse(readFileSync(join(checkout, "manifest.json"), "utf8")) as { shards: Record<string, number> }
    assert.equal(manifest.shards["db/orders"], 1)
    assert.ok(listFiles(checkout, "data").every((name) => statSync(join(checkout, name)).size <= GIT_SHARD_BYTES))
    const back = await collect((await driver.read(receipt.ref, open)).entries())
    assert.equal(back.length, 36)
    assert.equal((await driver.verify(receipt.ref, open)).healthy, true)
})

test("real sops: a sealed blob over a shard's worth is chunked and read back byte for byte", { skip: toolsMissing }, async () => {
    const checkout = fresh("real-blob")
    const { driver, ctx, open } = realBackup(checkout)
    const big = Uint8Array.from({ length: 3_000_000 }, (_, at) => at % 241)
    const receipt = await driver.write(await sourceOf({ files: { big } }, backupHeader()), ctx)
    const blobs = listFiles(checkout, "blobs")
    assert.equal(blobs.length, 2)
    assert.ok(blobs.every((name) => /\.[01]\.bin\.sops\.json$/u.test(name)))
    const [entry] = await collect((await driver.read(receipt.ref, open)).entries())
    assert.ok(entry !== undefined)
    assert.ok(Buffer.from(entry.entry.body).equals(Buffer.from(big)))
})

test("real sops: a record deleted from the store leaves no file when its shard empties", { skip: toolsMissing }, async () => {
    const checkout = fresh("real-stale")
    const { driver, ctx, open } = realBackup(checkout)
    await driver.write(await sourceOf(smallSets, backupHeader()), ctx)
    const receipt = await driver.write(await sourceOf({ orders: smallSets.orders ?? {} }, backupHeader()), ctx)
    assert.equal(listFiles(checkout, "blobs").length + listFiles(checkout, "index").length, 0)
    assert.equal((await driver.verify(receipt.ref, open)).healthy, true)
})
