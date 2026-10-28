import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"
import { z } from "zod"
import { FEEDBACK_TARGET_KINDS } from "../../harness/feedback.js"
import type { FeedbackTargetKind } from "../../harness/feedback.js"
import { runtimeRoot } from "../../harness/ledger.js"
import { Refusal } from "../../shared/errors.js"
import { captureGitSync } from "../../shared/git.js"
import { loadScenarios } from "../bench/scenario.js"
import { knowledgeDir } from "../contexts/anatomy.js"
import { readCorpus } from "../contexts/search-corpus.js"

/** The folder of the harness checkout a commit target must touch, per commit kind. */
const COMMIT_FOLDERS: Readonly<Partial<Record<FeedbackTargetKind, string>>> = { grammar: "packages/grammar/", cli: "cli/", app: "app/" }

/** Replaces the checkout whose commits close a feedback (the harness checkout): the bench points it at a fixture repository. */
export const FEEDBACK_REPO_ENV = "STARCI_FEEDBACK_REPO"

/** The checkout a commit target resolves in: STARCI_FEEDBACK_REPO, else the harness checkout. */
const commitRepo = (): string => {
    const repo = process.env[FEEDBACK_REPO_ENV]
    return repo === undefined || repo === "" ? runtimeRoot() : repo
}

/** A target kind as `--kind` gives it; refuses one that is not a closing kind. */
export const targetKindOf = (kind: string): FeedbackTargetKind => {
    const found = FEEDBACK_TARGET_KINDS.find((item) => item === kind)
    if (found === undefined) throw new Refusal("FEEDBACK_TARGET_KIND", `--kind ${kind} is not one of ${FEEDBACK_TARGET_KINDS.join(", ")}`)
    return found
}

const unresolved = (kind: FeedbackTargetKind, target: string, why: string): Refusal => new Refusal("FEEDBACK_TARGET_UNRESOLVED", `${kind} ${target} does not close a feedback: ${why}`)

/** A commit of the harness checkout that touches the kind's folder: its full sha, subject and the files it changed there. */
const resolveCommit = (kind: FeedbackTargetKind, folder: string, target: string): { readonly target: string; readonly evidence: string } => {
    if (!/^[0-9a-f]{7,40}$/.test(target)) throw unresolved(kind, target, "a commit target is a sha of 7 to 40 hex digits")
    const root = commitRepo()
    const sha = captureGitSync(["rev-parse", "--verify", "--quiet", `${target}^{commit}`], root)
    if (sha.exitCode !== 0) throw unresolved(kind, target, `no commit ${target} in ${root}`)
    const full = sha.stdout.trim()
    const files = captureGitSync(["diff-tree", "--no-commit-id", "--name-only", "-r", "-m", "--root", full], root)
    if (files.exitCode !== 0) throw unresolved(kind, target, `git diff-tree failed: ${files.stderr.trim()}`)
    const touched = [...new Set(files.stdout.split("\n").map((line) => line.trim()).filter((line) => line.startsWith(folder)))]
    if (touched.length === 0) throw unresolved(kind, target, `commit ${full.slice(0, 12)} touches nothing under ${folder}`)
    const subject = captureGitSync(["log", "-1", "--format=%s", full], root).stdout.trim()
    return { target: full, evidence: `${full.slice(0, 12)} "${subject}" touches ${String(touched.length)} file(s) under ${folder}` }
}

const rulesSchema = z.object({
    rules: z.array(z.object({ id: z.string(), code: z.string(), enforcers: z.array(z.object({ kind: z.string(), id: z.string(), status: z.string().optional() })).optional() })),
})

/** A rule of contexts/hfs/rules.yaml judged by at least one built (not planned) enforcer. */
const resolveRule = (target: string): { readonly target: string; readonly evidence: string } => {
    if (!/^R\d+$/.test(target)) throw unresolved("rule", target, "a rule target is an id R<n> of contexts/hfs/rules.yaml")
    const file = join(knowledgeDir(), "hfs", "rules.yaml")
    const parsed = rulesSchema.safeParse(parse(readFileSync(file, "utf8")))
    if (!parsed.success) throw new Refusal("KNOWLEDGE_INVALID", `${file} is invalid: ${z.prettifyError(parsed.error)}`)
    const rule = parsed.data.rules.find((item) => item.id === target)
    if (rule === undefined) throw unresolved("rule", target, `${file} has no rule ${target}`)
    const built = (rule.enforcers ?? []).filter((enforcer) => enforcer.status !== "planned")
    if (built.length === 0) throw unresolved("rule", target, `${target} (${rule.code}) has no built enforcer`)
    return { target, evidence: `${target} ${rule.code} enforced by ${built.map((enforcer) => enforcer.kind + " " + enforcer.id).join(", ")}` }
}

/** An anchor the contexts search corpus resolves: a citable id or `<path>#<anchor>`. */
const resolveContext = (target: string): { readonly target: string; readonly evidence: string } => {
    const chunk = readCorpus(runtimeRoot()).chunks.find((item) => item.anchor === target || item.aliases.includes(target))
    if (chunk === undefined) throw unresolved("context", target, "no anchor of the contexts corpus is this id (starci contexts anchor resolves them)")
    return { target, evidence: `${chunk.path}:${String(chunk.line)} ${chunk.title}` }
}

/** A scenario of bench/scenarios. */
const resolveBench = (target: string): { readonly target: string; readonly evidence: string } => {
    const scenario = loadScenarios().find((item) => item.id === target)
    if (scenario === undefined) throw unresolved("bench", target, "no scenario of bench/scenarios has this id")
    return { target, evidence: `bench scenario ${scenario.id} (${scenario.automation}): ${scenario.title}` }
}

/** Resolves a closing target or refuses FEEDBACK_TARGET_UNRESOLVED; the answer is the target as stored and what proved it. */
export const resolveTarget = (kind: FeedbackTargetKind, target: string): { readonly target: string; readonly evidence: string } => {
    const folder = COMMIT_FOLDERS[kind]
    if (folder !== undefined) return resolveCommit(kind, folder, target)
    if (kind === "rule") return resolveRule(target)
    if (kind === "context") return resolveContext(target)
    return resolveBench(target)
}
