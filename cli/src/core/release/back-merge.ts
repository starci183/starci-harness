import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { configuredSlotRoot, takeLiveLock } from "../../harness/slots.js"
import { holderLine, landPaths, releaseLockFile } from "../../harness/lane-state.js"
import { lockScope, profileNameFor } from "../../harness/land-profile.js"
import { Refusal } from "../../shared/errors.js"
import { captureGit, repositoryRoot } from "../../shared/git.js"
import { defineVerb } from "../../shared/verb.js"

/**
 * The main -> dev back-merge of a release train. A train lands dev on main (the FULL gate, then `release push`), and `release publish` (publish.yml)
 * may add one commit on main after it, the cli-follow commit that moves the CLI onto the pins npm now serves. That commit, and anything else main
 * holds that dev lacks, comes back to dev at once, so main stays an ancestor of dev and the two lines never drift.
 */

/** The git seam of the back-merge: a spec drives it without a repository. */
export type BackMergeGit = (cwd: string, args: readonly string[]) => Promise<{ readonly ok: boolean; readonly out: string; readonly err: string }>

const realGit: BackMergeGit = async (cwd, args) => {
    const run = await captureGit(args, cwd)
    return { ok: run.exitCode === 0, out: run.stdout.trim(), err: run.stderr.trim() }
}

/** How dev stands to main: holding it already, behind it only (a fast-forward), or apart (a merge commit). */
export type BackMergeKind = "in-sync" | "fast-forward" | "merge"

/** What a back-merge found and did. */
export interface BackMerge {
    readonly remote: string
    readonly main: string
    readonly dev: string
    readonly kind: BackMergeKind
    /** The commits main holds that dev lacks, newest first, as `<sha> <subject>`. */
    readonly missing: readonly string[]
    /** The dev commit pushed, when executed and needed. */
    readonly pushed?: string
    readonly dryRun: boolean
}

/** The message of a back-merge commit. Pure. */
export const backMergeMessage = (main: string, missing: readonly string[]): string =>
    [`back-merge main ${main.slice(0, 10)} into dev (release train)`, "", ...missing.map((line) => `- ${line}`)].join("\n")

/**
 * Reads where dev stands to main on `remote` (after a fetch) and, with `execute`, brings main into dev: a dev that main already holds is pushed to
 * main's commit (a fast-forward), a dev apart from main gets a merge commit made in a temporary worktree at dev (a conflict there refuses
 * RELEASE_BACKMERGE_CONFLICT with its files and pushes nothing), and the push is `git push <remote> <commit>:refs/heads/dev`, which git refuses when
 * dev moved meanwhile (run it again). A dev already holding main changes nothing.
 */
export const backMerge = async (given: { readonly root: string; readonly remote?: string | undefined; readonly execute: boolean; readonly git?: BackMergeGit; readonly scratch?: () => string; readonly say?: (line: string) => void }): Promise<BackMerge> => {
    const { root, execute } = given
    const remote = given.remote ?? "origin"
    const git = given.git ?? realGit
    const say = given.say ?? (() => undefined)
    const fetched = await git(root, ["fetch", "--quiet", remote, "main", "dev"])
    if (!fetched.ok) throw new Refusal("RELEASE_BACKMERGE_FETCH", `git fetch ${remote} main dev: ${fetched.err}`)
    const main = (await git(root, ["rev-parse", `${remote}/main`])).out
    const dev = (await git(root, ["rev-parse", `${remote}/dev`])).out
    if (main === "" || dev === "") throw new Refusal("RELEASE_BACKMERGE_NO_BRANCH", `${remote} needs both main and dev (main ${main || "missing"}, dev ${dev || "missing"})`)
    const holds = async (ancestor: string, descendant: string): Promise<boolean> => (await git(root, ["merge-base", "--is-ancestor", ancestor, descendant])).ok
    const listed = (await git(root, ["log", "--format=%h %s", `${dev}..${main}`])).out
    const missing = listed === "" ? [] : listed.split("\n")
    const kind: BackMergeKind = (await holds(main, dev)) ? "in-sync" : (await holds(dev, main)) ? "fast-forward" : "merge"
    const result = { remote, main, dev, kind, missing, dryRun: !execute }
    if (!execute || kind === "in-sync") return result
    if (kind === "fast-forward") {
        const pushed = await git(root, ["push", remote, `${main}:refs/heads/dev`])
        if (!pushed.ok) throw new Refusal("RELEASE_BACKMERGE_PUSH", `git push ${remote} ${main.slice(0, 10)}:dev: ${pushed.err} (dev moved? run it again)`)
        say(`dev fast-forwarded to main ${main.slice(0, 10)}`)
        return { ...result, pushed: main }
    }
    const tree = (given.scratch ?? (() => join(mkdtempSync(join(tmpdir(), "starci-back-merge-")), "dev")))()
    const added = await git(root, ["worktree", "add", "--detach", tree, dev])
    if (!added.ok) throw new Refusal("RELEASE_BACKMERGE_WORKTREE", `git worktree add ${tree}: ${added.err}`)
    try {
        const merged = await git(tree, ["merge", "--no-ff", "--no-edit", "-m", backMergeMessage(main, missing), main])
        if (!merged.ok) {
            const files = (await git(tree, ["diff", "--name-only", "--diff-filter=U"])).out.split("\n").filter((file) => file !== "")
            await git(tree, ["merge", "--abort"])
            throw new Refusal("RELEASE_BACKMERGE_CONFLICT", `merging main ${main.slice(0, 10)} into dev ${dev.slice(0, 10)} conflicts${files.length > 0 ? ` in ${files.join(", ")}` : `: ${merged.err}`}; resolve it in a lane off dev that merges origin/main, and land it`)
        }
        const commit = (await git(tree, ["rev-parse", "HEAD"])).out
        const pushed = await git(tree, ["push", remote, `${commit}:refs/heads/dev`])
        if (!pushed.ok) throw new Refusal("RELEASE_BACKMERGE_PUSH", `git push ${remote} ${commit.slice(0, 10)}:dev: ${pushed.err} (dev moved? run it again)`)
        say(`merged main ${main.slice(0, 10)} into dev as ${commit.slice(0, 10)}`)
        return { ...result, pushed: commit }
    } finally {
        await git(root, ["worktree", "remove", "--force", tree])
        if (given.scratch === undefined) rmSync(dirname(tree), { recursive: true, force: true })
    }
}

/**
 * `starci release back-merge`: main -> dev after a release train (contexts/project/branches.md PROJECT-BRANCH-3). Dry until --execute. While it pushes
 * it holds the dev lock of the lanes folder (when one is configured), so it never races a landing's push of dev.
 */
export const releaseBackMergeVerb = defineVerb({
    path: ["release", "back-merge"],
    summary: "bring main back into dev after a release train (the cli-follow commit and anything else dev lacks): a fast-forward when dev is behind, else a merge commit made in a temporary worktree, pushed to dev under the dev lock; dry until --execute",
    effect: "remote",
    roles: ["owner", "release", "coordinator", "lead"],
    schema: "starci/release-back-merge@1",
    flags: {
        remote: { kind: "string", summary: "the remote holding main and dev (default origin)" },
        dir: { kind: "string", summary: "the lanes folder whose dev lock the push holds (default: STARCI_LANES_DIR, else slots.root; none configured: no lock)" },
        execute: { kind: "boolean", summary: "merge and push dev (default: report how dev stands to main only)" },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const dir = flags.dir ?? configuredSlotRoot()
        const lock = flags.execute && dir !== undefined && dir !== "" ? landPaths(dir, lockScope(profileNameFor(root, undefined))).devLock : undefined
        if (lock !== undefined && !takeLiveLock(lock, holderLine(), context.progress)) throw new Refusal("RELEASE_BACKMERGE_LOCKED", `${lock} is held (a landing is pushing dev): run it again in a moment`)
        try {
            const data = await backMerge({ root, remote: flags.remote, execute: flags.execute, say: context.progress })
            const what = data.kind === "in-sync" ? "dev already holds main: nothing to merge" : `${String(data.missing.length)} commit(s) on main that dev lacks (${data.kind})`
            const done = data.pushed === undefined ? (data.kind === "in-sync" ? "" : " (dry run; add --execute)") : `; pushed dev ${data.pushed.slice(0, 10)}`
            return { data, message: [`${what}${done}`, ...data.missing.slice(0, 10).map((line) => `  ${line}`)].join("\n") }
        } finally {
            if (lock !== undefined) releaseLockFile(lock, process.pid)
        }
    },
})
