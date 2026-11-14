import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, test } from "node:test"
import type { OpenContext } from "../driver.ts"
import { DataRefusal } from "../driver.ts"
import type { Runner, RunResult } from "./driver.ts"
import { openReviewTree, pinRepository } from "./files.ts"

/* The real tools: git always; sops and age when installed (CI must install both for the real-sops specs to run; they
 * are skipped, saying why, when either is missing). The sops failure and type-selection branches run with a fake runner. */

const root = mkdtempSync(join(tmpdir(), "git-files-spec-"))
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
    readonly file: string
    readonly open: OpenContext
}

/** A throwaway age key generated inside the temp dir; never printed. */
function throwawayKey(name: string): ThrowawayKey | null {
    if (toolsMissing !== false) return null
    const file = join(root, `${name}.txt`)
    assert.equal(spawnSync("age-keygen", ["-o", file]).status, 0)
    const recipient = /# public key: (age1\S+)/u.exec(readFileSync(file, "utf8"))?.[1]
    assert.ok(recipient !== undefined)
    return { recipient, file, open: { identity: { kind: "age-identity", env: { SOPS_AGE_KEY_FILE: file } } } }
}
const key = throwawayKey("key")
const otherKey = throwawayKey("other")

function git(cwd: string, ...args: string[]): string {
    const result = spawnSync("git", args, { cwd, env: { ...process.env, ...gitEnv }, encoding: "utf8" })
    assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`)
    return result.stdout
}

/** A local repository with one commit per call of `commit`. */
function repository(name: string): { readonly dir: string; commit(files: Record<string, string | Buffer>): string } {
    const dir = fresh(name)
    mkdirSync(dir, { recursive: true })
    git(dir, "init", "-q", "-b", "main")
    return {
        dir,
        commit(files) {
            for (const [path, content] of Object.entries(files)) {
                mkdirSync(dirname(join(dir, path)), { recursive: true })
                writeFileSync(join(dir, path), content)
            }
            git(dir, "add", "-A")
            git(dir, "commit", "-q", "-m", "files")
            return git(dir, "rev-parse", "HEAD").trim()
        },
    }
}

function sealWithSops(plain: string, recipient: string, type: "yaml" | "json", filename: string): Buffer {
    const sealed = spawnSync("sops", ["encrypt", "--age", recipient, "--input-type", type, "--output-type", type, "--filename-override", filename], { input: plain })
    assert.equal(sealed.status, 0)
    return sealed.stdout
}

const ok = (stdout = ""): RunResult => ({ status: 0, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0) })
const failed: RunResult = { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
const anyIdentity: OpenContext = { identity: { kind: "age-identity", env: { FROM_CONTEXT: "yes" } } }

function thrown(run: () => unknown): DataRefusal {
    try {
        run()
    } catch (error) {
        assert.ok(error instanceof DataRefusal)
        return error
    }
    return assert.fail("expected a DataRefusal")
}

/* ---------------------------------------------------------------- pinRepository */

test("pinRepository reads files at the pinned commit through a bare mirror in the cache", () => {
    const source = repository("pin-source")
    const commit = source.commit({ "docs/readme.txt": "hello", "bin/data.bin": Buffer.from([0, 1, 2, 255]) })
    const cache = fresh("pin-cache")
    const pinned = pinRepository({ repository: source.dir, commit, cache, name: "shop-data", env: gitEnv })
    assert.equal(pinned.commit, commit)
    assert.ok(existsSync(join(cache, "shop-data.git")))
    assert.equal(pinned.readText("docs/readme.txt"), "hello")
    assert.deepEqual([...(pinned.readBytes("bin/data.bin") ?? Buffer.alloc(0))], [0, 1, 2, 255])
    assert.equal(pinned.readText("docs/missing.txt"), null)
    assert.equal(pinned.readBytes("nothing"), null)
    assert.equal(pinned.openSealed("docs/missing.sops.yaml", anyIdentity), null)
})

test("pinRepository refuses a path that leaves the repository, an absolute path and a pin that is not a commit", () => {
    const source = repository("pin-paths")
    const commit = source.commit({ "a.txt": "a" })
    const pinned = pinRepository({ repository: source.dir, commit, cache: fresh("pin-paths-cache"), name: "r" })
    for (const path of ["../x", "..", "docs/../../x", "/etc/passwd", "C:/Windows/win.ini"]) {
        const error = thrown(() => pinned.readText(path))
        assert.equal(error.code, "DATA_COPY_MISSING", path)
        assert.equal(error.retry, "configuration")
    }
    for (const pin of ["main", "ABCDEF".repeat(7).slice(0, 40), commit.slice(0, 39), `${commit}0`]) {
        const error = thrown(() => pinRepository({ repository: source.dir, commit: pin, cache: fresh("pin-bad-cache"), name: "r" }))
        assert.equal(error.code, "DATA_COPY_MISSING")
        assert.equal(error.params.name, "r")
    }
})

test("pinRepository refuses a commit the repository does not hold, and an unreachable repository is transient", () => {
    const source = repository("pin-unknown")
    source.commit({ "a.txt": "a" })
    const unknown = thrown(() => pinRepository({ repository: source.dir, commit: "1".repeat(40), cache: fresh("pin-unknown-cache"), name: "r" }))
    assert.equal(unknown.code, "DATA_COPY_MISSING")
    const nowhere = thrown(() => pinRepository({ repository: join(root, "does-not-exist"), commit: "1".repeat(40), cache: fresh("pin-nowhere-cache"), name: "r" }))
    assert.equal(nowhere.code, "DATA_DRIVER_UNAVAILABLE")
    assert.equal(nowhere.retry, "transient")
})

test("pinRepository reuses its mirror and fetches a commit made after the mirror was cloned", () => {
    const source = repository("pin-fetch")
    const first = source.commit({ "a.txt": "one" })
    const cache = fresh("pin-fetch-cache")
    assert.equal(pinRepository({ repository: source.dir, commit: first, cache, name: "r", env: gitEnv }).readText("a.txt"), "one")
    const second = source.commit({ "a.txt": "two" })
    const again = pinRepository({ repository: source.dir, commit: second, cache, name: "r", env: gitEnv })
    assert.equal(again.readText("a.txt"), "two")
    assert.equal(pinRepository({ repository: source.dir, commit: first, cache, name: "r" }).readText("a.txt"), "one")
})

test("openSealed picks the sops type from the extension and passes the identity's environment", () => {
    const source = repository("pin-types")
    const commit = source.commit({ "a.sops.json": "{}", "b.sops.yaml": "k: v", "c.sops.yml": "k: v", "d.sops.bin": "raw" })
    const seen: string[][] = []
    const environments: (Readonly<Record<string, string>> | undefined)[] = []
    const run: Runner = (program, args, options) => {
        if (program === "sops") {
            seen.push([...args])
            environments.push(options.env)
            return ok("plain")
        }
        return realRunner(program, args, options)
    }
    const pinned = pinRepository({ repository: source.dir, commit, cache: fresh("pin-types-cache"), name: "r", env: { ...gitEnv, FROM_OPTIONS: "yes" }, run })
    const types = ["a.sops.json", "b.sops.yaml", "c.sops.yml", "d.sops.bin"].map((path) => {
        const opened = pinned.openSealed(path, anyIdentity)
        assert.equal(opened?.toString("utf8"), "plain")
        const args = seen.at(-1) ?? []
        return [args[args.indexOf("--input-type") + 1], args[args.indexOf("--output-type") + 1], args[args.indexOf("--filename-override") + 1]]
    })
    assert.deepEqual(types, [["json", "json", "a.sops.json"], ["yaml", "yaml", "b.sops.yaml"], ["yaml", "yaml", "c.sops.yml"], ["binary", "binary", "d.sops.bin"]])
    assert.ok(environments.every((env) => env?.FROM_CONTEXT === "yes" && env.FROM_OPTIONS === "yes"))
})

test("openSealed refuses with DATA_SEAL_FAILED when sops fails", () => {
    const source = repository("pin-sops-fails")
    const commit = source.commit({ "s.sops.yaml": "k: v" })
    const run: Runner = (program, args, options) => (program === "sops" ? failed : realRunner(program, args, options))
    const pinned = pinRepository({ repository: source.dir, commit, cache: fresh("pin-sops-fails-cache"), name: "r", run })
    const error = thrown(() => pinned.openSealed("s.sops.yaml", anyIdentity))
    assert.equal(error.code, "DATA_SEAL_FAILED")
    assert.equal(error.params.path, "s.sops.yaml")
})

test("real sops: openSealed opens a sealed yaml and json file in memory with the throwaway key; another key is DATA_SEAL_FAILED", { skip: toolsMissing }, () => {
    assert.ok(key !== null && otherKey !== null)
    const source = repository("pin-real")
    const commit = source.commit({
        "secrets/app.sops.yaml": sealWithSops("password: hunter2\n", key.recipient, "yaml", "secrets/app.sops.yaml"),
        "secrets/app.sops.json": sealWithSops('{"password":"hunter2"}', key.recipient, "json", "secrets/app.sops.json"),
    })
    const pinned = pinRepository({ repository: source.dir, commit, cache: fresh("pin-real-cache"), name: "r" })
    assert.match(pinned.openSealed("secrets/app.sops.yaml", key.open)?.toString("utf8") ?? "", /password: hunter2/u)
    assert.match(pinned.openSealed("secrets/app.sops.json", key.open)?.toString("utf8") ?? "", /hunter2/u)
    assert.equal(thrown(() => pinned.openSealed("secrets/app.sops.yaml", otherKey.open)).code, "DATA_SEAL_FAILED")
    assert.ok(!pinned.readText("secrets/app.sops.yaml")?.includes("hunter2"))
})

/* ---------------------------------------------------------------- openReviewTree */

function realRunner(program: string, args: readonly string[], options: { readonly cwd: string; readonly input?: Buffer; readonly env?: Readonly<Record<string, string>> }): RunResult {
    const result = spawnSync(program, [...args], { cwd: options.cwd, input: options.input, env: { ...process.env, ...options.env } })
    return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

test("openReviewTree refuses a folder that is not a git working tree", () => {
    const folder = fresh("tree-plain")
    mkdirSync(folder, { recursive: true })
    const error = thrown(() => openReviewTree(folder))
    assert.equal(error.code, "DATA_COPY_MISSING")
    assert.equal(error.params.reason, "not a git working tree")
})

test("a review tree reads, writes text (true only when it changed) and refuses paths outside the tree", () => {
    const tree = repository("tree-text")
    const review = openReviewTree(tree.dir)
    assert.equal(review.readText("notes/a.txt"), null)
    assert.equal(review.writeText("notes/a.txt", "one"), true)
    assert.equal(review.readText("notes/a.txt"), "one")
    assert.equal(review.writeText("notes/a.txt", "one"), false)
    assert.equal(review.writeText("notes/a.txt", "two"), true)
    assert.equal(readFileSync(join(tree.dir, "notes/a.txt"), "utf8"), "two")
    for (const path of ["../outside.txt", "/abs.txt", "..hidden"]) {
        const error = thrown(() => review.writeText(path, "x"))
        assert.equal(error.code, "DATA_COPY_MISSING", path)
    }
    assert.equal(existsSyncOutside(tree.dir), false)
})

function existsSyncOutside(dir: string): boolean {
    return existsSync(join(dir, "..", "outside.txt"))
}

test("a review tree seals through sops with its own creation rules, in the type of the extension; sops failing is DATA_SEAL_FAILED", () => {
    const tree = repository("tree-fake")
    const calls: { args: readonly string[]; cwd: string; input: string; env: Readonly<Record<string, string>> | undefined }[] = []
    const run: Runner = (_program, args, options) => {
        calls.push({ args, cwd: options.cwd, input: options.input?.toString("utf8") ?? "", env: options.env })
        return ok("SEALED")
    }
    const review = openReviewTree(tree.dir, { run, env: { MARK: "1" } })
    assert.equal(review.seal("conf/a.yaml", Buffer.from("k: v")), true)
    assert.equal(review.seal("conf/b.json", Buffer.from("{}")), true)
    assert.equal(readFileSync(join(tree.dir, "conf/a.yaml"), "utf8"), "SEALED")
    assert.deepEqual(calls.map((call) => [call.args[call.args.indexOf("--input-type") + 1], call.args[call.args.indexOf("--filename-override") + 1], call.input, call.cwd]), [["yaml", "conf/a.yaml", "k: v", tree.dir], ["json", "conf/b.json", "{}", tree.dir]])
    assert.deepEqual(calls[0]?.env, { MARK: "1" })
    const unsealed = openReviewTree(tree.dir, { run: () => ok("x") })
    assert.equal(unsealed.seal("c.yaml", Buffer.from("k")), true)
    const refused = thrown(() => openReviewTree(tree.dir, { run: () => failed }).seal("conf/c.yaml", Buffer.from("k: v")))
    assert.equal(refused.code, "DATA_SEAL_FAILED")
    assert.ok(!existsSync(join(tree.dir, "conf/c.yaml")))
})

test("real sops: a review tree seals a document with the creation rule of its own .sops.yaml, naming the throwaway recipient", { skip: toolsMissing }, () => {
    assert.ok(key !== null)
    const tree = repository("tree-real")
    writeFileSync(join(tree.dir, ".sops.yaml"), `creation_rules:\n  - path_regex: .*\\.(yaml|json)$\n    age: ${key.recipient}\n`)
    const review = openReviewTree(tree.dir)
    assert.equal(review.seal("secrets/app.yaml", Buffer.from("password: hunter2\n")), true)
    assert.equal(review.seal("secrets/app.json", Buffer.from('{"password":"hunter2"}')), true)
    const sealedYaml = review.readText("secrets/app.yaml") ?? ""
    assert.ok(sealedYaml.includes("ENC[AES256_GCM") && !sealedYaml.includes("hunter2"))
    const opened = spawnSync("sops", ["decrypt", "--input-type", "yaml", "--output-type", "yaml", join(tree.dir, "secrets/app.yaml")], { env: { ...process.env, ...key.open.identity.env }, encoding: "utf8" })
    assert.match(opened.stdout, /password: hunter2/u)
    assert.ok((review.readText("secrets/app.json") ?? "").includes("ENC[AES256_GCM"))
})

test("real sops: a review tree with no creation rule for the path is DATA_SEAL_FAILED and writes nothing", { skip: toolsMissing }, () => {
    const tree = repository("tree-norule")
    const review = openReviewTree(tree.dir, { env: { SOPS_AGE_KEY_FILE: key?.file ?? "" } })
    assert.equal(thrown(() => review.seal("secrets/none.yaml", Buffer.from("k: v\n"))).code, "DATA_SEAL_FAILED")
    assert.ok(!existsSync(join(tree.dir, "secrets/none.yaml")))
})
