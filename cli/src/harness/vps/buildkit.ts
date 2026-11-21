import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../../shared/errors.js"
import { locateOps } from "../ops.js"
import { resolveImages } from "./policy.js"
import type { PlanStep, VpsPlan } from "./plan.js"
import { megabytes } from "./services.js"
import type { Keep, Measured } from "./services.js"
import { shellQuote } from "./ssh.js"

/**
 * The remote BuildKit of a managed VPS (contexts/harness/managed-vps.md "Remote BuildKit"): one rootless
 * buildkitd per server as a host-level docker compose project, its only door a Unix socket that the ssh user `starci-build` reaches through
 * a forced-command gate admitting exactly `buildctl dial-stdio`. The service is the self-contained folder ops/vps/services/buildkit
 * (service.yaml, compose.yaml, buildkitd.toml); the host roles catalog deploys it as the `buildkit` service of the `starci` role (kind
 * host-compose) with buildkitUpPlan, rolls it back with buildkitDownPlan and checks it with buildkitDoctorScript + readBuildkitDoctor.
 * ROOTLESS ONLY: the render refuses privileged, the Docker socket, host namespaces, added capabilities or devices and a root user.
 * Nothing here reaches a server; the plans are idempotent bash a verb runs step by step.
 */

const NAME = /^[a-z][a-z0-9-]*$/
const ABSOLUTE = /^\/[A-Za-z0-9._/-]+$/
const SIZE = /^\d+(?:\.\d+)?(?:[KMGT]B|%)$/
const HEX64 = /^[0-9a-f]{64}$/
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

const serviceSchema = z.strictObject({
    schema: z.literal("starci/host-compose-service@1"),
    name: z.literal("buildkit"),
    kind: z.literal("host-compose"),
    role: z.string().regex(NAME),
    purpose: z.string().min(1),
    project: z.string().regex(NAME),
    dir: z.string().regex(ABSOLUTE),
    image: z.strictObject({ image: z.string().regex(/^[a-z0-9./-]+$/), pin: z.string().min(1) }),
    buildctl: z.strictObject({ version: z.string().regex(/^v\d+\.\d+\.\d+$/), path: z.string().regex(ABSOLUTE), sha256: z.strictObject({ amd64: z.string().regex(HEX64), arm64: z.string().regex(HEX64) }) }),
    daemon: z.strictObject({ uid: z.number().int().positive() }),
    socket: z.strictObject({ dir: z.string().regex(ABSOLUTE), path: z.string().regex(ABSOLUTE), group: z.string().regex(NAME) }),
    access: z.strictObject({ user: z.string().regex(NAME), home: z.string().regex(ABSOLUTE), gate: z.string().regex(ABSOLUTE), builder: z.string().regex(NAME) }),
    limits: z.strictObject({ cpus: z.string().regex(/^\d+\.\d+$/), memory: z.string().regex(/^\d+(?:\.\d+)?[MG]$/), pids: z.number().int().positive(), parallelism: z.number().int().positive() }),
    storage: z.strictObject({ volume: z.string().regex(NAME), reserved: z.string().regex(SIZE), maxUsed: z.string().regex(SIZE), minFree: z.string().regex(SIZE) }),
})

/** The buildkit service of the catalog, with its folder and its two templates. */
export interface BuildkitService extends z.infer<typeof serviceSchema> {
    readonly folder: string
    readonly composeTemplate: string
    readonly tomlTemplate: string
}

/** The catalog id the host roles reference: role `starci`, service `buildkit`, kind `host-compose`, folder ops/vps/services/buildkit. */
export const BUILDKIT_SERVICE = "buildkit"

/** The folder of the service in an ops tree. */
export const buildkitFolder = (opsDir: string): string => join(opsDir, "vps", "services", BUILDKIT_SERVICE)

const readText = (file: string): string => {
    if (!existsSync(file)) throw new Refusal("OPS_INVALID", `${file} is missing: the buildkit service is the folder's service.yaml, compose.yaml and buildkitd.toml`)
    return readFileSync(file, "utf8")
}

/** Loads and validates ops/vps/services/buildkit; the socket must lie in its folder and the buildctl release must be the image's. */
export const loadBuildkit = (opsDir: string = locateOps()): BuildkitService => {
    const folder = buildkitFolder(opsDir)
    const file = join(folder, "service.yaml")
    let raw: unknown
    try {
        raw = parse(readText(file))
    } catch (error: unknown) {
        if (error instanceof Refusal) throw error
        throw new Refusal("OPS_INVALID", `${file} is not readable yaml: ${error instanceof Error ? error.message : String(error)}`)
    }
    const parsed = serviceSchema.safeParse(raw)
    if (!parsed.success) throw new Refusal("OPS_INVALID", `${file} is invalid: ${z.prettifyError(parsed.error)}`)
    const service = parsed.data
    if (!service.socket.path.startsWith(`${service.socket.dir}/`) || service.socket.path.slice(service.socket.dir.length + 1).includes("/")) throw new Refusal("OPS_INVALID", `${file}: socket.path must be a file directly in socket.dir`)
    return { ...service, folder, composeTemplate: readText(join(folder, "compose.yaml")), tomlTemplate: readText(join(folder, "buildkitd.toml")) }
}

/** The image by digest from contexts/stack/pins.yaml; its tag must be the buildctl release, rootless. */
export const buildkitImage = (service: BuildkitService, opsDir: string = locateOps()): string => {
    const image = resolveImages({ buildkit: service.image }, opsDir).buildkit
    const tag = image.slice(service.image.image.length + 1, image.indexOf("@"))
    if (tag !== `${service.buildctl.version}-rootless`) throw new Refusal("OPS_INVALID", `the buildkit image ${image} is not ${service.buildctl.version}-rootless, the release buildctl is pinned at: raise both together`)
    return image
}

/** The text of the two files the host holds, filled from the service and the image. */
export interface BuildkitRender {
    readonly image: string
    readonly compose: string
    readonly toml: string
}

const tokensOf = (service: BuildkitService, image: string): Readonly<Record<string, string>> => ({
    image,
    project: service.project,
    "daemon.uid": String(service.daemon.uid),
    "socket.dir": service.socket.dir,
    "socket.path": service.socket.path,
    "limits.cpus": service.limits.cpus,
    "limits.memory": service.limits.memory,
    "limits.pids": String(service.limits.pids),
    "limits.parallelism": String(service.limits.parallelism),
    "storage.volume": service.storage.volume,
    "storage.reserved": service.storage.reserved,
    "storage.maxUsed": service.storage.maxUsed,
    "storage.minFree": service.storage.minFree,
})

const fill = (template: string, tokens: Readonly<Record<string, string>>, name: string): string =>
    template.replace(/\{\{([a-zA-Z.]+)\}\}/g, (_all, key: string) => {
        const value = tokens[key]
        if (value === undefined) throw new Refusal("OPS_INVALID", `${name} names {{${key}}}, which the buildkit service does not fill`)
        return value
    })

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)

/** The host paths a compose service mounts (short and long syntax). */
const mountSources = (volumes: unknown): string[] =>
    (Array.isArray(volumes) ? volumes : []).map((entry: unknown) => (typeof entry === "string" ? entry.split(":")[0] ?? "" : record(entry) && typeof entry.source === "string" ? entry.source : ""))

/**
 * What makes a rendered compose file unsafe for a prod host, one line each (empty when it is safe): privileged, the Docker socket in any
 * mount, host PID, IPC, network or user namespace, added capabilities, devices, a root or missing user, missing cpus, mem_limit or pids_limit.
 */
export const composeViolations = (composeText: string): string[] => {
    const doc: unknown = parse(composeText)
    const services = record(doc) && record(doc.services) ? doc.services : {}
    if (Object.keys(services).length === 0) return ["the compose file declares no service"]
    const found: string[] = []
    for (const [name, raw] of Object.entries(services)) {
        const entry = record(raw) ? raw : {}
        if (entry.privileged !== undefined && entry.privileged !== false) found.push(`${name}: privileged`)
        for (const source of mountSources(entry.volumes)) if (/docker\.sock|containerd\.sock|^\/var\/run\/docker$|^\/run\/docker$/.test(source)) found.push(`${name}: mounts the container engine socket ${source}`)
        for (const key of ["pid", "ipc", "userns_mode", "cgroup", "uts"]) if (entry[key] === "host") found.push(`${name}: ${key}: host`)
        if (typeof entry.network_mode === "string" && entry.network_mode === "host") found.push(`${name}: network_mode: host`)
        if (entry.cap_add !== undefined) found.push(`${name}: cap_add`)
        if (entry.devices !== undefined) found.push(`${name}: devices`)
        if (entry.ports !== undefined) found.push(`${name}: publishes ports (the socket is its only door)`)
        const user = typeof entry.user === "string" ? entry.user : ""
        if (user === "" || /^(?:0|root)(?::|$)/.test(user)) found.push(`${name}: runs as root or as the image's default user`)
        if (Array.isArray(entry.security_opt) && entry.security_opt.some((option: unknown) => /^(?:label[:=]disable|systempaths=unconfined)$/.test(String(option)))) found.push(`${name}: security_opt ${String(entry.security_opt.find((option: unknown) => /^(?:label[:=]disable|systempaths=unconfined)$/.test(String(option))))}`)
        for (const key of ["cpus", "mem_limit", "pids_limit"]) if (entry[key] === undefined || entry[key] === "" || entry[key] === null) found.push(`${name}: no ${key}`)
    }
    return found
}

/** Fills the templates and refuses an unsafe compose file (BUILDKIT_RENDER_UNSAFE). */
export const renderBuildkit = (service: BuildkitService, image: string): BuildkitRender => {
    const tokens = tokensOf(service, image)
    const compose = fill(service.composeTemplate, tokens, "compose.yaml")
    const toml = fill(service.tomlTemplate, tokens, "buildkitd.toml")
    const unsafe = composeViolations(compose)
    if (unsafe.length > 0) throw new Refusal("BUILDKIT_RENDER_UNSAFE", `the buildkit compose file is not rootless-safe for a prod host; nothing was rendered:\n${unsafe.map((line) => `  ${line}`).join("\n")}`)
    if (!toml.includes(`"unix://${service.socket.path}"`) || toml.includes("tcp://")) throw new Refusal("BUILDKIT_RENDER_UNSAFE", `buildkitd.toml must listen on unix://${service.socket.path} alone`)
    return { image, compose, toml }
}

/** The ssh endpoint a client builds through: `ssh://starci-build@<host>[:port]` (BuildKit's ssh connection helper runs `buildctl dial-stdio` there). */
export const builderEndpoint = (service: Pick<BuildkitService, "access">, host: string, port = 22): string => {
    if (!/^[A-Za-z0-9.-]+$/.test(host)) throw new Refusal("BUILDKIT_HOST_INVALID", `${host} is no plain host name or address`)
    return `ssh://${service.access.user}@${host}${port === 22 ? "" : `:${String(port)}`}`
}

/** The one request the gate admits, exactly as BuildKit's ssh helper sends it. */
export const GATE_REQUEST = "buildctl dial-stdio"

/**
 * The POSIX sh text of the gate, the forced command of every starci-build key: it admits exactly `buildctl dial-stdio` and runs buildctl
 * against the one socket; everything else is refused with exit 126 and no echo. `buildctl` is the binary it runs (the pinned path; a test
 * passes a stand-in).
 */
export const buildGateScript = (service: BuildkitService, buildctl: string = service.buildctl.path): string =>
    [
        "#!/bin/sh",
        "# starci-build-gate: the forced command of every key of the starci-build user (generated by starci-harness, cli/src/harness/vps/buildkit.ts; do not edit).",
        `# Admits exactly \`${GATE_REQUEST}\` to ${service.socket.path}, nothing else. A refusal says nothing about the request.`,
        "PATH=/usr/local/bin:/usr/bin:/bin",
        "refuse() { echo 'starci-build-gate: command refused' >&2; exit 126; }",
        `[ "\${SSH_ORIGINAL_COMMAND-}" = ${shellQuote(GATE_REQUEST)} ] || refuse`,
        `exec ${shellQuote(buildctl)} --addr ${shellQuote(`unix://${service.socket.path}`)} dial-stdio`,
        "",
    ].join("\n")

/** The options of a starci-build key's line: forced to the gate, nothing optional. */
export const buildKeyOptions = (service: BuildkitService): string =>
    ["restrict", `command="${service.access.gate}"`, "no-pty", "no-port-forwarding", "no-agent-forwarding", "no-X11-forwarding", "no-user-rc"].join(",")

/** The comment that names a key's repository in authorized_keys, the handle of list and remove. */
export const buildKeyComment = (repo: string): string => {
    if (!REPO.test(repo)) throw new Refusal("BUILDKIT_REPO_INVALID", `--repo takes <owner>/<name>; ${repo} is not one`)
    return `starci-build:${repo}`
}

const PUBLIC_KEY = /^ssh-ed25519 [A-Za-z0-9+/]+={0,3}$/

/** The authorized_keys line of one repository's key from its PUBLIC half (type and base64 only; the comment is the repository's). */
export const buildKeyLine = (service: BuildkitService, publicKey: string, repo: string): string => {
    const [type, body] = publicKey.trim().split(/\s+/)
    const key = `${type ?? ""} ${body ?? ""}`
    if (publicKey.includes("PRIVATE KEY") || !PUBLIC_KEY.test(key)) throw new Refusal("BUILDKIT_KEY_PUBLIC", "a starci-build key is one ed25519 public key: ssh-ed25519 <base64>")
    return `${buildKeyOptions(service)} ${key} ${buildKeyComment(repo)}`
}

const step = (id: string, summary: string, script: string, secrets: PlanStep["secrets"] = []): PlanStep => ({ id, summary, root: true, script: script.trim(), secrets })

const MARKER = "STARCI_EOF"

/** Writes `content` to `file` with `mode` (owner root) only when it differs; sets C=changed. */
const writeFile = (file: string, content: string, mode: string): string => {
    if (content.includes(MARKER)) throw new Refusal("VPS_PLAN_INVALID", `a file the plan writes holds ${MARKER}`)
    const quoted = shellQuote(file)
    return [`cat > ${quoted}.starci-new <<'${MARKER}'`, content.trimEnd(), MARKER, `if cmp -s ${quoted}.starci-new ${quoted}; then rm -f ${quoted}.starci-new; else install -m ${mode} -o root -g root ${quoted}.starci-new ${quoted}; rm -f ${quoted}.starci-new; C=changed; fi`].join("\n")
}

/**
 * The kernel's answer to "can this box run BuildKit rootless", as `rootless.<fact>=<value>` lines and a final `rootless.block=<reason>` (empty when
 * it can): unprivileged user namespaces allowed, Ubuntu's AppArmor restriction off, the kernel version (overlayfs in a user namespace from 5.11).
 */
export const rootlessFactsScript = (): string =>
    `
K=$(uname -r); echo "rootless.kernel=$K"
B=""
M=$(cat /proc/sys/user/max_user_namespaces 2>/dev/null || echo 0); echo "rootless.maxUserNamespaces=$M"
[ "\${M:-0}" -gt 0 ] 2>/dev/null || B="user.max_user_namespaces is \${M:-0}: the kernel allows no user namespace"
if [ -r /proc/sys/kernel/unprivileged_userns_clone ]; then U=$(cat /proc/sys/kernel/unprivileged_userns_clone); echo "rootless.unprivilegedUsernsClone=$U"; [ "$U" = 1 ] || B="\${B:+$B; }kernel.unprivileged_userns_clone is $U: unprivileged user namespaces are off"; fi
if [ -r /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]; then A=$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns); echo "rootless.apparmorRestrictUserns=$A"; [ "$A" = 0 ] || B="\${B:+$B; }kernel.apparmor_restrict_unprivileged_userns is $A (Ubuntu 24.04+): rootlesskit cannot create its user namespace"; fi
V=$(printf '%s' "$K" | cut -d. -f1-2); MAJ=\${V%%.*}; MIN=\${V#*.}; MIN=\${MIN%%[!0-9]*}
if [ "\${MAJ:-0}" -gt 5 ] 2>/dev/null || { [ "\${MAJ:-0}" -eq 5 ] && [ "\${MIN:-0}" -ge 11 ]; } 2>/dev/null; then echo "rootless.snapshotter=overlayfs"; else echo "rootless.snapshotter=native (kernel before 5.11: slower, still rootless)"; fi
echo "rootless.block=$B"`.trim()

/** Ends the preflight: exit 9 with the kernel's exact reason when B (rootless.block) is set, else unchanged. */
const PREFLIGHT_SUFFIX = `
if [ -n "$B" ]; then echo "BuildKit cannot run rootless on this kernel: $B. Changing that is a host security setting, an owner decision; nothing was changed and there is no privileged fallback" >&2; exit 9; fi
echo unchanged`

/** The host compose project: rootless preflight, users, buildctl, gate, socket folder, files, up; each step idempotent, printing changed or unchanged. */
export const buildkitUpPlan = (service: BuildkitService, render: BuildkitRender, serverId: string): VpsPlan => {
    const { access, socket, daemon } = service
    const tmpfiles = `/etc/tmpfiles.d/starci-${service.project}.conf`
    const composeFile = `${service.dir}/compose.yaml`
    const compose = `docker compose -p ${shellQuote(service.project)} -f ${shellQuote(composeFile)}`
    const tmpfilesText = [
        `# The socket folder of the remote BuildKit (ops/vps/services/buildkit), made at every boot before Docker starts; written by starci-harness.`,
        `d ${socket.dir} 0750 ${String(daemon.uid)} ${socket.group} -`,
        `a+ ${socket.dir} - - - - default:group:${socket.group}:rw,default:mask::rwx`,
    ].join("\n")
    return {
        verb: "buildkit up",
        server: serverId,
        steps: [
            step("rootless-preflight", "the kernel runs BuildKit rootless (unprivileged user namespaces allowed, Ubuntu's AppArmor restriction off); otherwise stop with the exact reason", `${rootlessFactsScript()}${PREFLIGHT_SUFFIX}`),
            step(
                "build-user",
                `the group ${socket.group} and the ssh user ${access.user} (password locked, in no docker, sudo, wheel or adm group; its authorized_keys owned by root, managed by \`starci vps build-key\`)`,
                `
G=${shellQuote(socket.group)}; U=${shellQuote(access.user)}; H=${shellQuote(access.home)}
C=unchanged
getent group "$G" >/dev/null || { groupadd --system "$G"; C=changed; }
if ! id -u "$U" >/dev/null 2>&1; then useradd --system --create-home --home-dir "$H" --shell /bin/sh --gid "$G" "$U"; C=changed; fi
passwd -l "$U" >/dev/null 2>&1 || true
for g in $(id -nG "$U"); do case "$g" in docker|sudo|wheel|adm|root) gpasswd -d "$U" "$g" >/dev/null; C=changed;; esac; done
install -d -m 750 -o root -g "$G" "$H/.ssh"
if [ ! -f "$H/.ssh/authorized_keys" ]; then install -m 640 -o root -g "$G" /dev/null "$H/.ssh/authorized_keys"; C=changed; else chown root:"$G" "$H/.ssh/authorized_keys"; chmod 640 "$H/.ssh/authorized_keys"; fi
echo "$C"`,
            ),
            step(
                "buildctl",
                `buildctl ${service.buildctl.version} at ${service.buildctl.path} from the BuildKit release, its tarball checked against the pinned sha256`,
                `
V=${shellQuote(service.buildctl.version)}; P=${shellQuote(service.buildctl.path)}
case "$(uname -m)" in x86_64) A=amd64; S=${service.buildctl.sha256.amd64};; aarch64) A=arm64; S=${service.buildctl.sha256.arm64};; *) echo "no buildctl is pinned for $(uname -m)" >&2; exit 3;; esac
if [ -x "$P" ] && "$P" --version 2>/dev/null | grep -qF " $V "; then echo unchanged; exit 0; fi
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
curl -fsSL --proto '=https' --max-time 300 -o "$T/b.tgz" "https://github.com/moby/buildkit/releases/download/$V/buildkit-$V.linux-$A.tar.gz" || { echo "the BuildKit release $V could not be downloaded" >&2; exit 4; }
printf '%s  %s\\n' "$S" "$T/b.tgz" | sha256sum -c - >/dev/null 2>&1 || { echo "buildkit-$V.linux-$A.tar.gz does not match its pinned sha256; nothing was installed" >&2; exit 4; }
tar -xzf "$T/b.tgz" -C "$T" bin/buildctl
install -m 0755 -o root -g root "$T/bin/buildctl" "$P"
echo changed`,
            ),
            step("gate", `the forced command ${access.gate}: it admits exactly \`${GATE_REQUEST}\` to ${socket.path}`, `C=unchanged\n${writeFile(access.gate, buildGateScript(service), "0755")}\necho "$C"`),
            step(
                "socket-dir",
                `the socket folder ${socket.dir} (uid ${String(daemon.uid)}, group ${socket.group}, a default ACL giving the group the socket), made again at every boot by ${tmpfiles}`,
                `
C=unchanged
command -v setfacl >/dev/null || { if command -v apt-get >/dev/null; then DEBIAN_FRONTEND=noninteractive apt-get install -y -qq acl >/dev/null; else dnf install -y -q acl >/dev/null; fi; C=changed; }
${writeFile(tmpfiles, tmpfilesText, "0644")}
systemd-tmpfiles --create ${shellQuote(tmpfiles)}
echo "$C"`,
            ),
            step(
                "files",
                `${service.dir}/compose.yaml and buildkitd.toml (${render.image})`,
                `
C=unchanged
install -d -m 755 -o root -g root ${shellQuote(service.dir)}
${writeFile(composeFile, render.compose, "0644")}
${writeFile(`${service.dir}/buildkitd.toml`, render.toml, "0644")}
echo "$C"`,
            ),
            step(
                "up",
                `the compose project ${service.project} up and healthy, then ${access.user} reaches it through buildctl (rollback: \`${compose} down\`, the cache volume kept)`,
                `
B=$(${compose} ps -q buildkitd 2>/dev/null || true)
${compose} up -d --wait --wait-timeout 180 >/dev/null || { echo "buildkitd did not become healthy: $(${compose} logs --tail 20 buildkitd 2>&1 | tail -n 5 | tr '\\n' ' ')" >&2; exit 5; }
A=$(${compose} ps -q buildkitd || true)
runuser -u ${shellQuote(access.user)} -- ${shellQuote(service.buildctl.path)} --addr ${shellQuote(`unix://${socket.path}`)} debug workers >/dev/null 2>&1 || { echo "${access.user} cannot reach ${socket.path}" >&2; exit 5; }
if [ "$A" = "$B" ]; then echo unchanged; else echo changed; fi`,
            ),
        ],
        notes: [
            `rootless only: ${render.image} as uid ${String(daemon.uid)}, never privileged, no Docker socket, no host namespaces; the preflight stops with the reason when the kernel cannot run it`,
            `rollback: \`${compose} down\` on the host; it touches no app stack and keeps the volume ${service.storage.volume}`,
            `clients: \`docker buildx create --name ${access.builder} --driver remote ssh://${access.user}@<host>\`, each with a key from \`starci vps build-key add ${serverId} --repo <owner>/<name>\``,
        ],
    }
}

/** The rollback: the compose project down, its files and the cache volume kept; the user, the gate and buildctl stay. */
export const buildkitDownPlan = (service: BuildkitService, serverId: string): VpsPlan => {
    const compose = `docker compose -p ${shellQuote(service.project)} -f ${shellQuote(`${service.dir}/compose.yaml`)}`
    return {
        verb: "buildkit down",
        server: serverId,
        steps: [step("down", `the compose project ${service.project} down (its cache volume ${service.storage.volume} kept)`, `[ -f ${shellQuote(`${service.dir}/compose.yaml`)} ] || { echo unchanged; exit 0; }\nif [ -z "$(${compose} ps -q || true)" ]; then echo unchanged; exit 0; fi\n${compose} down >/dev/null\necho changed`)],
        notes: ["no app stack is touched; `docker volume rm` of the cache is a separate owner choice"],
    }
}

/**
 * The read-only doctor of the service, run as root on the host: the kernel facts, the running container's rootless shape (user, privileged,
 * mounts, pid and network modes), the socket and its group, the gate, buildctl, the user's groups, and a real `buildctl debug workers` as
 * starci-build through the socket. Prints `<key>=<value>` lines that readBuildkitDoctor judges.
 */
export const buildkitDoctorScript = (service: BuildkitService): string => {
    const { access, socket } = service
    const compose = `docker compose -p ${shellQuote(service.project)} -f ${shellQuote(`${service.dir}/compose.yaml`)}`
    return `
${rootlessFactsScript()}
ID=$(${compose} ps -q buildkitd 2>/dev/null || true)
echo "container.running=$([ -n "$ID" ] && echo yes || echo no)"
if [ -n "$ID" ]; then
  echo "container.user=$(docker inspect --format '{{.Config.User}}' "$ID")"
  echo "container.privileged=$(docker inspect --format '{{.HostConfig.Privileged}}' "$ID")"
  echo "container.pid=$(docker inspect --format '{{.HostConfig.PidMode}}' "$ID")"
  echo "container.network=$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$ID")"
  echo "container.mounts=$(docker inspect --format '{{range .Mounts}}{{.Source}},{{end}}' "$ID")"
  echo "container.health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$ID")"
  echo "container.image=$(docker inspect --format '{{.Config.Image}}' "$ID")"
fi
echo "socket.exists=$([ -S ${shellQuote(socket.path)} ] && echo yes || echo no)"
echo "socket.groupWrite=$(runuser -u ${shellQuote(access.user)} -- test -w ${shellQuote(socket.path)} 2>/dev/null && echo yes || echo no)"
echo "user.groups=$(id -nG ${shellQuote(access.user)} 2>/dev/null | tr ' ' ',')"
echo "gate.installed=$([ -x ${shellQuote(access.gate)} ] && echo yes || echo no)"
echo "buildctl.version=$(${shellQuote(service.buildctl.path)} --version 2>/dev/null | awk '{print $3}')"
WORKERS=$(runuser -u ${shellQuote(access.user)} -- ${shellQuote(service.buildctl.path)} --addr ${shellQuote(`unix://${socket.path}`)} debug workers 2>/dev/null | awk 'NR>1{print $1}' | paste -sd, - || true)
echo "workers=$WORKERS"
echo "keys=$(grep -c ' starci-build:' ${shellQuote(`${access.home}/.ssh/authorized_keys`)} 2>/dev/null || true)"`.trim()
}

/** One judged fact of the doctor. */
export interface BuildkitCheck {
    readonly name: string
    readonly ok: boolean
    readonly detail: string
}

/** The doctor's verdict: ok only when every check passes; `blocked` carries the kernel's exact reason when it cannot run rootless. */
export interface BuildkitDoctor {
    readonly ok: boolean
    readonly blocked: string
    readonly checks: readonly BuildkitCheck[]
}

const factsOf = (stdout: string): Map<string, string> => {
    const values = new Map<string, string>()
    for (const line of stdout.split(/\r?\n/)) {
        const at = line.indexOf("=")
        if (at > 0) values.set(line.slice(0, at).trim(), line.slice(at + 1).trim())
    }
    return values
}

/** Judges the doctor's output against the service (and the pinned image, when given). */
export const readBuildkitDoctor = (service: BuildkitService, stdout: string, image?: string): BuildkitDoctor => {
    const facts = factsOf(stdout)
    const get = (key: string): string => facts.get(key) ?? ""
    const blocked = get("rootless.block")
    const groups = get("user.groups").split(",").filter((group) => group !== "")
    const mounts = get("container.mounts").split(",").filter((mount) => mount !== "")
    const running = get("container.running") === "yes"
    const checks: BuildkitCheck[] = [
        { name: "rootless kernel", ok: blocked === "" && facts.has("rootless.block"), detail: blocked === "" ? `kernel ${get("rootless.kernel")}, snapshotter ${get("rootless.snapshotter")}` : blocked },
        { name: "container running", ok: running && get("container.health") === "healthy", detail: running ? `health ${get("container.health")}` : `no buildkitd in the project ${service.project}` },
        ...(running
            ? [
                  { name: "non-root user", ok: get("container.user") === `${String(service.daemon.uid)}:${String(service.daemon.uid)}`, detail: `user ${get("container.user") || "(image default)"}` },
                  { name: "not privileged", ok: get("container.privileged") === "false", detail: `privileged ${get("container.privileged")}` },
                  { name: "no host namespaces", ok: get("container.pid") !== "host" && get("container.network") !== "host", detail: `pid ${get("container.pid") || "private"}, network ${get("container.network")}` },
                  { name: "no engine socket", ok: !mounts.some((mount) => /docker\.sock|containerd\.sock/.test(mount)), detail: `mounts ${mounts.join(", ") || "none"}` },
                  ...(image === undefined ? [] : [{ name: "pinned image", ok: get("container.image") === image, detail: get("container.image") }]),
              ]
            : []),
        { name: "socket", ok: get("socket.exists") === "yes" && get("socket.groupWrite") === "yes", detail: `${service.socket.path} ${get("socket.exists") === "yes" ? "exists" : "is missing"}, ${service.access.user} ${get("socket.groupWrite") === "yes" ? "can" : "cannot"} write it` },
        { name: "no docker group", ok: groups.length > 0 && !groups.some((group) => ["docker", "sudo", "wheel", "adm", "root"].includes(group)), detail: `${service.access.user} groups ${groups.join(", ") || "(no such user)"}` },
        { name: "gate", ok: get("gate.installed") === "yes", detail: service.access.gate },
        { name: "buildctl", ok: get("buildctl.version") === service.buildctl.version, detail: `${get("buildctl.version") || "missing"}, pinned ${service.buildctl.version}` },
        { name: "workers", ok: get("workers") !== "", detail: get("workers") === "" ? `buildctl debug workers as ${service.access.user} answered nothing` : `buildctl debug workers: ${get("workers")}` },
    ]
    return { ok: checks.every((check) => check.ok), blocked, checks }
}

/**
 * The client side of a ping from a machine that holds a key: the argv of `docker buildx` that create the builder (idempotent: an existing one
 * is inspected) and bootstrap it, i.e. a real `buildctl dial-stdio` through the gate. The hosts doctor runs them with its own timeout.
 */
export const builderPingCommands = (service: Pick<BuildkitService, "access">, endpoint: string): { readonly create: readonly string[]; readonly bootstrap: readonly string[]; readonly remove: readonly string[] } => ({
    create: ["buildx", "create", "--name", service.access.builder, "--driver", "remote", endpoint],
    bootstrap: ["buildx", "inspect", "--bootstrap", service.access.builder],
    remove: ["buildx", "rm", service.access.builder],
})

/** A storage size of buildkitd.toml in MB (KB, MB, GB, TB); a percentage of the disk is 0 here (it is a share, not an amount). */
const storageMegabytes = (size: string): number => {
    const match = /^(\d+(?:\.\d+)?)([KMGT])B$/.exec(size)
    if (match === null) return 0
    const factor = { K: 1 / 1024, M: 1, G: 1024, T: 1024 * 1024 }[match[2] as "K" | "M" | "G" | "T"]
    return Math.ceil(Number(match[1]) * factor)
}

/** Judges whether the builder's limits fit the box beside the app reserve (ops/vps.yaml services.capacity); refuses BUILDKIT_CAPACITY naming every number. */
export const judgeBuildkitCapacity = (service: BuildkitService, measured: Measured, keep: Keep): string[] => {
    const memoryMb = megabytes(service.limits.memory)
    const cpus = Number(service.limits.cpus)
    const cacheMb = storageMegabytes(service.storage.maxUsed)
    const onDisk = measured.volumes.includes(service.storage.volume)
    const checks = [
        { ok: memoryMb <= measured.totalMb - keep.memoryMb, line: `memory limit: ${service.name} ${String(memoryMb)} MB against ${String(measured.totalMb)} MB less ${String(keep.memoryMb)} MB kept for the apps` },
        { ok: cpus <= measured.cpus - keep.cpus, line: `CPU limit: ${service.name} ${service.limits.cpus} against ${String(measured.cpus)} CPUs less ${String(keep.cpus)} kept` },
        ...(onDisk ? [] : [{ ok: cacheMb <= measured.diskFreeMb - keep.diskMb, line: `disk: the cache may grow to ${service.storage.maxUsed} against ${String(measured.diskFreeMb)} MB free less ${String(keep.diskMb)} MB kept` }]),
    ]
    const lines = checks.map((check) => `  capacity ${check.ok ? "fits" : "DOES NOT FIT"}: ${check.line}`)
    if (checks.some((check) => !check.ok)) throw new Refusal("BUILDKIT_CAPACITY", `${service.name} does not fit this box; nothing was changed:\n${lines.join("\n")}`)
    return lines
}

/** The Actions secrets of a repository that builds through the remote builder (images.yml reads them; build-key sets and deletes them). */
export const BUILDER_SECRETS = Object.freeze({ key: "STARCI_BUILDER_SSH_KEY", host: "STARCI_BUILDER_HOST", knownHosts: "STARCI_BUILDER_KNOWN_HOSTS" })

const authorizedKeys = (service: BuildkitService): string => `${service.access.home}/.ssh/authorized_keys`

/** `build-key add`: the repository's line replaces any line it had (one key per repository), added to the root-owned authorized_keys. */
export const buildKeyAddPlan = (service: BuildkitService, serverId: string, repo: string): VpsPlan => {
    const comment = buildKeyComment(repo)
    const file = authorizedKeys(service)
    return {
        verb: "build-key add",
        server: serverId,
        steps: [
            step(
                "build-key",
                `the key of ${repo} in ${file}, forced to ${service.access.gate} (one line per repository; an older key of it is replaced)`,
                `
F=${shellQuote(file)}; N=${shellQuote(` ${comment}`)}
[ -f "$F" ] || { echo "no ${service.access.user} on this server: bring the buildkit service up first" >&2; exit 3; }
L="${buildKeyOptions(service).replaceAll('"', '\\"')} $BUILD_PUBLIC_KEY ${comment}"
grep -qxF "$L" "$F" && { echo unchanged; exit 0; }
T=$(mktemp); grep -vF "$N" "$F" > "$T" || true
printf '%s\\n' "$L" >> "$T"
install -m 640 -o root -g ${shellQuote(service.socket.group)} "$T" "$F"; rm -f "$T"
echo changed`,
                ["BUILD_PUBLIC_KEY"],
            ),
        ],
        notes: [
            `a new ed25519 key is made on this machine; its private half goes only to the Actions secret ${BUILDER_SECRETS.key} of ${repo} (gh secret set, on stdin, never printed), with ${BUILDER_SECRETS.host} and ${BUILDER_SECRETS.knownHosts}`,
            `the key opens nothing but \`${GATE_REQUEST}\`; \`vps grant\` never touches ${file}`,
            `the repository opts in with ci.imageBuilder: remote in .starcistacks/application-stacks.yaml, then \`starci app sync\``,
        ],
    }
}

/** `build-key remove`: the repository's line goes (idempotent); its Actions secrets are deleted after. */
export const buildKeyRemovePlan = (service: BuildkitService, serverId: string, repo: string): VpsPlan => {
    const comment = buildKeyComment(repo)
    const file = authorizedKeys(service)
    return {
        verb: "build-key remove",
        server: serverId,
        steps: [
            step(
                "build-key",
                `remove the key of ${repo} from ${file}`,
                `
F=${shellQuote(file)}; N=${shellQuote(` ${comment}`)}
[ -f "$F" ] && grep -qF "$N" "$F" || { echo unchanged; exit 0; }
T=$(mktemp); grep -vF "$N" "$F" > "$T" || true
install -m 640 -o root -g ${shellQuote(service.socket.group)} "$T" "$F"; rm -f "$T"
echo changed`,
            ),
        ],
        notes: [`the Actions secrets ${Object.values(BUILDER_SECRETS).join(", ")} of ${repo} are deleted after (gh secret delete); its images.yml then builds on the runner`],
    }
}

/** `build-key list`: the repositories that hold a key, one per line (read-only). */
export const buildKeyListScript = (service: BuildkitService): string => `F=${shellQuote(authorizedKeys(service))}\n[ -f "$F" ] || exit 0\nsed -n 's/.* starci-build:\\([A-Za-z0-9_.-]*\\/[A-Za-z0-9_.-]*\\)$/\\1/p' "$F" | sort -u`

/** Reads the list script's output. */
export const readBuildKeys = (stdout: string): string[] => stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => REPO.test(line))
