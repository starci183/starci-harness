import { existsSync } from "node:fs"
import { join } from "node:path"
import { knowledgeDir, regenerateContexts } from "../core/contexts/anatomy.js"
import { Refusal } from "../shared/errors.js"
import { captureGit } from "../shared/git.js"

/**
 * The generated files of a harness lane (contexts/authority/lanes.md "Gate and land"): `contexts/project/index.md`, the slices of anatomy.md and the section
 * indexes record the size and first sentence of every page of the tree, so a lane that edits a page makes them stale, and the full release gate (`contexts
 * anatomy`) goes red on the first stale line after forty minutes. `lane gate` of a harness lane therefore regenerates them in its own worktree before it gates
 * and commits what changed as part of the lane, so a docs-changing lane never lands a stale index. A lane that changed nothing generated commits nothing.
 */

/** What the regeneration did. */
export interface GeneratedCommit {
    /** The files that were stale, relative to the worktree. Empty when the tree already matched the generator. */
    readonly files: readonly string[]
    /** The commit that carries them, when one was made. */
    readonly sha?: string
}

/** The message of the commit: names the verb that wrote it, so a reader of the lane's history knows no person edited those files. */
export const GENERATED_COMMIT_MESSAGE = "regenerate the generated contexts files (lane gate)"

/**
 * Regenerates the generated contexts files of the harness worktree `root` and commits those that changed (only them: nothing else in the tree is staged).
 * A tree that is no harness (no contexts/hfs/slots.yaml) is left alone. Refuses LANE_GATE_GENERATED when the commit fails.
 */
export const commitGenerated = async (root: string, say: (line: string) => void = () => undefined): Promise<GeneratedCommit> => {
    if (!existsSync(join(root, "contexts", "hfs", "slots.yaml"))) return { files: [] }
    const files = regenerateContexts(knowledgeDir(root))
    if (files.length === 0) return { files }
    const added = await captureGit(["add", "--", ...files], root)
    if (added.exitCode !== 0) throw new Refusal("LANE_GATE_GENERATED", `git add of the regenerated files failed: ${added.stderr.trim()}`)
    const committed = await captureGit(["commit", "-m", GENERATED_COMMIT_MESSAGE, "--", ...files], root)
    if (committed.exitCode !== 0) throw new Refusal("LANE_GATE_GENERATED", `git commit of the regenerated files failed: ${`${committed.stdout}\n${committed.stderr}`.trim().split("\n").slice(-3).join(" ")}`)
    const sha = (await captureGit(["rev-parse", "HEAD"], root)).stdout.trim()
    say(`regenerated ${String(files.length)} generated file(s) and committed them with the lane (${sha.slice(0, 10)}): ${files.join(", ")}`)
    return { files, sha }
}
