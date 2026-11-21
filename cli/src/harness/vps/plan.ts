import { Refusal } from "../../shared/errors.js"
import { forServer } from "./policy.js"
import type { ManagedServer, VpsPins, VpsPolicy } from "./policy.js"
import { shellQuote } from "./ssh.js"

/**
 * The dry-run planners of `starci vps`: each acting verb is a list of steps, each one idempotent bash that runs on the server
 * (as root through `sudo -n` when the login is not root) and prints `changed` or `unchanged`. A plan is printed as it is by a dry
 * run and run step by step by `--execute`. A step names the secrets it reads from its environment; their values are put on the
 * script's stdin at run time (ssh.ts), so a plan, its print and its argv never hold one. Nothing here reaches a server.
 */

/** A secret a step reads from its environment, resolved by the verb at run time. */
export type StepSecret =
    | "OPS_PUBLIC_KEY"
    | "DEPLOY_PUBLIC_KEY"
    | "TUNNEL_TOKEN"
    | "CLOUDFLARE_API_TOKEN"
    | "MONITOR_TELEGRAM_TOKEN"
    | "MONITOR_GRAFANA_PASSWORD"
    | "MONITOR_GLITCHTIP_DB_PASSWORD"
    | "MONITOR_GLITCHTIP_SECRET_KEY"
    | "SERVICE_KEY"
    | "BUILD_PUBLIC_KEY"

/** One step of a plan. */
export interface PlanStep {
    readonly id: string
    readonly summary: string
    readonly root: boolean
    readonly script: string
    readonly secrets: readonly StepSecret[]
}

/** The plan of one verb on one server. */
export interface VpsPlan {
    readonly verb: string
    readonly server: string
    readonly steps: readonly PlanStep[]
    readonly notes: readonly string[]
}

const step = (id: string, summary: string, script: string, secrets: readonly StepSecret[] = []): PlanStep => ({ id, summary, root: true, script: script.trim(), secrets })

/** Writes `content` to `file` only when it differs, then runs `then` (a reload); prints changed or unchanged. */
const writeIfChanged = (file: string, content: string, mode: string, then: string): string => {
    const marker = "STARCI_EOF"
    if (content.includes(marker)) throw new Refusal("VPS_PLAN_INVALID", `a file the plan writes holds ${marker}`)
    const quoted = shellQuote(file)
    return [
        `cat > ${quoted}.starci-new <<'${marker}'`,
        content.trimEnd(),
        marker,
        `if cmp -s ${quoted}.starci-new ${quoted}; then rm -f ${quoted}.starci-new; echo unchanged; else install -m ${mode} ${quoted}.starci-new ${quoted}; rm -f ${quoted}.starci-new; ${then} echo changed; fi`,
    ].join("\n")
}

/** The ports a firewall opens: the policy's list with `ssh` read as the server's sshPort. */
export const openPorts = (policy: VpsPolicy, server: ManagedServer): string[] => [...new Set(policy.bootstrap.firewall.openPorts.map((port) => (port === "ssh" ? `${String(server.sshPort)}/tcp` : port)))]

const install = (server: ManagedServer, packages: string): string =>
    server.family === "debian" ? `DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ${packages} >/dev/null` : `dnf install -y -q ${packages} >/dev/null`

const aptUpdate = (server: ManagedServer): string => (server.family === "debian" ? "apt-get update -qq >/dev/null" : "true")

/**
 * Prints `clean.panels=<names>` (the control panels of ops/vps.yaml `bootstrap.notClean` found by their folders) and
 * `clean.listeners=<addresses>` (what listens on its ports and is not Docker); both empty on a clean box. Read-only.
 */
export const cleanScript = (policy: VpsPolicy): string => {
    const { panels, ports } = policy.bootstrap.notClean
    const filter = ports.map((port) => `sport = :${String(port)}`).join(" or ")
    return [
        `P=""`,
        ...Object.entries(panels).map(([name, dir]) => `[ -d ${shellQuote(dir)} ] && P="$P,${name}"`),
        `echo "clean.panels=\${P#,}"`,
        `echo "clean.listeners=$(ss -Htlnp '( ${filter} )' 2>/dev/null | grep -vE 'docker-proxy|dockerd' | awk '{print $4}' | sort -u | paste -sd, -)"`,
    ].join("\n")
}

/** The preflight of bootstrap: the OS its file names, systemd, and a clean box (no control panel, nothing but Docker on 80/443). */
const preflight = (policy: VpsPolicy, server: ManagedServer): PlanStep =>
    step(
        "preflight",
        `the server runs ${server.os} (its file's os) and systemd, and is a clean box: no control panel, nothing but Docker on ${policy.bootstrap.notClean.ports.join("/")}`,
        `
. /etc/os-release
if [ "$ID" != ${shellQuote(server.os)} ]; then echo "the server runs $ID, its file says ${server.os}" >&2; exit 3; fi
command -v systemctl >/dev/null || { echo "no systemd" >&2; exit 3; }
CLEAN=$(
${cleanScript(policy)}
)
PANELS=$(printf '%s
' "$CLEAN" | sed -n 's/^clean.panels=//p'); LISTEN=$(printf '%s
' "$CLEAN" | sed -n 's/^clean.listeners=//p')
if [ -n "$PANELS$LISTEN" ]; then echo "not a clean box (panel: \${PANELS:-none}; listening on ${policy.bootstrap.notClean.ports.join("/")}: \${LISTEN:-none}); starci vps manages clean boxes only, so handle this one by hand" >&2; exit 9; fi
echo unchanged`,
    )

/** The ops user: key login with the sealed key's public half only, sudo without a password, its password locked. */
const opsUser = (policy: VpsPolicy): PlanStep => {
    const user = policy.bootstrap.opsUser
    const sudoers = `/etc/sudoers.d/90-${user}`
    return step(
        "ops-user",
        `the ops user ${user}: key login with the sealed key, sudo without a password, password locked`,
        `
U=${shellQuote(user)}
C=unchanged
if ! id -u "$U" >/dev/null 2>&1; then useradd --create-home --shell /bin/bash "$U"; C=changed; fi
passwd -l "$U" >/dev/null 2>&1 || true
H=$(getent passwd "$U" | cut -d: -f6)
install -d -m 700 -o "$U" -g "$U" "$H/.ssh"
touch "$H/.ssh/authorized_keys"
if ! grep -qxF "$OPS_PUBLIC_KEY" "$H/.ssh/authorized_keys"; then printf '%s\\n' "$OPS_PUBLIC_KEY" >> "$H/.ssh/authorized_keys"; C=changed; fi
chown "$U:$U" "$H/.ssh/authorized_keys"; chmod 600 "$H/.ssh/authorized_keys"
printf '%s ALL=(ALL) NOPASSWD:ALL\\n' "$U" > ${sudoers}.starci-new
if cmp -s ${sudoers}.starci-new ${sudoers}; then rm -f ${sudoers}.starci-new; else visudo -cf ${sudoers}.starci-new >/dev/null && install -m 440 ${sudoers}.starci-new ${sudoers} && rm -f ${sudoers}.starci-new; C=changed; fi
echo "$C"`,
        ["OPS_PUBLIC_KEY"],
    )
}

/** sshd hardening in a drop-in that wins over the main file; `sshd -t` must accept it or the previous file comes back. */
const sshd = (policy: VpsPolicy): PlanStep => {
    const file = "/etc/ssh/sshd_config.d/00-starci.conf"
    const content = ["# Written by `starci vps bootstrap` (ops/vps.yaml bootstrap.sshd); a later edit is overwritten.", ...Object.entries(policy.bootstrap.sshd).map(([key, value]) => `${key} ${value}`)].join("\n")
    return step(
        "sshd",
        `${Object.entries(policy.bootstrap.sshd).map(([key, value]) => `${key} ${value}`).join(", ")}, in a drop-in sshd -t validates`,
        `
install -d -m 755 /etc/ssh/sshd_config.d
grep -qE '^[[:space:]]*Include[[:space:]]+/etc/ssh/sshd_config.d/\\*\\.conf' /etc/ssh/sshd_config || sed -i '1i Include /etc/ssh/sshd_config.d/*.conf' /etc/ssh/sshd_config
[ -f ${file} ] && cp -p ${file} ${file}.starci-prev || rm -f ${file}.starci-prev
${writeIfChanged(file, content, "644", `if ! sshd -t; then if [ -f ${file}.starci-prev ]; then mv ${file}.starci-prev ${file}; else rm -f ${file}; fi; echo "sshd -t refused the settings; the previous file is back" >&2; exit 4; fi; systemctl reload ssh 2>/dev/null || systemctl reload sshd;`)}
rm -f ${file}.starci-prev`,
    )
}

const firewall = (policy: VpsPolicy, server: ManagedServer): PlanStep => {
    const ports = openPorts(policy, server)
    const summary = `firewall ${server.firewallKind}: only ${ports.join(", ")} open`
    if (server.firewallKind === "ufw") {
        return step(
            "firewall",
            summary,
            `
command -v ufw >/dev/null || { ${aptUpdate(server)}; ${install(server, "ufw")}; }
B=$(ufw status verbose 2>/dev/null | md5sum)
${ports.map((port) => `ufw allow ${port} >/dev/null`).join("\n")}
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw --force enable >/dev/null
[ "$B" = "$(ufw status verbose | md5sum)" ] && echo unchanged || echo changed`,
        )
    }
    if (server.firewallKind === "firewalld") {
        return step(
            "firewall",
            summary,
            `
command -v firewall-cmd >/dev/null || ${install(server, "firewalld")}
systemctl enable --now firewalld >/dev/null 2>&1
B=$(firewall-cmd --list-all | md5sum)
${ports.map((port) => `firewall-cmd --permanent --add-port=${port} >/dev/null`).join("\n")}
firewall-cmd --permanent --remove-service=cockpit >/dev/null 2>&1 || true
firewall-cmd --reload >/dev/null
[ "$B" = "$(firewall-cmd --list-all | md5sum)" ] && echo unchanged || echo changed`,
        )
    }
    const tcp = ports.filter((port) => port.endsWith("/tcp")).map((port) => port.slice(0, -"/tcp".length))
    return step(
        "firewall",
        `${summary} (CSF's TCP_IN; DOCKER="0" and a csfpost.sh that restarts Docker, so csf and Docker live together)`,
        `
[ -f /etc/csf/csf.conf ] || { echo "csf is not installed: a server whose file names csf has CSF installed by the owner first, or names no firewall and gets its family default" >&2; exit 5; }
B=$(md5sum < /etc/csf/csf.conf)
for P in ${tcp.join(" ")}; do
  grep -qE "^TCP_IN = \\"([^\\"]*,)?$P(,[^\\"]*)?\\"" /etc/csf/csf.conf || sed -i -E "s/^TCP_IN = \\"([^\\"]*)\\"/TCP_IN = \\"\\1,$P\\"/" /etc/csf/csf.conf
done
sed -i -E 's/^TESTING = "1"/TESTING = "0"/; s/^DOCKER = "1"/DOCKER = "0"/' /etc/csf/csf.conf
printf '#!/bin/sh
# Written by starci vps bootstrap: csf flushes iptables, so Docker restarts to rebuild its chains.
if systemctl is-active --quiet docker; then systemctl restart docker; fi
' > /etc/csf/csfpost.sh.starci-new
if ! cmp -s /etc/csf/csfpost.sh.starci-new /etc/csf/csfpost.sh; then install -m 700 /etc/csf/csfpost.sh.starci-new /etc/csf/csfpost.sh; B=changed; fi
rm -f /etc/csf/csfpost.sh.starci-new
if [ "$B" = "$(md5sum < /etc/csf/csf.conf)" ] && [ ! -f /etc/csf/csf.error ] && systemctl is-active --quiet lfd; then echo unchanged; exit 0; fi
D=0; if systemctl is-active --quiet docker; then systemctl stop docker docker.socket; D=1; fi
rm -f /etc/csf/csf.error
systemctl restart csf lfd
[ "$D" = 1 ] && systemctl start docker
echo changed`,
    )
}

const intrusion = (policy: VpsPolicy, server: ManagedServer): PlanStep => {
    const guard = policy.bootstrap.intrusion
    if (server.firewallKind === "csf") return step("intrusion", "CSF's lfd guards ssh logins", "systemctl enable --now lfd >/dev/null 2>&1\nsystemctl is-active --quiet lfd && echo unchanged")
    const jail = ["[sshd]", "enabled = true", `port = ${String(server.sshPort)}`, `maxretry = ${String(guard.maxRetry)}`, `findtime = ${String(guard.findTimeMinutes)}m`, `bantime = ${String(guard.banTimeMinutes)}m`, "backend = systemd"].join("\n")
    const packages = server.family === "debian" ? "fail2ban" : "epel-release && dnf install -y -q fail2ban fail2ban-systemd"
    return step(
        "intrusion",
        `fail2ban's sshd jail: ${String(guard.maxRetry)} failures in ${String(guard.findTimeMinutes)} min ban for ${String(guard.banTimeMinutes)} min`,
        `
command -v fail2ban-client >/dev/null || { ${aptUpdate(server)}; ${install(server, packages)}; }
install -d -m 755 /etc/fail2ban/jail.d
${writeIfChanged("/etc/fail2ban/jail.d/starci-sshd.local", jail, "644", "systemctl restart fail2ban;")}
systemctl enable --now fail2ban >/dev/null 2>&1`,
    )
}

const autoUpdates = (server: ManagedServer): PlanStep =>
    server.family === "debian"
        ? step(
              "auto-updates",
              "security updates install by themselves (unattended-upgrades)",
              `
dpkg -s unattended-upgrades >/dev/null 2>&1 || { ${aptUpdate(server)}; ${install(server, "unattended-upgrades")}; }
${writeIfChanged("/etc/apt/apt.conf.d/20auto-upgrades", 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";', "644", "")}`,
          )
        : step(
              "auto-updates",
              "security updates install by themselves (dnf-automatic, security only)",
              `
rpm -q dnf-automatic >/dev/null 2>&1 || ${install(server, "dnf-automatic")}
B=$(md5sum < /etc/dnf/automatic.conf)
sed -i -E 's/^upgrade_type *=.*/upgrade_type = security/; s/^apply_updates *=.*/apply_updates = yes/' /etc/dnf/automatic.conf
systemctl enable --now dnf-automatic.timer >/dev/null 2>&1
[ "$B" = "$(md5sum < /etc/dnf/automatic.conf)" ] && echo unchanged || echo changed`,
          )

/** Docker Engine at the pinned version from the vendor repository, held there; the ops user joins the docker group. */
const docker = (policy: VpsPolicy, server: ManagedServer, pins: VpsPins): PlanStep => {
    const repo = policy.docker.repository[server.family]
    const user = shellQuote(policy.bootstrap.opsUser)
    const head = `
V=${shellQuote(pins.docker)}
HAVE=$(docker version --format '{{.Server.Version}}' 2>/dev/null || true)
if [ "$HAVE" = "$V" ]; then id -nG ${user} | grep -qw docker || usermod -aG docker ${user}; echo unchanged; exit 0; fi`
    const tail = `
systemctl enable --now docker >/dev/null 2>&1
usermod -aG docker ${user}
echo changed`
    if (server.family === "debian") {
        return step(
            "docker",
            `Docker Engine ${pins.docker} from ${repo}, held at that version`,
            `${head}
. /etc/os-release
apt-get update -qq >/dev/null
${install(server, "ca-certificates curl")}
install -m 0755 -d /etc/apt/keyrings
curl -fsSL ${shellQuote(repo)}/$ID/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] ${repo}/$ID $VERSION_CODENAME stable" > /etc/apt/sources.list.d/docker.list
apt-get update -qq >/dev/null
P=$(apt-cache madison docker-ce | awk -v v="$V" '$3 ~ ("^([0-9]+:)?" v "-") {print $3; exit}')
[ -n "$P" ] || { echo "docker-ce $V is not in the repository" >&2; exit 6; }
apt-mark unhold docker-ce docker-ce-cli >/dev/null 2>&1 || true
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --allow-downgrades "docker-ce=$P" "docker-ce-cli=$P" containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
apt-mark hold docker-ce docker-ce-cli >/dev/null${tail}`,
        )
    }
    return step(
        "docker",
        `Docker Engine ${pins.docker} from ${repo}, held at that version`,
        `${head}
curl -fsSL ${shellQuote(`${repo}/centos/docker-ce.repo`)} -o /etc/yum.repos.d/docker-ce.repo
P=$(dnf -q list --showduplicates docker-ce 2>/dev/null | awk -v v="$V" '$2 ~ ("^([0-9]+:)?" v "-") {print $2; exit}')
[ -n "$P" ] || { echo "docker-ce $V is not in the repository" >&2; exit 6; }
P=\${P#*:}
dnf install -y -q --allowerasing "docker-ce-$P" "docker-ce-cli-$P" containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
grep -q '^exclude=docker-ce' /etc/dnf/dnf.conf || echo 'exclude=docker-ce docker-ce-cli' >> /etc/dnf/dnf.conf${tail}`,
    )
}

/** `vps bootstrap <id>`: the ops user, sshd, firewall, intrusion guard, automatic security updates and Docker, in this order. */
export const bootstrapPlan = (policy: VpsPolicy, server: ManagedServer, pins: VpsPins): VpsPlan => ({
    verb: "bootstrap",
    server: server.id,
    steps: [preflight(policy, server), opsUser(policy), sshd(policy), firewall(policy, server), intrusion(policy, server), ...(policy.bootstrap.autoUpdates ? [autoUpdates(server)] : []), docker(policy, server, pins)],
    notes: [
        `after ops-user the CLI logs in again as ${policy.bootstrap.opsUser} with the sealed key and checks sudo before sshd turns password login off; the sealed login becomes ${policy.bootstrap.opsUser}`,
        "root keeps key login (prohibit-password) for recovery; no password is ever set, sent or stored",
    ],
})

/** `vps swarm init <id>`: a one-manager swarm advertised on the server's address, and the shared overlay network. */
export const swarmInitPlan = (policy: VpsPolicy, server: ManagedServer): VpsPlan => {
    if (server.swarm.role !== "manager") throw new Refusal("VPS_SWARM_ROLE", `${server.id} is a swarm ${server.swarm.role}; only a manager inits a swarm (a worker joins one, a design of its own)`)
    const network = shellQuote(policy.swarm.network)
    return {
        verb: "swarm init",
        server: server.id,
        steps: [
            step(
                "swarm",
                `a swarm advertised on ${server.host}${policy.swarm.autolock ? ", autolocked" : ""}`,
                `
S=$(docker info --format '{{.Swarm.LocalNodeState}}')
if [ "$S" = active ]; then echo unchanged; exit 0; fi
A=${shellQuote(server.host)}
case "$A" in *[!0-9.]*) A=$(hostname -I | awk '{print $1}');; esac
docker swarm init --advertise-addr "$A"${policy.swarm.autolock ? " --autolock" : ""} >/dev/null
echo changed`,
            ),
            step("network", `the attachable overlay network ${policy.swarm.network}`, `docker network inspect ${network} >/dev/null 2>&1 && { echo unchanged; exit 0; }\ndocker network create --driver overlay --attachable ${network} >/dev/null\necho changed`),
        ],
        notes: ["swarm's 2377, 7946 and 4789 stay closed in the firewall while the swarm has one node"],
    }
}

/** The Swarm UI stack file: Portainer CE on the shared network, its agent global, no port published. */
export const uiStackFile = (policy: VpsPolicy, pins: VpsPins): string =>
    [
        "# Written by `starci vps ui up` (ops/vps.yaml ui): no port is published; the server's tunnel or proxy is the only door.",
        'version: "3.8"',
        "services:",
        "  agent:",
        `    image: ${pins.uiAgent}`,
        "    volumes:",
        "      - /var/run/docker.sock:/var/run/docker.sock",
        "      - /var/lib/docker/volumes:/var/lib/docker/volumes",
        "    networks: [agent]",
        "    deploy:",
        "      mode: global",
        "      placement: {constraints: [node.platform.os == linux]}",
        "  portainer:",
        `    image: ${pins.uiServer}`,
        "    command: -H tcp://tasks.agent:9001 --tlsskipverify",
        "    volumes: [data:/data]",
        "    networks: [agent, public]",
        "    deploy:",
        "      replicas: 1",
        "      placement: {constraints: [node.role == manager]}",
        "networks:",
        "  agent: {driver: overlay, attachable: true}",
        `  public: {external: true, name: ${policy.swarm.network}}`,
        "volumes:",
        "  data: {}",
    ].join("\n")

/** The fully qualified name of a subdomain label of the owner's domain. */
export const fqdnOf = (policy: VpsPolicy, label: string): string => `${label}.${policy.ingress.domain}`

/** The UI's public name for a server. */
export const uiHost = (policy: VpsPolicy, server: Pick<ManagedServer, "id">): string => fqdnOf(policy, forServer(policy.ui.subdomain, server.id))

/** `vps ui up <id>`: the Portainer stack, deployed (again) only when its file changed. */
export const uiUpPlan = (policy: VpsPolicy, server: ManagedServer, pins: VpsPins): VpsPlan => ({
    verb: "ui up",
    server: server.id,
    steps: [
        step(
            "ui-stack",
            `the ${policy.ui.stack} stack: ${pins.uiServer} and ${pins.uiAgent} (global)`,
            `
[ "$(docker info --format '{{.Swarm.LocalNodeState}}')" = active ] || { echo "no swarm: run starci vps swarm init first" >&2; exit 7; }
install -d -m 700 /opt/starci/ui
${writeIfChanged("/opt/starci/ui/stack.yml", uiStackFile(policy, pins), "600", `docker stack deploy --quiet -c /opt/starci/ui/stack.yml ${shellQuote(policy.ui.stack)} >/dev/null;`)}`,
        ),
    ],
    notes: [
        `the UI publishes no port: \`starci vps domain add ${server.id} ${forServer(policy.ui.subdomain, server.id)} --to ui --execute\` opens https://${uiHost(policy, server)}`,
        "Portainer asks for its admin within minutes of its first start; open it once the domain answers, or `docker service update --force " + `${policy.ui.stack}_portainer\` restarts the window`,
    ],
})

/** The deploy user of a project and environment on a server. */
export const deployUser = (policy: VpsPolicy, project: string, environment: string): string => {
    const name = `${policy.grant.userPrefix}${project}-${environment}`.toLowerCase().replaceAll(/[^a-z0-9-]/g, "-")
    if (name.length > 32) throw new Refusal("VPS_GRANT_NAME", `the deploy user ${name} is longer than 32 characters; shorten the project or environment name`)
    return name
}

/** `vps grant`: the deploy user with exactly the generated key, in the policy's groups, with no password and no sudo. */
export const grantPlan = (policy: VpsPolicy, server: ManagedServer, project: string, environment: string): VpsPlan => {
    if (!server.projects.includes(project)) throw new Refusal("VPS_GRANT_PROJECT", `${server.id} allows the projects ${server.projects.join(", ") || "(none)"}; add ${project} to its file's projects first`)
    const user = deployUser(policy, project, environment)
    const groups = policy.grant.groups.join(",")
    return {
        verb: "grant",
        server: server.id,
        steps: [
            step(
                "deploy-user",
                `the deploy user ${user} (groups ${groups || "none"}, no sudo, password locked) with the new key alone`,
                `
U=${shellQuote(user)}
C=unchanged
if ! id -u "$U" >/dev/null 2>&1; then useradd --create-home --shell /bin/bash${groups === "" ? "" : ` --groups ${shellQuote(groups)}`} "$U"; C=changed; fi
${groups === "" ? "" : `usermod -aG ${shellQuote(groups)} "$U"`}
passwd -l "$U" >/dev/null 2>&1 || true
H=$(getent passwd "$U" | cut -d: -f6)
install -d -m 700 -o "$U" -g "$U" "$H/.ssh"
printf '%s\\n' "$DEPLOY_PUBLIC_KEY" > "$H/.ssh/authorized_keys.starci-new"
if cmp -s "$H/.ssh/authorized_keys.starci-new" "$H/.ssh/authorized_keys"; then rm -f "$H/.ssh/authorized_keys.starci-new"; else install -m 600 -o "$U" -g "$U" "$H/.ssh/authorized_keys.starci-new" "$H/.ssh/authorized_keys"; rm -f "$H/.ssh/authorized_keys.starci-new"; C=changed; fi
echo "$C"`,
                ["DEPLOY_PUBLIC_KEY"],
            ),
        ],
        notes: [
            `a new ed25519 key is made on this machine for ${user}; a grant again replaces it (rotation), and the old key stops working`,
            `the app's .starcistacks/${environment}/secrets/${policy.grant.member}.enc.yaml receives VPS_HOST, VPS_USER, privateKey and knownHosts through \`starci app secret set\` (PROJECT-STACKS-5)`,
            ...(server.sshPort === 22 ? [] : [`the server listens on ${String(server.sshPort)}: the app's deploy target names that port`]),
        ],
    }
}

/** `vps revoke`: the deploy user and its home are removed; its key no longer logs in. */
export const revokePlan = (policy: VpsPolicy, server: ManagedServer, project: string, environment: string): VpsPlan => {
    const user = deployUser(policy, project, environment)
    return {
        verb: "revoke",
        server: server.id,
        steps: [step("deploy-user", `remove the deploy user ${user} and its home`, `U=${shellQuote(user)}\nid -u "$U" >/dev/null 2>&1 || { echo unchanged; exit 0; }\npkill -KILL -u "$U" 2>/dev/null || true\nuserdel -r "$U" 2>/dev/null || userdel "$U"\necho changed`)],
        notes: [`the app keeps its ${policy.grant.member} member until the owner removes it (\`starci app secret remove --env ${environment} ${policy.grant.member} --execute\` in the app); the key in it no longer logs in`],
    }
}

/** The service name of the tunnel connector and its swarm secret's name for one tunnel. */
export const connectorNames = (tunnelId: string): { readonly service: string; readonly secret: string } => ({ service: "starci-tunnel", secret: `starci_tunnel_${tunnelId.replaceAll("-", "").slice(0, 12)}` })

/** The connector of a server's tunnel: one cloudflared swarm service on the shared network, its token a swarm secret. */
export const connectorStep = (policy: VpsPolicy, pins: VpsPins, tunnelId: string): PlanStep => {
    const names = connectorNames(tunnelId)
    const network = shellQuote(policy.swarm.network)
    return step(
        "tunnel-connector",
        `the ${names.service} service (${pins.connector}) runs the server's tunnel, its token the swarm secret ${names.secret}`,
        `
[ "$(docker info --format '{{.Swarm.LocalNodeState}}')" = active ] || { echo "no swarm: run starci vps swarm init first" >&2; exit 7; }
C=unchanged
if ! docker secret inspect ${names.secret} >/dev/null 2>&1; then printf '%s' "$TUNNEL_TOKEN" | docker secret create ${names.secret} - >/dev/null; C=changed; fi
GW=$(docker network inspect docker_gwbridge --format '{{(index .IPAM.Config 0).Gateway}}')
if docker service inspect ${names.service} >/dev/null 2>&1; then
  if [ "$(docker service inspect ${names.service} --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}')" != ${shellQuote(pins.connector)} ] || ! docker service inspect ${names.service} --format '{{range .Spec.TaskTemplate.ContainerSpec.Secrets}}{{.SecretName}} {{end}}' | grep -qw ${names.secret}; then
    docker service rm ${names.service} >/dev/null; sleep 5
  else echo "$C"; exit 0; fi
fi
docker service create --quiet --detach --name ${names.service} --replicas 1 --network ${network} --secret ${names.secret} --host "host.starci.internal:$GW" ${shellQuote(pins.connector)} tunnel --no-autoupdate run --token-file /run/secrets/${names.secret} >/dev/null
echo changed`,
        ["TUNNEL_TOKEN"],
    )
}

/** Where a domain's traffic goes: through the server's tunnel to an origin URL, or through the edge proxy to a swarm service's port. */
export type DomainRoute = { readonly via: "tunnel"; readonly origin: string } | { readonly via: "edge"; readonly service: string; readonly port: number }

/**
 * The route of a `--to` target. The UI and SSH always go through the tunnel (no admin port is public); an app service goes through the
 * tunnel on a tunnel server and through Traefik on an edge server; a bare host port only through the tunnel.
 */
export const routeOf = (policy: VpsPolicy, server: ManagedServer, to: string): DomainRoute => {
    if (to === "ssh") return { via: "tunnel", origin: `ssh://host.starci.internal:${String(server.sshPort)}` }
    if (to === "ui") return { via: "tunnel", origin: `http://${policy.ui.stack}_portainer:${String(policy.ui.port)}` }
    const service = /^([a-z0-9][a-z0-9_.-]*):(\d{1,5})$/.exec(to)
    if (service !== null) {
        const [, name = "", port = ""] = service
        return server.ingressMode === "edge" ? { via: "edge", service: name, port: Number(port) } : { via: "tunnel", origin: `http://${name}:${port}` }
    }
    if (/^\d{1,5}$/.test(to) && server.ingressMode === "tunnel") return { via: "tunnel", origin: `http://host.starci.internal:${to}` }
    throw new Refusal("VPS_DOMAIN_TARGET", `--to takes <service>:<port> (a swarm service on the ${policy.swarm.network} network), ${server.ingressMode === "tunnel" ? "<port> (on the host), " : ""}ui or ssh; ${to} is neither`)
}

/** The Traefik router (and service) name of a domain. */
export const routerOf = (fqdn: string): string => fqdn.replaceAll(".", "-")

/** The edge proxy's stack file; the Cloudflare token secret's name comes from the deploy's environment (it changes with the token). */
export const edgeStackFile = (policy: VpsPolicy, pins: VpsPins): string => {
    const resolver = policy.edge.resolver
    const flags = [
        "--providers.swarm.endpoint=unix:///var/run/docker.sock",
        "--providers.swarm.exposedByDefault=false",
        `--providers.swarm.network=${policy.swarm.network}`,
        "--entrypoints.web.address=:80",
        "--entrypoints.web.http.redirections.entryPoint.to=websecure",
        "--entrypoints.web.http.redirections.entryPoint.scheme=https",
        "--entrypoints.websecure.address=:443",
        `--certificatesresolvers.${resolver}.acme.dnschallenge=true`,
        `--certificatesresolvers.${resolver}.acme.dnschallenge.provider=cloudflare`,
        `--certificatesresolvers.${resolver}.acme.storage=/acme/acme.json`,
    ]
    return [
        "# Written by `starci vps edge up` (ops/vps.yaml edge): Traefik on 80 and 443 of the box, routing to labelled swarm services.",
        'version: "3.8"',
        "services:",
        "  proxy:",
        `    image: ${pins.edge}`,
        "    command:",
        ...flags.map((flag) => `      - ${flag}`),
        "    environment:",
        "      CF_DNS_API_TOKEN_FILE: /run/secrets/cf_dns_token",
        "    secrets:",
        "      - {source: cf_dns_token, target: cf_dns_token}",
        "    ports:",
        "      - {target: 80, published: 80, protocol: tcp, mode: host}",
        "      - {target: 443, published: 443, protocol: tcp, mode: host}",
        "    volumes:",
        "      - /var/run/docker.sock:/var/run/docker.sock:ro",
        "      - acme:/acme",
        "    networks: [public]",
        "    deploy:",
        "      mode: global",
        "      placement: {constraints: [node.role == manager]}",
        "networks:",
        `  public: {external: true, name: ${policy.swarm.network}}`,
        "volumes:",
        "  acme: {}",
        "secrets:",
        '  cf_dns_token: {external: true, name: "${STARCI_CF_SECRET}"}',
    ].join("\n")
}

/** `vps edge up <id>`: the Cloudflare token as a swarm secret named by its hash, and the Traefik stack, deployed again only on a change. */
export const edgeUpPlan = (policy: VpsPolicy, server: ManagedServer, pins: VpsPins): VpsPlan => {
    const marker = "STARCI_EOF"
    const stack = shellQuote(policy.edge.stack)
    return {
        verb: "edge up",
        server: server.id,
        steps: [
            step(
                "edge-stack",
                `the ${policy.edge.stack} stack: ${pins.edge} on 80 and 443 (host mode), certificates by DNS-01 through Cloudflare (resolver ${policy.edge.resolver})`,
                `
[ "$(docker info --format '{{.Swarm.LocalNodeState}}')" = active ] || { echo "no swarm: run starci vps swarm init first" >&2; exit 7; }
docker network inspect ${shellQuote(policy.swarm.network)} >/dev/null 2>&1 || { echo "no ${policy.swarm.network} network: run starci vps swarm init first" >&2; exit 7; }
C=unchanged
export STARCI_CF_SECRET="starci_cf_dns_$(printf '%s' "$CLOUDFLARE_API_TOKEN" | sha256sum | cut -c1-12)"
if ! docker secret inspect "$STARCI_CF_SECRET" >/dev/null 2>&1; then printf '%s' "$CLOUDFLARE_API_TOKEN" | docker secret create "$STARCI_CF_SECRET" - >/dev/null; C=changed; fi
install -d -m 700 /opt/starci/edge
cat > /opt/starci/edge/stack.yml.starci-new <<'${marker}'
${edgeStackFile(policy, pins)}
${marker}
if ! cmp -s /opt/starci/edge/stack.yml.starci-new /opt/starci/edge/stack.yml; then install -m 600 /opt/starci/edge/stack.yml.starci-new /opt/starci/edge/stack.yml; C=changed; fi
rm -f /opt/starci/edge/stack.yml.starci-new
docker stack ls --format '{{.Name}}' | grep -qx ${stack} || C=changed
if [ "$C" = changed ]; then docker stack deploy --quiet -c /opt/starci/edge/stack.yml ${stack} >/dev/null; fi
echo "$C"`,
                ["CLOUDFLARE_API_TOKEN"],
            ),
        ],
        notes: [
            `an app name reaches a swarm service by \`starci vps domain add ${server.id} <sub> --to <service>:<port> --execute\` (a DNS-only A record and the service's Traefik labels)`,
            "a rotated Cloudflare token makes a new swarm secret and redeploys the stack; the old secret stays until the owner removes it",
        ],
    }
}

/** `vps domain add` on an edge server: the swarm service joins the edge network and carries the Traefik labels of the name. */
export const edgeRouteStep = (policy: VpsPolicy, fqdn: string, service: string, port: number): PlanStep => {
    const router = routerOf(fqdn)
    const rule = `Host(\`${fqdn}\`)`
    const network = shellQuote(policy.swarm.network)
    return step(
        "edge-route",
        `Traefik routes https://${fqdn} to ${service}:${String(port)} (labels on the service, certificate by resolver ${policy.edge.resolver})`,
        `
S=${shellQuote(service)}
docker service inspect "$S" >/dev/null 2>&1 || { echo "no swarm service $S" >&2; exit 8; }
NA=""
NET=$(docker network inspect ${network} --format '{{.Id}}')
docker service inspect "$S" --format '{{range .Spec.TaskTemplate.Networks}}{{.Target}} {{end}}' | grep -q "$NET" || NA="--network-add ${policy.swarm.network}"
HAVE=$(docker service inspect "$S" --format '{{index .Spec.Labels "traefik.http.routers.${router}.rule"}}|{{index .Spec.Labels "traefik.http.services.${router}.loadbalancer.server.port"}}')
if [ "$HAVE" = ${shellQuote(`${rule}|${String(port)}`)} ] && [ -z "$NA" ]; then echo unchanged; exit 0; fi
docker service update --quiet --detach $NA --label-add traefik.enable=true --label-add ${shellQuote(`traefik.http.routers.${router}.rule=${rule}`)} --label-add traefik.http.routers.${router}.entrypoints=websecure --label-add traefik.http.routers.${router}.tls.certresolver=${policy.edge.resolver} --label-add traefik.http.routers.${router}.service=${router} --label-add traefik.http.services.${router}.loadbalancer.server.port=${String(port)} "$S" >/dev/null
echo changed`,
    )
}

/** `vps domain remove` on an edge server: every service that carries the name's router loses its labels. */
export const edgeUnrouteStep = (fqdn: string): PlanStep => {
    const router = routerOf(fqdn)
    const labels = ["rule", "entrypoints", "tls.certresolver", "service"].map((key) => `--label-rm traefik.http.routers.${router}.${key}`).join(" ")
    return step(
        "edge-route",
        `no service carries the Traefik router of ${fqdn}`,
        `
C=unchanged
for S in $(docker service ls -q --filter label=traefik.http.routers.${router}.rule); do
  docker service update --quiet --detach ${labels} --label-rm traefik.http.services.${router}.loadbalancer.server.port "$S" >/dev/null; C=changed
done
echo "$C"`,
    )
}

/** The script that lists the names the edge proxy serves: one `<service> <label>=<value>` line per Traefik rule or port label. */
export const edgeListScript = (): string =>
    `for S in $(docker service ls -q --filter label=traefik.enable=true); do docker service inspect "$S" --format '{{$n := .Spec.Name}}{{range $k, $v := .Spec.Labels}}{{$n}} {{$k}}={{$v}}{{"\\n"}}{{end}}'; done | grep -E ' traefik\\.http\\.(routers\\.[^.]+\\.rule|services\\.[^.]+\\.loadbalancer\\.server\\.port)=' || true`

/** The plan's print: one line per step and its secrets by name, then the notes; never a value. */
export const describePlan = (plan: VpsPlan, execute: boolean): string[] => [
    `${plan.verb} ${plan.server}: ${execute ? "executing" : "dry run (add --execute to apply)"}`,
    ...plan.steps.map((entry, index) => `  ${String(index + 1)}. ${entry.id}: ${entry.summary}${entry.secrets.length === 0 ? "" : ` [reads ${entry.secrets.join(", ")} from its environment]`}`),
    ...plan.notes.map((note) => `  note: ${note}`),
]
