import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { Refusal } from "../../shared/errors.js"
import { captureTool } from "../../shared/exec.js"
import { git, isAncestor, refExists, repositoryRoot, resolveSha, trackedChanges } from "../../shared/git.js"
import { defineVerb } from "../../shared/verb.js"
import { requireCiGreen } from "../check/ci.js"
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

/** `starci release cut`: tags a commit that is already on the remote main with the package version and its CHANGELOG notes; it runs no suite. */
export const releaseCutVerb = defineVerb({
    path: ["release", "cut"],
    summary: "tag a commit already on the remote main as v<version> with its CHANGELOG notes and push the tag alone; it runs no suite and waits for a green CI when policy requires it",
    editions: ["lite", "full"],
    effect: "remote",
    roles: ["owner", "release"],
    schema: "starci/release-cut@1",
    flags: {
        package: { kind: "string", summary: "the package whose version is released (default: the root package, or the only package)" },
        remote: { kind: "string", summary: "the remote (default origin)" },
        "dry-run": { kind: "boolean", summary: "run every judgement but do not tag or push" },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const remote = flags.remote ?? "origin"
        const dryRun = flags["dry-run"]
        const pkg = choosePackage(root, flags.package)
        const tag = `v${pkg.version}`
        const dirty = await trackedChanges(root)
        if (dirty.length > 0) throw new Refusal("CUT_DIRTY_TREE", `commit or drop the tracked changes first: ${dirty.slice(0, 5).join(", ")}`)
        await captureTool("git", ["fetch", "--quiet", "--tags", remote, "main"], root)
        const commit = await resolveSha(root, "HEAD")
        if (!(await refExists(root, `${remote}/main`)) || !(await isAncestor(root, commit, `${remote}/main`))) {
            throw new Refusal("CUT_NOT_ON_REMOTE_MAIN", `push ${commit.slice(0, 9)} to ${remote}/main first (starci release push); a release tags a commit CI already sees`)
        }
        if (await refExists(root, `refs/tags/${tag}`)) throw new Refusal("CUT_TAG_EXISTS", `${tag} already exists; bump the version of ${pkg.name} first`)
        const changelogPath = [join(pkg.dir, "CHANGELOG.md"), join(root, "CHANGELOG.md")].find((path) => existsSync(path))
        if (changelogPath === undefined) throw new Refusal("CUT_NO_CHANGELOG", `add a CHANGELOG.md with a "## ${pkg.version}" section`)
        const notes = changelogSection(readFileSync(changelogPath, "utf8"), pkg.version)
        if (notes === undefined) throw new Refusal("CUT_NO_NOTES", `${changelogPath} has no "## ${pkg.version}" section`)
        const ci = await requireCiGreen(context, root, "release.cut", commit)
        if (!dryRun) {
            await git(root, ["tag", "-a", tag, commit, "-m", notes])
            await git(root, ["push", remote, `refs/tags/${tag}`])
        }
        const data: CutData = { package: pkg.name, version: pkg.version, tag, commit, changelog: changelogPath, pushed: !dryRun, dryRun, ci: ci?.verdict ?? "not required" }
        return { data, message: `${dryRun ? "would tag" : "tagged"} ${tag} on ${commit.slice(0, 9)} and ${dryRun ? "push" : "pushed"} the tag; CI judges it: starci release ci-status --sha ${commit}` }
    },
})
