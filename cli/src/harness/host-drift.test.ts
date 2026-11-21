// The config drift of `host up --host` without a server: the files a deployer would write now are compared with the server's by one sha256 each
// (the same digest the read-only script prints, checked in a real bash when one is here); an owned running service whose rendered config differs
// (the monitor stack of sv-hk-1 before its dns_search fix) or whose pinned images moved is planned `update`, an identical one `keep`, an adopted
// one with drift stays `adopt` (reported only); and `--execute` hands exactly the update and deploy steps to their deployer, the monitor stack once.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { registerMachine } from "../core/vps/machines.js"
import { judgeRemote, machineScope, planUp, readObserved, runUpPlan, withConfigDrift } from "./host-machine.js"
import type { MachineScope, ServiceState, UpHooks, UpStep } from "./host-machine.js"
import { loadHostRoles, placementImages, placementOf } from "./host-roles.js"
import type { Placement } from "./host-roles.js"
import { configDriftScript, contentDigest, readConfigDrift } from "./vps/drift.js"
import type { DesiredFile } from "./vps/drift.js"
import { loadMonitorComponents, monitorDesiredFiles, monitorDir, monitorImages, renderMonitor, selectComponents } from "./vps/monitor.js"
import { loadVpsPolicy } from "./vps/policy.js"

const opsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "ops")
const catalog = loadHostRoles(opsDir)
const policy = loadVpsPolicy(opsDir)

const remote = (id: string): Placement => {
    const placement = placementOf(catalog, id, "remote")
    if (placement === undefined) throw new Error(`${id} has no remote placement`)
    return placement
}

/** A temp state base for config.yaml with one machine `box-1` (app-host, monitor, edge); STARCI_LOCAL_ROOT is restored after. */
const boxScope = (t: { after: (fn: () => void) => void }): MachineScope => {
    const saved = process.env.STARCI_LOCAL_ROOT
    const dir = mkdtempSync(join(tmpdir(), "starci-drift-"))
    process.env.STARCI_LOCAL_ROOT = dir
    t.after(() => {
        if (saved === undefined) delete process.env.STARCI_LOCAL_ROOT
        else process.env.STARCI_LOCAL_ROOT = saved
        rmSync(dir, { recursive: true, force: true })
    })
    registerMachine({ name: "box-1", host: "203.0.113.7", user: "starci-ops", roles: "app-host,monitor,edge" }, opsDir)
    return machineScope("box-1", opsDir)
}

/** The server's Docker: every monitor component of the box at its pin, 1/1; Portainer and Traefik under other names (adopted), Traefik off its pin. */
const observedBox = (scope: MachineScope): ReturnType<typeof readObserved> => {
    const lines = ["swarm=active", "stack starci-monitor"]
    for (const id of scope.services) {
        const placement = remote(id)
        if (placement.via !== "vps-monitor") continue
        const images = placementImages(placement, opsDir)
        placement.components.forEach((component, index) => lines.push(`svc starci-monitor_${component}|1/1|${images[index] ?? ""}`))
    }
    lines.push(`svc proxy_traefik|1/1|traefik:v3.1.0@sha256:${"a".repeat(64)}`, "ctr portainer|portainer/portainer-ce:2.33.8|")
    return readObserved(lines.join("\n"))
}

const judged = (scope: MachineScope): ServiceState[] => {
    const seen = observedBox(scope)
    return scope.services.map((id) => judgeRemote(id, "s", remote(id), placementImages(remote(id), opsDir), seen, new Set()))
}

/** The monitor files `vps monitor up` renders for the default components (the files its `cmp -s` compares before it redeploys). */
const monitorFiles = (): DesiredFile[] => {
    const components = loadMonitorComponents(policy, opsDir)
    const selected = selectComponents(components)
    const render = renderMonitor(policy, monitorDir(policy, opsDir), components, selected, monitorImages(components, selected, opsDir), { target: { kind: "local" }, alertBots: [] })
    return monitorDesiredFiles(render, "/opt/starci/monitor")
}

/** What the read-only script answers for a server holding `held` (by label; a file absent from it is not on the server). */
const answer = (files: readonly DesiredFile[], held: Readonly<Record<string, string>>): string =>
    files.map((file, index) => (held[file.label] === undefined ? `file ${String(index)} absent` : `file ${String(index)} ${contentDigest(held[file.label] ?? "")}`)).join("\n")

/** Applies one comparison to every monitor service, as host up does (one stack, compared once). */
const withMonitorDrift = (scope: MachineScope, states: readonly ServiceState[], drift: readonly string[]): ServiceState[] => states.map((state) => (placementOf(scope.catalog, state.id, scope.site)?.via === "vps-monitor" ? withConfigDrift(state, drift) : state))

const byId = (plan: readonly UpStep[]): Partial<Record<string, UpStep>> => Object.fromEntries(plan.map((step) => [step.id, step]))

void test("a monitor stack running 1/1 whose rendered config differs from the server's is planned update, naming the files", (t) => {
    const scope = boxScope(t)
    const files = monitorFiles()
    const stack = files.find((file) => file.label === "monitor/stack.yml")
    assert.ok(stack?.content.includes("dns_search"), "the rendered stack carries the dns_search fix")
    // The server holds the stack file of before the fix (no dns_search) and every other file as rendered.
    const held = Object.fromEntries(files.map((file) => [file.label, file === stack ? file.content.replaceAll(/^\s*dns_search:\n(?:\s*- .*\n)+/gm, "") : file.content]))
    const read = readConfigDrift(files, answer(files, held))
    assert.deepEqual(read, { drift: ["monitor/stack.yml differs"], unread: [] })
    const plan = byId(planUp(scope, withMonitorDrift(scope, judged(scope), read.drift)))
    for (const id of ["monitor.prometheus", "monitor.grafana", "monitor.loki", "monitor.alertmanager", "monitor.exporters"]) {
        assert.equal(plan[id]?.action, "update", `${id} runs 1/1 but its config drifted`)
        assert.match(plan[id].detail, /^config drift: monitor\/stack\.yml differs: starci vps monitor up box-1 with .* --execute, then wait for its health$/u)
        assert.match(plan[id].rollback ?? "", /^docker service rollback starci-monitor_/u, "an update rolls back to the previous spec, never docker stack rm")
    }
})

void test("identical rendered files give keep; a file not on the server is drift; an unread file is no drift", (t) => {
    const scope = boxScope(t)
    const files = monitorFiles()
    const same = readConfigDrift(files, answer(files, Object.fromEntries(files.map((file) => [file.label, `${file.content}\n\n`]))))
    assert.deepEqual(same, { drift: [], unread: [] }, "trailing newlines are not a change: the deployers write content.trimEnd()")
    const plan = byId(planUp(scope, withMonitorDrift(scope, judged(scope), same.drift)))
    for (const id of ["monitor.prometheus", "monitor.grafana", "monitor.loki", "monitor.alertmanager", "monitor.exporters"]) assert.equal(plan[id]?.action, "keep", `${id} runs as rendered`)
    const missing = readConfigDrift(files, answer(files, Object.fromEntries(files.filter((file) => file.label !== "monitor/alerts.yml").map((file) => [file.label, file.content]))))
    assert.deepEqual(missing.drift, ["monitor/alerts.yml is not on the server"])
    assert.deepEqual(readConfigDrift(files, "").unread.length, files.length, "an empty answer is unread, never a drift")
    assert.deepEqual(readConfigDrift(files, "").drift, [])
})

void test("an owned running service whose pinned image moved is planned update; an adopted service with drift stays adopt, reported only", (t) => {
    const scope = boxScope(t)
    const states = judged(scope).map((state) => (state.id === "monitor.grafana" ? { ...state, drift: [`grafana/grafana runs sha256:${"b".repeat(64)}, not the pinned sha256:${"c".repeat(64)}`] } : state))
    const plan = byId(planUp(scope, states))
    assert.equal(plan["monitor.grafana"]?.action, "update")
    assert.match(plan["monitor.grafana"].detail, /^image drift: grafana\/grafana runs/u)
    assert.equal(plan["monitor.prometheus"]?.action, "keep")
    const traefik = states.find((state) => state.id === "edge.traefik")
    assert.ok(traefik !== undefined)
    assert.equal(traefik.state, "adopted")
    assert.equal(traefik.drift.length, 1)
    // An adopted service is never compared: a config drift handed to it is not taken, and its image drift never makes an update.
    assert.deepEqual(withConfigDrift(traefik, ["edge/stack.yml differs"]).configDrift, [])
    assert.equal(plan["edge.traefik"]?.action, "adopt")
    assert.match(plan["edge.traefik"].detail, /drift \(reported only\)/u)
    assert.equal(plan["monitor.portainer"]?.action, "adopt")
    assert.equal(plan["edge.traefik"].rollback, null)
})

void test("--execute hands exactly the update and deploy steps to their deployer, the monitor stack once, and rolls an unhealthy update back", async (t) => {
    const scope = boxScope(t)
    const states = withMonitorDrift(scope, judged(scope), ["monitor/stack.yml differs"])
    const plan = planUp(scope, states)
    const calls: string[] = []
    const rolled: string[] = []
    const progress: string[] = []
    const hooks: UpHooks = {
        deploy: (step, placement) => {
            calls.push(`${step.action} ${step.id} via ${placement.via}`)
            return Promise.resolve({ ok: true, detail: "monitor-stack: changed" })
        },
        awaitHealthy: (step) => Promise.resolve({ ok: true, evidence: `${step.id} 1/1` }),
        rollback: (step) => {
            rolled.push(step.id)
            return Promise.resolve("rolled")
        },
        progress: (line) => {
            progress.push(line)
        },
    }
    const outcomes = await runUpPlan(scope, plan, hooks, { rollback: true })
    assert.deepEqual(calls, ["update monitor.prometheus via vps-monitor"], "the five monitor services are one stack: one vps monitor up; traefik and portainer are adopted, never deployed")
    const outcome = Object.fromEntries(outcomes.map((one) => [one.id, one.outcome]))
    for (const id of ["monitor.prometheus", "monitor.grafana", "monitor.loki", "monitor.alertmanager", "monitor.exporters"]) assert.equal(outcome[id], "updated")
    assert.equal(outcome["edge.traefik"], "adopted")
    assert.equal(outcome["monitor.portainer"], "adopted")
    assert.deepEqual(rolled, [])
    // Nothing drifted: nothing is handed to a deployer.
    calls.length = 0
    await runUpPlan(scope, planUp(scope, judged(scope)), hooks, { rollback: true })
    assert.deepEqual(calls, [])
    // An update that never turns healthy is rolled back by the hook, once.
    const unhealthy = await runUpPlan(scope, plan, { ...hooks, awaitHealthy: () => Promise.resolve({ ok: false, evidence: "0/1" }) }, { rollback: true })
    assert.deepEqual(rolled, ["monitor.prometheus"])
    assert.equal(unhealthy.find((one) => one.id === "monitor.grafana")?.outcome, "rolled back")
})

/** Git for Windows' bash on win32 (never WSL's), bash elsewhere; null when none is here. */
const realBash = (): string | null => {
    if (process.platform !== "win32") return "bash"
    const git = join(process.env.ProgramFiles ?? "C:/Program Files", "Git", "bin", "bash.exe")
    return existsSync(git) ? git : null
}

void test("the read-only script prints the same digest as contentDigest for a file written the way the deployers write it, and absent for none", (t) => {
    const bash = realBash()
    if (bash === null) {
        t.skip("no bash on this machine")
        return
    }
    const dir = mkdtempSync(join(tmpdir(), "starci-drift-sh-"))
    t.after(() => {
        rmSync(dir, { recursive: true, force: true })
    })
    const content = "version: \"3.8\"\nservices:\n  a:\n    dns_search:\n      - .\n"
    const written = join(dir, "stack.yml").replaceAll("\\", "/")
    // The deployers write content.trimEnd() and one newline (a heredoc).
    writeFileSync(written, `${content.trimEnd()}\n`)
    const files: DesiredFile[] = [
        { path: written, label: "stack.yml", content },
        { path: join(dir, "none.yml").replaceAll("\\", "/"), label: "none.yml", content: "x" },
        { path: written, label: "other.yml", content: "something else" },
    ]
    const run = spawnSync(bash, ["-s"], { input: configDriftScript(files), encoding: "utf8" })
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(readConfigDrift(files, run.stdout), { drift: ["none.yml is not on the server", "other.yml differs"], unread: [] })
})
