import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { Refusal } from "../../shared/errors.js"
import { captureGit, git, isAncestor, refExists, repositoryRoot, resolveSha, trackedChanges } from "../../shared/git.js"
import { defineVerb } from "../../shared/verb.js"
import { requireCiGreen } from "../check/ci.js"
import { judgePush } from "../deps/push-gate.js"
import { choosePackage } from "./package-choice.js"

interface CutData {
    readonly package: string
    readonly version: string
    readonly tag: string
    readonly commit: string
    readonly changelog: string
    readonly pushed: boolean
    readonly dryRun: boolean
    readonly ci: string
    /** The fixed sha `--from` named, cut in its own temporary worktree; undefined when the checkout's HEAD was cut. */
    readonly from?: string
}

const escapeRegExp = (text: string): string => text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)

/** The CHANGELOG section of `version`: from its `## ` heading to the next `## ` heading. */
const changelogSection = (text: string, version: string): string | undefined => {
    const heading = new RegExp(String.raw`^## \[?v?${escapeRegExp(version)}\]?(?:\s|$)`, "m")
    const start = heading.exec(text)
    if (start === null) return undefined
    const rest = text.slice(start.index)
    const next = /^## /m.exec(rest.slice(3))
    return (next === null ? rest : rest.slice(0, next.index + 3)).trim()
}

/** The sha `--from` names (a full or short sha, a tag, any revision of the repository), resolved to its full commit. */
const fixedSha = async (root: string, from: string): Promise<string> => {
    const run = await captureGit(["rev-parse", "--verify", "--quiet", `${from}^{commit}`], root)
    if (run.exitCode !== 0 || run.stdout.trim() === "") throw new Refusal("CUT_FROM_UNKNOWN", `${from} names no commit of ${root} (fetch it first, or pass the full sha)`)
    return run.stdout.trim()
}

/**
 * Runs `cut` in a temporary detached worktree of `root` at `commit` and removes the worktree after, whatever happens: a release cut from a
 * fixed sha never moves, checks out or dirties the checkout it is called from (the app's dev checkout keeps serving dev).
 */
export const inReleaseWorktree = async <T>(root: string, commit: string, cut: (tree: string) => Promise<T>): Promise<T> => {
    const parent = mkdtempSync(join(tmpdir(), "starci-release-"))
    const tree = join(parent, "tree")
    try {
        const added = await captureGit(["worktree", "add", "--detach", "--quiet", tree, commit], root)
        if (added.exitCode !== 0) throw new Refusal("CUT_WORKTREE", `git worktree add ${tree} ${commit.slice(0, 9)}: ${added.stderr.trim()}`)
        return await cut(tree)
    } finally {
        await captureGit(["worktree", "remove", "--force", tree], root)
        rmSync(parent, { recursive: true, force: true })
        await captureGit(["worktree", "prune"], root)
    }
}

/**
 * `starci release cut`: tags a commit that is already on the remote main with the package version and its CHANGELOG notes; it runs no suite.
 * `--from <sha>` cuts that fixed sha in a temporary worktree (cleaned after), so the prod path never moves or waits on the dev checkout.
 */
export const releaseCutVerb = defineVerb({
    path: ["release", "cut"],
    summary: "tag a commit already on the remote main as v<version> with its CHANGELOG notes and push the tag alone (dry until --execute); it runs no suite and waits for a green CI (or, with --urgent, the commit's urgent record) when policy requires it",
    effect: "remote",
    roles: ["owner", "release", "debug"],
    schema: "starci/release-cut@1",
    flags: {
        package: { kind: "string", summary: "the package whose version is released (default: the root package, or the only package)" },
        remote: { kind: "string", summary: "the remote (default origin)" },
        execute: { kind: "boolean", summary: "tag and push for real (default: a dry run that runs every judgement and tags nothing)" },
        from: { kind: "string", summary: "cut this fixed sha (on the remote main) in its own temporary worktree, removed after: prod work never moves the dev checkout (default: this checkout's HEAD)" },
        urgent: { kind: "boolean", summary: "accept the commit's pushed urgent record (starci app release push --urgent) in place of a green CI (contexts/project/cicd.md \"The urgent path\")" },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const remote = flags.remote ?? "origin"
        const dryRun = !flags.execute
        if (flags.from === undefined) {
            const dirty = await trackedChanges(root)
            if (dirty.length > 0) throw new Refusal("CUT_DIRTY_TREE", `commit or drop the tracked changes first: ${dirty.slice(0, 5).join(", ")} (or cut a fixed sha with --from <sha>, which never touches this checkout)`)
        }
        await captureGit(["fetch", "--quiet", "--tags", remote, "main"], root)
        const commit = flags.from === undefined ? await resolveSha(root, "HEAD") : await fixedSha(root, flags.from)
        const cut = async (tree: string): Promise<CutData> => {
            const pkg = choosePackage(tree, flags.package)
            const tag = `v${pkg.version}`
            await judgePush(tree)
            if (!(await refExists(root, `${remote}/main`)) || !(await isAncestor(root, commit, `${remote}/main`))) {
                throw new Refusal("CUT_NOT_ON_REMOTE_MAIN", `push ${commit.slice(0, 9)} to ${remote}/main first (starci release push --execute); a release tags a commit CI already sees`)
            }
            if (await refExists(root, `refs/tags/${tag}`)) throw new Refusal("CUT_TAG_EXISTS", `${tag} already exists; bump the version of ${pkg.name} first`)
            const changelogPath = [join(pkg.dir, "CHANGELOG.md"), join(tree, "CHANGELOG.md")].find((path) => existsSync(path))
            if (changelogPath === undefined) throw new Refusal("CUT_NO_CHANGELOG", `add a CHANGELOG.md with a "## ${pkg.version}" section`)
            const notes = changelogSection(readFileSync(changelogPath, "utf8"), pkg.version)
            if (notes === undefined) throw new Refusal("CUT_NO_NOTES", `${changelogPath} has no "## ${pkg.version}" section`)
            const ci = await requireCiGreen(context, root, "release.cut", commit, { urgent: flags.urgent })
            if (!dryRun) {
                await git(root, ["tag", "-a", tag, commit, "-m", notes])
                await git(root, ["push", remote, `refs/tags/${tag}`])
            }
            const changelog = flags.from === undefined ? changelogPath : `${commit.slice(0, 9)}:${relative(tree, changelogPath).replaceAll("\\", "/")}`
            return { package: pkg.name, version: pkg.version, tag, commit, changelog, pushed: !dryRun, dryRun, ci: ci?.verdict ?? "not required", ...(flags.from === undefined ? {} : { from: commit }) }
        }
        const data = flags.from === undefined ? await cut(root) : await inReleaseWorktree(root, commit, cut)
        const where = flags.from === undefined ? "" : " (cut from the fixed sha in a temporary worktree, removed again; this checkout did not move)"
        return { data, message: `${dryRun ? "would tag" : "tagged"} ${data.tag} on ${commit.slice(0, 9)} and ${dryRun ? "push" : "pushed"} the tag${where}${dryRun ? " (dry run; add --execute)" : ""}; CI judges it: starci check ci --sha ${commit}` }
    },
})
