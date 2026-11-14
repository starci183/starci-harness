import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, normalize } from "node:path"
import { DataRefusal } from "../driver.ts"
import type { OpenContext } from "../driver.ts"
import type { RunResult, Runner } from "./driver.ts"

/**
 * File-level reads of a copy repository at one pinned commit, and writes into a working tree for review: what a
 * project's own extension of the standard (a kind it defines on top, with its own document) reads through, so no app
 * writes git or sops code. The data driver (`createGitDriver`) stays the one writer of the generic layout.
 */
export interface PinnedRepository {
    /** The commit every read is of (40 hex digits, verified to exist). */
    readonly commit: string
    /** The bytes of a repository-relative file at the commit, or null when the commit holds no such file. */
    readBytes(path: string): Buffer | null
    /** The text of a repository-relative file at the commit, or null. */
    readText(path: string): string | null
    /** Opens a sops-sealed file of the commit IN MEMORY with the identity (sops on stdin/stdout); the plaintext never reaches a file. */
    openSealed(path: string, context: OpenContext): Buffer | null
}

/** Where a pinned repository is fetched from and into. */
export interface PinOptions {
    /** A git remote URL (never one holding a credential) or a local repository path. */
    readonly repository: string
    /** The commit, 40 hex digits. */
    readonly commit: string
    /** A cache directory outside every code repository; one bare mirror per repository name lives under it. */
    readonly cache: string
    /** The mirror's folder name under the cache (the repository's name). */
    readonly name: string
    /** Extra environment for git and sops. */
    readonly env?: Readonly<Record<string, string>>
    /** The program runner; spawnSync by default. */
    readonly run?: Runner
}

const defaultRunner: Runner = (program, args, options): RunResult => {
    const result = spawnSync(program, [...args], { cwd: options.cwd, input: options.input, env: { ...process.env, ...options.env }, maxBuffer: 1 << 30 })
    return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function safePath(path: string): string {
    const clean = normalize(path).split("\\").join("/")
    if (isAbsolute(path) || clean.startsWith("../") || clean === "..") throw new DataRefusal("DATA_COPY_MISSING", "configuration", { path })
    return clean
}

/** Fetches the repository into its bare mirror under the cache and answers it at the pinned commit; refuses a commit it cannot find. */
export function pinRepository(options: PinOptions): PinnedRepository {
    const run = options.run ?? defaultRunner
    const env = options.env ?? {}
    if (!/^[0-9a-f]{40}$/u.test(options.commit)) throw new DataRefusal("DATA_COPY_MISSING", "configuration", { reason: "the pin is not a 40-hex commit", name: options.name })
    const mirror = join(options.cache, `${options.name}.git`)
    mkdirSync(options.cache, { recursive: true })
    const git = (args: readonly string[]): RunResult => run("git", args, { cwd: mirror, env })
    const has = (): boolean => git(["cat-file", "-e", `${options.commit}^{commit}`]).status === 0
    if (!existsSync(mirror) && run("git", ["clone", "-q", "--bare", options.repository, mirror], { cwd: options.cache, env }).status !== 0)
        throw new DataRefusal("DATA_DRIVER_UNAVAILABLE", "transient", { step: "git clone", name: options.name })
    if (!has()) git(["fetch", "-q", "origin", "+refs/heads/*:refs/heads/*"])
    if (!has()) throw new DataRefusal("DATA_COPY_MISSING", "configuration", { reason: "the pinned commit is not in the repository", name: options.name })
    const readBytes = (path: string): Buffer | null => {
        const shown = git(["show", `${options.commit}:${safePath(path)}`])
        return shown.status === 0 ? shown.stdout : null
    }
    return {
        commit: options.commit,
        readBytes,
        readText: (path) => readBytes(path)?.toString("utf8") ?? null,
        openSealed(path, context) {
            const sealed = readBytes(path)
            if (sealed === null) return null
            const type = path.endsWith(".json") ? "json" : path.endsWith(".yaml") || path.endsWith(".yml") ? "yaml" : "binary"
            const opened = run("sops", ["decrypt", "--input-type", type, "--output-type", type, "--filename-override", safePath(path), "--decryption-order", "age"], { cwd: options.cache, env: { ...env, ...context.identity.env }, input: sealed })
            if (opened.status !== 0) throw new DataRefusal("DATA_SEAL_FAILED", "configuration", { reason: "the sealed file does not open with this identity", path: safePath(path) })
            return opened.stdout
        },
    }
}

/** A working tree a person reviews and commits: writes text, and seals values through sops with the tree's own `.sops.yaml` rules. */
export interface ReviewTree {
    /** The text of a tree-relative file, or null. */
    readText(path: string): string | null
    /** Writes a tree-relative text file; true when its content changed. */
    writeText(path: string, text: string): boolean
    /** Seals a plaintext document (yaml or json by extension) into `path` with the tree's `.sops.yaml` creation rule for that path; the plaintext is sops's stdin only. True when it wrote. */
    seal(path: string, plaintext: Buffer): boolean
}

/** Opens a git working tree for review writes; refuses a folder that is not one. */
export function openReviewTree(root: string, options: { readonly env?: Readonly<Record<string, string>>; readonly run?: Runner } = {}): ReviewTree {
    const run = options.run ?? defaultRunner
    if (!existsSync(join(root, ".git"))) throw new DataRefusal("DATA_COPY_MISSING", "configuration", { reason: "not a git working tree", root })
    const full = (path: string): string => join(root, safePath(path))
    const readText = (path: string): string | null => (existsSync(full(path)) ? readFileSync(full(path), "utf8") : null)
    return {
        readText,
        writeText(path, text) {
            if (readText(path) === text) return false
            mkdirSync(dirname(full(path)), { recursive: true })
            writeFileSync(full(path), text)
            return true
        },
        seal(path, plaintext) {
            const type = path.endsWith(".json") ? "json" : "yaml"
            const sealed = run("sops", ["encrypt", "--input-type", type, "--output-type", type, "--filename-override", safePath(path)], { cwd: root, env: options.env ?? {}, input: plaintext })
            if (sealed.status !== 0) throw new DataRefusal("DATA_SEAL_FAILED", "configuration", { reason: "sops could not seal with the tree's rules", path: safePath(path) })
            mkdirSync(dirname(full(path)), { recursive: true })
            writeFileSync(full(path), sealed.stdout)
            return true
        },
    }
}
