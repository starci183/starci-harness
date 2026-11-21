// The remote BuildKit of a managed VPS without a server: the service folder loads and pins by digest, the compose render is rootless-safe
// (no privileged, no engine socket, no host namespaces, limits present) and the guard refuses each unsafe shape, the gate admits exactly
// `buildctl dial-stdio` (for real sh), the key lines and the plans hold no private material, and the doctor and capacity judge fixed facts.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, sep } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"
import { builderHostValue, ghSecretDeleteCalls, ghSecretSetCalls } from "../../core/vps/build-key.js"
import {
    BUILDER_SECRETS,
    buildGateScript,
    builderEndpoint,
    builderPingCommands,
    buildKeyAddPlan,
    buildKeyLine,
    buildKeyListScript,
    buildKeyRemovePlan,
    buildkitDoctorScript,
    buildkitDownPlan,
    buildkitImage,
    buildkitUpPlan,
    composeViolations,
    judgeBuildkitCapacity,
    loadBuildkit,
    readBuildKeys,
    readBuildkitDoctor,
    renderBuildkit,
} from "./buildkit.js"

const opsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "ops")
const service = loadBuildkit(opsDir)
const image = buildkitImage(service, opsDir)
const render = renderBuildkit(service, image)
const PUBLIC = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeFakeFakeFakeFakeFakeFakeFakeFakeFakeFake"
const refused = (code: string) => (error: unknown) => error instanceof Error && "code" in error && (error as { code: string }).code === code

void test("the buildkit service loads from its folder and its image is the rootless release buildctl is pinned at, by digest", () => {
    assert.equal(service.kind, "host-compose")
    assert.equal(service.role, "starci")
    assert.match(image, /^moby\/buildkit:v\d+\.\d+\.\d+-rootless@sha256:[0-9a-f]{64}$/)
    assert.ok(image.includes(`:${service.buildctl.version}-rootless@`))
})

void test("the compose render is rootless-safe: a non-root user, no privileged, no engine socket, no host namespace, no port, limits present", () => {
    const doc = parse(render.compose) as { name: string; services: Record<string, Record<string, unknown>>; volumes: Record<string, { name: string }> }
    assert.equal(doc.name, service.project)
    const buildkitd = doc.services.buildkitd ?? {}
    assert.equal(buildkitd.image, image)
    assert.equal(buildkitd.user, "1000:1000")
    assert.equal(buildkitd.privileged, undefined)
    assert.equal(buildkitd.pid, undefined)
    assert.equal(buildkitd.network_mode, undefined)
    assert.equal(buildkitd.ports, undefined)
    assert.deepEqual(buildkitd.security_opt, ["seccomp=unconfined", "apparmor=unconfined"])
    assert.ok((buildkitd.command as string[]).includes("--oci-worker-no-process-sandbox"))
    assert.equal(buildkitd.cpus, service.limits.cpus)
    assert.equal(buildkitd.mem_limit, service.limits.memory)
    assert.equal(buildkitd.pids_limit, service.limits.pids)
    assert.equal(buildkitd.restart, "unless-stopped")
    assert.doesNotMatch(render.compose, /docker\.sock|privileged:\s*true|\{\{/)
    assert.equal(doc.volumes.state?.name, service.storage.volume)
    assert.deepEqual(composeViolations(render.compose), [])
    assert.match(render.toml, /address = \["unix:\/\/\/run\/starci-buildkit\/buildkitd\.sock"\]/)
    assert.match(render.toml, /maxUsedSpace = "100GB"/)
    assert.doesNotMatch(render.toml, /tcp:\/\/|\{\{/)
})

void test("the guard refuses every unsafe shape of a compose file by name", () => {
    const base = parse(render.compose) as { services: { buildkitd: Record<string, unknown> } }
    const variant = (patch: Record<string, unknown>, drop: readonly string[] = []): string => {
        const entry = Object.fromEntries(Object.entries({ ...base.services.buildkitd, ...patch }).filter(([key]) => !drop.includes(key)))
        return JSON.stringify({ services: { buildkitd: entry } })
    }
    const cases: readonly [string, string][] = [
        [variant({ privileged: true }), "privileged"],
        [variant({ volumes: ["/var/run/docker.sock:/var/run/docker.sock"] }), "engine socket"],
        [variant({ volumes: [{ type: "bind", source: "/run/containerd/containerd.sock", target: "/c.sock" }] }), "engine socket"],
        [variant({ pid: "host" }), "pid: host"],
        [variant({ network_mode: "host" }), "network_mode: host"],
        [variant({ ipc: "host" }), "ipc: host"],
        [variant({ cap_add: ["SYS_ADMIN"] }), "cap_add"],
        [variant({ devices: ["/dev/fuse"] }), "devices"],
        [variant({ ports: ["1234:1234"] }), "publishes ports"],
        [variant({ user: "0:0" }), "root"],
        [variant({}, ["user"]), "root"],
        [variant({ security_opt: ["systempaths=unconfined"] }), "systempaths"],
        [variant({}, ["cpus"]), "no cpus"],
        [variant({}, ["mem_limit"]), "no mem_limit"],
        [variant({}, ["pids_limit"]), "no pids_limit"],
    ]
    for (const [text, expected] of cases) {
        const found = composeViolations(text)
        assert.ok(found.some((line) => line.includes(expected)), `${expected}: ${found.join("; ")}`)
    }
    const unsafe = { ...service, composeTemplate: service.composeTemplate.replace("restart: unless-stopped", "restart: unless-stopped\n    privileged: true") }
    assert.throws(() => renderBuildkit(unsafe, image), refused("BUILDKIT_RENDER_UNSAFE"))
    const tcp = { ...service, tomlTemplate: service.tomlTemplate.replace('address = ["unix://{{socket.path}}"]', 'address = ["unix://{{socket.path}}", "tcp://0.0.0.0:1234"]') }
    assert.throws(() => renderBuildkit(tcp, image), refused("BUILDKIT_RENDER_UNSAFE"))
    assert.throws(() => renderBuildkit({ ...service, composeTemplate: `${service.composeTemplate}\n# {{unknown.token}}` }, image), refused("OPS_INVALID"))
})

const shAvailable = spawnSync("sh", ["-c", "exit 0"], { windowsHide: true }).status === 0
const posix = (file: string): string => (process.platform === "win32" ? file.replace(/^([A-Za-z]):/, (_all, drive: string) => `/${drive.toLowerCase()}`) : file).split(sep).join("/")

void test("the gate admits exactly `buildctl dial-stdio`, to the one socket, and refuses everything else saying nothing", { skip: shAvailable ? false : "no sh on this machine" }, (t) => {
    const dir = mkdtempSync(join(tmpdir(), "starci-build-gate-"))
    t.after(() => {
        rmSync(dir, { recursive: true, force: true })
    })
    const fake = join(dir, "buildctl")
    writeFileSync(fake, '#!/bin/sh\necho "buildctl $*"\n', { mode: 0o755 })
    const gate = join(dir, "starci-build-gate")
    writeFileSync(gate, buildGateScript(service, posix(fake)), { mode: 0o755 })
    const viaGate = (command: string | undefined) => {
        const env: NodeJS.ProcessEnv = { ...process.env }
        if (command === undefined) delete env.SSH_ORIGINAL_COMMAND
        else env.SSH_ORIGINAL_COMMAND = command
        const run = spawnSync("sh", [posix(gate)], { env, encoding: "utf8", windowsHide: true })
        return { status: run.status ?? 1, stdout: run.stdout, stderr: run.stderr }
    }
    const admitted = viaGate("buildctl dial-stdio")
    assert.equal(admitted.status, 0, admitted.stderr)
    assert.equal(admitted.stdout, `buildctl --addr unix://${service.socket.path} dial-stdio\n`)
    for (const near of [undefined, "", "sh", "id", "buildctl", "buildctl dial-stdio ", " buildctl dial-stdio", "buildctl  dial-stdio", "buildctl dial-stdio; id", "buildctl dial-stdio && id", "buildctl debug workers", "buildctl --addr unix:///run/buildkit/buildkitd.sock dial-stdio", "buildctl --addr tcp://127.0.0.1:1 dial-stdio", "docker system dial-stdio", "starci-op list /srv", "BUILDCTL dial-stdio", "buildctl dial-stdio\nid"]) {
        const answer = viaGate(near)
        assert.equal(answer.status, 126, JSON.stringify(near))
        assert.equal(answer.stdout, "")
        assert.equal(answer.stderr, "starci-build-gate: command refused\n")
    }
})

void test("a build key's line is forced to the gate with every option off and named by its repository; a private key or a bad repository is refused", () => {
    const line = buildKeyLine(service, `${PUBLIC} somebody@laptop`, "starci183/nivoos-lite")
    assert.equal(line, `restrict,command="${service.access.gate}",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-user-rc ${PUBLIC} starci-build:starci183/nivoos-lite`)
    assert.throws(() => buildKeyLine(service, "-----BEGIN OPENSSH PRIVATE KEY-----", "a/b"), refused("BUILDKIT_KEY_PUBLIC"))
    assert.throws(() => buildKeyLine(service, `no-pty ${PUBLIC}`, "a/b"), refused("BUILDKIT_KEY_PUBLIC"))
    assert.throws(() => buildKeyLine(service, `ssh-rsa AAAAB3Nza`, "a/b"), refused("BUILDKIT_KEY_PUBLIC"))
    assert.throws(() => buildKeyLine(service, PUBLIC, "not a repo"), refused("BUILDKIT_REPO_INVALID"))
    assert.throws(() => buildKeyLine(service, PUBLIC, "a/b c"), refused("BUILDKIT_REPO_INVALID"))
    assert.deepEqual(readBuildKeys("starci183/nivoos-lite\nstarci183/next-one-edition\n\ngarbage line\n"), ["starci183/nivoos-lite", "starci183/next-one-edition"])
    assert.match(buildKeyListScript(service), /starci-build:/)
})

void test("the build-key plans touch only starci-build's authorized_keys, take the public half on stdin and set the private half through gh stdin only", () => {
    const added = buildKeyAddPlan(service, "sv-test", "starci183/nivoos-lite")
    assert.deepEqual(added.steps.map((entry) => entry.secrets), [["BUILD_PUBLIC_KEY"]])
    const script = added.steps[0]?.script ?? ""
    assert.match(script, /\/var\/lib\/starci-build\/\.ssh\/authorized_keys/)
    assert.match(script, / starci-build:starci183\/nivoos-lite/)
    assert.match(script, /install -m 640 -o root -g 'starci-build'/)
    assert.doesNotMatch(script, /deploy-|usermod|docker/)
    const removed = buildKeyRemovePlan(service, "sv-test", "starci183/nivoos-lite")
    assert.deepEqual(removed.steps.map((entry) => entry.secrets), [[]])
    const calls = ghSecretSetCalls("starci183/nivoos-lite", { [BUILDER_SECRETS.key]: "PRIVATE-KEY-TEXT", [BUILDER_SECRETS.host]: "203.0.113.7:2222", [BUILDER_SECRETS.knownHosts]: "known" })
    assert.deepEqual(calls.map((call) => call.args[2]), ["STARCI_BUILDER_SSH_KEY", "STARCI_BUILDER_HOST", "STARCI_BUILDER_KNOWN_HOSTS"])
    for (const call of calls) {
        assert.doesNotMatch(call.args.join(" "), /PRIVATE-KEY-TEXT|203\.0\.113\.7|known/)
        assert.deepEqual(call.args.slice(3), ["--repo", "starci183/nivoos-lite", "--app", "actions"])
    }
    assert.equal(calls[0]?.input, "PRIVATE-KEY-TEXT")
    assert.deepEqual(ghSecretDeleteCalls("a/b").map((call) => [call.args[1], call.input]), [["delete", undefined], ["delete", undefined], ["delete", undefined]])
    assert.equal(builderHostValue({ host: "203.0.113.7", sshPort: 22 }), "203.0.113.7")
    assert.equal(builderHostValue({ host: "203.0.113.7", sshPort: 2222 }), "203.0.113.7:2222")
})

void test("the up plan stops at a rootless preflight first, installs a checked buildctl and the gate, and the rollback is the project's compose down", () => {
    const plan = buildkitUpPlan(service, render, "sv-test")
    assert.deepEqual(plan.steps.map((entry) => entry.id), ["rootless-preflight", "build-user", "buildctl", "gate", "socket-dir", "files", "up"])
    const [preflight, user, buildctl, gate, socketDir, files, up] = plan.steps
    assert.match(preflight?.script ?? "", /apparmor_restrict_unprivileged_userns/)
    assert.match(preflight?.script ?? "", /exit 9/)
    assert.match(preflight?.script ?? "", /no privileged fallback/)
    assert.match(user?.script ?? "", /docker\|sudo\|wheel\|adm\|root\) gpasswd -d/)
    assert.doesNotMatch(user?.script ?? "", /usermod -aG|--groups/)
    assert.match(buildctl?.script ?? "", new RegExp(service.buildctl.sha256.amd64))
    assert.match(buildctl?.script ?? "", /sha256sum -c/)
    assert.ok((gate?.script ?? "").includes(buildGateScript(service).trimEnd()))
    assert.match(socketDir?.script ?? "", /default:group:starci-build:rw/)
    assert.ok((files?.script ?? "").includes(render.compose.trimEnd()))
    assert.match(up?.script ?? "", /docker compose -p 'starci-buildkit' .* up -d --wait/)
    assert.doesNotMatch(plan.steps.map((entry) => entry.script).join("\n"), /docker\.sock|--privileged|privileged: true/)
    for (const entry of plan.steps) assert.deepEqual(entry.secrets, [])
    const down = buildkitDownPlan(service, "sv-test")
    assert.deepEqual(down.steps.map((entry) => entry.id), ["down"])
    assert.match(down.steps[0]?.script ?? "", /docker compose -p 'starci-buildkit' -f '\/opt\/starci\/services\/buildkit\/compose\.yaml' down/)
    assert.doesNotMatch(down.steps[0]?.script ?? "", /-v\b|--volumes|stack rm/)
})

const HEALTHY = [
    "rootless.kernel=6.8.0-50-generic",
    "rootless.maxUserNamespaces=63000",
    "rootless.apparmorRestrictUserns=0",
    "rootless.snapshotter=overlayfs",
    "rootless.block=",
    "container.running=yes",
    "container.user=1000:1000",
    "container.privileged=false",
    "container.pid=",
    "container.network=starci-buildkit_default",
    "container.mounts=/run/starci-buildkit,/var/lib/docker/volumes/starci-buildkit-state/_data,/opt/starci/services/buildkit/buildkitd.toml,",
    "container.health=healthy",
    `container.image=${image}`,
    "socket.exists=yes",
    "socket.groupWrite=yes",
    "user.groups=starci-build",
    "gate.installed=yes",
    `buildctl.version=${service.buildctl.version}`,
    "workers=abcdef123456",
    "keys=2",
].join("\n")

void test("the doctor passes a healthy rootless builder and names the kernel's exact reason or the unsafe fact otherwise", () => {
    assert.match(buildkitDoctorScript(service), /debug workers/)
    const healthy = readBuildkitDoctor(service, HEALTHY, image)
    assert.equal(healthy.ok, true, JSON.stringify(healthy.checks.filter((check) => !check.ok)))
    const blocked = readBuildkitDoctor(service, HEALTHY.replace("rootless.block=", "rootless.block=kernel.apparmor_restrict_unprivileged_userns is 1 (Ubuntu 24.04+): rootlesskit cannot create its user namespace"), image)
    assert.equal(blocked.ok, false)
    assert.match(blocked.blocked, /apparmor_restrict_unprivileged_userns is 1/)
    for (const [from, to, name] of [
        ["container.privileged=false", "container.privileged=true", "not privileged"],
        ["container.user=1000:1000", "container.user=", "non-root user"],
        ["container.pid=", "container.pid=host", "no host namespaces"],
        ["container.mounts=/run/starci-buildkit,", "container.mounts=/var/run/docker.sock,", "no engine socket"],
        ["user.groups=starci-build", "user.groups=starci-build,docker", "no docker group"],
        ["socket.groupWrite=yes", "socket.groupWrite=no", "socket"],
        [`buildctl.version=${service.buildctl.version}`, "buildctl.version=v0.1.0", "buildctl"],
        ["workers=abcdef123456", "workers=", "workers"],
    ] as const) {
        const judged = readBuildkitDoctor(service, HEALTHY.replace(from, to), image)
        assert.equal(judged.ok, false, name)
        assert.equal(judged.checks.find((check) => check.name === name)?.ok, false, name)
    }
    assert.equal(readBuildkitDoctor(service, HEALTHY.replace("container.running=yes", "container.running=no"), image).ok, false)
})

void test("the client endpoint and ping commands, and the capacity judge against the app reserve", () => {
    assert.equal(builderEndpoint(service, "203.0.113.7"), "ssh://starci-build@203.0.113.7")
    assert.equal(builderEndpoint(service, "203.0.113.7", 2222), "ssh://starci-build@203.0.113.7:2222")
    assert.throws(() => builderEndpoint(service, "host;id"), refused("BUILDKIT_HOST_INVALID"))
    const ping = builderPingCommands(service, "ssh://starci-build@203.0.113.7")
    assert.deepEqual(ping.create, ["buildx", "create", "--name", "starci-remote", "--driver", "remote", "ssh://starci-build@203.0.113.7"])
    assert.deepEqual(ping.bootstrap, ["buildx", "inspect", "--bootstrap", "starci-remote"])
    const keep = { memoryMb: 4096, cpus: 2, diskMb: 20480 }
    const roomy = { totalMb: 64000, availableMb: 40000, cpus: 16, diskFreeMb: 400000, stacks: [], volumes: [] }
    assert.equal(judgeBuildkitCapacity(service, roomy, keep).every((line) => line.includes("fits")), true)
    assert.throws(() => judgeBuildkitCapacity(service, { ...roomy, cpus: 4 }, keep), refused("BUILDKIT_CAPACITY"))
    assert.throws(() => judgeBuildkitCapacity(service, { ...roomy, totalMb: 8000 }, keep), refused("BUILDKIT_CAPACITY"))
    assert.throws(() => judgeBuildkitCapacity(service, { ...roomy, diskFreeMb: 50000 }, keep), refused("BUILDKIT_CAPACITY"))
    assert.doesNotThrow(() => judgeBuildkitCapacity(service, { ...roomy, diskFreeMb: 50000, volumes: [service.storage.volume] }, keep))
})
