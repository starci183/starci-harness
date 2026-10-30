import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, normalize, win32 } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { captureTool, headline, runTool, startDetached, ToolNotStarted } from "../shared/exec.js"
import { hostLauncherPath, runtimeRoot, stateBase } from "./ledger.js"
import { orcaBinarySync } from "./orca/client.js"
import { locateOps } from "./ops.js"
import { inOrder } from "./sequential.js"

const argvSchema = z.array(z.string().min(1)).min(1)

const scheduleSchema = z.strictObject({
    kind: z.literal("schedule"),
    name: z.string().regex(/^StarCi [A-Za-z0-9][A-Za-z0-9 -]*$/, "a schedule is named StarCi <words>"),
    everyMinutes: z.number().int().min(1).max(1439).optional(),
    atLogon: z.literal(true).optional(),
    argv: argvSchema,
    env: z.record(z.string().regex(/^[A-Za-z_]\w*$/), z.string()).optional(),
    log: z.string().min(1).optional(),
})

const serviceSchema = z.strictObject({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    summary: z.string().min(1),
    platform: z.enum(["win32", "linux", "darwin", "any"]),
    check: z
        .strictObject({
            argv: argvSchema,
            json: z.strictObject({ path: z.string().min(1), equals: z.union([z.string(), z.number(), z.boolean(), z.null()]) }).optional(),
        })
        .optional(),
    start: z.strictObject({ argv: argvSchema, detach: z.boolean().default(false) }).optional(),
    install: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("none") }), scheduleSchema]),
    requires: z.array(z.string()).default([]),
})

type ServiceEntry = z.infer<typeof serviceSchema>

/** The declaration problems of the services: an id or schedule name declared twice, a schedule with not exactly one trigger, an unscheduled service with no check. */
const declarationProblems = (services: readonly ServiceEntry[]): string[] => {
    const problems: string[] = []
    const ids = new Set<string>()
    const names = new Set<string>()
    for (const service of services) {
        if (ids.has(service.id)) problems.push(`service ${service.id} is declared twice`)
        ids.add(service.id)
        if (service.install.kind === "schedule") {
            const schedule = service.install
            if ((schedule.everyMinutes === undefined) === (schedule.atLogon === undefined)) problems.push(`${service.id}: a schedule names exactly one of everyMinutes and atLogon`)
            if (names.has(schedule.name.toLowerCase())) problems.push(`schedule ${schedule.name} is declared twice`)
            names.add(schedule.name.toLowerCase())
        } else if (service.check === undefined) problems.push(`${service.id}: a service with no schedule needs a check`)
    }
    return problems
}

/** The requires problems of the services: a requirement that names no service, and every cycle the requirements form. */
const requiresProblems = (services: readonly ServiceEntry[]): string[] => {
    const byId = new Map(services.map((service) => [service.id, service]))
    const problems = services.flatMap((service) => service.requires.filter((need) => !byId.has(need)).map((need) => `${service.id} requires ${need}, which is no service`))
    const visit = (id: string, path: readonly string[]): void => {
        if (path.includes(id)) {
            problems.push(`requires form a cycle: ${[...path, id].join(" > ")}`)
            return
        }
        for (const need of byId.get(id)?.requires ?? []) visit(need, [...path, id])
    }
    for (const service of services) visit(service.id, [])
    return problems
}

const hostSchema = z
    .strictObject({
        schema: z.literal("starci/host@1"),
        waitSeconds: z.number().int().positive(),
        checkTimeoutSeconds: z.number().int().positive(),
        services: z.array(serviceSchema).min(1),
    })
    .superRefine((host, issues) => {
        for (const message of [...declarationProblems(host.services), ...requiresProblems(host.services)]) issues.addIssue({ code: "custom", message })
    })

/** ops/host.yaml, validated: the services a host runs for the harness. */
export type HostConfig = z.infer<typeof hostSchema>

/** One service of ops/host.yaml. */
export type HostService = HostConfig["services"][number]

/** A platform a service or an install targets. */
export type HostPlatform = HostService["platform"]

/** A service's schedule, when it registers one. */
export type HostSchedule = z.infer<typeof scheduleSchema>

/** Loads and validates ops/host.yaml from the ops folder (STARCI_OPS_DIR honoured). */
export const loadHost = (dir: string = locateOps()): HostConfig => {
    const file = join(dir, "host.yaml")
    let raw: unknown
    try {
        raw = parse(readFileSync(file, "utf8"))
    } catch (error: unknown) {
        throw new Refusal("OPS_INVALID", `${file} is not readable yaml: ${error instanceof Error ? error.message : String(error)}`)
    }
    const parsed = hostSchema.safeParse(raw)
    if (!parsed.success) throw new Refusal("OPS_INVALID", `${file} is invalid: ${z.prettifyError(parsed.error)}`)
    return parsed.data
}

const TOKEN = /\{(starci|node|orca|state|runtime|env:[A-Za-z_]\w*)\}/g

const mainScript = (): string => join(dirname(fileURLToPath(import.meta.url)), "..", "main.js")

const expandToken = (token: string): string =>
    token.replaceAll(TOKEN, (_, name: string) => {
        if (name === "node") return process.execPath
        if (name === "orca") return orcaBinarySync()?.path ?? "orca"
        if (name === "state") return stateBase()
        if (name === "runtime") return runtimeRoot()
        if (name === "starci") throw new Refusal("OPS_INVALID", `{starci} must be a whole argv token, not part of ${token}`)
        const variable = name.slice("env:".length)
        const value = process.env[variable]
        if (value === undefined || value === "") throw new Refusal("HOST_ENV_MISSING", `${token} names ${variable}, which is not set on this host`)
        return value
    })

/** An argv of ops/host.yaml with its tokens resolved for this host; `{starci}` becomes this Node and this CLI's main.js. */
export const expandArgv = (argv: readonly string[]): string[] => argv.flatMap((token) => (token === "{starci}" ? [process.execPath, mainScript()] : [expandToken(token)]))

/** The platforms a service runs on, judged against a target platform. */
export const appliesTo = (service: HostService, platform: string): boolean => service.platform === "any" || service.platform === platform

/** The services ids name, in ops/host.yaml order; every service when none is named. Refuses an id that is no service. */
export const selectServices = (config: HostConfig, ids: readonly string[]): HostService[] => {
    const unknown = ids.filter((id) => !config.services.some((service) => service.id === id))
    if (unknown.length > 0) throw new Refusal("HOST_UNKNOWN_SERVICE", `no service ${unknown.join(", ")} in ops/host.yaml (services: ${config.services.map((service) => service.id).join(", ")})`)
    return ids.length === 0 ? [...config.services] : config.services.filter((service) => ids.includes(service.id))
}

/** What one check found: up or not, and the evidence that says so. */
export interface Probe {
    readonly up: boolean
    readonly evidence: string
}

const valueAt = (value: unknown, path: string): unknown =>
    path.split(".").reduce<unknown>((at, key) => (typeof at === "object" && at !== null && key in at ? (at as Record<string, unknown>)[key] : undefined), value)

/** Runs a service's check without a shell: up when it exits 0 and its json value, when named, equals the expected one. */
export const probeService = async (check: NonNullable<HostService["check"]>, cwd: string, timeoutSeconds: number): Promise<Probe> => {
    let argv: string[]
    try {
        argv = expandArgv(check.argv)
    } catch (error: unknown) {
        return { up: false, evidence: error instanceof Error ? error.message : String(error) }
    }
    const [tool, ...args] = argv
    if (tool === undefined) return { up: false, evidence: "empty check" }
    let run
    try {
        run = await captureTool(tool, args, cwd, { timeoutMs: timeoutSeconds * 1000 })
    } catch (error: unknown) {
        if (error instanceof ToolNotStarted) return { up: false, evidence: error.message }
        throw error
    }
    if (run.timedOut) return { up: false, evidence: `check timed out after ${String(timeoutSeconds)}s` }
    if (run.exitCode !== 0) return { up: false, evidence: `exit ${String(run.exitCode)}: ${headline(run.stderr) || headline(run.stdout) || "no output"}` }
    if (check.json === undefined) return { up: true, evidence: "exit 0" }
    let parsed: unknown
    try {
        parsed = JSON.parse(run.stdout)
    } catch {
        return { up: false, evidence: "exit 0, but its output is not json" }
    }
    const value = valueAt(parsed, check.json.path)
    return { up: value === check.json.equals, evidence: `${check.json.path} = ${value === undefined ? "absent" : JSON.stringify(value)}` }
}

/** One scheduled task of the host's scheduler: its name (without its folder), whether it is enabled, and its first action. */
export interface ScheduledTask {
    readonly name: string
    readonly enabled: boolean
    readonly command: string
    readonly arguments: string
}

const decodeXml = (text: string): string => text.replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&")

const tagOf = (xml: string, tag: string): string | undefined => {
    const found = new RegExp(String.raw`<${tag}>([\s\S]*?)</${tag}>`).exec(xml)?.[1]
    return found === undefined ? undefined : decodeXml(found.trim())
}

/** Parses `schtasks /Query /XML`: every task's XML follows a `<!-- \folder\name -->` comment. */
export const parseScheduledTasks = (dump: string): ScheduledTask[] => {
    const parts = dump.split(/<!--\s*(\\[^>]*)-->/)
    const tasks: ScheduledTask[] = []
    for (let index = 1; index + 1 < parts.length; index += 2) {
        const path = (parts[index] ?? "").trimEnd()
        const xml = parts[index + 1] ?? ""
        const exec = /<Exec>([\s\S]*?)<\/Exec>/.exec(xml)?.[1] ?? ""
        tasks.push({
            name: path.slice(path.lastIndexOf("\\") + 1),
            enabled: tagOf(/<Settings>([\s\S]*?)<\/Settings>/.exec(xml)?.[1] ?? "", "Enabled") !== "false",
            command: tagOf(exec, "Command") ?? "",
            arguments: tagOf(exec, "Arguments") ?? "",
        })
    }
    return tasks
}

const system32 = (tool: string): string => win32.join(process.env.SystemRoot ?? String.raw`C:\Windows`, "System32", tool)

/** The Windows task scheduler's CLI, by its full path, so no `schtasks` shim on PATH stands in for it. */
export const schtasksPath = (): string => system32("schtasks.exe")

/** The host's scheduled tasks (Windows), or why they could not be read. */
export const listScheduledTasks = async (cwd: string): Promise<ScheduledTask[] | string> => {
    try {
        const run = await captureTool(schtasksPath(), ["/Query", "/XML"], cwd, { timeoutMs: 60_000 })
        if (run.exitCode !== 0) return `schtasks /Query failed: ${headline(run.stderr) || "exit " + String(run.exitCode)}`
        return parseScheduledTasks(run.stdout)
    } catch (error: unknown) {
        return error instanceof Error ? error.message : String(error)
    }
}

// The schtasks /TR value may hold at most this many characters.
const TR_MAX = 261

// Inside a double-quoted cmd token only these break: the quote itself, %-expansion and a line break.
const launcherToken = (token: string): string => {
    if (/["%\r\n]/.test(token)) throw new Refusal("HOST_ARGV_UNQUOTABLE", `${token} holds a quote, a % or a line break, which a launcher cannot carry`)
    return `"${token}"`
}

const trToken = (token: string): string => {
    if (token.includes('"')) throw new Refusal("HOST_ARGV_UNQUOTABLE", `${token} holds a quote, which a scheduled task's command cannot carry`)
    return /\s/.test(token) ? `"${token}"` : token
}

/** One file `host install` writes under the state base. */
export interface Launcher {
    readonly path: string
    readonly content: string
}

/** What `host install` does for one schedule: the launchers it writes and the exact scheduler argv it runs. */
export interface SchedulePlan {
    readonly service: string
    readonly name: string
    readonly launchers: readonly Launcher[]
    /** The task's action as Task Scheduler stores it: the program and its arguments. */
    readonly action: { readonly command: string; readonly arguments: string }
    readonly argv: readonly string[]
}

/**
 * Plans a service's Windows schedule. The task runs `wscript //B <service>.vbs`, which runs `cmd /d /s /c ""<service>.cmd""` with
 * its window hidden and waits; the .cmd changes to the runtime root, sets the service's environment and appends its output to
 * its log, every token double-quoted. So the scheduler's command line holds one quoted path and never the service's own argv,
 * and `/s` strips only the outer pair of quotes, whatever the path holds (spaces, &, ^).
 */
export const planSchedule = (service: HostService): SchedulePlan => {
    if (service.install.kind !== "schedule") throw new Refusal("HOST_NO_SCHEDULE", `${service.id} registers no schedule (install kind none)`)
    const schedule = service.install
    const batch = hostLauncherPath(service.id, "cmd")
    const script = hostLauncherPath(service.id, "vbs")
    const log = schedule.log === undefined ? "" : ` >> ${launcherToken(normalize(expandToken(schedule.log)))} 2>&1`
    const lines = [
        "@echo off",
        `rem StarCi host service ${service.id}, written by starci host install from ops/host.yaml`,
        `cd /d ${launcherToken(runtimeRoot())}`,
        ...Object.entries(schedule.env ?? {}).map(([key, value]) => `set ${launcherToken(key + "=" + expandToken(value))}`),
        `${expandArgv(schedule.argv).map(launcherToken).join(" ")}${log}`,
        "",
    ]
    // A VBScript string doubles each quote it holds.
    const hidden = `${launcherToken(system32("cmd.exe"))} /d /s /c "${launcherToken(batch)}"`.replaceAll('"', '""')
    const vbs = [`' StarCi host service ${service.id}, written by starci host install from ops/host.yaml: runs ${service.id}.cmd hidden and waits`, `CreateObject("WScript.Shell").Run "${hidden}", 0, True`, ""]
    const command = system32("wscript.exe")
    const rest = `//B //Nologo ${launcherToken(script)}`
    const tr = `${trToken(command)} ${rest}`
    if (tr.length > TR_MAX) throw new Refusal("HOST_TR_TOO_LONG", `the task command for ${service.id} is ${String(tr.length)} characters, over schtasks' ${String(TR_MAX)}: move the state base to a shorter path`)
    const when = schedule.everyMinutes === undefined ? ["/SC", "ONLOGON"] : ["/SC", "MINUTE", "/MO", String(schedule.everyMinutes)]
    return {
        service: service.id,
        name: schedule.name,
        launchers: [
            { path: batch, content: lines.join("\r\n") },
            { path: script, content: vbs.join("\r\n") },
        ],
        action: { command, arguments: rest },
        argv: [schtasksPath(), "/Create", "/F", "/TN", schedule.name, ...when, "/TR", tr],
    }
}

/** Where a service's schedule stands on this host. */
export type ScheduleState = "installed" | "absent" | "disabled" | "differs" | "unreadable"

/** Judges a planned schedule against the scheduler's tasks and the launcher on disk. */
export const scheduleState = (plan: SchedulePlan, tasks: readonly ScheduledTask[] | string): { readonly state: ScheduleState; readonly evidence: string } => {
    if (typeof tasks === "string") return { state: "unreadable", evidence: tasks }
    const task = tasks.find((candidate) => candidate.name.toLowerCase() === plan.name.toLowerCase())
    if (task === undefined) return { state: "absent", evidence: `no scheduled task ${plan.name}` }
    const same = task.command.toLowerCase() === plan.action.command.toLowerCase() && task.arguments.trim().toLowerCase() === plan.action.arguments.toLowerCase()
    if (!same) return { state: "differs", evidence: `${plan.name} runs ${task.command} ${task.arguments}` }
    const stale = plan.launchers.find((launcher) => !existsSync(launcher.path) || readFileSync(launcher.path, "utf8") !== launcher.content)
    if (stale !== undefined) return { state: "differs", evidence: `${stale.path} is missing or not what ops/host.yaml writes; starci host install ${plan.service} --execute` }
    if (!task.enabled) return { state: "disabled", evidence: `${plan.name} is disabled` }
    return { state: "installed", evidence: `${plan.name} runs ${plan.launchers.map((launcher) => launcher.path).join(", ")}` }
}

/** One service's status on this host. */
export interface ServiceStatus {
    readonly id: string
    readonly summary: string
    readonly platform: HostPlatform
    readonly state: "up" | "down" | "not installed" | "other platform"
    readonly evidence: string
    readonly schedule?: { readonly name: string; readonly state: ScheduleState | "unsupported"; readonly evidence: string }
}

/** A StarCi-named scheduled task that no service of ops/host.yaml declares: listed, never changed. */
export interface ForeignTask extends ScheduledTask {
    readonly kind: "legacy, disabled" | "not this harness's"
    readonly hint: string
}

/** The host as `host status` reports it. */
export interface HostStatus {
    readonly platform: string
    readonly services: readonly ServiceStatus[]
    readonly others: readonly ForeignTask[]
    readonly scheduler: string
}

const scheduleOf = (service: HostService, tasks: readonly ScheduledTask[] | string): ServiceStatus["schedule"] => {
    if (service.install.kind !== "schedule") return undefined
    if (process.platform !== "win32") return { name: service.install.name, state: "unsupported", evidence: `scheduling on ${process.platform} is not built; run starci supervisor tick --loop --execute in a terminal` }
    let plan: SchedulePlan
    try {
        plan = planSchedule(service)
    } catch (error: unknown) {
        return { name: service.install.name, state: "unreadable", evidence: error instanceof Error ? error.message : String(error) }
    }
    return { name: plan.name, ...scheduleState(plan, tasks) }
}

const statusOf = async (service: HostService, config: HostConfig, tasks: readonly ScheduledTask[] | string, cwd: string): Promise<ServiceStatus> => {
    const base = { id: service.id, summary: service.summary, platform: service.platform }
    if (!appliesTo(service, process.platform)) return { ...base, state: "other platform", evidence: `runs on ${service.platform}` }
    const schedule = scheduleOf(service, tasks)
    const withSchedule = schedule === undefined ? {} : { schedule }
    if (service.check !== undefined) {
        const probe = await probeService(service.check, cwd, config.checkTimeoutSeconds)
        return { ...base, state: probe.up ? "up" : "down", evidence: probe.evidence, ...withSchedule }
    }
    const scheduled = schedule?.state
    let state: ServiceStatus["state"] = "down"
    if (scheduled === "installed") state = "up"
    else if (scheduled === "absent" || scheduled === "unsupported") state = "not installed"
    const hint = state === "up" ? "" : `; starci host install ${service.id} --execute`
    return { ...base, state, evidence: `${schedule?.evidence ?? "no schedule"}${hint}`, ...withSchedule }
}

const foreignOf = (config: HostConfig, tasks: readonly ScheduledTask[] | string): ForeignTask[] => {
    if (typeof tasks === "string") return []
    const ours = new Set(config.services.flatMap((service) => (service.install.kind === "schedule" ? [service.install.name.toLowerCase()] : [])))
    return tasks
        .filter((task) => /starci/i.test(task.name) && !ours.has(task.name.toLowerCase()))
        .map((task) =>
            task.enabled
                ? { ...task, kind: "not this harness's" as const, hint: "no service of ops/host.yaml declares it; it runs something else (read its action), and host verbs never change it" }
                : { ...task, kind: "legacy, disabled" as const, hint: `not this harness's and never changed by it; when unneeded the owner removes it: schtasks /Delete /TN "${task.name}"` },
        )
}

/** Reads every service of the host and the StarCi-named tasks it does not own; changes nothing. */
export const hostStatus = async (config: HostConfig, services: readonly HostService[], cwd: string): Promise<HostStatus> => {
    const tasks = process.platform === "win32" ? await listScheduledTasks(cwd) : []
    const statuses = await Promise.all(services.map((service) => statusOf(service, config, tasks, cwd)))
    const scheduler = process.platform === "win32" ? "schtasks" : "none"
    return { platform: process.platform, services: statuses, others: foreignOf(config, tasks), scheduler: typeof tasks === "string" ? tasks : scheduler }
}

/** The services named and every service they require, ordered so that each comes after what it requires. */
export const inRequiresOrder = (config: HostConfig, services: readonly HostService[]): HostService[] => {
    const byId = new Map(config.services.map((service) => [service.id, service]))
    const ordered: HostService[] = []
    const visit = (service: HostService): void => {
        if (ordered.includes(service)) return
        for (const need of service.requires) {
            const required = byId.get(need)
            if (required !== undefined) visit(required)
        }
        ordered.push(service)
    }
    for (const service of services) visit(service)
    return ordered
}

/** What `host up` did for one service. */
export interface UpOutcome {
    readonly id: string
    readonly outcome: "already up" | "started" | "still down" | "blocked" | "not startable" | "other platform"
    readonly evidence: string
}

const POLL_MS = 2000

/**
 * Starts every service named (and what it requires) that is down, in requires order; one already up is left alone, one whose
 * requirement stayed down is blocked. A started service is up once its check says so within waitSeconds.
 */
export const hostUp = async (config: HostConfig, services: readonly HostService[], cwd: string, progress: (line: string) => void): Promise<UpOutcome[]> => {
    const upIds = new Set<string>()
    const tasks = process.platform === "win32" ? await listScheduledTasks(cwd) : []
    return inOrder(inRequiresOrder(config, services), async (service) => {
        const outcome = await upService(service, { config, tasks, cwd, upIds, progress })
        if (outcome.outcome === "other platform" || outcome.outcome === "already up" || outcome.outcome === "started") upIds.add(service.id)
        return outcome
    })
}

/**
 * The variables an agent session sets for itself and its children (Claude Code, the Anthropic SDK, Codex, Orca panes, the
 * harness role). A service started from inside such a session would hand them to every terminal it opens: Orca started from a
 * Claude Code session made each Claude it launched believe it was that session's child, so Orca never saw it become ready.
 */
const SESSION_VARIABLE = /^(CLAUDE|CLAUDECODE$|ANTHROPIC_|CODEX_|OPENAI_|ORCA_|STARCI_ROLE$)/i

/** This process's environment without the agent-session variables, for a host service to start from. */
export const serviceEnv = (): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(process.env).filter(([name]) => !SESSION_VARIABLE.test(name)))

/** Starts a service by its start argv, from a clean environment: detached, or run to its end within waitSeconds. */
const startService = async (start: NonNullable<HostService["start"]>, config: HostConfig, cwd: string): Promise<void> => {
    const argv = expandArgv(start.argv)
    if (start.detach) {
        await startDetached(argv, cwd, serviceEnv())
        return
    }
    const [tool, ...args] = argv
    if (tool !== undefined) await runTool(tool, args, cwd, { timeoutMs: config.waitSeconds * 1000, baseEnv: serviceEnv() })
}

/** Probes a started service until its check says up or the deadline passes, POLL_MS apart. */
const awaitUp = async (check: NonNullable<HostService["check"]>, config: HostConfig, cwd: string, deadline: number): Promise<Probe> => {
    const probe = await probeService(check, cwd, config.checkTimeoutSeconds)
    if (probe.up || Date.now() >= deadline) return probe
    await sleep(POLL_MS)
    return awaitUp(check, config, cwd, deadline)
}

/** `host up` for one service, its requirements already handled (`upIds` holds those that are up). */
const upService = async (
    service: HostService,
    host: { readonly config: HostConfig; readonly tasks: readonly ScheduledTask[] | string; readonly cwd: string; readonly upIds: ReadonlySet<string>; readonly progress: (line: string) => void },
): Promise<UpOutcome> => {
    const { config, cwd } = host
    if (!appliesTo(service, process.platform)) return { id: service.id, outcome: "other platform", evidence: `runs on ${service.platform}` }
    const status = await statusOf(service, config, host.tasks, cwd)
    if (status.state === "up") return { id: service.id, outcome: "already up", evidence: status.evidence }
    const down = service.requires.filter((need) => !host.upIds.has(need))
    if (down.length > 0) return { id: service.id, outcome: "blocked", evidence: `requires ${down.join(", ")}, which is not up` }
    if (service.start === undefined || service.check === undefined) return { id: service.id, outcome: "not startable", evidence: status.evidence }
    host.progress(`starting ${service.id}`)
    await startService(service.start, config, cwd)
    const probe = await awaitUp(service.check, config, cwd, Date.now() + config.waitSeconds * 1000)
    return { id: service.id, outcome: probe.up ? "started" : "still down", evidence: probe.evidence }
}

/** What `host install` or `host uninstall` did (or, without --execute, would do) for one service. */
export interface InstallOutcome {
    readonly id: string
    readonly outcome: "installed" | "uninstalled" | "absent" | "planned" | "skipped"
    readonly evidence: string
    readonly argv?: readonly string[]
    readonly launchers?: readonly Launcher[]
}

/** The platform a schedule is planned for: this host's, or another only for a dry run. */
export const targetPlatform = (platform: string | undefined, dry: boolean): string => {
    if (platform === undefined || platform === process.platform) return process.platform
    if (!dry) throw new Refusal("HOST_PLATFORM_DRY_ONLY", `--platform ${platform} plans for another host; it runs only as a dry run (without --execute)`)
    return platform
}

const assertSchedulable = (platform: string): void => {
    if (platform !== "win32") throw new Refusal("HOST_INSTALL_UNSUPPORTED", `scheduling on ${platform} is not built; run starci supervisor tick --loop --execute in a terminal`)
}

const scheduled = (services: readonly HostService[], platform: string): { readonly plans: HostService[]; readonly skipped: InstallOutcome[] } => {
    const plans: HostService[] = []
    const skipped: InstallOutcome[] = []
    for (const service of services) {
        if (!appliesTo(service, platform)) skipped.push({ id: service.id, outcome: "skipped", evidence: `runs on ${service.platform}` })
        else if (service.install.kind === "none") skipped.push({ id: service.id, outcome: "skipped", evidence: "install kind none: it registers nothing" })
        else plans.push(service)
    }
    return { plans, skipped }
}

/** Registers each named service's schedule (Windows: its launchers, then `schtasks /Create /F`, so a rerun replaces it); a dry run writes and runs nothing. */
export const hostInstall = async (services: readonly HostService[], cwd: string, dry: boolean, platform: string): Promise<InstallOutcome[]> => {
    assertSchedulable(platform)
    const { plans, skipped } = scheduled(services, platform)
    const installed = await inOrder(plans, async (service): Promise<InstallOutcome> => {
        const plan = planSchedule(service)
        if (!dry) {
            for (const launcher of plan.launchers) {
                mkdirSync(dirname(launcher.path), { recursive: true })
                writeFileSync(launcher.path, launcher.content, "utf8")
            }
            const [tool, ...args] = plan.argv
            if (tool !== undefined) await runTool(tool, args, cwd, { timeoutMs: 60_000 })
        }
        return { id: service.id, outcome: dry ? "planned" : "installed", evidence: plan.name, argv: plan.argv, launchers: plan.launchers }
    })
    return [...skipped, ...installed]
}

/** The human lines of an install or uninstall: each service's outcome, its scheduler argv as one json string per token, and its launchers. */
export const describeOutcomes = (outcomes: readonly InstallOutcome[]): string =>
    outcomes
        .map((outcome) => {
            const argv = outcome.argv === undefined ? "" : `\n  argv: [${outcome.argv.map((token) => JSON.stringify(token)).join(", ")}]`
            const body = (file: Launcher): string => file.content.split("\r\n").filter((line) => line !== "").map((line) => `    ${line}`).join("\n")
            const launcher = (outcome.launchers ?? []).map((file) => `\n  launcher ${file.path}:\n${body(file)}`).join("")
            return `${outcome.id}: ${outcome.outcome} (${outcome.evidence})${argv}${launcher}`
        })
        .join("\n")

/** Removes each named service's schedule and launchers; a task no service declares is never touched. A dry run runs nothing. */
export const hostUninstall = async (services: readonly HostService[], cwd: string, dry: boolean, platform: string): Promise<InstallOutcome[]> => {
    assertSchedulable(platform)
    const { plans, skipped } = scheduled(services, platform)
    const tasks = platform === process.platform ? await listScheduledTasks(cwd) : []
    if (typeof tasks === "string") throw new Refusal("HOST_SCHEDULER_UNREADABLE", tasks)
    const removed = await inOrder(plans, async (service): Promise<InstallOutcome> => {
        const plan = planSchedule(service)
        const argv = [schtasksPath(), "/Delete", "/F", "/TN", plan.name]
        if (dry) return { id: service.id, outcome: "planned", evidence: plan.name, argv }
        const present = tasks.some((task) => task.name.toLowerCase() === plan.name.toLowerCase())
        const [tool, ...args] = argv
        if (present && tool !== undefined) await runTool(tool, args, cwd, { timeoutMs: 60_000 })
        for (const launcher of plan.launchers) rmSync(launcher.path, { force: true })
        return present ? { id: service.id, outcome: "uninstalled", evidence: plan.name, argv } : { id: service.id, outcome: "absent", evidence: `no scheduled task ${plan.name}` }
    })
    return [...skipped, ...removed]
}
