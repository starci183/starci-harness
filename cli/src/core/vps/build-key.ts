import { tmpdir } from "node:os"
import { runSteps, sessionFor } from "../../harness/vps/fleet.js"
import type { StepOutcome } from "../../harness/vps/fleet.js"
import { BUILDER_SECRETS, buildKeyAddPlan, buildKeyComment, buildKeyLine, buildKeyListScript, buildKeyRemovePlan, loadBuildkit, readBuildKeys } from "../../harness/vps/buildkit.js"
import type { BuildkitService } from "../../harness/vps/buildkit.js"
import type { ManagedServer } from "../../harness/vps/policy.js"
import { generateKey } from "../../harness/vps/local.js"
import { ownerStore, requireKey, SERVER_KEYS } from "../../harness/vps/sealed.js"
import { Refusal } from "../../shared/errors.js"
import { captureTool, headline } from "../../shared/exec.js"
import { defineVerb } from "../../shared/verb.js"
import type { VerbResult } from "../../shared/verb.js"
import { EXECUTE, OWNER, planResult, requireAction, scopeOf } from "./shared.js"
import type { VpsData } from "./shared.js"

/** The value of STARCI_BUILDER_HOST: the host, with its ssh port when that is not 22 (images.yml splits it). */
export const builderHostValue = (server: Pick<ManagedServer, "host" | "sshPort">): string => (server.sshPort === 22 ? server.host : `${server.host}:${String(server.sshPort)}`)

/** One Actions secret write or delete through gh, the value on stdin only. */
export interface GhSecretCall {
    readonly args: readonly string[]
    readonly input?: string
}

/** The gh calls that give a repository its builder secrets: each value on stdin (`gh secret set` reads the body there), never in argv or a print. */
export const ghSecretSetCalls = (repo: string, values: Readonly<Record<string, string>>): GhSecretCall[] => {
    buildKeyComment(repo)
    return Object.entries(values).map(([name, value]) => ({ args: ["secret", "set", name, "--repo", repo, "--app", "actions"], input: value }))
}

/** The gh calls that take them away again. */
export const ghSecretDeleteCalls = (repo: string): GhSecretCall[] => {
    buildKeyComment(repo)
    return Object.values(BUILDER_SECRETS).map((name) => ({ args: ["secret", "delete", name, "--repo", repo, "--app", "actions"] }))
}

/** Runs gh calls in order; returns the outcome of each without printing a value. */
const runGh = async (calls: readonly GhSecretCall[], id: string): Promise<StepOutcome[]> => {
    const outcomes: StepOutcome[] = []
    for (const call of calls) {
        const run = await captureTool("gh", call.args, tmpdir(), { timeoutMs: 60_000, ...(call.input === undefined ? {} : { input: call.input }) })
        const name = call.args[2] ?? ""
        outcomes.push(run.exitCode === 0 ? { id: `${id} ${name}`, outcome: "changed", detail: "" } : { id: `${id} ${name}`, outcome: "failed", detail: headline(run.stderr) || `exit ${String(run.exitCode)}` })
        if (run.exitCode !== 0) break
    }
    return outcomes
}

const withSession = async <T>(scope: ReturnType<typeof scopeOf>, body: (session: Awaited<ReturnType<typeof sessionFor>>, knownHosts: string) => Promise<T>): Promise<T> => {
    const store = await ownerStore()
    const knownHosts = requireKey(store.open(scope.server.sealedFile), SERVER_KEYS.knownHosts, scope.server.sealedFile)
    const session = await sessionFor(scope.policy, scope.server, store)
    try {
        return await body(session, knownHosts)
    } finally {
        session.close()
    }
}

const add = async (scope: ReturnType<typeof scopeOf>, service: BuildkitService, repo: string, execute: boolean, progress: (line: string) => void): Promise<VerbResult<VpsData>> => {
    const plan = buildKeyAddPlan(service, scope.server.id, repo)
    const secrets = [BUILDER_SECRETS.key, BUILDER_SECRETS.host, BUILDER_SECRETS.knownHosts]
    if (!execute) return planResult(plan, undefined, [`  then: gh secret set ${secrets.join(", ")} --repo ${repo} (each value on stdin, never printed)`])
    const key = await generateKey(buildKeyComment(repo))
    // The line is composed and checked here; the server receives the public half alone, on the step's stdin.
    const line = buildKeyLine(service, key.publicKey, repo)
    const publicHalf = line.split(" ").slice(1, 3).join(" ")
    return withSession(scope, async (session, knownHosts) => {
        const outcomes = await runSteps(scope.policy, session, plan.steps, { BUILD_PUBLIC_KEY: publicHalf }, progress)
        if (outcomes.some((outcome) => outcome.outcome === "failed")) return planResult(plan, outcomes)
        const calls = ghSecretSetCalls(repo, { [BUILDER_SECRETS.key]: key.privateKey, [BUILDER_SECRETS.host]: builderHostValue(scope.server), [BUILDER_SECRETS.knownHosts]: knownHosts })
        const gh = await runGh(calls, "actions-secret")
        const failed = gh.some((outcome) => outcome.outcome === "failed")
        return planResult(plan, [...outcomes, ...gh], failed ? [`  the server holds the new key but ${repo} lacks its secrets: run build-key add again (it replaces the key)`] : [`  next: declare ci.imageBuilder: remote in ${repo}'s .starcistacks/application-stacks.yaml and run \`starci app sync\``])
    })
}

const remove = async (scope: ReturnType<typeof scopeOf>, service: BuildkitService, repo: string, execute: boolean, progress: (line: string) => void): Promise<VerbResult<VpsData>> => {
    const plan = buildKeyRemovePlan(service, scope.server.id, repo)
    if (!execute) return planResult(plan, undefined, [`  then: gh secret delete ${Object.values(BUILDER_SECRETS).join(", ")} --repo ${repo}`])
    return withSession(scope, async (session) => {
        const outcomes = await runSteps(scope.policy, session, plan.steps, {}, progress)
        if (outcomes.some((outcome) => outcome.outcome === "failed")) return planResult(plan, outcomes)
        return planResult(plan, [...outcomes, ...(await runGh(ghSecretDeleteCalls(repo), "actions-secret"))])
    })
}

const list = async (scope: ReturnType<typeof scopeOf>, service: BuildkitService): Promise<VerbResult<VpsData>> =>
    withSession(scope, async (session) => {
        const run = await session.run({ script: buildKeyListScript(service), root: true, timeoutMs: scope.policy.ssh.commandTimeoutSeconds * 1000 })
        if (run.exitCode !== 0) throw new Refusal("BUILDKIT_KEYS_UNREAD", `the build keys of ${scope.server.id} could not be read (${headline(run.stderr) || `exit ${String(run.exitCode)}`})`)
        const repos = readBuildKeys(run.stdout)
        return { data: { server: scope.server.id, repos }, message: [`build keys of ${scope.server.id}: ${String(repos.length)}`, ...repos.map((repo) => `  ${repo}`)].join("\n") }
    })

/**
 * `starci vps build-key add|list|remove <id> --repo <owner>/<name> [--execute]`: the keys of the remote BuildKit's ssh user `starci-build`,
 * one per repository, each forced to the gate that admits only `buildctl dial-stdio`. `add` mints an ed25519 key here, installs the public half
 * on the server and sets the private half (with the host and its pinned known_hosts) as the repository's Actions secrets through gh, on stdin;
 * `remove` takes the line and the secrets away. Never `vps grant`'s authorized_keys. `add` and `remove` are dry runs until --execute.
 */
export const vpsBuildKeyVerb = defineVerb({
    path: ["vps", "build-key"],
    summary: "`build-key add|list|remove <id> --repo <owner>/<name>`: the keys of the remote BuildKit's ssh user starci-build (not in the docker group), one gated line per repository admitting only `buildctl dial-stdio`; add mints the key here, installs the public half and sets the private half as the repository's Actions secret STARCI_BUILDER_SSH_KEY through gh on stdin (never printed), with STARCI_BUILDER_HOST and STARCI_BUILDER_KNOWN_HOSTS; a dry run until --execute",
    effect: "remote",
    roles: OWNER,
    schema: "starci/vps-build-key@1",
    flags: {
        action: { kind: "string", summary: "add | list | remove", required: true, positional: true },
        id: { kind: "string", summary: "the server id (its ops/vps/servers/<id>.yaml) that runs the buildkit service", required: true, positional: true },
        repo: { kind: "string", summary: "add, remove: the GitHub repository <owner>/<name> whose CI builds through the server" },
        execute: EXECUTE,
    },
    run: async (context, flags): Promise<VerbResult<VpsData>> => {
        const action = requireAction(flags.action, ["add", "list", "remove"], "build-key")
        const scope = scopeOf(flags.id)
        const service = loadBuildkit(scope.opsDir)
        if (action === "list") return list(scope, service)
        if (flags.repo === undefined) throw new Refusal("BUILDKIT_REPO_INVALID", `build-key ${action} needs --repo <owner>/<name>`)
        buildKeyComment(flags.repo)
        return action === "add" ? add(scope, service, flags.repo, flags.execute, context.progress) : remove(scope, service, flags.repo, flags.execute, context.progress)
    },
})
