import { readFileSync } from "node:fs"
import { existsSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { parse } from "yaml"
import { z } from "zod"
import { FEEDBACK_TARGET_KINDS } from "../../harness/feedback.js"
import type { FeedbackTargetKind } from "../../harness/feedback.js"
import { runtimeRoot } from "../../harness/ledger.js"
import { Refusal } from "../../shared/errors.js"
import { captureGitSync } from "../../shared/git.js"
import { knowledgeDir } from "../contexts/anatomy.js"
import { readCorpus } from "../contexts/search-corpus.js"

/** The folder of the harness checkout a commit target must touch, per commit kind. */
const COMMIT_FOLDERS: Readonly<Partial<Record<FeedbackTargetKind, string>>> = { grammar: "packages/grammar/", cli: "cli/", app: "app/" }

/** A target kind as `--kind` gives it; refuses one that is not a closing kind. */
export const targetKindOf = (kind: string): FeedbackTargetKind => {
    const found = FEEDBACK_TARGET_KINDS.find((item) => item === kind)
    if (found === undefined) throw new Refusal("FEEDBACK_TARGET_KIND", `--kind ${kind} is not one of ${FEEDBACK_TARGET_KINDS.join(", ")}`)
    return found
}

const unresolved = (kind: FeedbackTargetKind, target: string, why: string): Refusal => new Refusal("FEEDBACK_TARGET_UNRESOLVED", `${kind} ${target} does not close a feedback: ${why}`)

interface Resolved {
    readonly target: string
    readonly evidence: string
}

/** The full sha of a commit in `root`, or a refusal naming why `sha` is none. */
const fullSha = (kind: FeedbackTargetKind, target: string, sha: string, root: string): string => {
    if (!/^[0-9a-f]{7,40}$/.test(sha)) throw unresolved(kind, target, "a commit is a sha of 7 to 40 hex digits")
    const found = captureGitSync(["rev-parse", "--verify", "--quiet", `${sha}^{commit}`], root)
    if (found.exitCode !== 0) throw unresolved(kind, target, `no commit ${sha} in ${root}`)
    return found.stdout.trim()
}

/** A commit of the harness checkout that touches the kind's folder: its full sha, subject and the files it changed there. */
const resolveCommit = (kind: FeedbackTargetKind, folder: string, target: string): Resolved => {
    const root = runtimeRoot()
    const full = fullSha(kind, target, target, root)
    const files = captureGitSync(["diff-tree", "--no-commit-id", "--name-only", "-r", "-m", "--root", full], root)
    if (files.exitCode !== 0) throw unresolved(kind, target, `git diff-tree failed: ${files.stderr.trim()}`)
    const touched = [...new Set(files.stdout.split("\n").map((line) => line.trim()).filter((line) => line.startsWith(folder)))]
    if (touched.length === 0) throw unresolved(kind, target, `commit ${full.slice(0, 12)} touches nothing under ${folder}`)
    const subject = captureGitSync(["log", "-1", "--format=%s", full], root).stdout.trim()
    return { target: full, evidence: `${full.slice(0, 12)} "${subject}" touches ${String(touched.length)} file(s) under ${folder}` }
}

/**
 * The commit that fixed the cause: a sha of the harness checkout, or `<repository path>@<sha>` for another repository (an app).
 * A commit of another repository is verified with git in that path (it must be a work tree that has the commit); the target is
 * stored as `<absolute path>@<full sha>`, a harness one as the full sha. The commit need not touch any folder: it is the fix.
 */
const resolveRootFix = (target: string): Resolved => {
    const at = target.lastIndexOf("@")
    const repo = at === -1 ? runtimeRoot() : resolve(target.slice(0, at))
    const sha = at === -1 ? target : target.slice(at + 1)
    if (at !== -1) {
        if (target.slice(0, at) === "") throw unresolved("root-fix", target, "a repository path before the @ is empty")
        if (!existsSync(repo) || !statSync(repo).isDirectory()) throw unresolved("root-fix", target, `${repo} is not a directory`)
        const inside = captureGitSync(["rev-parse", "--is-inside-work-tree"], repo)
        if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") throw unresolved("root-fix", target, `${repo} is not a git work tree`)
    }
    const full = fullSha("root-fix", target, sha, repo)
    const subject = captureGitSync(["log", "-1", "--format=%s", full], repo).stdout.trim()
    return { target: at === -1 ? full : `${repo}@${full}`, evidence: `${full.slice(0, 12)} "${subject}" in ${repo}` }
}

const rulesSchema = z.object({
    rules: z.array(z.object({ id: z.string(), code: z.string(), enforcers: z.array(z.object({ kind: z.string(), id: z.string(), status: z.string().optional() })).optional() })),
})

/** A rule of contexts/hfs/rules.yaml; one with no built enforcer is held by review, and the evidence says so. */
const resolveRule = (target: string): Resolved => {
    if (!/^R\d+$/.test(target)) throw unresolved("rule", target, "a rule target is an id R<n> of contexts/hfs/rules.yaml")
    const file = join(knowledgeDir(), "hfs", "rules.yaml")
    const parsed = rulesSchema.safeParse(parse(readFileSync(file, "utf8")))
    if (!parsed.success) throw new Refusal("KNOWLEDGE_INVALID", `${file} is invalid: ${z.prettifyError(parsed.error)}`)
    const rule = parsed.data.rules.find((item) => item.id === target)
    if (rule === undefined) throw unresolved("rule", target, `${file} has no rule ${target}`)
    const built = (rule.enforcers ?? []).filter((enforcer) => enforcer.status !== "planned")
    if (built.length === 0) return { target, evidence: `${target} ${rule.code} held by review` }
    return { target, evidence: `${target} ${rule.code} enforced by ${built.map((enforcer) => enforcer.kind + " " + enforcer.id).join(", ")}` }
}

/** An anchor the contexts search corpus resolves: a citable id or `<path>#<anchor>`. */
const resolveContext = (target: string): Resolved => {
    const chunk = readCorpus(runtimeRoot()).chunks.find((item) => item.anchor === target || item.aliases.includes(target))
    if (chunk === undefined) throw unresolved("context", target, "no anchor of the contexts corpus is this id (starci contexts anchor resolves them)")
    return { target, evidence: `${chunk.path}:${String(chunk.line)} ${chunk.title}` }
}

/** Resolves a closing target or refuses FEEDBACK_TARGET_UNRESOLVED; the answer is the target as stored and what proved it. */
export const resolveTarget = (kind: FeedbackTargetKind, target: string): Resolved => {
    if (kind === "declined") throw unresolved(kind, target, "a declined feedback has a reason and no target")
    const folder = COMMIT_FOLDERS[kind]
    if (folder !== undefined) return resolveCommit(kind, folder, target)
    if (kind === "root-fix") return resolveRootFix(target)
    if (kind === "rule") return resolveRule(target)
    return resolveContext(target)
}
