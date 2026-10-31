import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { captureGit, repositoryRoot, resolveSha } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb, EVERYONE } from "../../shared/verb.js"
import { listPackages } from "../../shared/workspace.js"
import type { WorkspacePackage } from "../../shared/workspace.js"

/** The CI nodes of this repository: each package under packages/, the CLI and the desktop app. */
const NODE = /^(?:packages\/[^/]+|cli|app)$/

/** Trees the CLI reads at run time, so a change there is the harness job's (the CLI node's). */
const HARNESS_TREES = ["contexts/", "ops/", "policy/", "hfs.json"]

/** Trees whose change makes every node affected: the workflows that run CI. */
const FULL_TREES = [".github/"]

const SKIPPED = new Set(["node_modules", "dist", "coverage", ".git", ".next", ".turbo"])
const TEXT = /\.(?:[cm]?[jt]sx?|json|ya?ml|toml|md|css|tpl|properties)$/
const MAX_BYTES = 1_000_000

/** One CI node with the text of its files: `own` outside its bundled runtime/ copies, `all` including them. */
interface Node {
    readonly pkg: WorkspacePackage
    readonly own: readonly string[]
    readonly all: readonly string[]
}

const textsOf = (dir: string): { readonly own: string[]; readonly all: string[] } => {
    const own: string[] = []
    const all: string[] = []
    const visit = (folder: string, bundled: boolean): void => {
        for (const entry of readdirSync(folder, { withFileTypes: true })) {
            if (SKIPPED.has(entry.name)) continue
            const path = join(folder, entry.name)
            if (entry.isDirectory()) visit(path, bundled || (folder === dir && entry.name === "runtime"))
            else if (TEXT.test(entry.name) && statSync(path).size <= MAX_BYTES) {
                const text = readFileSync(path, "utf8")
                all.push(text)
                if (!bundled) own.push(text)
            }
        }
    }
    visit(dir, false)
    return { own, all }
}

const parentOf = (dir: string): string => (dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "")
const baseOf = (dir: string): string => dir.slice(dir.lastIndexOf("/") + 1)

/** The siblings a node needs, by folder, in the strengths that matter to a build order. */
interface Needs {
    /** Siblings it installs or builds against: its `requires` and `file:` dependencies. A build must follow these. */
    readonly hard: ReadonlySet<string>
    /** Siblings whose built output (`../<sibling>/dist`) its own files import: its build typechecks against them, so they build first. */
    readonly built: ReadonlySet<string>
    /** Every sibling its own files read by relative path (`../<sibling>/`, or path segments `"..", "<sibling>"`), outside its bundled runtime/ copies; `built` is a subset. */
    readonly soft: ReadonlySet<string>
}

/**
 * The siblings a node needs, by folder: the siblings it requires (`dependencies`, `peerDependencies`, the graph `release publish`
 * orders by) and the folders its `file:` dependencies install (`hard`), and the siblings its own files read by relative path
 * (`soft`), those among them whose `dist/` they import apart (`built`).
 */
const needsOf = (node: Node, nodes: readonly Node[]): Needs => {
    const hard = new Set<string>()
    const built = new Set<string>()
    const soft = new Set<string>()
    for (const name of Object.keys(node.pkg.requires)) {
        const sibling = nodes.find((other) => other.pkg.name === name)
        if (sibling !== undefined) hard.add(sibling.pkg.relativeDir)
    }
    for (const dir of node.pkg.fileDependencies) if (nodes.some((other) => other.pkg.relativeDir === dir)) hard.add(dir)
    for (const other of nodes) {
        const dir = other.pkg.relativeDir
        if (dir === node.pkg.relativeDir || parentOf(dir) !== parentOf(node.pkg.relativeDir)) continue
        const segments = new RegExp(String.raw`["']\.\.["'],\s*(?:["']\.\.["'],\s*)*["']${baseOf(dir)}["']`)
        if (node.own.some((text) => text.includes(`../${baseOf(dir)}/`) || segments.test(text))) soft.add(dir)
        if (node.own.some((text) => text.includes(`../${baseOf(dir)}/dist`))) built.add(dir)
    }
    for (const set of [hard, built, soft]) set.delete(node.pkg.relativeDir)
    return { hard, built, soft }
}

/** Every node `needs` can name, whichever strength: what makes a node affected when a sibling it needs is. */
const anyNeeds = (needs: Needs): Set<string> => new Set([...needs.hard, ...needs.soft])

type NeedsOf = ReadonlyMap<string, { readonly hard: ReadonlySet<string>; readonly built: ReadonlySet<string>; readonly soft: ReadonlySet<string> }>

/**
 * The edges a build order follows: every hard need; then the needs whose `dist/` a node imports, then the other relative reads,
 * each only where it closes no cycle. Specs of two siblings may read each other's files while one of them installs and builds
 * against the other (`file:`) or typechecks against its `dist/`; that edge must win, or the dependent builds before the sibling
 * it imports (a cycle broken the wrong way). Needs are added in sorted order, so the result is the same on every run.
 */
export const buildEdges = (needs: NeedsOf): Map<string, Set<string>> => {
    const edges = new Map([...needs].map(([dir, need]) => [dir, new Set(need.hard)]))
    const reaches = (from: string, target: string, seen = new Set<string>()): boolean => {
        if (from === target) return true
        if (seen.has(from)) return false
        seen.add(from)
        return [...(edges.get(from) ?? [])].some((next) => reaches(next, target, seen))
    }
    const sorted = [...needs].toSorted(([left], [right]) => left.localeCompare(right))
    for (const strength of ["built", "soft"] as const) {
        for (const [dir, need] of sorted) {
            for (const sibling of [...need[strength]].toSorted((left, right) => left.localeCompare(right))) {
                if (!edges.get(dir)?.has(sibling) && !reaches(sibling, dir)) edges.get(dir)?.add(sibling)
            }
        }
    }
    return edges
}

/**
 * The nodes `start` needs, transitively, deps first, then `start` itself: the order a CI job installs and builds them. `also`
 * are siblings `start` reads that could not go before it (the edge would close a cycle): they, and what they need, follow it,
 * so they are still installed and built before the job's test step runs.
 */
export const buildOrder = (start: string, edges: ReadonlyMap<string, ReadonlySet<string>>, also: Iterable<string> = []): string[] => {
    const order: string[] = []
    const visit = (dir: string, path: readonly string[]): void => {
        if (order.includes(dir) || path.includes(dir)) return
        for (const need of [...(edges.get(dir) ?? [])].toSorted((a, b) => a.localeCompare(b))) visit(need, [...path, dir])
        order.push(dir)
    }
    visit(start, [])
    for (const sibling of [...also].toSorted((a, b) => a.localeCompare(b))) visit(sibling, [])
    return order
}

/** What a change affects: the packages CI tests (each with its build order), and whether the harness and app jobs run. */
export interface Affected {
    readonly base: string | null
    readonly head: string
    readonly full: boolean
    readonly changed: readonly string[]
    readonly packages: readonly { readonly name: string; readonly dir: string; readonly build: readonly string[] }[]
    readonly harness: boolean
    readonly app: boolean
    readonly appBuild: readonly string[]
    readonly matrix: { readonly include: readonly { readonly package: string; readonly name: string; readonly build: string }[] }
    /** The plan in two lines: what was measured, then the packages and jobs that run. */
    readonly summary: readonly string[]
}

const changedBetween = async (root: string, base: string, head: string): Promise<string[] | null> => {
    const diff = await captureGit(["diff", "--name-only", "--no-renames", "-z", base, head], root)
    return diff.exitCode === 0 ? diff.stdout.split("\0").filter((path) => path !== "") : null
}

/**
 * The CI nodes a diff affects. A file under a node is that node's; a file under the trees the CLI reads is the CLI's; a node's file
 * whose repository path another node's text names (a canon pin `packages/<name>/package.json`) is that other node's too; a change under .github/, or
 * no base to diff against, affects every node. Every node that needs (`needsOf`) an affected node, transitively, is affected.
 */
export const affectedBy = async (cwd: string, baseFlag: string | undefined, headFlag: string | undefined): Promise<Affected> => {
    const root = await repositoryRoot(cwd)
    const head = await resolveSha(root, headFlag ?? "HEAD")
    const base = baseFlag === undefined || baseFlag.trim() === "" ? null : await resolveSha(root, baseFlag.trim()).catch(() => null)
    const changed = base === null ? null : await changedBetween(root, base, head)
    const nodes: Node[] = listPackages(root)
        .filter((pkg) => NODE.test(pkg.relativeDir))
        .map((pkg) => ({ pkg, ...textsOf(pkg.dir) }))
    const needs = new Map(nodes.map((node) => [node.pkg.relativeDir, needsOf(node, nodes)]))
    const full = changed === null || changed.some((file) => FULL_TREES.some((tree) => file.startsWith(tree)))
    const hit = new Set<string>(full ? nodes.map((node) => node.pkg.relativeDir) : [])
    for (const file of full ? [] : changed) {
        const owner = nodes.find((node) => file.startsWith(`${node.pkg.relativeDir}/`))
        if (owner !== undefined) hit.add(owner.pkg.relativeDir)
        if (HARNESS_TREES.some((tree) => file === tree || file.startsWith(tree))) hit.add("cli")
        if (owner !== undefined) for (const node of nodes) if (node !== owner && node.all.some((text) => text.includes(file))) hit.add(node.pkg.relativeDir)
    }
    let grew = true
    while (grew) {
        grew = false
        for (const [dir, needed] of needs) {
            if (!hit.has(dir) && [...anyNeeds(needed)].some((need) => hit.has(need))) {
                hit.add(dir)
                grew = true
            }
        }
    }
    const packageOnly = (dirs: ReadonlySet<string>): Set<string> => new Set([...dirs].filter((need) => need.startsWith("packages/")))
    const packageNeeds = new Map([...needs].map(([dir, needed]) => [dir, { hard: packageOnly(needed.hard), built: packageOnly(needed.built), soft: packageOnly(needed.soft) }]))
    const edges = buildEdges(packageNeeds)
    const orderOf = (dir: string): string[] => buildOrder(dir, edges, packageNeeds.get(dir)?.soft ?? [])
    const packages = nodes
        .filter((node) => node.pkg.relativeDir.startsWith("packages/") && hit.has(node.pkg.relativeDir))
        .map((node) => ({ name: node.pkg.name, dir: node.pkg.relativeDir, build: orderOf(node.pkg.relativeDir) }))
    const harness = hit.has("cli")
    const app = hit.has("app")
    const summary = [
        `base ${base ?? "-"} head ${head}${full ? " (full)" : ""}: ${String((changed ?? []).length)} file(s) changed`,
        `packages: ${packages.map((pkg) => pkg.dir).join(", ") || "-"}; harness: ${harness ? "yes" : "no"}; app: ${app ? "yes" : "no"}`,
    ]
    return {
        base,
        head,
        full,
        changed: changed ?? [],
        packages,
        harness,
        app,
        appBuild: orderOf("app").filter((dir) => dir !== "app"),
        matrix: { include: packages.map((pkg) => ({ package: pkg.dir, name: pkg.name, build: pkg.build.join(" ") })) },
        summary,
    }
}

/**
 * `starci release affected --base <sha>`: the CI plan of a diff. CI's plan job runs it and fans the packages out to one matrix
 * entry each (installing and building its build order, then testing it), runs the harness job when the CLI is affected and the
 * app job when the desktop app is.
 */
export const releaseAffectedVerb = defineVerb({
    path: ["release", "affected"],
    summary: "the CI nodes a diff affects: each package with its build order (sibling requires and file: dependencies first, then relative reads that close no cycle), the harness and app jobs; no base is every node",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/release-affected@1",
    flags: {
        base: { kind: "string", summary: "the commit the change is measured from (empty or unknown: every node is affected)" },
        sha: { kind: "string", summary: "the commit measured (default HEAD)" },
    },
    run: async (context, flags) => {
        const data = await affectedBy(context.cwd, flags.base, flags.sha)
        return { data, message: data.summary.join("\n") }
    },
})
