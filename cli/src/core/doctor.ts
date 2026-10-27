import { existsSync } from "node:fs"
import { join } from "node:path"
import { LOCAL_ROOT_ENV, ledgerCount, machinePath, runtimeRoot, stateBase } from "../harness/ledger.js"
import { locateOrca } from "../harness/orca/client.js"
import { loadPolicy, resolveProfile } from "../harness/policy.js"
import { hostHas } from "../harness/router.js"
import { loadRouting } from "../harness/routing.js"
import { asRefusal, Refusal } from "../shared/errors.js"
import { captureTool, probeTool, runNpm } from "../shared/exec.js"
import { captureGit } from "../shared/git.js"
import { formatTable } from "../shared/output.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../shared/verb.js"

interface Probe {
    readonly name: string
    readonly required: boolean
    readonly found: string | undefined
}

/** Where the harness keeps its state on this host, and how many project ledgers its registry lists. */
interface HarnessState {
    readonly runtimeRoot: string
    readonly stateBase: string
    readonly stateBaseFrom: "STARCI_LOCAL_ROOT" | "runtime root"
    readonly machine: string
    readonly ledgers: number | null
}

/** The policy profile of the working directory and why, or why it could not be read. */
type PolicyView = { readonly profile: string; readonly source: string } | { readonly error: string }

/** The `.starciwork` Work folder of the working directory's repository: product content, committed. */
interface WorkView {
    readonly repository: string
    readonly exists: boolean
    readonly trackedFiles: number
    readonly untrackedFiles: number
    readonly ignored: boolean
    readonly legacyLedger: boolean
}

interface DoctorData {
    readonly tree: string
    readonly treeRoot: string | null
    readonly probes: readonly Probe[]
    readonly orca: { readonly path: string; readonly source: string; readonly version: string | null } | null
    readonly harness: HarnessState
    readonly policy: PolicyView
    readonly work: WorkView | null
    readonly warnings: readonly string[]
}

const NODE_MAJOR = 24

const firstLine = (text: string | undefined): string | undefined => text?.split("\n")[0]?.trim()

const lineCount = (text: string): number => text.split("\n").filter((line) => line.trim() !== "").length

/** The host tools ops/routing.yaml probes (browser, docker ...) beyond the ones listed above; the router reads the same probes. */
const hostToolProbes = (): Probe[] => {
    try {
        const routing = loadRouting()
        return Object.keys(routing.hostProbes)
            .filter((tool) => tool !== "git" && tool !== "node")
            .map((tool): Probe => ({ name: tool, required: false, found: hostHas(routing, tool) ? "ok (routing probe)" : undefined }))
    } catch {
        return []
    }
}

/** The orca binary this host would run and the version it reports; null when there is none (orca is optional). */
const orcaOf = async (cwd: string): Promise<DoctorData["orca"]> => {
    try {
        const binary = await locateOrca(cwd)
        const run = await captureTool(binary.path, ["--version"], cwd, { timeoutMs: 15_000 }).catch(() => undefined)
        const version = run?.exitCode === 0 ? (firstLine(run.stdout) ?? null) : null
        return { path: binary.path, source: binary.source, version }
    } catch {
        return null
    }
}

const policyOf = (repository: string | undefined, treeRoot: string | undefined): PolicyView => {
    try {
        const choice = resolveProfile(loadPolicy(repository), treeRoot)
        return { profile: choice.name, source: choice.source }
    } catch (error: unknown) {
        const refusal = asRefusal(error)
        return { error: `${refusal.code}: ${refusal.message}` }
    }
}

const git = async (cwd: string, args: readonly string[]): Promise<{ readonly exitCode: number; readonly stdout: string }> =>
    captureGit(args, cwd, { timeoutMs: 15_000 }).catch(() => ({ exitCode: -1, stdout: "" }))

/** The Work folder of the repository holding `cwd`; null outside git. */
const workOf = async (cwd: string): Promise<WorkView | null> => {
    const top = await git(cwd, ["rev-parse", "--show-toplevel"])
    const repository = top.exitCode === 0 ? top.stdout.trim() : ""
    if (repository === "") return null
    const dir = join(repository, ".starciwork")
    const tracked = await git(repository, ["ls-files", "--", ".starciwork"])
    const untracked = await git(repository, ["ls-files", "--others", "--exclude-standard", "--", ".starciwork"])
    const ignored = await git(repository, ["check-ignore", "-q", ".starciwork"])
    return {
        repository,
        exists: existsSync(dir),
        trackedFiles: lineCount(tracked.stdout),
        untrackedFiles: lineCount(untracked.stdout),
        ignored: ignored.exitCode === 0,
        legacyLedger: existsSync(join(dir, "runtime.sqlite")),
    }
}

const warningsOf = (work: WorkView | null, harness: HarnessState): string[] => {
    const warnings: string[] = []
    if (work?.legacyLedger === true) {
        warnings.push(`${work.repository}/.starciwork/runtime.sqlite is a ledger of the old layout: the harness never reads, copies or migrates it, and keeps its state under ${harness.stateBase}; move it out of the Work folder`)
    }
    if (work?.ignored === true) warnings.push(`${work.repository}/.starciwork is git-ignored, but it is product content (Business, Architecture, features) and is committed`)
    return warnings
}

const workLine = (work: WorkView | null): string => {
    if (work === null) return "work: not in a git repository"
    if (!work.exists) return `work: ${work.repository} has no .starciwork`
    return `work: ${work.repository}/.starciwork, ${String(work.trackedFiles)} tracked file(s), ${String(work.untrackedFiles)} untracked${work.ignored ? ", git-ignored" : ""}`
}

/**
 * `starci doctor`: the host tools a verb may need (Orca with its version, optional), the StarCi tree of the folder and its
 * policy profile, where the harness keeps its state (runtime root, state base, how many ledgers machine.sqlite lists), and
 * whether the repository's `.starciwork` is committed Work, warning about an old-layout runtime.sqlite left inside it.
 */
export const doctorVerb = defineVerb({
    path: ["doctor"],
    summary: "check Node, git, npm, gh and Orca on this host; report the tree, its policy profile, the harness state base and ledgers, and the repository's .starciwork",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/doctor@1",
    flags: {},
    run: async (context) => {
        const nodeMajor = Number(process.versions.node.split(".")[0])
        const orca = await orcaOf(context.cwd)
        const probes: Probe[] = [
            { name: "node", required: true, found: nodeMajor >= NODE_MAJOR ? process.versions.node : undefined },
            { name: "git", required: true, found: firstLine(await probeTool("git", ["--version"], context.cwd)) },
            { name: "npm", required: true, found: firstLine(await runNpm(["--version"], context.cwd).then((output) => output.stdout, () => undefined)) },
            { name: "gh", required: false, found: firstLine(await probeTool("gh", ["--version"], context.cwd)) },
            { name: "orca", required: false, found: orca === null ? undefined : `${orca.version ?? "version unknown"} (${orca.path}, ${orca.source})` },
            ...hostToolProbes(),
        ]
        const missing = probes.filter((probe) => probe.required && probe.found === undefined)
        if (missing.length > 0) {
            const names = missing.map((probe) => (probe.name === "node" ? `node (>= ${String(NODE_MAJOR)}, found ${process.versions.node})` : probe.name))
            throw new Refusal("DOCTOR_TOOL_MISSING", `missing or too old: ${names.join(", ")}`)
        }
        const local = process.env[LOCAL_ROOT_ENV]
        const harness: HarnessState = {
            runtimeRoot: runtimeRoot(),
            stateBase: stateBase(),
            stateBaseFrom: local === undefined || local === "" ? "runtime root" : "STARCI_LOCAL_ROOT",
            machine: machinePath(),
            ledgers: ledgerCount() ?? null,
        }
        const work = await workOf(context.cwd)
        const policy = policyOf(work?.repository, context.treeRoot)
        const warnings = warningsOf(work, harness)
        const data: DoctorData = { tree: context.tree, treeRoot: context.treeRoot ?? null, probes, orca, harness, policy, work, warnings }
        const table = formatTable(probes.map((probe) => [probe.name, probe.found ?? (probe.required ? "MISSING" : "absent"), probe.required ? "required" : "optional"]))
        const treeNote = context.treeRoot === undefined ? "" : ` (${context.treeRoot})`
        const ledgerNote = harness.ledgers === null ? `none yet (no ${harness.machine})` : `${String(harness.ledgers)} in ${harness.machine}`
        const lines = [
            `tree: ${context.tree}${treeNote}`,
            "error" in policy ? `policy: unreadable (${policy.error})` : `policy: profile ${policy.profile} (${policy.source})`,
            table,
            `runtime root: ${harness.runtimeRoot}`,
            `state base: ${harness.stateBase} (from ${harness.stateBaseFrom})`,
            `ledgers: ${ledgerNote}`,
            workLine(work),
            ...warnings.map((warning) => `warning: ${warning}`),
        ]
        return { data, message: lines.join("\n") }
    },
})
