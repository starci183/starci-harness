import { loadPolicy, resolveProfile } from "../../harness/policy.js"
import { Refusal } from "../../shared/errors.js"
import { changedFiles, refExists, repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"
import { describeSecrets, scanSecrets } from "./secrets-scan.js"
import type { SecretReport } from "./secrets-scan.js"
import { treeFiles } from "./tree-files.js"

interface SecretsData extends SecretReport {
    readonly base: string | null
    readonly profile: string
}

/** `starci check secrets`: the secret scan of the changed files as they stand (the whole tree with --all), per policy/security.yaml. */
export const checkSecretsVerb = defineVerb({
    path: ["check", "secrets"],
    summary: "scan the changed files (every file with --all) for secrets per policy/security.yaml; red with file:line and rule, never the value",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/check-secrets@1",
    flags: {
        base: { kind: "string", summary: "compare against this ref (default origin/main, else HEAD)" },
        all: { kind: "boolean", summary: "scan every file of the tree" },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const policy = loadPolicy(root)
        const choice = resolveProfile(policy, context.treeRoot)
        let base: string | null = null
        let files: string[]
        if (flags.all) files = await treeFiles(root)
        else {
            base = flags.base ?? ((await refExists(root, "origin/main")) ? "origin/main" : "HEAD")
            if (!(await refExists(root, base))) throw new Refusal("CHECK_BASE_UNKNOWN", `the base ${base} does not exist here`)
            files = await changedFiles(root, base)
        }
        const report = scanSecrets(root, files, policy, choice.name, flags.all)
        const data: SecretsData = { ...report, base, profile: choice.name }
        return { data, message: describeSecrets(report).join("\n"), exitCode: report.verdict === "red" ? 1 : 0 }
    },
})
