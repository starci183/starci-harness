import { loadPolicy } from "../../harness/policy.js"
import { judgePush } from "../deps/push-gate.js"
import { assertMayPushBranch } from "../pkg/edit.js"
import { exceptSecrets } from "../check/secrets-scan.js"
import { Refusal } from "../../shared/errors.js"
import { captureGit, currentBranch, git, nulPaths, isAncestor, refExists, repositoryRoot, resolveSha, trackedChanges } from "../../shared/git.js"
import { scanDiff } from "../../shared/secrets.js"
import type { SecretFinding } from "../../shared/secrets.js"
import { defineVerb } from "../../shared/verb.js"

interface PushData {
    readonly remote: string
    readonly branch: string
    readonly head: string
    readonly previous: string | null
    readonly commits: number
    readonly pushed: boolean
    readonly dryRun: boolean
}

/** Git's empty tree: the base of a first push, so the whole tree is scanned. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

const lineSuffix = (line: number | null): string => (line === null ? "" : `:${String(line)}`)

const describeFindings = (findings: readonly SecretFinding[]): string =>
    findings.map((finding) => `${finding.file}${lineSuffix(finding.line)} (${finding.pattern})`).join("; ")

/** `starci release push`: the light gate of ruling push-main-after-scoped-check: on the branch, clean, fast-forward, no secret; then git push with hooks. */
export const releasePushVerb = defineVerb({
    path: ["release", "push"],
    summary: "push main right after a green scoped check: refuses a dirty tree, a non fast-forward or a secret in the pushed range",
    editions: ["lite", "full"],
    effect: "remote",
    roles: ["owner", "release", "coordinator", "lead"],
    schema: "starci/release-push@1",
    flags: {
        remote: { kind: "string", summary: "the remote to push to (default origin)" },
        branch: { kind: "string", summary: "the branch to push (default main)" },
        "dry-run": { kind: "boolean", summary: "run every judgement but do not push" },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const remote = flags.remote ?? "origin"
        const branch = flags.branch ?? "main"
        const dryRun = flags["dry-run"]
        assertMayPushBranch(branch)
        assertMayPushBranch(await currentBranch(root))
        if ((await currentBranch(root)) !== branch) throw new Refusal("PUSH_NOT_ON_BRANCH", `check out ${branch} first; only ${branch} is pushed`)
        const dirty = await trackedChanges(root)
        if (dirty.length > 0) throw new Refusal("PUSH_DIRTY_TREE", `commit or drop the tracked changes first: ${dirty.slice(0, 5).join(", ")}`)
        await judgePush(root)
        await captureGit(["fetch", "--quiet", remote, branch], root)
        const remoteRef = `${remote}/${branch}`
        const head = await resolveSha(root, "HEAD")
        const remoteKnown = await refExists(root, remoteRef)
        const previous = remoteKnown ? await resolveSha(root, remoteRef) : null
        if (previous === head) {
            return { data: { remote, branch, head, previous, commits: 0, pushed: false, dryRun } satisfies PushData, message: `${remoteRef} already at ${head.slice(0, 9)}; nothing to push` }
        }
        if (previous !== null && !(await isAncestor(root, previous, head))) throw new Refusal("PUSH_NOT_FAST_FORWARD", `${remoteRef} has commits this branch lacks; merge or rebase onto it first`)
        const base = previous ?? EMPTY_TREE
        const range = previous === null ? [EMPTY_TREE, head] : [`${previous}..${head}`]
        const files = nulPaths(await git(root, ["diff", "--name-only", "-z", "--diff-filter=AMR", ...range]))
        const diff = await git(root, ["diff", "-U0", "--no-color", "--diff-filter=AMR", ...range])
        const encrypted = new Map<string, string>()
        const shownFiles = await Promise.all(
            files
                .filter((name) => name.endsWith(".enc"))
                .map(async (file) => ({ file, shown: await captureGit(["show", `${head}:${file}`], root) })),
        )
        for (const { file, shown } of shownFiles) if (shown.exitCode === 0) encrypted.set(file, shown.stdout)
        const { findings } = exceptSecrets(root, scanDiff(diff, files, (file) => encrypted.get(file)), loadPolicy(root))
        if (findings.length > 0) throw new Refusal("PUSH_SECRET_FOUND", `the pushed range adds secret material: ${describeFindings(findings)}`)
        const commits = previous === null ? Number(await git(root, ["rev-list", "--count", head])) : Number(await git(root, ["rev-list", "--count", `${base}..${head}`]))
        if (!dryRun) await git(root, ["push", remote, `HEAD:refs/heads/${branch}`])
        const data: PushData = { remote, branch, head, previous, commits, pushed: !dryRun, dryRun }
        return { data, message: `${dryRun ? "would push" : "pushed"} ${String(commits)} commit(s) to ${remoteRef} (${head.slice(0, 9)}); CI is the critic: starci release ci-status --sha ${head}` }
    },
})
