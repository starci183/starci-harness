import { Refusal } from "../../shared/errors.js"
import { captureNpm, captureTool } from "../../shared/exec.js"
import { isAncestor, refExists, repositoryRoot, resolveSha, trackedChanges } from "../../shared/git.js"
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

const planOf = async (packages: readonly WorkspacePackage[], cwd: string): Promise<PlanRow[]> =>
    Promise.all(
        packages.map(async (pkg): Promise<PlanRow> => {
            const action = await actionOf(pkg, cwd)
            return { package: pkg.name, version: pkg.version, dir: pkg.relativeDir, distTag: distTagOf(pkg.version), action }
        }),
    )

/** `starci release publish`: plans which package versions are missing from npm; with --publish it publishes them from a clean commit on the remote main and reads each back. */
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
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const packages = listPackages(root).filter((pkg) => flags.package === undefined || pkg.relativeDir === flags.package || pkg.name === flags.package)
        if (packages.length === 0) throw new Refusal("RELEASE_PACKAGE_UNKNOWN", `no package matches ${flags.package ?? "this repository"}`)
        const rows = await planOf(packages, root)
        const due = rows.filter((row) => row.action === "publish")
        const published: string[] = []
        if (flags.publish && due.length > 0) {
            const dirty = await trackedChanges(root)
            if (dirty.length > 0) throw new Refusal("PUBLISH_DIRTY_TREE", "publish from a clean tree: the archive must equal the commit")
            await captureTool("git", ["fetch", "--quiet", "origin", "main"], root)
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
