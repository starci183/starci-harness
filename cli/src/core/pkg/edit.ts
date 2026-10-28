import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { z } from "zod"
import { now, openMachine, runtimeRoot } from "../../harness/ledger.js"
import { Refusal } from "../../shared/errors.js"
import { captureGit, git, gitCommonDir, mainCheckout } from "../../shared/git.js"
import { callerRole } from "../../shared/role.js"

/**
 * A package edit: an app session, or a worker its Kernel or Supervisor assigns, may fix or extend a `@starci` package while
 * its app runs on local sources. It edits on its own harness branch `pkg/<app>-<topic>`, in a worktree under the harness's
 * `.claude/worktrees/` (never the harness main checkout), cut from harness `main` (`starci pkg branch`); the app takes the
 * packages from there (`starci deps source --local --from <worktree>/packages`); and the editor records the branch for
 * Debug (`starci pkg handoff`), who alone merges it to main, pushes and publishes. A push of a `pkg/` branch is refused
 * PKG_EDIT_PUSH_REFUSED for every role but debug and owner, by `release push` and `release publish` and by the harness
 * repository's pre-push hook that `pkg branch` installs (`installPushGuard`).
 */
export const BRANCH_PREFIX = "pkg/"

/** The git config key (`branch.<branch>.<key>`) holding the app a package edit branch was cut for. */
export const APP_KEY = "starciapp"

/** The roles that may push or publish a package edit branch. */
const MAY_PUSH = new Set(["debug", "owner"])

const slug = (text: string): string =>
    text
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, "-")
        .split("-")
        .filter((part) => part !== "")
        .join("-")

/** The app's short name: its main checkout's folder name, slugged. */
export const appName = async (cwd: string): Promise<string> => slug(basename(await mainCheckout(cwd))) || "app"

/** A topic as it may stand in a branch name; PKG_TOPIC_INVALID when nothing of it is left. */
export const topicSlug = (topic: string): string => {
    const slugged = slug(topic)
    if (slugged === "") throw new Refusal("PKG_TOPIC_INVALID", `"${topic}" names no topic; use letters and digits, e.g. button-loading`)
    return slugged
}

/** The harness repository an edit branches from: `--harness`, else the main checkout of the harness this CLI runs from. */
export const harnessRepository = async (given: string | undefined): Promise<string> => mainCheckout(given ?? runtimeRoot())

/** The worktree of a package edit branch: `<harness>/.claude/worktrees/pkg-<app>-<topic>`. */
export const editWorktree = (harness: string, branch: string): string => join(harness, ".claude", "worktrees", branch.replaceAll("/", "-"))

const HOOK_MARK = "# starci pkg branch: package edit branches are pushed by Debug alone."

/**
 * Installs the harness repository's pre-push hook that refuses pushing a `pkg/` branch unless STARCI_ROLE is debug or owner.
 * It sits in the repository's common hooks folder, so it holds in every worktree; a pre-push hook that is not this one, or a
 * `core.hooksPath` elsewhere, is refused PKG_HOOK_TAKEN rather than replaced.
 */
export const installPushGuard = async (harness: string): Promise<string> => {
    const hooksPath = (await captureGit(["config", "--get", "core.hooksPath"], harness)).stdout.trim()
    if (hooksPath !== "") throw new Refusal("PKG_HOOK_TAKEN", `${harness} sets core.hooksPath=${hooksPath}; add the package edit push guard there by hand`)
    const dir = join((await gitCommonDir(harness)).trim(), "hooks")
    const file = join(dir, "pre-push")
    if (existsSync(file) && !readFileSync(file, "utf8").includes(HOOK_MARK)) throw new Refusal("PKG_HOOK_TAKEN", `${file} is another pre-push hook; add the package edit push guard to it by hand`)
    mkdirSync(dir, { recursive: true })
    const body = [
        "#!/bin/sh",
        HOOK_MARK,
        'case "$STARCI_ROLE" in debug|owner) exit 0 ;; esac',
        'refuse() { echo "PKG_EDIT_PUSH_REFUSED: $1 is a package edit branch; record it with starci pkg handoff, Debug merges, pushes and publishes it" >&2; exit 1; }',
        'current=$(git symbolic-ref -q HEAD)',
        'case "$current" in refs/heads/pkg/*) refuse "$current" ;; esac',
        "while read -r local_ref local_sha remote_ref remote_sha; do",
        '  case "$local_ref" in refs/heads/pkg/*) refuse "$local_ref" ;; esac',
        '  case "$remote_ref" in refs/heads/pkg/*) refuse "$remote_ref" ;; esac',
        "done",
        "exit 0",
        "",
    ].join("\n")
    writeFileSync(file, body, { mode: 0o755 })
    return file
}

/** Refuses PKG_EDIT_PUSH_REFUSED when `branch` is a package edit branch and the caller is not debug or owner. */
export const assertMayPushBranch = (branch: string | undefined): void => {
    if (branch?.startsWith(BRANCH_PREFIX) !== true) return
    const role = callerRole()
    if (role !== undefined && MAY_PUSH.has(role)) return
    throw new Refusal("PKG_EDIT_PUSH_REFUSED", `${branch} is a package edit branch: record it with starci pkg handoff; Debug merges, pushes and publishes it (STARCI_ROLE debug or owner)`)
}

const TABLE = `
CREATE TABLE IF NOT EXISTS package_handoffs (
  branch TEXT NOT NULL, head TEXT NOT NULL, harness TEXT NOT NULL, worktree TEXT NOT NULL, app TEXT NOT NULL, packages TEXT NOT NULL,
  urgent INTEGER NOT NULL, note TEXT, by_role TEXT, at TEXT NOT NULL, PRIMARY KEY (branch, head));
`

/** One package edit handed to Debug: the branch and the head to merge, the packages it changes and whether a deploy waits on it. */
export interface Handoff {
    readonly branch: string
    readonly head: string
    readonly harness: string
    readonly worktree: string
    readonly app: string
    readonly packages: readonly string[]
    readonly urgent: boolean
    readonly note: string | null
    readonly byRole: string | null
    readonly at: string
}

/**
 * Records a handoff in the host store's `package_handoffs` (one row per branch and head, so handing the same head twice
 * keeps one row and raises `urgent` if asked), where Debug reads it (`starci pkg handoff --list`); it never reaches the owner.
 */
export const recordHandoff = (handoff: Omit<Handoff, "at">): Handoff => {
    const db = openMachine()
    try {
        db.exec(TABLE)
        const at = now()
        db.prepare(
            "INSERT INTO package_handoffs (branch, head, harness, worktree, app, packages, urgent, note, by_role, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(branch, head) DO UPDATE SET urgent = max(urgent, excluded.urgent), note = coalesce(excluded.note, note)",
        ).run(handoff.branch, handoff.head, handoff.harness, handoff.worktree, handoff.app, JSON.stringify(handoff.packages), handoff.urgent ? 1 : 0, handoff.note, handoff.byRole, at)
        return { ...handoff, at }
    } finally {
        db.close()
    }
}

/** Every recorded handoff, urgent first, newest first. */
export const listHandoffs = (): Handoff[] => {
    const db = openMachine()
    try {
        db.exec(TABLE)
        return db
            .prepare("SELECT * FROM package_handoffs ORDER BY urgent DESC, at DESC")
            .all()
            .map((row) => ({
                branch: String(row.branch),
                head: String(row.head),
                harness: String(row.harness),
                worktree: String(row.worktree),
                app: String(row.app),
                packages: z.array(z.string()).parse(JSON.parse(String(row.packages))),
                urgent: Number(row.urgent) === 1,
                note: row.note === null ? null : String(row.note),
                byRole: row.by_role === null ? null : String(row.by_role),
                at: String(row.at),
            }))
    } finally {
        db.close()
    }
}

/** The `@starci` package folders a branch changes against harness main, by folder name. */
export const changedPackages = async (worktree: string): Promise<string[]> => {
    const base = (await git(worktree, ["merge-base", "HEAD", "main"])).trim()
    const files = (await git(worktree, ["diff", "--name-only", `${base}..HEAD`])).split("\n").map((line) => line.trim())
    return [...new Set(files.filter((file) => file.startsWith("packages/")).map((file) => file.split("/")[1] ?? ""))].filter((name) => name !== "").sort((left, right) => left.localeCompare(right))
}
