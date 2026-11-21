// The host roles without a machine or the network: ops/host-roles.yaml loads and holds no address, its pins are the deployers' own (the host
// stack's compose files, the VPS embeddings catalog, the monitoring components), the roles of a machine and their toggles give the right union,
// config.yaml is written and read back under STARCI_LOCAL_ROOT only, the judgement of a server's Docker adopts and reports drift, the plan
// never redeploys what runs, the embed parity guard refuses mixed vectors, and an app's hostServices are judged by config.yaml.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"
import { registerMachine } from "../core/vps/machines.js"
import { loadHost, valueAt } from "./host.js"
import { cosine, embedBody, endpointsOf, judgeParity, judgeRemote, machineScope, planUp, readHttp, readObserved, remoteEmbedScript, remoteLockScript, vectorOf } from "./host-machine.js"
import type { Observed } from "./host-machine.js"
import { judgeNeeds, readHostNeeds, requireHostServices, serverOfRecipient, targetOf } from "./host-needs.js"
import { applyRoles, canonicalService, imageRepository, loadHostRoles, machineServices, placementImages, placementOf, roleService, serviceIds } from "./host-roles.js"
import type { HostRoles, Placement } from "./host-roles.js"
import { allMachines, importedFields, readMachines, writeMachines } from "./machines.js"
import type { MachinesRead } from "./machines.js"
import { loadServer, loadVpsPolicy } from "./vps/policy.js"
import { loadService } from "./vps/services.js"
import { loadMonitorComponents } from "./vps/monitor.js"

const opsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "ops")
const catalog = loadHostRoles(opsDir)

const remote = (id: string): Placement => {
    const placement = placementOf(catalog, id, "remote")
    if (placement === undefined) throw new Error(`${id} has no remote placement`)
    return placement
}
const local = (id: string): Placement => {
    const placement = placementOf(catalog, id, "local")
    if (placement === undefined) throw new Error(`${id} has no local placement`)
    return placement
}

/** A temp state base for config.yaml; STARCI_LOCAL_ROOT is restored after. */
const withState = (t: { after: (fn: () => void) => void }): string => {
    const saved = process.env.STARCI_LOCAL_ROOT
    const dir = mkdtempSync(join(tmpdir(), "starci-roles-"))
    process.env.STARCI_LOCAL_ROOT = dir
    t.after(() => {
        if (saved === undefined) delete process.env.STARCI_LOCAL_ROOT
        else process.env.STARCI_LOCAL_ROOT = saved
        rmSync(dir, { recursive: true, force: true })
    })
    return dir
}

void test("ops/host-roles.yaml loads: the four roles of the owner's words and dev, app-host on swarm with k3s declared, no address", () => {
    assert.deepEqual(Object.keys(catalog.roles), ["app-host", "starci", "monitor", "edge", "dev"])
    assert.equal(catalog.roles["app-host"]?.engine, "swarm")
    assert.deepEqual(catalog.roles["app-host"].engines, { swarm: "built", k3s: "declared" })
    assert.deepEqual(Object.keys(catalog.roles.starci?.services ?? {}), ["embed", "buildkit", "sonar", "registry"])
    assert.deepEqual(Object.keys(catalog.roles.monitor?.services ?? {}), ["prometheus", "grafana", "loki", "alertmanager", "exporters", "portainer"])
    assert.deepEqual(Object.keys(catalog.roles.edge?.services ?? {}), ["traefik"])
    const text = readFileSync(join(opsDir, "host-roles.yaml"), "utf8")
    assert.doesNotMatch(text.replaceAll("127.0.0.1", "loopback"), /\b(?:\d{1,3}\.){3}\d{1,3}\b/u, "no machine address in the pushed catalog (loopback only)")
    assert.doesNotMatch(text, /sv-hk-1/u, "no machine is named in the generic catalog")
    for (const id of serviceIds(catalog)) {
        for (const site of ["local", "remote"] as const) {
            const placement = placementOf(catalog, id, site)
            if (placement === undefined) continue
            assert.ok(["swarm-stack", "host-compose"].includes(placement.kind), `${id} ${site}`)
            for (const image of placementImages(placement, opsDir)) assert.match(image, /@sha256:[0-9a-f]{64}$/u, `${id} ${site} pins ${image} by digest`)
        }
    }
})

void test("starci.embed pins qwen3-embedding:4b at its native 2560 dimensions by its full manifest digest, the same on the PC and the VPS catalog", () => {
    const model = roleService(catalog, "starci.embed").model
    assert.equal(model?.name, "qwen3-embedding:4b")
    assert.equal(model.dimensions, 2560)
    assert.equal(model.digest, "df5bd2e3c74cd8d069d21dc038f1b359fcdc9458fce1c99bd43c9eb1518ff907")
    assert.equal(model.minCosine, 0.999)
    const policy = loadVpsPolicy(opsDir)
    const embeddings = loadService(policy, opsDir, "embeddings")
    const fallback = embeddings.model?.variants[embeddings.model.default]
    assert.equal(fallback?.name, model.name, "the VPS serves the pinned model by default")
    assert.equal(fallback.digest, model.digest)
    assert.equal(fallback.dimensions, model.dimensions)
    const host = loadHost(opsDir).services.find((service) => service.id === "embeddings")
    assert.deepEqual(host?.check?.json, { path: "models.*.name", includes: model.name }, "the PC's Ollama is judged by the pinned model, at any position of its list")
    assert.deepEqual(valueAt({ models: [{ name: "qwen3-embedding:4b" }, { name: "qwen3-embedding:8b" }] }, "models.*.name"), ["qwen3-embedding:4b", "qwen3-embedding:8b"])
    assert.equal(valueAt({ models: [{ name: "a" }] }, "models.0.name"), "a")
})

void test("the catalog's pins and limits are the deployers' own: the host stack compose files, the VPS embeddings components, the monitoring components", () => {
    const composeImages = ["embeddings.yaml", "sonar.yaml", "registry.yaml", "tunnel.yaml"].flatMap((file) => [...readFileSync(join(opsDir, "host", "stack", file), "utf8").matchAll(/^\s+image: (\S+)$/gmu)].map((match) => match[1] ?? ""))
    for (const id of ["starci.embed", "starci.sonar", "starci.registry"]) for (const image of placementImages(local(id), opsDir)) assert.ok(composeImages.includes(image), `${id}: ${image} is what ops/host/stack runs`)
    const policy = loadVpsPolicy(opsDir)
    const embeddings = loadService(policy, opsDir, "embeddings")
    const embed = remote("starci.embed")
    assert.deepEqual(embed.images, Object.values(embeddings.components).map((component) => component.image))
    const megabytes = (size: string): number => (size.endsWith("G") ? Number(size.slice(0, -1)) * 1024 : Number(size.slice(0, -1)))
    assert.equal(megabytes(embed.limits?.memory ?? "0M"), Object.values(embeddings.components).reduce((sum, component) => sum + megabytes(component.resources.memory), 0))
    assert.equal(embed.network, embeddings.network)
    assert.equal(embed.endpoint, embeddings.app.url)
    const components = loadMonitorComponents(policy, opsDir)
    for (const id of serviceIds(catalog).filter((one) => one.startsWith("monitor."))) {
        const placement = remote(id)
        if (placement.via !== "vps-monitor") continue
        assert.deepEqual(placement.images, placement.components.map((name) => components[name]?.image), id)
        const memory = placement.components.reduce((sum, name) => sum + megabytes(components[name]?.resources.memory ?? "0M"), 0)
        assert.equal(megabytes(placement.limits?.memory ?? "0M"), memory, `${id} limits`)
    }
    const host = loadHost(opsDir)
    for (const id of serviceIds(catalog)) {
        const placement = placementOf(catalog, id, "local")
        if (placement?.via === "host-stack") for (const one of placement.ids) assert.ok(host.services.some((service) => service.id === one), `${id} names ${one} of ops/host.yaml`)
    }
})

void test("a machine's services are the defaults of its roles plus and minus its toggles; local is starci (sonar, registry, embed) and dev", () => {
    assert.deepEqual(machineServices(catalog, catalog.local), ["starci.embed", "starci.sonar", "starci.registry", "dev.orca", "dev.docker"])
    const server = applyRoles(catalog, undefined, "app-host,starci,monitor,edge")
    assert.deepEqual(machineServices(catalog, server), ["starci.embed", "monitor.prometheus", "monitor.grafana", "monitor.loki", "monitor.alertmanager", "monitor.exporters", "monitor.portainer", "edge.traefik"])
    const toggled = applyRoles(catalog, server, "+starci.sonar,-starci.embed,+starci.buildkit")
    assert.deepEqual(toggled.services, { "starci.sonar": true, "starci.embed": false, "starci.buildkit": true })
    assert.ok(machineServices(catalog, toggled).includes("starci.buildkit"))
    assert.ok(!machineServices(catalog, toggled).includes("starci.embed"))
    const back = applyRoles(catalog, toggled, "+starci.embed")
    assert.equal(back.services["starci.embed"], undefined, "a toggle equal to the role's default is not stored")
    assert.deepEqual(applyRoles(catalog, server, "-edge,+dev").roles, ["app-host", "starci", "monitor", "dev"])
    assert.throws(() => applyRoles(catalog, server, "-app-host,-starci,-monitor,-edge"), { code: "HOST_ROLES_EMPTY" })
    assert.throws(() => applyRoles(catalog, server, "app-host,+edge"), /mixes a plain list/u)
    assert.throws(() => applyRoles(catalog, undefined, "k8s"), { code: "HOST_ROLE_UNKNOWN" })
    assert.equal(canonicalService(catalog, "embed"), "starci.embed")
    assert.throws(() => canonicalService(catalog, "nope"), { code: "HOST_SERVICE_UNKNOWN" })
})

void test("vps add registers a machine in config.yaml with no question, local is always there, an inventory server file is imported and its sealed login kept", (t) => {
    const dir = withState(t)
    const read = readMachines()
    assert.equal(read.exists, false)
    assert.deepEqual(Object.keys(allMachines(read, catalog.local)), ["local"])
    const key = join(dir, "id_test")
    writeFileSync(key, "not a real key, only a path config.yaml keeps")
    const added = registerMachine({ name: "box-1", host: "203.0.113.7", user: "starci-ops", port: "2222", "ssh-key": key, roles: "app-host,starci,+starci.buildkit" }, opsDir)
    assert.match(added.lines.join("\n"), /registered box-1/u)
    const file = readFileSync(join(dir, "config.yaml"), "utf8")
    assert.match(file, /Never pushed/u)
    assert.doesNotMatch(file, /not a real key/u, "the key's path is kept, never its content")
    const box = readMachines().doc.machines["box-1"]
    assert.deepEqual({ host: box?.host, user: box?.user, port: box?.port, roles: box?.roles, services: box?.services }, { host: "203.0.113.7", user: "starci-ops", port: 2222, roles: ["app-host", "starci"], services: { "starci.buildkit": true } })
    assert.throws(() => registerMachine({ name: "box-1", host: "203.0.113.8", roles: "edge" }, opsDir), { code: "HOST_MACHINE_EXISTS" })
    assert.throws(() => registerMachine({ name: "box-2", roles: "edge" }, opsDir), /takes --host/u)
    const policy = loadVpsPolicy(opsDir)
    const server = loadServer(policy, "box-1", join(opsDir, "vps", "servers"))
    assert.deepEqual({ id: server.id, host: server.host, port: server.sshPort, login: server.login?.user, sealed: server.sealedFile.replaceAll("\\", "/").endsWith("machines/box-1.enc.yaml") }, { id: "box-1", host: "203.0.113.7", port: 2222, login: "starci-ops", sealed: true }, "a config.yaml machine is a managed server for every vps verb")
    const inventory = join(dir, "sv-x.yaml")
    writeFileSync(inventory, readFileSync(join(opsDir, "vps", "servers", "example.yaml"), "utf8").replace("id: example", "id: sv-x"))
    assert.deepEqual(importedFields(parse(readFileSync(inventory, "utf8")), inventory), { host: "203.0.113.10", port: 22, os: "ubuntu", server: "sv-x" })
    registerMachine({ name: "sv-x", import: inventory, roles: "app-host,monitor" }, opsDir)
    assert.equal(readMachines().doc.machines["sv-x"]?.server, "sv-x")
    assert.throws(() => importedFields({ schema: "other" }, "f"), { code: "HOST_IMPORT_INVALID" })
})

const observed = (text: string): Observed => readObserved(text)

void test("a server's Docker is judged: a stack runs, a service under another name is adopted with its drift, a missing one is missing, buildkit is unbuilt", () => {
    const seen = observed(
        [
            "swarm=active",
            "stack starci-embeddings",
            "svc starci-embeddings_model|1/1|ollama/ollama:0.30.11@sha256:c484b703176aa19dfc0a54cbfb60ab8094b38faa04283fb77eba1d33319e5eca",
            "svc starci-embeddings_gate|1/1|caddy:2.10.2@sha256:c3d7ee5d2b11f9dc54f947f68a734c84e9c9666c92c88a7f30b9cba5da182adb",
            `svc proxy_traefik|1/1|traefik:v3.1.0@sha256:${"a".repeat(64)}`,
            "ctr portainer|portainer/portainer-ce:2.33.8|",
            "ctr nivo_api.1.x|ghcr.io/x/nivo-api:1|",
        ].join("\n"),
    )
    assert.equal(seen.swarm, "active")
    const images = (id: string): string[] => placementImages(remote(id), opsDir)
    const embed = judgeRemote("starci.embed", "e", remote("starci.embed"), images("starci.embed"), seen, new Set())
    assert.equal(embed.state, "running")
    assert.deepEqual(embed.drift, [])
    const traefik = judgeRemote("edge.traefik", "t", remote("edge.traefik"), images("edge.traefik"), seen, new Set())
    assert.equal(traefik.state, "adopted")
    assert.equal(traefik.found[0]?.as, "proxy_traefik")
    assert.equal(traefik.drift.length, 1, "a running image that is not the pin is reported, never changed")
    const portainer = judgeRemote("monitor.portainer", "p", remote("monitor.portainer"), images("monitor.portainer"), seen, new Set())
    assert.equal(portainer.state, "adopted")
    assert.equal(judgeRemote("monitor.grafana", "g", remote("monitor.grafana"), images("monitor.grafana"), seen, new Set()).state, "missing")
    assert.equal(judgeRemote("starci.buildkit", "b", remote("starci.buildkit"), [], seen, new Set()).state, "unbuilt")
    assert.equal(judgeRemote("starci.buildkit", "b", remote("starci.buildkit"), [], seen, new Set(["buildkit"])).state, "missing", "once its adapter is registered it deploys")
    const partial = observed("swarm=active\nstack starci-monitor\nsvc starci-monitor_prometheus|1/1|prom/prometheus:x\nsvc starci-monitor_socket-proxy|1/1|x")
    assert.equal(judgeRemote("monitor.grafana", "g", remote("monitor.grafana"), images("monitor.grafana"), partial, new Set()).state, "partial", "a monitor stack running without a component is never changed by host up")
    assert.equal(imageRepository("docker.io/library/caddy:2@sha256:x"), "caddy")
})

void test("host up plans keep, adopt, deploy and skip; it never redeploys what runs and names each deploy's rollback", (t) => {
    withState(t)
    registerMachine({ name: "box-1", host: "203.0.113.7", user: "starci-ops", roles: "app-host,starci,monitor,edge,+starci.buildkit,-starci.embed" }, opsDir)
    const scope = machineScope("box-1", opsDir)
    const seen = observed(`swarm=active\nsvc proxy_traefik|1/1|traefik:v3.6.12\nctr portainer|portainer/portainer-ce:2.33.8|`)
    const states = scope.services.map((id) => judgeRemote(id, "s", remote(id), placementImages(remote(id), opsDir), seen, new Set()))
    const plan = planUp(scope, states)
    const byId = Object.fromEntries(plan.map((step) => [step.id, step]))
    assert.equal(byId["edge.traefik"]?.action, "adopt")
    assert.equal(byId["monitor.portainer"]?.action, "adopt")
    assert.equal(byId["monitor.grafana"]?.action, "deploy")
    assert.match(byId["monitor.grafana"].rollback ?? "", /docker stack rm starci-monitor/u)
    assert.equal(byId["starci.buildkit"]?.action, "skip")
    assert.equal(byId["starci.embed"], undefined, "a service turned off is not planned")
    assert.ok(plan.every((step) => step.action !== "deploy" || step.rollback !== null), "every deploy has a rollback")
})

void test("the endpoints of starci.embed are listed local first, then the servers in config.yaml order; a machine with it off is left out", (t) => {
    withState(t)
    registerMachine({ name: "sv-a", host: "203.0.113.7", user: "u", roles: "app-host,starci" }, opsDir)
    registerMachine({ name: "sv-b", host: "203.0.113.8", user: "u", roles: "app-host,starci,-starci.embed" }, opsDir)
    const machines = allMachines(readMachines(), catalog.local)
    const list = endpointsOf(catalog, machines, "starci.embed")
    assert.deepEqual(list.map((endpoint) => [endpoint.machine, endpoint.url, endpoint.dimensions]), [
        ["local", "https://embed.starci.org/v1", 2560],
        ["sv-a", "http://embeddings-gate:8080/v1", 2560],
    ])
})

void test("the embed parity guard: equal dimensions and cosine >= 0.999 pass; another dimension or another vector space is HOST_EMBED_MISMATCH", () => {
    const model = roleService(catalog, "starci.embed").model
    if (model === undefined) throw new Error("no model")
    const base = Array.from({ length: 2560 }, (_, index) => Math.sin(index + 1))
    const near = base.map((value, index) => value + (index % 7 === 0 ? 1e-4 : 0))
    assert.ok(cosine(base, near) > 0.999)
    assert.equal(judgeParity(model, [{ machine: "local", vector: base }, { machine: "sv-a", vector: near }]).verdict, "equal")
    const other = Array.from({ length: 2560 }, (_, index) => Math.cos(index * 3))
    const mixed = judgeParity(model, [{ machine: "local", vector: base }, { machine: "sv-a", vector: other }])
    assert.equal(mixed.code, "HOST_EMBED_MISMATCH")
    assert.equal(judgeParity(model, [{ machine: "local", vector: base }, { machine: "sv-a", vector: base.slice(0, 1024) }]).code, "HOST_EMBED_MISMATCH")
    assert.equal(judgeParity(model, [{ machine: "local", vector: base }, { machine: "sv-a", error: "unreachable" }]).verdict, "unjudged")
    assert.equal(judgeParity(model, [{ machine: "local", vector: base }]).verdict, "single")
    assert.deepEqual(vectorOf(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] })), [0.1, 0.2])
    assert.equal(typeof vectorOf("nope"), "string")
    assert.deepEqual(JSON.parse(embedBody(model)), { model: "qwen3-embedding:4b", input: model.probeText })
})

void test("the remote probes hold no secret value: the key is read from the step's environment and the body from a heredoc", () => {
    const model = roleService(catalog, "starci.embed").model
    if (model === undefined) throw new Error("no model")
    const script = remoteEmbedScript("curlimages/curl:8@sha256:x", "starci-embeddings", "http://embeddings-gate:8080/v1", model)
    assert.match(script, /-e SERVICE_KEY --network 'starci-embeddings'/u)
    assert.match(script, /Bearer \$SERVICE_KEY/u)
    assert.match(script, /http:\/\/embeddings-gate:8080\/v1\/embeddings/u)
    assert.deepEqual(readHttp("<html>login</html>\nstatus=200\n"), { status: 200, body: "<html>login</html>" })
    assert.equal(readHttp("status=000").status, 0)
    assert.match(remoteLockScript("me:1", 6), /mkdir "\$L"/u)
})

const stacks = (environments: Record<string, unknown>): string => JSON.stringify({ environments })

void test("an app's hostServices are judged by config.yaml: served by an ordered list, refused HOST_SERVICE_MISSING when none hosts it", (t) => {
    const dir = withState(t)
    const empty: MachinesRead = readMachines()
    const needs = readHostNeeds(stacks({ production: { hostServices: { needs: { embed: ["local", "sv-a"] } }, deploy: { remote: { serverRecipient: "age1dypvrqkgumsr0e37d5ejenzs6gnczfqwwtegusat35t5sy7ne57sfn3kd8" } } }, dev: {} }), "f")
    assert.equal(needs.length, 1)
    const production = needs[0]
    if (production === undefined) throw new Error("no production")
    assert.equal(serverOfRecipient(production.serverRecipient ?? "", opsDir), "sv-hk-1", "the target is the server whose key the environment seals to")
    assert.equal(targetOf(production, opsDir), "sv-hk-1")
    assert.equal(judgeNeeds(catalog, empty, production, "sv-a").state, "unjudged", "a host with no config.yaml (CI) does not judge")
    registerMachine({ name: "sv-a", host: "203.0.113.7", user: "u", roles: "app-host,starci,-starci.embed" }, opsDir)
    const read = readMachines()
    const served = judgeNeeds(catalog, read, production, "sv-a")
    assert.equal(served.state, "ok")
    assert.deepEqual(served.served, { "starci.embed": "local" }, "local first")
    writeMachines(read.file, { ...read.doc, machines: { ...read.doc.machines, local: { roles: ["dev"], services: {}, adopted: {} } } })
    const missing = judgeNeeds(catalog, readMachines(), production, "sv-a")
    assert.equal(missing.code, "HOST_SERVICE_MISSING")
    assert.match(missing.detail, /none of local, sv-a hosts it/u)
    assert.equal(judgeNeeds(catalog, readMachines(), { ...production, needs: { embed: [] } }, "sv-a").code, "HOST_SERVICE_MISSING", "[] is the target alone")
    assert.equal(judgeNeeds(catalog, readMachines(), production, "sv-z").code, "HOST_MACHINE_UNKNOWN")
    registerMachine({ name: "sv-c", host: "203.0.113.9", user: "u", roles: "starci" }, opsDir)
    assert.equal(judgeNeeds(catalog, readMachines(), production, "sv-c").code, "HOST_ROLE_MISSING")
    assert.throws(() => readHostNeeds(stacks({ production: { hostServices: { need: {} } } }), "f"), { code: "HOST_NEEDS_INVALID" })
    const app = join(dir, "app")
    mkdirSync(join(app, ".starcistacks"), { recursive: true })
    writeFileSync(join(app, ".starcistacks", "application-stacks.yaml"), stacks({ production: { hostServices: { machine: "sv-a", needs: { "starci.embed": [] } } } }))
    assert.throws(() => requireHostServices(app, "production", readMachines(), opsDir), { code: "HOST_SERVICE_MISSING" })
    assert.deepEqual(requireHostServices(app, "staging", readMachines(), opsDir), [], "an environment that declares nothing judges nothing")
})

void test("the remote catalog of monitor services covers the default monitoring components exactly once", () => {
    const policy = loadVpsPolicy(opsDir)
    const components = loadMonitorComponents(policy, opsDir)
    const listed = serviceIds(catalog).flatMap((id) => {
        const placement = placementOf(catalog, id, "remote")
        return placement?.via === "vps-monitor" ? placement.components : []
    })
    const defaults = Object.entries(components).filter(([, component]) => component.default).map(([name]) => name)
    assert.deepEqual([...listed].sort((a, b) => a.localeCompare(b)), [...defaults].sort((a, b) => a.localeCompare(b)))
    assert.equal(new Set(listed).size, listed.length)
    const unused: HostRoles = catalog
    assert.ok(unused.waitSeconds > 0)
})
