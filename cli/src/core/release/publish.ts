import { Refusal } from "../../shared/errors.js"
import { captureNpm } from "../../shared/exec.js"
import { captureGit, currentBranch, isAncestor, refExists, repositoryRoot, resolveSha, trackedChanges } from "../../shared/git.js"
import { assertMayPushBranch } from "../pkg/edit.js"
import { formatTable } from "../../shared/output.js"
import { defineVerb } from "../../shared/verb.js"
import { requireCiGreen } from "../check/ci.js"
import { NPMJS_FLAGS } from "../deps/local-refs.js"
import { assertCliPins } from "../check/cli-pins.js"
import { SPEC_FILE } from "../../shared/spec-file.js"
import { listPackages } from "../../shared/workspace.js"
import type { WorkspacePackage } from "../../shared/workspace.js"
import { inOrder } from "../../harness/sequential.js"
import { GRAMMAR_PACKAGE, judgeGrammarBump } from "./grammar-bump.js"
import { meetsPin } from "./pin-range.js"

/** What publication does with one package. */
/** What publication does with one package: `unchanged` is a raised version whose content equals the version npm serves (skipped, never published). */
type Action = "publish" | "published" | "private" | "unchanged"

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
export const distTagOf = (version: string): string => /^\d+\.\d+\.\d+-([A-Za-z]+)/.exec(version)?.[1] ?? "latest"

const onRegistry = async (pkg: WorkspacePackage, cwd: string): Promise<boolean> => {
    const view = await captureNpm(["view", `${pkg.name}@${pkg.version}`, "version", ...NPMJS_FLAGS], cwd)
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

/** Runs `npm publish` for one row; the failure line when npm refuses it. Reading it back is the batch's (settleBatch). */
const publishRow = async (pkg: WorkspacePackage, row: PlanRow): Promise<string | undefined> => {
    // Provenance needs a CI identity (GitHub Actions OIDC): CI's publish job signs every tarball, Debug's fallback from a workstation goes without it.
    const provenance = process.env.GITHUB_ACTIONS === "true" ? ["--provenance"] : ["--provenance=false"]
    const run = await captureNpm(["publish", "--tag", row.distTag, ...provenance, ...NPMJS_FLAGS], pkg.dir)
    return run.exitCode === 0 ? undefined : `${row.package}@${row.version}: ${(run.stderr || run.stdout).split("\n").slice(-3).join(" ")}`
}

interface BatchOutcome {
    readonly published: readonly string[]
    readonly failed: readonly string[]
    readonly unconfirmed: readonly string[]
}

/**
 * Publishes a batch, then reads it back. Each row gets its own `npm publish` in order (a dependency before its dependent;
 * npm does not need the dependency readable to accept the dependent), and one refusal holds back only that row. Then every
 * published row is polled at once against one shared deadline, so the registry's delay is paid once per batch, not once per package.
 */
const settleBatch = async (rows: readonly PlanRow[], packages: readonly WorkspacePackage[], root: string): Promise<BatchOutcome> => {
    const failed: string[] = []
    const sent: { readonly row: PlanRow; readonly pkg: WorkspacePackage }[] = []
    await inOrder(rows, async (row) => {
        const pkg = packages.find((candidate) => candidate.name === row.package)
        if (pkg === undefined) return
        const refusal = await publishRow(pkg, row)
        if (refusal === undefined) sent.push({ row, pkg })
        else failed.push(refusal)
    })
    const deadline = Date.now() + REGISTRY_SETTLE_MS
    const read = await Promise.all(sent.map(async ({ row, pkg }) => ({ name: `${row.package}@${row.version}`, served: await settledOnRegistry(pkg, root, deadline) })))
    return { published: read.filter((item) => item.served).map((item) => item.name), failed, unconfirmed: read.filter((item) => !item.served).map((item) => item.name) }
}

/**
 * The package held for the second phase: the CLI. Every CI job installs it from its lockfile, which can name only versions npm
 * already serves, so it is published after the siblings, as its commit stands: its @starci requirements and lockfile at their
 * stack pins (assertCliPins), each a version npm serves (judgeRequires).
 */
const HELD_DIR = "cli"

/**
 * Publishes the due rows: the siblings as one batch, then the held CLI at its pins once npm serves them (its lockfile installs
 * from npm). Every row gets its attempt; the refusal afterwards names each one npm refused or never served, and a rerun
 * publishes what is left.
 */
const publishDue = async (due: readonly PlanRow[], packages: readonly WorkspacePackage[], root: string, published: string[]): Promise<void> => {
    const siblings = await settleBatch(due.filter((row) => row.dir !== HELD_DIR), packages, root)
    published.push(...siblings.published)
    const held = due.filter((row) => row.dir === HELD_DIR)
    const blocked = siblings.failed.length > 0 || siblings.unconfirmed.length > 0
    if (held.length > 0 && !blocked) assertCliPins(root)
    const cli = held.length > 0 && !blocked ? await settleBatch(held, packages, root) : { published: [], failed: [], unconfirmed: [] }
    published.push(...cli.published)
    const failed = [...siblings.failed, ...cli.failed]
    const unconfirmed = [...siblings.unconfirmed, ...cli.unconfirmed]
    if (failed.length > 0) throw new Refusal("PUBLISH_FAILED", `npm publish failed: ${failed.join("; ")}${held.length > 0 && blocked ? "; the CLI waits for its siblings" : ""}`)
    if (unconfirmed.length > 0) throw new Refusal("PUBLISH_NOT_CONFIRMED", `not readable on the registry ${String(REGISTRY_SETTLE_MS / 1000)} s after publishing: ${unconfirmed.join(", ")}`)
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
    const view = await captureNpm(["view", `${name}@${version}`, "version", ...NPMJS_FLAGS], cwd)
    return view.exitCode === 0 && view.stdout.trim() === version
}

/**
 * Refuses a plan that would publish a package against a sibling it does not ship with. A package due in this run requires every
 * sibling it names (dependencies and peerDependencies) at that sibling's version at this commit, on npm or due in the same run,
 * never private; the dependency and the version move in one commit. The held CLI instead requires each sibling at a version npm
 * already serves (its lockfile installs from npm); that it is the sibling's stack pin is judged in the CLI's own phase
 * (assertCliPins), so a CLI waiting on a sibling never holds the packages that sibling is published with.
 */
const judgeRequires = async (rows: readonly PlanRow[], packages: readonly WorkspacePackage[], root: string): Promise<void> => {
    await inOrder(rows.filter((candidate) => candidate.action === "publish"), async (row) => {
        const requires = packages.find((pkg) => pkg.name === row.package)?.requires ?? {}
        await inOrder(Object.entries(requires), async ([name, spec]) => {
            const sibling = rows.find((candidate) => candidate.package === name)
            if (sibling === undefined) return
            if (sibling.action === "private") throw new Refusal("RELEASE_DEPENDENCY_UNPUBLISHED", `${row.package}@${row.version} requires ${name}@${spec}, which is private: it is neither on npm nor published by this run`)
            if (sibling.action === "unchanged" && meetsPin(spec, sibling.version)) throw new Refusal("RELEASE_DEPENDENCY_UNPUBLISHED", `${row.package}@${row.version} requires ${name}@${spec}, but ${sibling.dir} ships what npm already serves, so ${sibling.version} is never published; drop that raise and require the served version (or its same-minor range)`)
            if (row.dir === HELD_DIR) {
                if (!(await versionOnRegistry(name, spec, root))) {
                    throw new Refusal("RELEASE_DEPENDENCY_SKEW", `${row.package}@${row.version} requires ${name}@${spec}, which npm does not serve; the CLI installs its siblings from npm, so it moves to ${sibling.version} once npm serves it`)
                }
                return
            }
            // A same-minor range (`~0.21.38`, the Grammar family) is met by any patch of it at this commit; every other requirement is exact.
            if (!meetsPin(spec, sibling.version)) {
                throw new Refusal("RELEASE_DEPENDENCY_SKEW", `${row.package}@${row.version} requires ${name} ${spec}, but ${sibling.dir} is ${sibling.version} at this commit; set the requirement to ${sibling.version} in the commit that raises ${row.package}`)
            }
        })
    })
}

/** A path of a package folder under one of its test folders, which never ship. */
const TEST_FOLDER = /(?:^|\/)(?:test|tests|__tests__)\//
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
    const view = await captureNpm(["view", `${row.package}@${row.version}`, "gitHead", ...NPMJS_FLAGS], root)
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
            const row: PlanRow = { package: pkg.name, version: pkg.version, dir: pkg.relativeDir, distTag: distTagOf(pkg.version), action }
            return action === "publish" && (await sameAsServed(row, cwd)) ? { ...row, action: "unchanged" } : row
        }),
    )

/** The files a version raise touches without changing what a package ships: its CHANGELOG and lockfile, and package.json once its version fields are set aside. */
const BOOKKEEPING = new Set(["CHANGELOG.md", "package-lock.json"])
const withoutVersion = (text: string | undefined): string | undefined => {
    if (text === undefined) return undefined
    try {
        const manifest = JSON.parse(text) as Record<string, unknown>
        delete manifest.version
        return JSON.stringify(manifest)
    } catch {
        return text
    }
}

/**
 * True when a package due at a raised version ships what the version npm serves under its dist-tag ships (CONTRIBUTING.md CONTRIB-20): the
 * shipped files of its folder differ since that version's commit (its gitHead) only by bookkeeping, the CHANGELOG, the lockfile and the version field.
 * Such a raise is skipped, never published: only a package whose content moved gets a version. Unknowable (no served version, no recorded commit) is a change.
 */
const sameAsServed = async (row: PlanRow, root: string): Promise<boolean> => {
    if (row.dir === ".") return false
    const served = await captureNpm(["view", row.package, `dist-tags.${row.distTag}`, ...NPMJS_FLAGS], root)
    const version = served.stdout.trim()
    if (served.exitCode !== 0 || version === "" || version === row.version) return false
    const from = await publishedFrom({ ...row, version }, root)
    if (from === undefined) return false
    return shipsTheSame(root, from, row.dir)
}

/** True when the shipped files of `dir` differ between `from` and HEAD only by bookkeeping (the CHANGELOG, the lockfile, the version field). */
export const shipsTheSame = async (root: string, from: string, dir: string): Promise<boolean> => {
    const changed = await shippedChanges(root, from, dir)
    if (changed === undefined) return false
    for (const path of changed) {
        const name = path.slice(dir.length + 1)
        if (BOOKKEEPING.has(name)) continue
        if (name !== "package.json") return false
        const before = (await captureGit(["show", `${from}:${path}`], root)).stdout
        const after = (await captureGit(["show", `HEAD:${path}`], root)).stdout
        if (withoutVersion(before) !== withoutVersion(after)) return false
    }
    return true
}

/**
 * The plan judgement of CI's publish step, one function for `release publish` and `release push`: every package's row, the
 * sibling requirements of each due package, and with a base the packages changed since it that are already on npm.
 */
export const judgePlan = async (root: string, packages: readonly WorkspacePackage[], base: string | undefined): Promise<PlanRow[]> => {
    const rows = await planOf(packages, root)
    await judgeRequires(rows, packages, root)
    if (base !== undefined) await judgeBumped(rows, root, base)
    // A Grammar patch reaches apps inside the canon pins' range alone, so a change of a minor's kind refuses a patch bump (contexts/grammars/contributing.md "Patch or minor").
    await judgeGrammarBump(root, rows.find((row) => row.package === GRAMMAR_PACKAGE))
    return rows
}

/**
 * `starci release publish`: plans which package versions are missing from npm and judges the plan (each due package requires its
 * siblings at their versions here, published or due; with `--base`, no package changed since it is on npm at its old version); with
 * --execute it publishes them, a dependency before its dependent, from a clean commit on the remote main and reads each back. CI's
 * publish jobs run it on every push to main; from a workstation it is Debug's fallback.
 */
export const releasePublishVerb = defineVerb({
    path: ["release", "publish"],
    summary: "plan the npm publication of every package version not yet on the registry; --execute performs it and reads each back",
    editions: ["lite", "full"],
    effect: "publish",
    roles: ["owner", "release"],
    schema: "starci/release-publish@1",
    flags: {
        execute: { kind: "boolean", summary: "perform the plan (default: a dry run that prints it only)" },
        package: { kind: "list", summary: "only these packages (a folder or name; repeat for several, published as one batch)" },
        base: { kind: "string", summary: "refuse RELEASE_VERSION_NOT_BUMPED for a package changed since this commit (empty: any package) whose version is on npm" },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        if (flags.execute) assertMayPushBranch(await currentBranch(root))
        const all = listPackages(root)
        const named = flags.package
        const packages = all.filter((pkg) => named.length === 0 || named.includes(pkg.relativeDir) || named.includes(pkg.name))
        const unknown = named.filter((name) => !all.some((pkg) => pkg.relativeDir === name || pkg.name === name))
        if (unknown.length > 0 || packages.length === 0) throw new Refusal("RELEASE_PACKAGE_UNKNOWN", `no package matches ${unknown.length > 0 ? unknown.join(", ") : "this repository"}`)
        const everyRow = await judgePlan(root, all, flags.base)
        const rows = everyRow.filter((row) => packages.some((pkg) => pkg.name === row.package))
        const due = publicationOrder(rows.filter((row) => row.action === "publish"), all)
        // The CLI's own phase (CI's publish-cli plans it alone): a due CLI is judged at its stack pins before it is planned.
        if (packages.every((pkg) => pkg.relativeDir === HELD_DIR) && due.length > 0) assertCliPins(root)
        const published: string[] = []
        if (flags.execute && due.length > 0) {
            const dirty = await trackedChanges(root)
            if (dirty.length > 0) throw new Refusal("PUBLISH_DIRTY_TREE", "publish from a clean tree: the archive must equal the commit")
            await captureGit(["fetch", "--quiet", "origin", "main"], root)
            const head = await resolveSha(root, "HEAD")
            if (!(await refExists(root, "origin/main")) || !(await isAncestor(root, head, "origin/main"))) {
                throw new Refusal("PUBLISH_NOT_ON_REMOTE_MAIN", "push the commit first (starci release push --execute); a published version must come from a commit on main")
            }
            await requireCiGreen(context, root, "release.publish", head)
            await publishDue(due, all, root, published)
        }
        const data: PublishData = { mode: flags.execute ? "publish" : "plan", rows, published }
        const table = formatTable([["PACKAGE", "VERSION", "TAG", "ACTION"], ...rows.map((row) => [row.package, row.version, row.distTag, row.action])])
        const summary = flags.execute ? `published ${String(published.length)} package(s)` : `${String(due.length)} to publish (plan only; add --execute)`
        return { data, message: `${table}\n${summary}` }
    },
})
