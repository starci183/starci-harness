import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import { captureGit } from "../../shared/git.js"
import { captureTool } from "../../shared/exec.js"
import type { GraphNode } from "./affected.js"

/**
 * The committed check cache of the harness repository itself (contexts/harness/check-cache.md), the harness counterpart of an app's
 * `.starcistacks/cache/` (contexts/project/check-cache.md). It keeps, per CI node (a package folder, `cli`, `app`) and per step the harness gate and CI's
 * package jobs run on it, the green verdict of the last real run under a content key, in `.cache/check/<step>/<node slug>.jsonl`. A gate or a CI plan reuses
 * a green record whose key the tree computes now; anything else runs and writes a new record. The record format, the canonical JSON Lines writer and the
 * hash combiner are `@starci/hfs`'s own (`cache/jsonl.mjs`, `cache/hash.mjs`), loaded from the installed package, so the two caches share one format.
 */

/** Where the harness's committed cache lives, repository-relative. */
export const CACHE_ROOT = ".cache"
/** The folder of the per-node step verdicts. */
export const CHECK_FOLDER = `${CACHE_ROOT}/check`
/** The version of the record format and key recipe: a record of another version never matches. */
export const CACHE_FORMAT = "harness-check@1"
/**
 * The version of the cached steps' commands (gate.ts `runStep`, ci.yml's package job). Bump it in the change that alters what a cached step runs or how its
 * verdict is read: every record then misses once and is rewritten by the next real run.
 */
export const STEPS_VERSION = "1"
/** An edited, malformed or contradicted record: an error finding wherever it is read. */
export const FORGED = "HARNESS_CHECK_CACHE_FORGED"

/** The gate step kinds that keep a verdict, and the folder each is kept under. `install` (preparation) and `check` (the repository-wide light gates) keep none. */
export const CACHED_STEPS = {
    build: "build",
    typecheck: "types",
    declarations: "declarations",
    bundles: "bundles",
    lint: "lint",
    test: "test",
} as const
export type CachedKind = keyof typeof CACHED_STEPS
export type CacheStep = (typeof CACHED_STEPS)[CachedKind]

/** Whether a gate step kind keeps a verdict. */
export const isCachedKind = (kind: string): kind is CachedKind => Object.hasOwn(CACHED_STEPS, kind)

/** Path segments whose files never join a key: install and build output, and the cache itself. */
const EXCLUDED_SEGMENTS = new Set(["node_modules", "dist", CACHE_ROOT])

/** One record, in `@starci/hfs`'s record shape (cache/types.mts CacheRecord). */
export interface HarnessRecord {
    readonly path: string
    readonly step: string
    readonly hash: string
    readonly findings: readonly unknown[]
    readonly data?: unknown
}

/** What a key is made of, kept in the record so a reader can recompute the key and see an edit. */
export interface KeyParts {
    readonly format: string
    readonly steps: string
    readonly tool: string
    /** The digest of the tracked tree of the node and of every node in its closure. */
    readonly source: string
    /** The digest of the top-level trees the closure reads outside packages/. */
    readonly reads: string
}

/** The `@starci/hfs` cache primitives the harness cache reuses. */
interface Primitives {
    readonly combineHashes: (parts: Readonly<Record<string, string>>) => string
    readonly serializeRecords: (records: readonly HarnessRecord[]) => string
    readonly parseRecords: (text: string) => { readonly records: HarnessRecord[]; readonly invalid: number }
}

let primitives: Primitives | undefined

/** Loads the record writer, parser and hash combiner of the installed `@starci/hfs` (its cache/ files, by path: the package exports no subpath for them). */
export const loadPrimitives = async (): Promise<Primitives> => {
    if (primitives !== undefined) return primitives
    const hfs = dirname(createRequire(import.meta.url).resolve("@starci/hfs/package.json"))
    const jsonl = (await import(pathToFileURL(join(hfs, "cache", "jsonl.mjs")).href)) as Pick<Primitives, "serializeRecords" | "parseRecords">
    const hash = (await import(pathToFileURL(join(hfs, "cache", "hash.mjs")).href)) as Pick<Primitives, "combineHashes">
    primitives = { combineHashes: hash.combineHashes, serializeRecords: jsonl.serializeRecords, parseRecords: jsonl.parseRecords }
    return primitives
}

/** The file name of a node's records: its folder with `/` as `-` (`packages/hfs` -> `packages-hfs`). */
export const slugOf = (dir: string): string => dir.replaceAll("/", "-")

/** The repository-relative file of one node's records of one step. */
export const recordFile = (step: string, dir: string): string => `${CHECK_FOLDER}/${step}/${slugOf(dir)}.jsonl`

/** Whether a repository path joins a key: it lies under no node_modules, dist or .cache segment. */
export const keyed = (path: string): boolean => !path.split("/").some((segment) => EXCLUDED_SEGMENTS.has(segment))

/** The top-level entry a repository path sits under: `packages/<name>` for a package's files, else its first segment. */
export const treeOf = (path: string): string => {
    const [first = "", second] = path.split("/")
    return first === "packages" && second !== undefined && path.includes("/", "packages/".length) ? `packages/${second}` : first
}

/**
 * The content id of every keyed file of the work tree, by repository path: git's blob id from the index (`git ls-files -s`, the bytes a commit carries,
 * the same on every host whatever its line endings), and for a file the work tree changed or git does not track yet, the id `git hash-object` gives its
 * current bytes (the blob it would commit); `absent` for a deleted one. A clean checkout (CI) takes the index alone.
 */
export const fileIds = async (root: string): Promise<Map<string, string>> => {
    const ids = new Map<string, string>()
    const listed = await captureGit(["ls-files", "-s", "-z"], root)
    if (listed.exitCode !== 0) throw new Error(`git ls-files failed: ${listed.stderr.trim()}`)
    for (const entry of listed.stdout.split("\0")) {
        const tab = entry.indexOf("\t")
        if (tab < 0) continue
        const path = entry.slice(tab + 1)
        const id = entry.slice(0, tab).split(" ")[1]
        if (id !== undefined && keyed(path)) ids.set(path, id)
    }
    const status = await captureGit(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"], root)
    if (status.exitCode !== 0) throw new Error(`git status failed: ${status.stderr.trim()}`)
    const dirty: string[] = []
    for (const entry of status.stdout.split("\0")) {
        // `XY path`; the capture trims the output, so the first entry may have lost the space a clean index column starts with.
        const path = /^[ MADRCUT?!]{1,2} (.+)$/u.exec(entry)?.[1]
        if (path === undefined) continue
        if (!keyed(path)) continue
        if (!existsSync(join(root, path))) ids.set(path, "absent")
        else dirty.push(path)
    }
    if (dirty.length > 0) {
        const hashed = await captureTool("git", ["hash-object", "--stdin-paths"], root, { input: `${dirty.join("\n")}\n` })
        const lines = hashed.stdout.split(/\r?\n/u).filter((line) => line.trim() !== "")
        if (hashed.exitCode !== 0 || lines.length !== dirty.length) throw new Error(`git hash-object failed: ${hashed.stderr.trim()}`)
        dirty.forEach((path, index) => ids.set(path, lines[index] ?? "absent"))
    }
    return ids
}

/** The digest of every top-level tree (`packages/<name>` counting as its own): each its files' ids by path. */
export const treeDigests = (ids: ReadonlyMap<string, string>, combine: Primitives["combineHashes"]): Map<string, string> => {
    const byTree = new Map<string, Record<string, string>>()
    for (const [path, id] of ids) {
        const tree = treeOf(path)
        const files = byTree.get(tree) ?? {}
        files[path] = id
        byTree.set(tree, files)
    }
    return new Map([...byTree].map(([tree, files]) => [tree, combine(files)]))
}

/** The nodes `dir`'s steps can read: itself and every node its needs reach, transitively (cycles allowed), sorted. Pure. */
export const closureOf = (dir: string, graph: readonly GraphNode[]): string[] => {
    const byDir = new Map(graph.map((node) => [node.dir, node]))
    const seen = new Set<string>()
    const visit = (at: string): void => {
        if (seen.has(at)) return
        seen.add(at)
        for (const need of byDir.get(at)?.needs ?? []) visit(need)
    }
    visit(dir)
    return [...seen].toSorted((left, right) => left.localeCompare(right))
}

/** The Node and npm majors the steps run on: the tool part of every key (each tool a step runs is pinned by the node's own lockfile, inside its source). */
export const toolPart = (node: string = process.versions.node, npm: string | undefined = process.env.npm_config_user_agent?.match(/npm\/(\d+)/u)?.[1]): string => `node${node.split(".")[0] ?? node} npm${npm ?? "-"}`

/** The parts of the key of `dir`. Pure over its inputs. */
export const keyParts = (dir: string, graph: readonly GraphNode[], trees: ReadonlyMap<string, string>, tool: string, combine: Primitives["combineHashes"]): KeyParts => {
    const closure = closureOf(dir, graph)
    const byDir = new Map(graph.map((node) => [node.dir, node]))
    const source = combine(Object.fromEntries(closure.map((node) => [node, trees.get(node) ?? "absent"])))
    const reads = [...new Set(closure.flatMap((node) => byDir.get(node)?.reads ?? []))]
    return { format: CACHE_FORMAT, steps: STEPS_VERSION, tool, source, reads: combine(Object.fromEntries(reads.map((top) => [top, trees.get(top) ?? "absent"]))) }
}

/** The key of one node's step: its parts with the node and the step. Pure. */
export const keyOf = (parts: KeyParts, dir: string, step: string, combine: Primitives["combineHashes"]): string => combine({ ...parts, path: dir, step })

/** The green record of one step that ran green under `parts`. */
export const greenRecord = (dir: string, step: string, parts: KeyParts, combine: Primitives["combineHashes"]): HarnessRecord => ({
    path: dir,
    step,
    hash: keyOf(parts, dir, step, combine),
    findings: [],
    data: { parts: { ...parts }, verdict: "green" },
})

/** One error finding about the cache, in the shape the gate reports. */
export interface CacheFinding {
    readonly level: "error"
    readonly code: string
    readonly path: string
    readonly message: string
}

const isParts = (value: unknown): value is KeyParts => {
    if (typeof value !== "object" || value === null) return false
    const parts = value as Record<string, unknown>
    return ["format", "steps", "tool", "source", "reads"].every((name) => typeof parts[name] === "string") && Object.keys(parts).length === 5
}

/**
 * Why a record read from `file` cannot be trusted, or undefined when it holds: a record names the node and step its file names, carries no finding,
 * says green, and its hash is the key its own parts make; anything else was edited by hand (or written by something other than a gate). A record of
 * another format or steps version is no fault: it is simply never matched. Pure.
 */
export const recordFault = (record: HarnessRecord, file: string, combine: Primitives["combineHashes"]): string | undefined => {
    const [step = "", name = ""] = file.slice(CHECK_FOLDER.length + 1).split("/")
    if (record.step !== step || `${slugOf(record.path)}.jsonl` !== name) return `names ${record.path} ${record.step}, not the node and step of its file`
    const data = record.data as { readonly verdict?: unknown; readonly parts?: unknown } | undefined
    if (data?.verdict !== "green" || record.findings.length !== 0) return "is not a green verdict: only green records are written"
    if (!isParts(data.parts)) return "carries no key parts"
    if (keyOf(data.parts, record.path, record.step, combine) !== record.hash) return "has a hash its own parts do not make (edited by hand)"
    return undefined
}

/** The records of the cache, by `<step>\0<dir>`, and the faults of every record or line that cannot be trusted. */
export interface Book {
    readonly records: ReadonlyMap<string, readonly HarnessRecord[]>
    readonly forged: readonly CacheFinding[]
}

const bookKey = (step: string, dir: string): string => `${step}\0${dir}`

/** A book from the text of each record file, by repository path. */
export const bookOf = (files: ReadonlyMap<string, string>, p: Primitives): Book => {
    const records = new Map<string, HarnessRecord[]>()
    const forged: CacheFinding[] = []
    for (const [file, text] of [...files].toSorted(([left], [right]) => left.localeCompare(right))) {
        const parsed = p.parseRecords(text)
        if (parsed.invalid > 0) forged.push({ level: "error", code: FORGED, path: file, message: `${String(parsed.invalid)} line(s) of ${file} are not records` })
        for (const record of parsed.records) {
            const fault = recordFault(record, file, p.combineHashes)
            if (fault !== undefined) {
                forged.push({ level: "error", code: FORGED, path: file, message: `the record of ${record.path} ${record.step} ${fault}` })
                continue
            }
            const key = bookKey(record.step, record.path)
            records.set(key, [...(records.get(key) ?? []), record])
        }
    }
    return { records, forged }
}

/** The record files of the work tree's cache, by repository path. */
export const readTreeFiles = (root: string): Map<string, string> => {
    const files = new Map<string, string>()
    const folder = join(root, CHECK_FOLDER)
    if (!existsSync(folder)) return files
    for (const step of readdirSync(folder, { withFileTypes: true })) {
        if (!step.isDirectory()) continue
        for (const file of readdirSync(join(folder, step.name))) if (file.endsWith(".jsonl")) files.set(`${CHECK_FOLDER}/${step.name}/${file}`, readFileSync(join(folder, step.name, file), "utf8"))
    }
    return files
}

/** The record files of the cache as commit `rev` holds them, by repository path; empty when the commit has none or cannot be read. */
export const readRevFiles = async (root: string, rev: string): Promise<Map<string, string>> => {
    const files = new Map<string, string>()
    const listed = await captureGit(["ls-tree", "-r", "-z", "--name-only", rev, "--", CHECK_FOLDER], root)
    if (listed.exitCode !== 0) return files
    for (const path of listed.stdout.split("\0").filter((each) => each.endsWith(".jsonl"))) {
        const shown = await captureGit(["show", `${rev}:${path}`], root)
        if (shown.exitCode === 0) files.set(path, shown.stdout)
    }
    return files
}

/** Whether the book holds a trusted green record of `dir`'s `step` under `key`. */
export const hasGreen = (book: Book, step: string, dir: string, key: string): boolean => (book.records.get(bookKey(step, dir)) ?? []).some((record) => record.hash === key)

/** The keys of a tree: every node's parts, computed once. */
export interface TreeKeys {
    readonly parts: ReadonlyMap<string, KeyParts>
    readonly key: (dir: string, step: string) => string | undefined
}

/** Computes the key parts of every node of `graph` over the work tree of `root`. */
export const treeKeys = async (root: string, graph: readonly GraphNode[], tool: string = toolPart()): Promise<TreeKeys> => {
    const p = await loadPrimitives()
    const trees = treeDigests(await fileIds(root), p.combineHashes)
    const parts = new Map(graph.map((node) => [node.dir, keyParts(node.dir, graph, trees, tool, p.combineHashes)]))
    return {
        parts,
        key: (dir, step) => {
            const own = parts.get(dir)
            return own === undefined ? undefined : keyOf(own, dir, step, p.combineHashes)
        },
    }
}

/**
 * Writes the green record of each step that ran green, one file per node and step holding that one record (a union merge of two branches may leave
 * two lines in a file: the reader takes the one its key matches, and the next write leaves one), and removes the record a step contradicted (it ran red
 * under the key its record claims green). Returns the files written or removed, repository-relative.
 */
export const writeRecords = async (root: string, green: readonly { readonly dir: string; readonly step: string; readonly parts: KeyParts }[], contradicted: readonly { readonly dir: string; readonly step: string }[] = []): Promise<string[]> => {
    const p = await loadPrimitives()
    const touched: string[] = []
    for (const { dir, step, parts } of green) {
        const file = recordFile(step, dir)
        const text = p.serializeRecords([greenRecord(dir, step, parts, p.combineHashes)])
        const absolute = join(root, file)
        if (existsSync(absolute) && readFileSync(absolute, "utf8") === text) continue
        mkdirSync(dirname(absolute), { recursive: true })
        writeFileSync(absolute, text)
        touched.push(file)
    }
    for (const { dir, step } of contradicted) {
        const absolute = join(root, recordFile(step, dir))
        if (!existsSync(absolute)) continue
        rmSync(absolute)
        touched.push(recordFile(step, dir))
    }
    return touched
}

/** The CI workflow whose green runs prove the committed records (the nightly full run without cache). */
export const VERIFY_WORKFLOW = "cache-verify.yml"

/** One finished or running run of the verify workflow, as `gh run list --json` prints it. */
export interface VerifyRun {
    readonly status: string
    readonly conclusion: string
    readonly headSha: string
    readonly headBranch: string
    readonly url: string
    readonly createdAt: string
}

/**
 * Whether the full gate may trust the committed records: the newest finished verify run of the default branch or of `head` decides; green, or none yet,
 * trusts; red does not, and neither does a list that cannot be read. A cancelled or skipped run is no verdict. Pure.
 */
export const verifyTrust = (runs: readonly VerifyRun[] | undefined, head: string, defaultBranch = "main"): { readonly trusted: boolean; readonly reason: string } => {
    if (runs === undefined) return { trusted: false, reason: `the ${VERIFY_WORKFLOW} runs cannot be read (gh): nothing proves the committed records, so every step runs` }
    const finished = runs
        .filter((run) => run.status === "completed" && (run.conclusion === "success" || run.conclusion === "failure"))
        .filter((run) => run.headBranch === defaultBranch || run.headSha === head)
        .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
    const newest = finished[0]
    if (newest === undefined) return { trusted: true, reason: `no finished ${VERIFY_WORKFLOW} run yet: the records are trusted` }
    if (newest.conclusion === "success") return { trusted: true, reason: `the newest ${VERIFY_WORKFLOW} run is green (${newest.url})` }
    return { trusted: false, reason: `the newest ${VERIFY_WORKFLOW} run is red (${newest.url}): the committed records are not trusted, so every step runs` }
}

/** The verify runs GitHub holds, or undefined when gh cannot list them. */
export const listVerifyRuns = async (root: string): Promise<VerifyRun[] | undefined> => {
    try {
        const listed = await captureTool("gh", ["run", "list", "--workflow", VERIFY_WORKFLOW, "--limit", "30", "--json", "status,conclusion,headSha,headBranch,url,createdAt"], root, { timeoutMs: 60_000 })
        if (listed.exitCode !== 0) return undefined
        return JSON.parse(listed.stdout) as VerifyRun[]
    } catch {
        return undefined
    }
}

/** The cached steps CI's `package (...)` job runs on a package, by its npm scripts: its build and the declarations check, its `npm test`, its `bundles:check`. Pure. */
export const ciPackageSteps = (scripts: Readonly<Record<string, string>>): CacheStep[] => [
    ...(scripts.build === undefined ? [] : (["build", "declarations"] as const)),
    ...(scripts.test === undefined ? [] : (["test"] as const)),
    ...(scripts["bundles:check"] === undefined ? [] : (["bundles"] as const)),
]

/** What CI may reuse: per package of the plan, whether every step its job runs has a green record at the trusted base; and the forged records of the commit. */
export interface CiReuse {
    readonly reused: readonly string[]
    readonly forged: readonly CacheFinding[]
}

/**
 * The reuse of CI's plan job (contexts/harness/check-cache.md "GitHub CI"). Only the records of the trusted `base` are trusted (the commit's own records
 * are a claim CI has not judged): a package whose every job step has a green record there under the key this commit computes is reused, its job runs no
 * step. The commit's own records are read only to be checked: an edited or malformed one is FORGED, an error that fails the plan.
 */
export const ciReuse = async (root: string, base: string, graph: readonly GraphNode[], packages: readonly string[], scriptsOf: (dir: string) => Readonly<Record<string, string>>): Promise<CiReuse> => {
    const p = await loadPrimitives()
    const keys = await treeKeys(root, graph)
    const trusted = bookOf(await readRevFiles(root, base), p)
    const own = bookOf(readTreeFiles(root), p)
    const reused = packages.filter((dir) => {
        const steps = ciPackageSteps(scriptsOf(dir))
        return steps.length > 0 && steps.every((step) => {
            const key = keys.key(dir, step)
            return key !== undefined && hasGreen(trusted, step, dir, key)
        })
    })
    return { reused, forged: own.forged }
}
