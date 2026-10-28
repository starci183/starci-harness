import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Refusal } from "../../shared/errors.js"
import { captureNpm } from "../../shared/exec.js"
import { withHeavySlot } from "../../harness/heavy.js"
import { captureGit, currentBranch, isAncestor, refExists, repositoryRoot, resolveSha, trackedChanges } from "../../shared/git.js"
import { assertMayPushBranch } from "../pkg/edit.js"
import { formatTable } from "../../shared/output.js"
import { defineVerb } from "../../shared/verb.js"
import { requireCiGreen } from "../check/ci.js"
import { listPackages } from "../../shared/workspace.js"
import type { WorkspacePackage } from "../../shared/workspace.js"

/** What publication does with one package. */
type Action = "publish" | "published" | "private"

interface PlanRow {
    readonly package: string
    readonly version: string
    readonly dir: string
    readonly distTag: string
    readonly action: Action
}

interface PublishData {
    readonly mode: "plan" | "publish"
    readonly rows: readonly PlanRow[]
    readonly published: readonly string[]
}

/** The npm dist-tag of a version: its prerelease id (1.0.0-alpha.3 -> alpha), else latest. */
const distTagOf = (version: string): string => /^\d+\.\d+\.\d+-([A-Za-z]+)/.exec(version)?.[1] ?? "latest"

const onRegistry = async (pkg: WorkspacePackage, cwd: string): Promise<boolean> => {
    const view = await captureNpm(["view", `${pkg.name}@${pkg.version}`, "version"], cwd)
    return view.exitCode === 0 && view.stdout.trim() === pkg.version
}

const actionOf = async (pkg: WorkspacePackage, cwd: string): Promise<Action> => {
    if (pkg.private) return "private"
    return (await onRegistry(pkg, cwd)) ? "published" : "publish"
}

/** How long a published version may take to become readable: the registry answers a fresh version only after a delay. */
const REGISTRY_SETTLE_MS = 900_000
const REGISTRY_POLL_MS = 10_000

/** True once the registry serves the package's version, polled until REGISTRY_SETTLE_MS has passed. */
const settledOnRegistry = async (pkg: WorkspacePackage, root: string, deadline: number): Promise<boolean> => {
    if (await onRegistry(pkg, root)) return true
    if (Date.now() >= deadline) return false
    await new Promise((done) => setTimeout(done, REGISTRY_POLL_MS))
    return settledOnRegistry(pkg, root, deadline)
}

const publishRow = async (row: PlanRow, packages: readonly WorkspacePackage[], root: string): Promise<string | undefined> => {
    const pkg = packages.find((candidate) => candidate.name === row.package)
    if (pkg === undefined) return undefined
    // Provenance needs a CI identity (GitHub Actions OIDC): CI's publish job signs every tarball, Debug's fallback from a workstation goes without it.
    const provenance = process.env.GITHUB_ACTIONS === "true" ? ["--provenance"] : ["--provenance=false"]
    const run = await captureNpm(["publish", "--tag", row.distTag, ...provenance], pkg.dir)
    if (run.exitCode !== 0) throw new Refusal("PUBLISH_FAILED", `npm publish of ${row.package}@${row.version} failed: ${(run.stderr || run.stdout).split("\n").slice(-3).join(" ")}`)
    if (!(await settledOnRegistry(pkg, root, Date.now() + REGISTRY_SETTLE_MS))) throw new Refusal("PUBLISH_NOT_CONFIRMED", `${row.package}@${row.version} is not readable on the registry ${String(REGISTRY_SETTLE_MS / 1000)} s after publishing`)
    return `${row.package}@${row.version}`
}

/**
 * The package held for the second phase: the CLI. Every CI job installs it from its lockfile, which can name only versions npm
 * already serves, so its commit requires a sibling at a published version and CI moves it after the siblings are published.
 */
const HELD_DIR = "cli"

const SIBLING_FIELDS = ["dependencies", "peerDependencies"] as const

/** A manifest whose sibling requirements name the siblings' folder versions, with the moves made (empty when none differ). */
const movedManifest = (text: string, packages: readonly WorkspacePackage[]): { readonly text: string; readonly moves: readonly WorkspacePackage[] } => {
    const manifest = JSON.parse(text) as Record<string, unknown>
    const moves: WorkspacePackage[] = []
    for (const field of SIBLING_FIELDS) {
        const specs = manifest[field]
        if (typeof specs !== "object" || specs === null) continue
        const record = specs as Record<string, unknown>
        for (const [name, spec] of Object.entries(record)) {
            const sibling = packages.find((pkg) => pkg.name === name)
            if (sibling === undefined || spec === sibling.version) continue
            record[name] = sibling.version
            if (!moves.includes(sibling)) moves.push(sibling)
        }
    }
    return { text: `${JSON.stringify(manifest, null, 2)}\n`, moves }
}

/**
 * Publishes the held CLI: its sibling requirements move to the siblings' folder versions, each read on npm first, its lockfile is
 * refreshed against them, and it is published; its package.json and lockfile are put back afterwards.
 */
const publishHeld = async (row: PlanRow, packages: readonly WorkspacePackage[], root: string): Promise<string | undefined> => {
    const pkg = packages.find((candidate) => candidate.name === row.package)
    if (pkg === undefined) return undefined
    const manifestPath = join(pkg.dir, "package.json")
    const lockPath = join(pkg.dir, "package-lock.json")
    const manifest = readFileSync(manifestPath, "utf8")
    const lock = existsSync(lockPath) ? readFileSync(lockPath, "utf8") : undefined
    const moved = movedManifest(manifest, packages)
    try {
        if (moved.moves.length > 0) {
            for (const sibling of moved.moves) {
                if (!(await settledOnRegistry(sibling, root, Date.now() + REGISTRY_SETTLE_MS))) {
                    throw new Refusal("RELEASE_DEPENDENCY_UNPUBLISHED", `${row.package}@${row.version} moves to ${sibling.name}@${sibling.version}, which npm does not serve`)
                }
            }
            writeFileSync(manifestPath, moved.text)
            const refresh = await withHeavySlot("install", "npm install --package-lock-only", pkg.dir, {}, (held) => captureNpm(["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], pkg.dir, held.options))
            if (refresh.exitCode !== 0) throw new Refusal("PUBLISH_LOCK_REFRESH_FAILED", `the lockfile of ${row.package} could not move to ${moved.moves.map((sibling) => `${sibling.name}@${sibling.version}`).join(", ")}: ${(refresh.stderr || refresh.stdout).split("\n").slice(-3).join(" ")}`)
        }
        return await publishRow(row, packages, root)
    } finally {
        writeFileSync(manifestPath, manifest)
        if (lock !== undefined) writeFileSync(lockPath, lock)
    }
}

/** Publishes the due rows one after the other (npm publishes stay ordered); stops at the first refusal. */
const publishDue = async (due: readonly PlanRow[], packages: readonly WorkspacePackage[], root: string, published: string[]): Promise<void> => {
    await due.reduce(async (previous, row) => {
        await previous
        const done = row.dir === HELD_DIR ? await publishHeld(row, packages, root) : await publishRow(row, packages, root)
        if (done !== undefined) published.push(done)
    }, Promise.resolve())
}

/** The due rows in publication order: a row after every due sibling it requires, so a dependency reaches npm before its dependent, and the held CLI last. */
const publicationOrder = (due: readonly PlanRow[], packages: readonly WorkspacePackage[]): PlanRow[] => {
    const requires = (row: PlanRow): readonly string[] => Object.keys(packages.find((pkg) => pkg.name === row.package)?.requires ?? {})
    const ordered: PlanRow[] = []
    const visit = (row: PlanRow, path: readonly string[]): void => {
        if (ordered.includes(row) || path.includes(row.package)) return
        for (const name of requires(row)) {
            const sibling = due.find((candidate) => candidate.package === name)
            if (sibling !== undefined) visit(sibling, [...path, row.package])
        }
        ordered.push(row)
    }
    for (const row of due) visit(row, [])
    return [...ordered.filter((row) => row.dir !== HELD_DIR), ...ordered.filter((row) => row.dir === HELD_DIR)]
}

const versionOnRegistry = async (name: string, version: string, cwd: string): Promise<boolean> => {
    const view = await captureNpm(["view", `${name}@${version}`, "version"], cwd)
    return view.exitCode === 0 && view.stdout.trim() === version
}

/**
 * Refuses a plan that would publish a package against a sibling it does not ship with. A package due in this run requires every
 * sibling it names (dependencies and peerDependencies) at that sibling's version at this commit, on npm or due in the same run,
 * never private; the dependency and the version move in one commit. The held CLI instead requires each sibling at a version npm
 * serves (its lockfile installs from npm), the folder's or an older one, and is published after the siblings with its requirement
 * moved to the folder's version (publishHeld).
 */
const judgeRequires = async (rows: readonly PlanRow[], packages: readonly WorkspacePackage[], root: string): Promise<void> => {
    for (const row of rows.filter((candidate) => candidate.action === "publish")) {
        const requires = packages.find((pkg) => pkg.name === row.package)?.requires ?? {}
        for (const [name, spec] of Object.entries(requires)) {
            const sibling = rows.find((candidate) => candidate.package === name)
            if (sibling === undefined) continue
            if (sibling.action === "private") throw new Refusal("RELEASE_DEPENDENCY_UNPUBLISHED", `${row.package}@${row.version} requires ${name}@${spec}, which is private: it is neither on npm nor published by this run`)
            if (row.dir === HELD_DIR) {
                if (!(await versionOnRegistry(name, spec, root))) {
                    throw new Refusal("RELEASE_DEPENDENCY_SKEW", `${row.package}@${row.version} requires ${name}@${spec}, which npm does not serve; the CLI installs its siblings from npm, so it requires a published ${name} and CI moves it to ${sibling.version} when it publishes`)
                }
                continue
            }
            if (spec !== sibling.version) {
                throw new Refusal("RELEASE_DEPENDENCY_SKEW", `${row.package}@${row.version} requires ${name} ${spec}, but ${sibling.dir} is ${sibling.version} at this commit; set the requirement to ${sibling.version} in the commit that raises ${row.package}`)
            }
        }
    }
}

/** A path of a package folder under one of its test folders, which never ship. */
const TEST_FOLDER = /(?:^|\/)(?:test|tests|__tests__)\//
/** A spec or test file of a package folder, which never ships. */
const SPEC_FILE = /\.(?:spec|test)\.[cm]?[jt]sx?$/
/** Whether a path of a package folder never ships: its specs and test folders. */
const unshipped = (path: string): boolean => TEST_FOLDER.test(path) || SPEC_FILE.test(path)

/** The shipped files of the package folder `dir` that differ between `from` and HEAD; undefined when git cannot diff from `from`. */
const shippedChanges = async (root: string, from: string, dir: string): Promise<string[] | undefined> => {
    const diff = await captureGit(["diff", "--name-only", "--no-renames", "-z", from, "HEAD", "--", dir], root)
    if (diff.exitCode !== 0) return undefined
    return diff.stdout.split("\0").filter((path) => path !== "" && !unshipped(path.slice(dir.length + 1)))
}

/** The commit npm recorded for a published version (its `gitHead`), when this repository's history holds it. */
const publishedFrom = async (row: PlanRow, root: string): Promise<string | undefined> => {
    const view = await captureNpm(["view", `${row.package}@${row.version}`, "gitHead"], root)
    const sha = view.stdout.trim()
    if (view.exitCode !== 0 || !/^[0-9a-f]{40}$/.test(sha)) return undefined
    return (await isAncestor(root, sha, "HEAD")) ? sha : undefined
}

/**
 * Refuses a package whose shipped files changed while its version is already on npm, so a change never ships under an old number.
 * The packages judged are those changed since `base` (CI's plan base; empty: every package); each is compared with the commit npm
 * recorded for its published version, else with `base`; a package neither can measure is not judged.
 */
const judgeBumped = async (rows: readonly PlanRow[], root: string, base: string): Promise<void> => {
    const from = base.trim() === "" ? undefined : await resolveSha(root, base.trim()).catch(() => undefined)
    const stale = await Promise.all(
        rows
            .filter((row) => row.action === "published" && row.dir !== ".")
            .map(async (row): Promise<string | undefined> => {
                if (from !== undefined && (await shippedChanges(root, from, row.dir))?.length === 0) return undefined
                const since = (await publishedFrom(row, root)) ?? from
                if (since === undefined) return undefined
                const changed = await shippedChanges(root, since, row.dir)
                if (changed === undefined || changed.length === 0) return undefined
                return `${row.package}@${row.version} (${row.dir}: ${changed.slice(0, 3).join(", ")}${changed.length > 3 ? ", ..." : ""} changed since ${since.slice(0, 9)})`
            }),
    )
    const named = stale.filter((line): line is string => line !== undefined)
    if (named.length > 0) {
        throw new Refusal("RELEASE_VERSION_NOT_BUMPED", `already on npm, yet changed: ${named.join("; ")}; raise each version in its package.json and add its CHANGELOG entry`)
    }
}

const planOf = async (packages: readonly WorkspacePackage[], cwd: string): Promise<PlanRow[]> =>
    Promise.all(
        packages.map(async (pkg): Promise<PlanRow> => {
            const action = await actionOf(pkg, cwd)
            return { package: pkg.name, version: pkg.version, dir: pkg.relativeDir, distTag: distTagOf(pkg.version), action }
        }),
    )

/**
 * `starci release publish`: plans which package versions are missing from npm and judges the plan (each due package requires its
 * siblings at their versions here, published or due; with `--base`, no package changed since it is on npm at its old version); with
 * --publish it publishes them, a dependency before its dependent, from a clean commit on the remote main and reads each back. CI's
 * publish jobs run it on every push to main; from a workstation it is Debug's fallback.
 */
export const releasePublishVerb = defineVerb({
    path: ["release", "publish"],
    summary: "plan the npm publication of every package version not yet on the registry; --publish performs it and reads each back",
    editions: ["lite", "full"],
    effect: "publish",
    roles: ["owner", "release"],
    schema: "starci/release-publish@1",
    flags: {
        publish: { kind: "boolean", summary: "perform the plan (default: print it only)" },
        package: { kind: "string", summary: "only this package (its folder or name)" },
        base: { kind: "string", summary: "refuse RELEASE_VERSION_NOT_BUMPED for a package changed since this commit (empty: any package) whose version is on npm" },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        if (flags.publish) assertMayPushBranch(await currentBranch(root))
        const all = listPackages(root)
        const packages = all.filter((pkg) => flags.package === undefined || pkg.relativeDir === flags.package || pkg.name === flags.package)
        if (packages.length === 0) throw new Refusal("RELEASE_PACKAGE_UNKNOWN", `no package matches ${flags.package ?? "this repository"}`)
        const everyRow = await planOf(all, root)
        await judgeRequires(everyRow, all, root)
        if (flags.base !== undefined) await judgeBumped(everyRow, root, flags.base)
        const rows = everyRow.filter((row) => packages.some((pkg) => pkg.name === row.package))
        const due = publicationOrder(rows.filter((row) => row.action === "publish"), all)
        const published: string[] = []
        if (flags.publish && due.length > 0) {
            const dirty = await trackedChanges(root)
            if (dirty.length > 0) throw new Refusal("PUBLISH_DIRTY_TREE", "publish from a clean tree: the archive must equal the commit")
            await captureGit(["fetch", "--quiet", "origin", "main"], root)
            const head = await resolveSha(root, "HEAD")
            if (!(await refExists(root, "origin/main")) || !(await isAncestor(root, head, "origin/main"))) {
                throw new Refusal("PUBLISH_NOT_ON_REMOTE_MAIN", "push the commit first (starci release push); a published version must come from a commit on main")
            }
            await requireCiGreen(context, root, "release.publish", head)
            // Every package, not the --package selection: the held CLI moves its requirements to its siblings' folder versions.
            await publishDue(due, all, root, published)
        }
        const data: PublishData = { mode: flags.publish ? "publish" : "plan", rows, published }
        const table = formatTable([["PACKAGE", "VERSION", "TAG", "ACTION"], ...rows.map((row) => [row.package, row.version, row.distTag, row.action])])
        const summary = flags.publish ? `published ${String(published.length)} package(s)` : `${String(due.length)} to publish (plan only; add --publish)`
        return { data, message: `${table}\n${summary}` }
    },
})
