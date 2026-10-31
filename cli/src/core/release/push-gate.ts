import { existsSync } from "node:fs"
import { join } from "node:path"
import { Refusal } from "../../shared/errors.js"
import { runTool } from "../../shared/exec.js"
import { isAncestor, refExists } from "../../shared/git.js"
import { listPackages } from "../../shared/workspace.js"
import { EVAL_FILE, checkAnchors, loadAnchors } from "../contexts/anchors.js"
import { judgePlan } from "./publish.js"

/** Whether the checkout is the harness repository itself: the CLI, the contexts it reads and the packages it publishes. */
export const isHarnessCheckout = (root: string): boolean => existsSync(join(root, "cli", "package.json")) && existsSync(join(root, "contexts", "README.md")) && existsSync(join(root, "packages"))

/**
 * The base CI's plan measures this push from (the `base` step of ci.yml): the head of the last successful CI run on main when
 * this history holds it, else (GitHub cannot be asked, or the run is off this history) the remote tip being pushed over (a
 * narrower range than CI's, never a wider one), and with no remote tip nothing, so every package is judged.
 */
export const ciBase = async (root: string, head: string, previous: string | null): Promise<{ readonly base: string; readonly from: string }> => {
    try {
        const listed = await runTool("gh", ["api", "repos/{owner}/{repo}/actions/workflows/ci.yml/runs?branch=main&event=push&status=success&per_page=1", "--jq", ".workflow_runs[0].head_sha // empty"], root)
        const sha = listed.stdout.trim()
        if (/^[0-9a-f]{40}$/.test(sha) && (await refExists(root, sha)) && (await isAncestor(root, sha, head))) return { base: sha, from: "the last successful CI run on main" }
    } catch {
        // GitHub could not be asked: the remote tip stands in below.
    }
    return { base: previous ?? "", from: previous === null ? "no remote tip (every package judged)" : "the remote tip (GitHub could not name CI's base)" }
}

/**
 * What `release push` judges in the harness repository before it pushes, the light gates CI refuses a push on: the publish
 * plan of ci.yml's `publish-packages` step against the base CI would use (RELEASE_VERSION_NOT_BUMPED, RELEASE_DEPENDENCY_SKEW,
 * RELEASE_DEPENDENCY_UNPUBLISHED) and the contexts anchors (no duplicate, no dangling link: PUSH_ANCHORS_RED).
 */
export const judgeHarnessPush = async (root: string, head: string, previous: string | null): Promise<string> => {
    const { base, from } = await ciBase(root, head, previous)
    await judgePlan(root, listPackages(root), base)
    const report = checkAnchors(loadAnchors(root), { file: join(root, EVAL_FILE), label: EVAL_FILE.replaceAll("\\", "/") })
    const red = [...report.duplicates.map((item) => `ANCHOR_DUPLICATE ${item.id}: ${item.places.join(", ")}`), ...report.dangling.map((item) => `ANCHOR_DANGLING ${item.ref} (named at ${item.from}:${String(item.line)})`)]
    if (red.length > 0) throw new Refusal("PUSH_ANCHORS_RED", `contexts anchors are red, CI's gate would refuse: ${red.slice(0, 10).join("; ")}${red.length > 10 ? `; and ${String(red.length - 10)} more` : ""}`)
    return `publish plan judged against ${base === "" ? "every package" : base.slice(0, 9)} (${from}); anchors green`
}
