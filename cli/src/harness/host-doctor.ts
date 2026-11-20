import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { captureTool, pidAlive, runTool, ToolNotStarted } from "../shared/exec.js"
import type { ToolRun } from "../shared/exec.js"
import { expandArgv, hostUp, serviceEnv, startEnv } from "./host.js"
import type { HostConfig, HostService } from "./host.js"
import { now, sharedStateBase } from "./ledger.js"
import { connectedChannel, loadTelegram, sendMessage, telegramBot } from "./telegram.js"

// `starci host doctor`: the stack's networks judged from inside, and repaired the least disruptive way that works.
//
// What it reads, per compose network that ops/host.yaml declares on a stack's services (`network`): whether Docker answers, whether the network
// exists, and for each member container whether it exists, runs, is healthy and is attached to the network; then, from a throwaway container
// on the network, whether each member's name resolves and each declared probe is answered. Docker's embedded DNS can stop answering on a network
// whose containers are all running and healthy (2026-11-21: `embeddings-gate` twice in one night), which no healthcheck inside the container sees.
//
// The repair ladder, each rung followed by a fresh read and tried only while something is still wrong: start what is absent or stopped, reconnect
// the members the findings implicate (a disconnect and a connect with the aliases and address they had, which registers them again with the
// network's DNS), restart them (with the rest of the network's members, whose resolver state may be as stale), and as the last resort recreate
// the network (the members stopped and disconnected, the network removed, the members recreated from their compose file; no volume is touched).

/** One thing the doctor found wrong; `service` is the ops/host.yaml service it implicates, when one. */
export interface Finding {
    readonly kind: "docker-down" | "network-missing" | "absent" | "stopped" | "unhealthy" | "detached" | "dns" | "http" | "probe-unavailable"
    readonly service: string | undefined
    readonly subject: string
    readonly detail: string
}

/** The repair rungs, least disruptive first. */
export type Rung = "docker" | "start" | "reconnect" | "restart" | "recreate"

/** One repair step: what it did (or, in a dry run, would do) to which services. */
export interface Step {
    readonly rung: Rung
    readonly targets: readonly string[]
    readonly outcome: "done" | "failed" | "planned"
    readonly evidence: string
}

/** A member of a network: a service of ops/host.yaml, its compose service, the names it answers to and what must answer there. */
export interface Member {
    readonly service: HostService
    readonly composeService: string
    readonly names: readonly string[]
    readonly ip: string | undefined
    readonly probes: readonly { readonly url: string; readonly status: number }[]
}

/** The members of one compose network of a stack. */
export interface Group {
    readonly stack: string
    readonly project: string
    readonly network: string
    readonly members: readonly Member[]
}

/** The compose project of a stack: STARCI_HOST_PROJECT (a throwaway project of a proof) or the stack's own name. */
export const projectOf = (stack: string): string => {
    const named = process.env.STARCI_HOST_PROJECT
    return named === undefined || named === "" ? stack : named
}

/** The networks the services of a stack declare, each with its members in ops/host.yaml order. */
export const doctorGroups = (config: HostConfig, stack: string): Group[] => {
    const project = projectOf(stack)
    const groups = new Map<string, Member[]>()
    for (const service of config.services.filter((candidate) => candidate.stack === stack)) {
        const network = service.network
        if (network === undefined) continue
        const composeService = service.start?.argv.at(-1)
        if (composeService === undefined) throw new Refusal("OPS_INVALID", `${service.id} declares a network but no start argv naming its compose service`)
        const member: Member = {
            service,
            composeService,
            names: [...new Set([composeService, ...network.aliases])],
            ip: network.ip,
            probes: network.probes,
        }
        groups.set(network.name, [...(groups.get(network.name) ?? []), member])
    }
    return [...groups].map(([name, members]) => ({ stack, project, network: `${project}-${name}`, members }))
}

/** One docker call: its exit code and output; a docker that cannot start answers as a failed call, so the caller reads it as Docker being down. */
export type Docker = (args: readonly string[], timeoutMs?: number) => Promise<ToolRun>

/** The real docker, run without a shell from the session-free environment. */
export const realDocker =
    (cwd: string): Docker =>
    async (args, timeoutMs = 60_000) => {
        try {
            return await captureTool("docker", args, cwd, { timeoutMs, baseEnv: serviceEnv() })
        } catch (error: unknown) {
            if (error instanceof ToolNotStarted) return { exitCode: 1, stdout: "", stderr: error.message, timedOut: false }
            throw error
        }
    }

/** What docker says of one member's container. */
interface ContainerState {
    readonly id: string
    readonly name: string
    readonly running: boolean
    readonly status: string
    readonly health: string | undefined
    readonly attached: boolean
}

const inspectSchema = z.looseObject({
    Id: z.string(),
    Name: z.string(),
    State: z.looseObject({ Running: z.boolean(), Status: z.string(), Health: z.looseObject({ Status: z.string() }).optional() }),
    NetworkSettings: z.looseObject({ Networks: z.record(z.string(), z.unknown()) }),
})

/** The container of a member in a compose project (absent when compose never created it), by the labels compose puts on it. */
const containerOf = async (docker: Docker, group: Group, member: Member): Promise<ContainerState | undefined> => {
    const listed = await docker(["ps", "-a", "-q", "--filter", `label=com.docker.compose.project=${group.project}`, "--filter", `label=com.docker.compose.service=${member.composeService}`])
    const id = listed.stdout.split(/\s+/).find((part) => part !== "")
    if (listed.exitCode !== 0 || id === undefined) return undefined
    const inspected = await docker(["inspect", id])
    if (inspected.exitCode !== 0) return undefined
    const parsed = z.array(inspectSchema).safeParse(JSON.parse(inspected.stdout) as unknown)
    const found = parsed.success ? parsed.data[0] : undefined
    if (found === undefined) return undefined
    return {
        id: found.Id,
        name: found.Name.replace(/^\//, ""),
        running: found.State.Running,
        status: found.State.Status,
        health: found.State.Health?.Status,
        attached: group.network in found.NetworkSettings.Networks,
    }
}

/** What the throwaway container on the network saw: each name's lookup and each URL's status. */
export interface ProbeSeen {
    readonly names: ReadonlyMap<string, boolean>
    readonly urls: ReadonlyMap<string, number>
}

const PROBE_SCRIPT = [
    'for n in $NAMES; do if getent hosts "$n" >/dev/null 2>&1; then echo "dns $n ok"; else echo "dns $n fail"; fi; done',
    'for u in $URLS; do c=$(curl -s -o /dev/null -m 5 -w "%{http_code}" "$u" 2>/dev/null); echo "http $u ${c:-000}"; done',
].join("\n")

/** Runs the probe from a throwaway container on the network (removed afterwards, whatever happens); undefined with the reason when it could not run. */
const probeFrom = async (docker: Docker, group: Group, config: HostConfig): Promise<ProbeSeen | string> => {
    const names = [...new Set(group.members.flatMap((member) => member.names))]
    const urls = group.members.flatMap((member) => member.probes.map((probe) => probe.url))
    const container = `${group.project}-doctor-probe-${String(process.pid)}`
    const timeoutMs = config.doctor.probeTimeoutSeconds * 1000
    const run = await docker(
        ["run", "--rm", "--name", container, "--network", group.network, "--entrypoint", "sh", "-e", `NAMES=${names.join(" ")}`, "-e", `URLS=${urls.join(" ")}`, config.doctor.probeImage, "-c", PROBE_SCRIPT],
        timeoutMs,
    )
    if (run.exitCode !== 0) {
        await docker(["rm", "-f", container])
        return `the probe container did not run on ${group.network}: ${run.timedOut ? "timed out" : (run.stderr.trim().split("\n").at(-1) ?? "no output")}`
    }
    const seenNames = new Map<string, boolean>()
    const seenUrls = new Map<string, number>()
    for (const line of run.stdout.split("\n")) {
        const [kind, subject, answer] = line.trim().split(" ")
        if (subject === undefined || answer === undefined) continue
        if (kind === "dns") seenNames.set(subject, answer === "ok")
        else if (kind === "http") seenUrls.set(subject, Number(answer))
    }
    return { names: seenNames, urls: seenUrls }
}

/** What one read of a network found: the findings (something wrong) and the members still starting (not wrong yet). */
export interface Reading {
    readonly findings: readonly Finding[]
    readonly starting: readonly string[]
}

/** Reads one network: the network, each member's container, and, when all run and none is starting, the probe from inside. */
export const readGroup = async (docker: Docker, group: Group, config: HostConfig): Promise<Reading> => {
    const network = await docker(["network", "inspect", "--format", "{{.Name}}", group.network])
    const findings: Finding[] = []
    const starting: string[] = []
    if (network.exitCode !== 0) findings.push({ kind: "network-missing", service: undefined, subject: group.network, detail: `network ${group.network} does not exist` })
    const states = await Promise.all(group.members.map(async (member) => ({ member, state: await containerOf(docker, group, member) })))
    for (const { member, state } of states) {
        const id = member.service.id
        if (state === undefined) findings.push({ kind: "absent", service: id, subject: id, detail: `${id} has no container in compose project ${group.project}` })
        else if (!state.running) findings.push({ kind: "stopped", service: id, subject: id, detail: `${state.name} is ${state.status}` })
        else if (state.health === "unhealthy") findings.push({ kind: "unhealthy", service: id, subject: id, detail: `${state.name} is unhealthy` })
        else {
            if (state.health === "starting") starting.push(id)
            if (network.exitCode === 0 && !state.attached) findings.push({ kind: "detached", service: id, subject: id, detail: `${state.name} is not attached to ${group.network}` })
        }
    }
    const probeable = network.exitCode === 0 && findings.every((finding) => finding.kind === "unhealthy" || finding.kind === "detached") && starting.length === 0 && states.every(({ state }) => state?.running === true)
    if (!probeable) return { findings, starting }
    const seen = await probeFrom(docker, group, config)
    if (typeof seen === "string") return { findings: [...findings, { kind: "probe-unavailable", service: undefined, subject: group.network, detail: seen }], starting }
    for (const member of group.members) {
        for (const name of member.names) {
            if (seen.names.get(name) !== true) findings.push({ kind: "dns", service: member.service.id, subject: name, detail: `${name} does not resolve on ${group.network}` })
        }
        for (const probe of member.probes) {
            const status = seen.urls.get(probe.url)
            if (status !== probe.status) findings.push({ kind: "http", service: member.service.id, subject: probe.url, detail: `GET ${probe.url} answered ${status === undefined || status === 0 ? "nothing" : String(status)}, not ${String(probe.status)}` })
        }
    }
    return { findings, starting }
}

/** The members a rung acts on: those the findings implicate with one of the kinds, in the network's order. */
const implicated = (group: Group, findings: readonly Finding[], kinds: readonly Finding["kind"][]): Member[] => {
    const ids = new Set(findings.filter((finding) => kinds.includes(finding.kind)).flatMap((finding) => (finding.service === undefined ? [] : [finding.service])))
    return group.members.filter((member) => ids.has(member.service.id))
}

const NETWORK_KINDS: readonly Finding["kind"][] = ["detached", "dns", "http"]

/** The rungs a group's findings call for, in order, with the members each acts on (a dry run prints this; a run tries each while findings remain). */
export const planRungs = (group: Group, findings: readonly Finding[]): { readonly rung: Rung; readonly targets: readonly Member[] }[] => {
    const plan: { rung: Rung; targets: Member[] }[] = []
    if (findings.some((finding) => finding.kind === "network-missing")) return [{ rung: "recreate", targets: [...group.members] }]
    const down = implicated(group, findings, ["absent", "stopped"])
    if (down.length > 0) plan.push({ rung: "start", targets: down })
    const reachable = implicated(group, findings, NETWORK_KINDS)
    if (reachable.length > 0) plan.push({ rung: "reconnect", targets: reachable })
    const restart = findings.some((finding) => NETWORK_KINDS.includes(finding.kind)) ? [...group.members] : implicated(group, findings, ["unhealthy"])
    if (restart.length > 0) plan.push({ rung: "restart", targets: restart })
    if (findings.some((finding) => finding.kind !== "absent" && finding.kind !== "stopped")) plan.push({ rung: "recreate", targets: [...group.members] })
    return plan
}

const memberIds = (members: readonly Member[]): string[] => members.map((member) => member.service.id)

/** `docker compose up` for members, from the argv ops/host.yaml declares (its `--no-recreate` swapped for what the rung needs), grouped by compose file. */
const composeUp = async (members: readonly Member[], flags: readonly string[], cwd: string, timeoutMs: number): Promise<void> => {
    const byFiles = new Map<string, Member[]>()
    for (const member of members) {
        const start = member.service.start
        if (start === undefined) throw new Refusal("OPS_INVALID", `${member.service.id} declares no start`)
        const key = JSON.stringify(start.argv.slice(0, -4))
        byFiles.set(key, [...(byFiles.get(key) ?? []), member])
    }
    for (const group of byFiles.values()) {
        const first = group[0]?.service.start
        if (first === undefined) continue
        const prefix = expandArgv(first.argv.slice(0, -4))
        const [tool, ...args] = [...prefix, "up", "-d", ...flags, ...group.map((member) => member.composeService)]
        if (tool !== undefined) await runTool(tool, args, cwd, { timeoutMs, baseEnv: serviceEnv(), env: startEnv(first) })
    }
}

const reconnect = async (docker: Docker, group: Group, member: Member, container: ContainerState): Promise<void> => {
    if (container.attached) await docker(["network", "disconnect", "--force", group.network, container.name])
    const connect = await docker(["network", "connect", ...member.names.flatMap((name) => ["--alias", name]), ...(member.ip === undefined ? [] : ["--ip", member.ip]), group.network, container.name])
    if (connect.exitCode !== 0) throw new Refusal("HOST_DOCTOR_RECONNECT", `docker network connect ${group.network} ${container.name} failed: ${connect.stderr.trim().split("\n").at(-1) ?? "no output"}`)
}

/** Reads again until no member is starting or `healthySeconds` pass; the last reading is the answer. */
const settled = async (docker: Docker, group: Group, config: HostConfig): Promise<Reading> => {
    await sleep(config.doctor.settleSeconds * 1000)
    const deadline = Date.now() + config.doctor.healthySeconds * 1000
    let reading = await readGroup(docker, group, config)
    while (reading.starting.length > 0 && Date.now() < deadline) {
        await sleep(2000)
        reading = await readGroup(docker, group, config)
    }
    return reading
}

const containersOf = async (docker: Docker, group: Group, members: readonly Member[]): Promise<ContainerState[]> => {
    const states = await Promise.all(members.map((member) => containerOf(docker, group, member)))
    return states.flatMap((state) => (state === undefined ? [] : [state]))
}

/** Performs one rung on its targets. */
const perform = async (rung: Exclude<Rung, "docker">, targets: readonly Member[], group: Group, docker: Docker, cwd: string, config: HostConfig): Promise<string> => {
    const timeoutMs = config.waitSeconds * 1000
    if (rung === "start") {
        await composeUp(targets, ["--no-recreate"], cwd, timeoutMs)
        return `compose up --no-recreate ${targets.map((member) => member.composeService).join(" ")}`
    }
    if (rung === "reconnect") {
        for (const member of targets) {
            const container = (await containersOf(docker, group, [member]))[0]
            if (container !== undefined) await reconnect(docker, group, member, container)
        }
        return `disconnected and connected again to ${group.network}, with the names and the address of ops/host.yaml`
    }
    if (rung === "restart") {
        for (const container of await containersOf(docker, group, targets)) {
            const restarted = await docker(["restart", "--time", "10", container.name], timeoutMs)
            if (restarted.exitCode !== 0) throw new Refusal("HOST_DOCTOR_RESTART", `docker restart ${container.name} failed: ${restarted.stderr.trim().split("\n").at(-1) ?? "no output"}`)
        }
        return `docker restart ${targets.map((member) => member.composeService).join(", ")}`
    }
    const containers = await containersOf(docker, group, targets)
    for (const container of containers) await docker(["stop", "--time", "10", container.name], timeoutMs)
    for (const container of containers) await docker(["network", "disconnect", "--force", group.network, container.name])
    const removed = await docker(["network", "rm", group.network])
    const gone = removed.exitCode === 0 || /not found|No such network/i.test(removed.stderr)
    if (!gone) throw new Refusal("HOST_DOCTOR_NETWORK", `docker network rm ${group.network} failed: ${removed.stderr.trim().split("\n").at(-1) ?? "no output"}`)
    await composeUp(targets, ["--force-recreate", "--no-deps"], cwd, timeoutMs)
    return `network ${group.network} removed, ${targets.map((member) => member.composeService).join(", ")} recreated by compose (no volume touched)`
}

/** One network's report: what was found, what was done and what remains. */
export interface GroupReport {
    readonly network: string
    readonly findings: readonly Finding[]
    readonly steps: readonly Step[]
    readonly remaining: readonly Finding[]
    /** "healthy": nothing wrong; "fixed": wrong and now right; "unfixed": still wrong; "found": wrong, no repair asked for. */
    readonly state: "healthy" | "fixed" | "unfixed" | "found"
}

/** The report of one `host doctor` run. */
export interface DoctorReport {
    readonly stack: string
    readonly project: string
    readonly docker: { readonly up: boolean; readonly evidence: string }
    readonly groups: readonly GroupReport[]
    readonly fixed: boolean
    readonly dry: boolean
}

/** What a run does: only read, plan the repairs (`fix`), or perform them (`fix` and `execute`). */
export interface DoctorOptions {
    readonly fix: boolean
    readonly execute: boolean
    readonly cwd: string
    readonly progress: (line: string) => void
    readonly docker?: Docker
}

const repairGroup = async (group: Group, first: Reading, docker: Docker, config: HostConfig, options: DoctorOptions): Promise<GroupReport> => {
    if (first.findings.length === 0) return { network: group.network, findings: [], steps: [], remaining: [], state: "healthy" }
    const plan = planRungs(group, first.findings)
    if (!options.fix) return { network: group.network, findings: first.findings, steps: [], remaining: first.findings, state: "found" }
    if (!options.execute) {
        const steps = plan.map(({ rung, targets }): Step => ({ rung, targets: memberIds(targets), outcome: "planned", evidence: "dry run: pass --execute to perform it" }))
        return { network: group.network, findings: first.findings, steps, remaining: first.findings, state: "found" }
    }
    const steps: Step[] = []
    let reading = first
    for (const rung of ["start", "reconnect", "restart", "recreate"] as const) {
        const current = planRungs(group, reading.findings).find((candidate) => candidate.rung === rung)
        if (current === undefined) continue
        options.progress(`${group.network}: ${rung} ${memberIds(current.targets).join(", ")}`)
        try {
            const evidence = await perform(rung, current.targets, group, docker, options.cwd, config)
            reading = await settled(docker, group, config)
            steps.push({ rung, targets: memberIds(current.targets), outcome: reading.findings.length === 0 ? "done" : "failed", evidence })
        } catch (error: unknown) {
            steps.push({ rung, targets: memberIds(current.targets), outcome: "failed", evidence: error instanceof Error ? error.message : String(error) })
            reading = await readGroup(docker, group, config)
        }
        if (reading.findings.length === 0) break
    }
    return { network: group.network, findings: first.findings, steps, remaining: reading.findings, state: reading.findings.length === 0 ? "fixed" : "unfixed" }
}

/** Reads every network of the stack, and with `fix` repairs what is wrong (with `execute`; without it, only the plan). */
export const runDoctor = async (config: HostConfig, stack: string, options: DoctorOptions): Promise<DoctorReport> => {
    const docker = options.docker ?? realDocker(options.cwd)
    const groups = doctorGroups(config, stack)
    if (groups.length === 0) throw new Refusal("HOST_NO_NETWORK", `no service of stack ${stack} declares a network in ops/host.yaml, so there is nothing for host doctor to judge`)
    const project = projectOf(stack)
    let info = await docker(["info", "--format", "{{.ServerVersion}}"], config.checkTimeoutSeconds * 1000)
    let dockerStep = ""
    if (info.exitCode !== 0 && options.fix && options.execute) {
        const docks = config.services.filter((service) => service.id === "docker")
        options.progress("docker does not answer: host up docker")
        const outcomes = await hostUp(config, docks, options.cwd, options.progress)
        dockerStep = outcomes.map((outcome) => `${outcome.id}: ${outcome.outcome}`).join(", ")
        info = await docker(["info", "--format", "{{.ServerVersion}}"], config.checkTimeoutSeconds * 1000)
    }
    if (info.exitCode !== 0) {
        const finding: Finding = { kind: "docker-down", service: "docker", subject: "docker", detail: `docker does not answer: ${info.stderr.trim().split("\n").at(-1) ?? "no output"}` }
        const steps: Step[] = options.fix ? [{ rung: "docker", targets: ["docker"], outcome: options.execute ? "failed" : "planned", evidence: options.execute ? dockerStep : "dry run: pass --execute to start Docker Desktop" }] : []
        return {
            stack,
            project,
            docker: { up: false, evidence: finding.detail },
            groups: groups.map((group) => ({ network: group.network, findings: [finding], steps, remaining: [finding], state: options.fix && options.execute ? "unfixed" : "found" })),
            fixed: false,
            dry: !options.execute,
        }
    }
    const reports: GroupReport[] = []
    for (const group of groups) {
        const first = await readGroup(docker, group, config)
        // A container that is only starting is neither healthy nor wrong yet: it gets until its healthcheck decides, once.
        const reading = first.starting.length > 0 && first.findings.length === 0 ? await settled(docker, group, config) : first
        reports.push(await repairGroup(group, reading, docker, config, options))
    }
    const repaired = dockerStep === "" ? undefined : dockerStep
    const detail = repaired === undefined ? `docker ${info.stdout.trim()}` : `docker ${info.stdout.trim()} (was down; ${repaired})`
    return { stack, project, docker: { up: true, evidence: detail }, groups: reports, fixed: reports.every((report) => report.state === "healthy" || report.state === "fixed"), dry: !options.execute }
}

/** The human lines of a report. */
export const describeDoctor = (report: DoctorReport): string => {
    const lines = [`host doctor, stack ${report.stack} (compose project ${report.project}): ${report.docker.evidence}`]
    for (const group of report.groups) {
        lines.push(`${group.network}: ${group.state}`)
        for (const finding of group.findings) lines.push(`  found ${finding.kind}: ${finding.detail}`)
        for (const step of group.steps) lines.push(`  ${step.outcome === "planned" ? "would " : ""}${step.rung} ${step.targets.join(", ")}: ${step.outcome} (${step.evidence})`)
        if (group.state === "unfixed") for (const finding of group.remaining) lines.push(`  still ${finding.kind}: ${finding.detail}`)
    }
    return lines.join("\n")
}

/** The Telegram text of a run that found something. */
export const alertText = (report: DoctorReport): string => {
    const broken = report.groups.filter((group) => group.state !== "healthy")
    const verdict = report.dry ? "problems found, none repaired (dry run)" : report.fixed ? "repaired by host doctor" : "NOT repaired, it needs the owner"
    const lines = [`Host stack ${report.stack}: ${verdict}`]
    for (const group of broken) {
        lines.push("", group.network)
        for (const finding of group.findings) lines.push(`found: ${finding.detail}`)
        for (const step of group.steps) lines.push(`${step.rung} ${step.targets.join(", ")}: ${step.outcome}`)
        if (group.state === "unfixed") for (const finding of group.remaining) lines.push(`still: ${finding.detail}`)
    }
    return lines.join("\n")
}

/** What an incident has told the owner: nothing yet (the send failed, its text pending), that it is not repaired, or that it is repaired. */
export interface Incident {
    readonly open: boolean
    readonly since: string
    readonly told: "none" | "unfixed" | "fixed"
    readonly pending: string | null
}

/** No incident. */
export const NO_INCIDENT: Incident = { open: false, since: "", told: "none", pending: null }

/** The one message that closes an incident the owner was told is not repaired. */
export const RECOVERED_TEXT = "Host stack recovered: host doctor finds every service answering again."

/**
 * The deduplication of the alerts: one message when an incident opens (repaired or not), none while it stays open and unrepaired, and
 * one more only when an incident the owner was told is not repaired later closes. `detected` is whether this run found anything,
 * `fixed` whether the stack is right now. The returned incident assumes the send succeeds; a send that fails is stored as pending.
 */
export const nextIncident = (previous: Incident, run: { readonly detected: boolean; readonly fixed: boolean; readonly text: string }, at: string): { readonly incident: Incident; readonly send: string | null } => {
    if (!run.detected) {
        if (!previous.open) return { incident: NO_INCIDENT, send: null }
        const send = previous.told === "none" ? previous.pending : RECOVERED_TEXT
        return { incident: { ...NO_INCIDENT, since: previous.since }, send }
    }
    const opened: Incident = { open: !run.fixed, since: previous.open ? previous.since : at, told: run.fixed ? "fixed" : "unfixed", pending: null }
    if (!previous.open || previous.told === "none") return { incident: opened, send: run.text }
    if (run.fixed) return { incident: { ...opened, open: false }, send: run.text }
    return { incident: previous, send: null }
}

const stateDir = (): string => join(sharedStateBase(), "host-doctor")

const incidentSchema = z.strictObject({ open: z.boolean(), since: z.string(), told: z.enum(["none", "unfixed", "fixed"]), pending: z.string().nullable() })

const incidentFile = (stack: string): string => join(stateDir(), `${stack}.json`)

const readIncident = (stack: string): Incident => {
    const file = incidentFile(stack)
    if (!existsSync(file)) return NO_INCIDENT
    try {
        return incidentSchema.parse(JSON.parse(readFileSync(file, "utf8")))
    } catch {
        return NO_INCIDENT
    }
}

const writeIncident = (stack: string, incident: Incident): void => {
    mkdirSync(stateDir(), { recursive: true })
    writeFileSync(incidentFile(stack), `${JSON.stringify(incident, null, 2)}\n`, "utf8")
}

/** The alert's seam: where a message goes (the owner's Telegram chat) and what stands in for it in a test. */
export type Alerter = (text: string) => Promise<void>

/** Sends to the owner channel of ops/telegram.yaml (the bot token by the secret loader, the chat `connect telegram discover-chat` stored). Refuses with the reason when the channel is not set up. */
export const telegramAlerter: Alerter = async (text) => {
    const config = loadTelegram()
    const bot = telegramBot(config)
    const channel = connectedChannel()
    await sendMessage(bot, channel.chatId, text)
}

/** What happened to the alert of a run. */
export interface AlertOutcome {
    readonly state: "none" | "sent" | "pending" | "dry" | "deduplicated"
    readonly text: string | null
    readonly evidence: string
}

/**
 * Tells the owner what this run found, once per incident (see nextIncident). Without `execute` nothing is sent and nothing is stored: the
 * text a run would send is returned as a dry run.
 */
export const alertOwner = async (report: DoctorReport, options: { readonly execute: boolean; readonly alerter?: Alerter }): Promise<AlertOutcome> => {
    const detected = report.groups.some((group) => group.state !== "healthy") || !report.docker.up
    const text = alertText(report)
    if (!options.execute) return detected ? { state: "dry", text, evidence: "dry run: this text would go to the owner's Telegram channel" } : { state: "none", text: null, evidence: "nothing found" }
    const { incident, send } = nextIncident(readIncident(report.stack), { detected, fixed: report.fixed, text }, now())
    if (send === null) {
        writeIncident(report.stack, incident)
        return { state: detected ? "deduplicated" : "none", text: null, evidence: detected ? "the incident is already open and the owner was told" : "nothing found" }
    }
    try {
        await (options.alerter ?? telegramAlerter)(send)
    } catch (error: unknown) {
        writeIncident(report.stack, { ...incident, open: true, told: "none", pending: send })
        return { state: "pending", text: send, evidence: `not sent, the next run tries again: ${error instanceof Error ? error.message : String(error)}` }
    }
    writeIncident(report.stack, incident)
    return { state: "sent", text: send, evidence: "sent to the owner's Telegram channel" }
}

/** Holds the run of one stack for its own duration, refusing HOST_DOCTOR_BUSY while another doctor of the stack runs (a stale lock of a dead process is taken over). */
export const withDoctorLock = async <T>(stack: string, work: () => Promise<T>): Promise<T> => {
    mkdirSync(stateDir(), { recursive: true })
    const file = join(stateDir(), `${stack}.lock`)
    if (existsSync(file)) {
        const holder = Number(readFileSync(file, "utf8").trim())
        if (Number.isInteger(holder) && holder > 0 && holder !== process.pid && pidAlive(holder)) throw new Refusal("HOST_DOCTOR_BUSY", `another host doctor of stack ${stack} runs (pid ${String(holder)})`)
    }
    writeFileSync(file, String(process.pid), "utf8")
    try {
        return await work()
    } finally {
        rmSync(file, { force: true })
    }
}
