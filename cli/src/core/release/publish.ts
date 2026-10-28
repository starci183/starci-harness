import { Refusal } from "../../shared/errors.js"
import { captureNpm } from "../../shared/exec.js"
import { captureGit, isAncestor, refExists, repositoryRoot, resolveSha, trackedChanges } from "../../shared/git.js"
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

const publishRow = async (row: PlanRow, packages: readonly WorkspacePackage[], root: string): Promise<string | undefined> => {
    const pkg = packages.find((candidate) => candidate.name === row.package)
    if (pkg === undefined) return undefined
    const run = await captureNpm(["publish", "--tag", row.distTag], pkg.dir)
    if (run.exitCode !== 0) throw new Refusal("PUBLISH_FAILED", `npm publish of ${row.package}@${row.version} failed: ${(run.stderr || run.stdout).split("\n").slice(-3).join(" ")}`)
    if (!(await onRegistry(pkg, root))) throw new Refusal("PUBLISH_NOT_CONFIRMED", `${row.package}@${row.version} is not readable on the registry after publishing`)
    return `${row.package}@${row.version}`
}

/** Publishes the due rows one after the other (npm publishes stay ordered); stops at the first refusal. */
const publishDue = async (due: readonly PlanRow[], packages: readonly WorkspacePackage[], root: string, published: string[]): Promise<void> => {
    await due.reduce(async (previous, row) => {
        await previous
        const done = await publishRow(row, packages, root)
        if (done !== undefined) published.push(done)
    }, Promise.resolve())
}

/** The due rows in publication order: a row after every due sibling it requires, so a dependency reaches npm before its dependent. */
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
    return ordered
}

/**
 * Refuses a plan that would publish a package against a sibling it does not ship with: each package due in this run requires every
 * sibling it names (dependencies and peerDependencies) at that sibling's version at this commit, and a sibling at that version is
 * on npm or due in the same run, never private. Bumping a package's version before the sibling it requires is how a CLI reached npm
 * on an older @starci/hfs; the dependency and the version move in one commit.
 */
const judgeRequires = (rows: readonly PlanRow[], packages: readonly WorkspacePackage[]): void => {
    for (const row of rows.filter((candidate) => candidate.action === "publish")) {
        const requires = packages.find((pkg) => pkg.name === row.package)?.requires ?? {}
        for (const [name, spec] of Object.entries(requires)) {
            const sibling = rows.find((candidate) => candidate.package === name)
            if (sibling === undefined) continue
            if (spec !== sibling.version) {
                throw new Refusal("RELEASE_DEPENDENCY_SKEW", `${row.package}@${row.version} requires ${name} ${spec}, but ${sibling.dir} is ${sibling.version} at this commit; set the requirement to ${sibling.version} in the commit that raises ${row.package}`)
            }
            if (sibling.action === "private") throw new Refusal("RELEASE_DEPENDENCY_UNPUBLISHED", `${row.package}@${row.version} requires ${name}@${spec}, which is private: it is neither on npm nor published by this run`)
        }
    }
}

/**
 * Refuses a release tag that publishes nothing new: `tag` (refs/tags/ optional) is the `v<version>` `release cut` pushes, so some
 * package carries that version, and at least one that does is not on npm yet. A tag naming no version, or one already published
 * (a CLI version republished), is refused.
 */
const judgeTag = (rows: readonly PlanRow[], tag: string): void => {
    const name = tag.replace(/^refs\/tags\//, "")
    const named = rows.filter((row) => `v${row.version}` === name && row.action !== "private")
    if (named.length === 0) throw new Refusal("RELEASE_TAG_UNKNOWN", `${name} names no public package version; a release tag is v<version> of the package it releases (starci release cut)`)
    if (named.every((row) => row.action === "published")) {
        throw new Refusal("RELEASE_ALREADY_PUBLISHED", `${name} releases ${named.map((row) => `${row.package}@${row.version}`).join(", ")}, already on npm; raise the version before tagging`)
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
 * siblings at their versions here, published or due; `--tag` names a version not on npm yet); with --publish it publishes them, a
 * dependency before its dependent, from a clean commit on the remote main and reads each back. CI's publish job runs the plan first.
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
        tag: { kind: "string", summary: "the release tag being published (v<version>): refused unless a package at that version is not on npm yet" },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const all = listPackages(root)
        const packages = all.filter((pkg) => flags.package === undefined || pkg.relativeDir === flags.package || pkg.name === flags.package)
        if (packages.length === 0) throw new Refusal("RELEASE_PACKAGE_UNKNOWN", `no package matches ${flags.package ?? "this repository"}`)
        const everyRow = await planOf(all, root)
        judgeRequires(everyRow, all)
        if (flags.tag !== undefined) judgeTag(everyRow, flags.tag)
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
            await publishDue(due, packages, root, published)
        }
        const data: PublishData = { mode: flags.publish ? "publish" : "plan", rows, published }
        const table = formatTable([["PACKAGE", "VERSION", "TAG", "ACTION"], ...rows.map((row) => [row.package, row.version, row.distTag, row.action])])
        const summary = flags.publish ? `published ${String(published.length)} package(s)` : `${String(due.length)} to publish (plan only; add --publish)`
        return { data, message: `${table}\n${summary}` }
    },
})
