import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, sep } from "node:path"
import type { StoredEntry } from "../copies.ts"
import { memorySpool, spooledSource } from "../copies.ts"
import type { CopyReceipt, CopyRef, CopyVerdict, DriverAdapter, DriverLimits, ExportSource, OpenContext, VerifyCheck, WriteContext } from "../driver.ts"
import { DataRefusal, holdingFor } from "../driver.ts"
import type { DataEntry, DataManifest, JsonValue } from "../manifest.ts"
import { ManifestBuilder, blobEntry, byteOrder, canonicalJson, manifestProblems, recordEntry, recordValue, sha256Hex } from "../manifest.ts"
import { GIT_CAP_BYTES, GIT_SHARD_BYTES, GIT_WARN_BYTES } from "../words.ts"

/**
 * The `git` driver: one copy repository holds one data set's snapshot, one commit per changed snapshot.
 *
 *   manifest.json                                the DataManifest + the file index (path -> plaintext sha256, bytes) + the shard widths
 *   data/<store>/<set>/<shard>.json              records: canonical JSON, one line per key; `<shard>` = `all` or a hash prefix of the key
 *   blobs/<store>/<set>/<aa>/<id>[.<n>].bin      blobs: `<id>` = sha256 of set and key, chunked at 4 MiB
 *   index/<store>/<set>.json                     per blob set: key -> media, sha256, chunks
 *
 * Sealing follows the purpose, never a choice: a `seed-standard` is plaintext (readable, diffable; it holds no secret);
 * a `seed-backup` seals every file under data/, blobs/ and index/ with sops (binary mode, age recipients of its one
 * environment), the file then named `<name>.sops.json`. The manifest stays plaintext and holds no value.
 *
 * The cap is the whole snapshot: the bytes of every file under data/, blobs/ and index/ in the working tree, history
 * not counted, at most 500 MiB (warning past 400 MiB); a write past it is refused DATA_GIT_CAP_EXCEEDED: the data set
 * has outgrown git and needs the s3 driver. A file whose plaintext did not change is never rewritten, so an unchanged
 * entry keeps an unchanged file and an unchanged export commits nothing.
 */
export interface GitDriverOptions {
    /** The driver id the stack manifest declares (e.g. `nivo-lite-seed-backup-prod`). */
    readonly id: string
    /** The local working copy of the repository (outside every code repository). Created by `git init` or cloned when missing. */
    readonly checkout: string
    /** The remote URL; when set the driver clones, pulls before a write and pushes after it. Never a URL holding a credential. */
    readonly remote?: string
    /** The branch; `main` by default. */
    readonly branch?: string
    /** The cap of the whole snapshot; GIT_CAP_BYTES by default (a smaller one only in tests). */
    readonly capBytes?: number
    /** The warning threshold; GIT_WARN_BYTES by default. */
    readonly warnBytes?: number
    /** Runs a program; spawnSync by default (tests substitute nothing: they use real git and sops with a throwaway key). */
    readonly run?: Runner
    /** Extra environment for git and sops (PATH, HOME); never an identity: an identity comes with an OpenContext. */
    readonly env?: Readonly<Record<string, string>>
}

/** The result of one program run. */
export interface RunResult {
    /** The exit status, null when it did not start. */
    readonly status: number | null
    /** stdout bytes. */
    readonly stdout: Buffer
    /** stderr bytes; never printed by the driver (sops prints no value there, but the driver keeps only a class). */
    readonly stderr: Buffer
}

/** Runs a program in a directory with optional stdin and environment. */
export type Runner = (program: string, args: readonly string[], options: { readonly cwd: string; readonly input?: Buffer; readonly env?: Readonly<Record<string, string>> }) => RunResult

interface FileFacts {
    readonly plain: string
    readonly bytes: number
}

/** manifest.json as the git driver writes it. */
interface GitManifest extends DataManifest {
    readonly sealing: "none" | "sops-age"
    readonly recipients: readonly string[]
    readonly shards: Readonly<Record<string, number>>
    readonly files: Readonly<Record<string, FileFacts>>
}

interface BlobIndexItem {
    readonly media: string
    readonly sha256: string
    readonly chunks: number
}

const SEALED_SUFFIX = ".sops.json"
/** Plaintext budget of one record shard, so the sealed file (base64 + envelope) stays under GIT_SHARD_BYTES. */
const SHARD_PLAIN_BYTES = Math.floor(GIT_SHARD_BYTES * 0.7)
const BLOB_CHUNK_BYTES = Math.floor(GIT_SHARD_BYTES * 0.7)
const COPY_ROOTS = ["data", "blobs", "index"] as const
const GIT_ATTRIBUTES = "* -text\n"

const defaultRunner: Runner = (program, args, options) => {
    const result = spawnSync(program, [...args], { cwd: options.cwd, input: options.input, env: { ...process.env, ...options.env }, maxBuffer: 1 << 30 })
    return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function posix(path: string): string {
    return path.split(sep).join("/")
}

function recordShardLines(records: readonly DataEntry[]): Buffer {
    const lines = records.map((entry) => `${JSON.stringify(entry.key)}:${canonicalJson(recordValue(entry))}`)
    return Buffer.from(`{\n${lines.join(",\n")}\n}\n`, "utf8")
}

function shardOf(key: string, width: number): string {
    return width === 0 ? "all" : sha256Hex(key).slice(0, width)
}

function shardWidth(records: readonly DataEntry[], previous: number): number {
    for (let width = previous; width < 8; width += 1) {
        const sizes = new Map<string, number>()
        for (const entry of records) sizes.set(shardOf(entry.key, width), (sizes.get(shardOf(entry.key, width)) ?? 0) + entry.body.byteLength + entry.key.length + 8)
        if ([...sizes.values()].every((size) => size <= SHARD_PLAIN_BYTES)) return width
    }
    return 8
}

/** Builds the git driver over a local working copy. */
export function createGitDriver(options: GitDriverOptions): DriverAdapter {
    const run = options.run ?? defaultRunner
    const branch = options.branch ?? "main"
    const cap = options.capBytes ?? GIT_CAP_BYTES
    const warn = options.warnBytes ?? GIT_WARN_BYTES
    const env = options.env ?? {}
    const limits: DriverLimits = { forms: ["record", "blob"], maxFileBytes: GIT_SHARD_BYTES, maxCopyBytes: cap, warnCopyBytes: warn }

    const git = (args: readonly string[]): Buffer => {
        const result = run("git", args, { cwd: options.checkout, env })
        if (result.status !== 0) throw new DataRefusal("DATA_DRIVER_UNAVAILABLE", "transient", { driver: options.id, step: `git ${args.slice(0, 1).join("")}` })
        return result.stdout
    }
    const sops = (args: readonly string[], input: Buffer, identityEnv: Readonly<Record<string, string>>): Buffer => {
        const result = run("sops", args, { cwd: tmpdir(), input, env: { ...env, ...identityEnv } })
        if (result.status !== 0) throw new DataRefusal("DATA_SEAL_FAILED", "configuration", { driver: options.id, step: `sops ${args.slice(0, 1).join("")}` })
        return result.stdout
    }
    const seal = (path: string, plain: Buffer, recipients: readonly string[]): Buffer =>
        sops(["encrypt", "--input-type", "binary", "--output-type", "json", "--filename-override", path, "--age", recipients.join(",")], plain, {})
    const open = (path: string, sealed: Buffer, context: OpenContext): Buffer =>
        sops(["decrypt", "--input-type", "json", "--output-type", "binary", "--filename-override", path, "--decryption-order", "age"], sealed, context.identity.env)

    const prepare = (): void => {
        if (!existsSync(join(options.checkout, ".git"))) {
            mkdirSync(options.checkout, { recursive: true })
            const cloned = options.remote !== undefined && run("git", ["clone", "-q", "-b", branch, options.remote, "."], { cwd: options.checkout, env }).status === 0
            if (!cloned) {
                git(["init", "-q", "-b", branch])
                if (options.remote !== undefined) git(["remote", "add", "origin", options.remote])
            }
        } else if (options.remote !== undefined) {
            const fetched = run("git", ["pull", "-q", "--ff-only", "origin", branch], { cwd: options.checkout, env })
            if (fetched.status !== 0 && run("git", ["rev-parse", "--verify", "-q", "HEAD"], { cwd: options.checkout, env }).status === 0)
                throw new DataRefusal("DATA_DRIVER_UNAVAILABLE", "transient", { driver: options.id, step: "git pull" })
        }
    }
    /** Copy files are bytes, never text: no line-ending conversion may touch a sealed envelope or a digest. */
    const pinBytes = (): void => {
        const file = join(options.checkout, ".gitattributes")
        if (!existsSync(file) || readFileSync(file, "utf8") !== GIT_ATTRIBUTES) writeFileSync(file, GIT_ATTRIBUTES)
    }
    const headManifest = (): GitManifest | null => {
        const file = join(options.checkout, "manifest.json")
        return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as GitManifest) : null
    }
    const showAt = (commit: string, path: string): Buffer => git(["show", `${commit}:${path}`])
    const manifestAt = (commit: string): GitManifest => JSON.parse(showAt(commit, "manifest.json").toString("utf8")) as GitManifest
    const copyBytesOnDisk = (): string[] => {
        const found: string[] = []
        for (const root of COPY_ROOTS) {
            const dir = join(options.checkout, root)
            if (!existsSync(dir)) continue
            for (const name of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
                const full = join(dir, name)
                if (statSync(full).isFile()) found.push(posix(relative(options.checkout, full)))
            }
        }
        return found
    }

    /** Every file of the new snapshot: path (sealed name when sealed) -> plaintext. */
    const planFiles = async (source: ExportSource, previous: GitManifest | null): Promise<{ files: Map<string, Buffer>; shards: Record<string, number> }> => {
        const bySet = new Map<string, DataEntry[]>()
        for await (const item of source.entries()) {
            const id = `${item.store}/${item.entry.set}`
            bySet.set(id, [...(bySet.get(id) ?? []), item.entry])
        }
        const files = new Map<string, Buffer>()
        const shards: Record<string, number> = {}
        for (const set of source.manifest.sets) {
            const id = `${set.store}/${set.set}`
            const entries = [...(bySet.get(id) ?? [])].sort((left, right) => byteOrder(left.key, right.key))
            if (set.form === "record") {
                const width = shardWidth(entries, previous?.shards[id] ?? 0)
                shards[id] = width
                const groups = new Map<string, DataEntry[]>()
                for (const entry of entries) groups.set(shardOf(entry.key, width), [...(groups.get(shardOf(entry.key, width)) ?? []), entry])
                for (const [shard, records] of groups) files.set(`data/${id}/${shard}.json`, recordShardLines(records))
                continue
            }
            const index: Record<string, BlobIndexItem> = {}
            for (const entry of entries) {
                const blobId = sha256Hex(`${entry.set}\u0000${entry.key}`)
                const chunks = Math.max(1, Math.ceil(entry.body.byteLength / BLOB_CHUNK_BYTES))
                for (let at = 0; at < chunks; at += 1) {
                    const name = chunks === 1 ? `${blobId}.bin` : `${blobId}.${String(at)}.bin`
                    files.set(`blobs/${id}/${blobId.slice(0, 2)}/${name}`, Buffer.from(entry.body.subarray(at * BLOB_CHUNK_BYTES, (at + 1) * BLOB_CHUNK_BYTES)))
                }
                index[entry.key] = { media: entry.media, sha256: entry.sha256, chunks }
            }
            files.set(`index/${id}.json`, Buffer.from(`${canonicalJson(index)}\n`, "utf8"))
        }
        return { files, shards }
    }

    const fileText = (commit: string, manifest: GitManifest, path: string, context: OpenContext | null): Buffer => {
        const stored = manifest.sealing === "none" ? path : `${path}${SEALED_SUFFIX}`
        const bytes = showAt(commit, stored)
        if (manifest.sealing === "none") return bytes
        if (context === null) throw new DataRefusal("DATA_SEAL_FAILED", "configuration", { driver: options.id, reason: "an identity is needed to open a sealed copy" })
        return open(stored, bytes, context)
    }

    const entriesAt = (commit: string, manifest: GitManifest, context: OpenContext | null): StoredEntry[] => {
        const out: StoredEntry[] = []
        for (const set of manifest.sets) {
            const id = `${set.store}/${set.set}`
            if (set.form === "record") {
                const shards = Object.keys(manifest.files).filter((path) => path.startsWith(`data/${id}/`)).sort(byteOrder)
                const records: DataEntry[] = []
                for (const path of shards) {
                    const values = JSON.parse(fileText(commit, manifest, path, context).toString("utf8")) as Record<string, JsonValue>
                    for (const [key, value] of Object.entries(values)) records.push(recordEntry(set.set, key, value))
                }
                for (const entry of records.sort((left, right) => byteOrder(left.key, right.key))) out.push({ store: set.store, entry })
                continue
            }
            const index = JSON.parse(fileText(commit, manifest, `index/${id}.json`, context).toString("utf8")) as Record<string, BlobIndexItem>
            for (const [key, item] of Object.entries(index).sort(([left], [right]) => byteOrder(left, right))) {
                const blobId = sha256Hex(`${set.set}\u0000${key}`)
                const parts: Buffer[] = []
                for (let at = 0; at < item.chunks; at += 1) {
                    const name = item.chunks === 1 ? `${blobId}.bin` : `${blobId}.${String(at)}.bin`
                    parts.push(fileText(commit, manifest, `blobs/${id}/${blobId.slice(0, 2)}/${name}`, context))
                }
                out.push({ store: set.store, entry: blobEntry(set.set, key, new Uint8Array(Buffer.concat(parts)), item.media) })
            }
        }
        return out
    }

    const refOf = (commit: string, manifest: GitManifest): CopyRef => ({ driver: options.id, kind: "git", locator: commit, exportDigest: manifest.exportDigest, takenAt: manifest.takenAt })

    return {
        id: options.id,
        kind: "git",
        limits: () => limits,
        plan: (manifest) => holdingFor(manifest, limits.forms),
        async write(source: ExportSource, context: WriteContext): Promise<CopyReceipt> {
            const sealed = source.manifest.purpose === "seed-backup"
            if (sealed && context.recipients.length === 0)
                throw new DataRefusal("DATA_SEAL_FAILED", "configuration", { driver: options.id, reason: "a seed-backup is sealed to its environment's recipients and none were given" })
            if (!context.dryRun) {
                prepare()
                pinBytes()
            }
            const previous = headManifest()
            const { files, shards } = await planFiles(source, previous)
            const facts: Record<string, FileFacts> = {}
            const writes = new Map<string, Buffer>()
            let total = 0
            for (const [path, plain] of [...files.entries()].sort(([left], [right]) => byteOrder(left, right))) {
                const stored = sealed ? `${path}${SEALED_SUFFIX}` : path
                const plainSha = sha256Hex(plain)
                const before = previous?.files[path]
                const onDisk = join(options.checkout, stored)
                const keep = before?.plain === plainSha && previous?.sealing === (sealed ? "sops-age" : "none") && existsSync(onDisk)
                const bytes = keep ? statSync(onDisk).size : (() => {
                    const out = sealed ? seal(stored, plain, context.recipients) : plain
                    writes.set(stored, out)
                    return out.byteLength
                })()
                if (bytes > GIT_SHARD_BYTES) throw new DataRefusal("DATA_GIT_CAP_EXCEEDED", "configuration", { driver: options.id, file: path, bytes, limit: GIT_SHARD_BYTES })
                facts[path] = { plain: plainSha, bytes }
                total += bytes
            }
            if (total > cap) throw new DataRefusal("DATA_GIT_CAP_EXCEEDED", "configuration", { driver: options.id, bytes: total, cap, next: "s3" })
            const warnings = total > warn ? ["DATA_GIT_CAP_NEAR"] : []
            const holding = holdingFor(source.manifest, limits.forms)
            const at = new Date().toISOString()
            const manifest: GitManifest = { ...source.manifest, sealing: sealed ? "sops-age" : "none", recipients: sealed ? [...context.recipients].sort() : [], shards, files: facts }
            const keepPaths = new Set(Object.keys(facts).map((path) => (sealed ? `${path}${SEALED_SUFFIX}` : path)))
            const stale = copyBytesOnDisk().filter((path) => !keepPaths.has(path))
            if (context.dryRun) {
                const ref: CopyRef = { driver: options.id, kind: "git", locator: "dry-run", exportDigest: manifest.exportDigest, takenAt: manifest.takenAt }
                return { schema: "starci/data-copy@1", ref, holding, bytes: total, changed: writes.size + stale.length, warnings, at }
            }
            for (const path of stale) rmSync(join(options.checkout, path))
            for (const [path, bytes] of writes) {
                mkdirSync(dirname(join(options.checkout, path)), { recursive: true })
                writeFileSync(join(options.checkout, path), bytes)
            }
            writeFileSync(join(options.checkout, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
            git(["add", "-A", "--", ".gitattributes", "manifest.json", ...COPY_ROOTS.filter((root) => existsSync(join(options.checkout, root)))])
            const staged = run("git", ["diff", "--cached", "--quiet"], { cwd: options.checkout, env }).status !== 0
            const unchanged = !staged || previous?.exportDigest === manifest.exportDigest && writes.size === 0 && stale.length === 0
            if (staged && !unchanged) git(["commit", "-q", "-m", `${manifest.format} ${manifest.exportDigest.slice(0, 12)} ${manifest.takenAt}`])
            else if (staged) git(["reset", "-q", "--hard", "HEAD"])
            if (options.remote !== undefined) git(["push", "-q", "origin", `HEAD:${branch}`])
            const commit = git(["rev-parse", "HEAD"]).toString("utf8").trim()
            return { schema: "starci/data-copy@1", ref: refOf(commit, headManifest() ?? manifest), holding, bytes: total, changed: unchanged ? 0 : writes.size + stale.length, warnings, at }
        },
        list(): Promise<readonly CopyRef[]> {
            if (!existsSync(join(options.checkout, ".git"))) return Promise.resolve([])
            const log = run("git", ["log", "-n", "30", "--format=%H", "--", "manifest.json"], { cwd: options.checkout, env })
            if (log.status !== 0) return Promise.resolve([])
            const commits = log.stdout.toString("utf8").split("\n").filter((line) => line.trim() !== "")
            return Promise.resolve(commits.map((commit) => refOf(commit, manifestAt(commit))))
        },
        read(ref: CopyRef, context: OpenContext): Promise<ExportSource> {
            const manifest = manifestAt(ref.locator)
            const spool = memorySpool()
            const entries = entriesAt(ref.locator, manifest, context)
            return Promise.all(entries.map((item) => spool.append(item))).then(() => spooledSource(manifest, spool))
        },
        verify(ref: CopyRef, context: OpenContext | null): Promise<CopyVerdict> {
            const checks: VerifyCheck[] = []
            let manifest: GitManifest
            try {
                manifest = manifestAt(ref.locator)
            } catch {
                return Promise.resolve({ ref, healthy: false, checks: [{ name: "manifest", ok: false, detail: "manifest.json cannot be read at the commit" }], manifest: null })
            }
            const problems = manifestProblems(manifest)
            checks.push({ name: "manifest", ok: problems.length === 0, detail: problems.length === 0 ? "starci/data-manifest@1, exportDigest matches the sets" : problems.join("; ") })
            const sealedPolicy = manifest.purpose === "seed-backup" ? "sops-age" : "none"
            checks.push({ name: "sealing", ok: manifest.sealing === sealedPolicy && (sealedPolicy === "none" || manifest.recipients.length > 0), detail: `purpose ${manifest.purpose} requires ${sealedPolicy}, the copy says ${manifest.sealing}` })
            const tree = git(["ls-tree", "-r", "-l", ref.locator]).toString("utf8").split("\n").filter((line) => line.trim() !== "")
            const listed = tree.flatMap((line) => {
                const match = /^\S+ \S+ \S+\s+(\d+)\t(.+)$/u.exec(line)
                return match === null ? [] : [{ path: String(match[2]), bytes: Number(match[1]) }]
            })
            const sizes = new Set(listed.map((item) => item.path))
            const copyListed = listed.filter((item) => COPY_ROOTS.some((root) => item.path.startsWith(`${root}/`)))
            const copyFiles = copyListed.map((item) => item.path)
            const expected = new Set(Object.keys(manifest.files).map((path) => (manifest.sealing === "none" ? path : `${path}${SEALED_SUFFIX}`)))
            const stray = copyFiles.filter((path) => !expected.has(path))
            const missing = [...expected].filter((path) => !sizes.has(path))
            const unsealed = manifest.sealing === "none" ? [] : copyFiles.filter((path) => !path.endsWith(SEALED_SUFFIX))
            checks.push({ name: "files", ok: stray.length === 0 && missing.length === 0 && unsealed.length === 0, detail: `${String(copyFiles.length)} files; stray ${String(stray.length)}, missing ${String(missing.length)}, unsealed ${String(unsealed.length)}` })
            if (manifest.sealing !== "none") {
                const notEnvelope = copyFiles.filter((path) => path.endsWith(SEALED_SUFFIX)).filter((path) => {
                    const text = showAt(ref.locator, path).toString("utf8")
                    return !text.includes('"sops"') || !text.includes("ENC[AES256_GCM")
                })
                checks.push({ name: "sealed", ok: notEnvelope.length === 0, detail: notEnvelope.length === 0 ? "every data file is a sops envelope" : `${String(notEnvelope.length)} files are not sops envelopes` })
            }
            const total = copyListed.reduce((sum, item) => sum + item.bytes, 0)
            checks.push({ name: "cap", ok: total <= cap, detail: `${String(total)} bytes of ${String(cap)}` })
            if (context !== null || manifest.sealing === "none") {
                try {
                    const builder = new ManifestBuilder()
                    for (const item of entriesAt(ref.locator, manifest, context)) builder.add(item.store, item.entry)
                    const rebuilt = builder.build(manifest)
                    const wrong = manifest.sets.filter((set) => rebuilt.sets.find((other) => other.store === set.store && other.set === set.set)?.digest !== set.digest)
                    checks.push({ name: "digests", ok: wrong.length === 0, detail: wrong.length === 0 ? "every set matches its digest and count" : `differ: ${wrong.map((set) => `${set.store}/${set.set}`).join(", ")}` })
                } catch (cause) {
                    checks.push({ name: "digests", ok: false, detail: cause instanceof DataRefusal ? cause.code : "a file cannot be read or parsed" })
                }
            }
            return Promise.resolve({ ref, healthy: checks.every((check) => check.ok), checks, manifest })
        },
    }
}
