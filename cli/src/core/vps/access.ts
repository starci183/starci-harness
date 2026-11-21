import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { stringify } from "yaml"
import { locateOps } from "../../harness/ops.js"
import { runPlan, sessionFor } from "../../harness/vps/fleet.js"
import { confirm, fingerprints, generateKey, keyscan, promptHidden, publicKeyOf, withPrivateDir } from "../../harness/vps/local.js"
import { inventoryDir, loadVpsPolicy, parseServer } from "../../harness/vps/policy.js"
import { deployUser, grantPlan, revokePlan } from "../../harness/vps/plan.js"
import { ownerStore, requireKey, SERVER_KEYS } from "../../harness/vps/sealed.js"
import { Refusal, UsageError } from "../../shared/errors.js"
import { headline } from "../../shared/exec.js"
import { defineVerb } from "../../shared/verb.js"
import type { VerbResult } from "../../shared/verb.js"
import { runHfs } from "../app/hfs.js"
import { registerMachine } from "./machines.js"
import { EXECUTE, OWNER, planResult, scopeOf, SERVER_ID } from "./shared.js"
import type { VpsData } from "./shared.js"

/**
 * `starci vps add <name> --host <addr> --user <user> [--port] [--ssh-key <path>] --roles <r1,r2>`: registers a machine in this host's config.yaml
 * (never pushed, contexts/harness/host.md "Machines"), with no question asked; `--import <file>` (or the inventory file of the same name, when
 * it exists and no --host is given) takes its address from an ops/vps/servers/<id>.yaml and keeps its sealed login.
 *
 * `starci vps add <id> --host <ip> --os <os> --provider <name> [...] [--execute]` (no --roles): adds a server to the managed inventory. Its key is never a
 * password: either the owner pastes the login's private key at a masked prompt (or redirects it on stdin), or `--generate-key`
 * makes one here and prints only its public half, which the owner adds to the login's authorized_keys at the provider (the one
 * owner step for a server that only allows password login). The host keys come from ssh-keyscan and are pinned only after the
 * owner confirms a fingerprint (on the terminal, or `--fingerprint SHA256:...`). The key, the login and the host keys are sealed
 * to the owner key at once; the server file holds no secret and is gitignored.
 */
export const vpsAddVerb = defineVerb({
    path: ["vps", "add"],
    summary: "with --roles: register a machine in this host's config.yaml (never pushed) with its address, login user, port, ssh key path and roles (ops/host-roles.yaml: app-host, starci, monitor, edge, dev), no question asked, --import <ops/vps/servers/<id>.yaml> (or the inventory file of the same name) taking its address and sealed login; without --roles: add a managed server: write ops/vps/servers/<id>.yaml (gitignored), take its login key at a masked prompt (or --generate-key and print the public half for the owner to install), pin its host keys by ssh-keyscan after the owner confirms a fingerprint, seal key and known_hosts to the owner key; never a password; a dry run until --execute",
    effect: "remote",
    roles: OWNER,
    schema: "starci/vps-add@1",
    flags: {
        id: SERVER_ID,
        host: { kind: "string", summary: "the server's IP address or DNS name" },
        roles: { kind: "string", summary: "the roles it hosts, a comma list (app-host,starci,monitor,edge; +starci.sonar or -starci.embed toggles one service): registers it in config.yaml" },
        "ssh-key": { kind: "string", summary: "with --roles: the private key file ssh logs in with (config.yaml keeps the path, never the key)" },
        import: { kind: "string", summary: "with --roles: an ops/vps/servers/<id>.yaml to take the address, port and sealed login from" },
        os: { kind: "string", summary: "its /etc/os-release ID (ubuntu, debian, almalinux, rocky, centos, rhel); the inventory enrollment needs it" },
        provider: { kind: "string", summary: "who rents it out (a free name); the inventory enrollment needs it" },
        port: { kind: "string", summary: "its ssh port (default 22)" },
        user: { kind: "string", summary: "the login the key opens (default root; bootstrap moves it to the ops user)" },
        "panel-kind": { kind: "string", summary: "its hosting panel: none (default), cpanel, directadmin, cyberpanel, aapanel, plesk, other" },
        "panel-url": { kind: "string", summary: "the panel's URL" },
        project: { kind: "list", summary: "a project allowed on it (a deploy grant names one); repeat for several" },
        ingress: { kind: "string", summary: "tunnel (default: every name through its Cloudflare tunnel) or edge (app names through Traefik on 80/443)" },
        firewall: { kind: "string", summary: "ufw, firewalld or csf when it is not the OS family's default" },
        role: { kind: "string", summary: "its swarm role: manager (default), worker or none" },
        "generate-key": { kind: "boolean", summary: "make the login key here and print its public half for the owner to install, instead of a prompt" },
        fingerprint: { kind: "string", summary: "the SHA256:... host key fingerprint the owner read at the provider, instead of the terminal question" },
        execute: EXECUTE,
    },
    run: async (context, flags): Promise<VerbResult<VpsData>> => {
        if (flags.roles !== undefined || flags.import !== undefined || flags["ssh-key"] !== undefined) {
            const registered = registerMachine({ name: flags.id, roles: flags.roles, import: flags.import, host: flags.host, user: flags.user, port: flags.port, "ssh-key": flags["ssh-key"], os: flags.os })
            return { data: registered.data, message: registered.lines.join("\n") }
        }
        if (flags.host === undefined || flags.os === undefined || flags.provider === undefined) throw new UsageError("starci vps add <name> takes --roles <r1,r2> to register a machine (with --host and --user), or --host, --os and --provider to enroll a managed server")
        const opsDir = locateOps()
        const policy = loadVpsPolicy(opsDir)
        const dir = inventoryDir(policy, opsDir)
        const port = flags.port === undefined ? 22 : Number(flags.port)
        const document = {
            schema: "starci/vps-server@1",
            id: flags.id,
            host: flags.host,
            sshPort: port,
            os: flags.os,
            provider: flags.provider,
            panel: { kind: flags["panel-kind"] ?? "none", url: flags["panel-url"] ?? null },
            swarm: { role: flags.role ?? "manager" },
            projects: [...flags.project],
            ...(flags.ingress === undefined ? {} : { ingress: { mode: flags.ingress } }),
            ...(flags.firewall === undefined ? {} : { firewall: flags.firewall }),
        }
        const file = join(dir, `${flags.id}.yaml`)
        const server = parseServer(policy, document, file, dir)
        if (existsSync(file) || existsSync(server.sealedFile)) throw new Refusal("VPS_SERVER_EXISTS", `${flags.id} is in the inventory already (${file}); edit its file, or remove both files to add it again`)
        const user = flags.user ?? "root"
        const steps = [
            `write ${file} (gitignored; no secret)`,
            flags["generate-key"] ? "make an ed25519 login key here and print its public half for you to add to the login's authorized_keys at the provider" : `read the private key of ${user} at a masked prompt (or redirected stdin)`,
            `scan ${server.host}:${String(port)} for its host keys and pin them once you confirm a fingerprint`,
            `seal ${SERVER_KEYS.user}, ${SERVER_KEYS.privateKey} and ${SERVER_KEYS.knownHosts} to the owner key in ${server.sealedFile} (gitignored)`,
            `log in as ${user} once with the sealed key`,
        ]
        if (!flags.execute) return { data: { server: document, steps, execute: false }, message: [`add ${flags.id}: dry run (add --execute to apply)`, ...steps.map((line, index) => `  ${String(index + 1)}. ${line}`)].join("\n") }
        const store = await ownerStore()
        const knownHosts = await keyscan(server.host, port, policy.ssh.keyTypes, policy.ssh.connectTimeoutSeconds)
        const prints = await fingerprints(knownHosts)
        context.progress(`host keys of ${server.host}:${String(port)}:\n${prints.map((line) => `  ${line}`).join("\n")}`)
        const confirmed = flags.fingerprint === undefined ? await confirm("Do these match the fingerprints the provider shows for this server", "--fingerprint SHA256:...") : prints.some((line) => line.split(" ")[1] === flags.fingerprint)
        if (!confirmed) throw new Refusal("VPS_FINGERPRINT_UNCONFIRMED", `the host keys of ${server.host} were not confirmed; nothing was written or sealed`)
        let privateKey: string
        let publicKey: string
        if (flags["generate-key"]) {
            const made = await generateKey(`starci-vps ${flags.id}`)
            privateKey = made.privateKey
            publicKey = made.publicKey
        } else {
            privateKey = await promptHidden(`private key of ${user}@${server.host}`, true)
            publicKey = await publicKeyOf(privateKey)
        }
        mkdirSync(dir, { recursive: true })
        store.write(server.sealedFile, { [SERVER_KEYS.user]: user, [SERVER_KEYS.privateKey]: privateKey, [SERVER_KEYS.knownHosts]: knownHosts })
        writeFileSync(file, `# Written by \`starci vps add\`; gitignored (contexts/harness/managed-vps.md).\n${stringify(document)}`)
        const lines = [`added ${flags.id}: ${file}, its keys sealed in ${server.sealedFile}`]
        if (flags["generate-key"]) {
            lines.push(`add this public key to ${user}'s ~/.ssh/authorized_keys at the provider (console or panel), then \`starci vps doctor ${flags.id}\`:`, `  ${publicKey}`)
            return { data: { server: document, publicKey, login: "pending" }, message: lines.join("\n") }
        }
        const session = await sessionFor(policy, server, store)
        try {
            const probe = await session.run({ script: "echo unchanged", root: false, timeoutMs: policy.ssh.connectTimeoutSeconds * 3000 })
            lines.push(probe.exitCode === 0 ? `  ${user} logs in with the sealed key; next: \`starci vps bootstrap ${flags.id}\`` : `  the login failed (${headline(probe.stderr) || `exit ${String(probe.exitCode)}`}): check the key is in ${user}'s authorized_keys`)
            return { data: { server: document, publicKey, login: probe.exitCode === 0 ? "ok" : "failed" }, message: lines.join("\n"), ...(probe.exitCode === 0 ? {} : { exitCode: 1 }) }
        } finally {
            session.close()
        }
    },
})

/** The app a grant names: an existing folder that holds `.starcistacks`, and its project name (the folder's name). */
const appOf = (path: string): { readonly root: string; readonly project: string } => {
    const root = resolve(path)
    if (!existsSync(join(root, ".starcistacks"))) throw new Refusal("VPS_GRANT_APP", `${root} holds no .starcistacks: --app names the app's root`)
    return { root, project: basename(root).toLowerCase() }
}

const APP_AND_ENV = {
    app: { kind: "string", summary: "the app's root folder (its name is the project the server's file must allow)", required: true },
    env: { kind: "string", summary: "the app's stack environment the access is for (its .starcistacks/<env>)", required: true },
} as const

/**
 * `starci vps grant <id> --app <path> --env <env> [--execute]`: a deploy user of that project and environment on the server, with a
 * key made here, sealed into the app's `.starcistacks/<env>/secrets/vps.enc.yaml` through `starci app secret set` (PROJECT-STACKS-5:
 * VPS_HOST, VPS_USER, privateKey, knownHosts). A second grant replaces the key.
 */
export const vpsGrantVerb = defineVerb({
    path: ["vps", "grant"],
    summary: "give one app environment deploy access to a managed server: a per-project deploy user (docker group, no sudo, no password) with a key made here, sealed into the app's .starcistacks/<env>/secrets/vps.enc.yaml through `app secret set` (PROJECT-STACKS-5); a grant again rotates the key; a dry run until --execute",
    effect: "remote",
    roles: OWNER,
    schema: "starci/vps-grant@1",
    flags: { id: SERVER_ID, ...APP_AND_ENV, execute: EXECUTE },
    run: async (context, flags): Promise<VerbResult<VpsData>> => {
        const scope = scopeOf(flags.id)
        const app = appOf(flags.app)
        if (!/^[a-z][a-z0-9-]*$/.test(flags.env)) throw new UsageError(`--env ${flags.env} is no environment name`)
        const plan = grantPlan(scope.policy, scope.server, app.project, flags.env)
        if (!flags.execute) return planResult(plan, undefined)
        const store = await ownerStore()
        const knownHosts = requireKey(store.open(scope.server.sealedFile), SERVER_KEYS.knownHosts, scope.server.sealedFile)
        const user = deployUser(scope.policy, app.project, flags.env)
        const key = await generateKey(`starci-deploy ${app.project}/${flags.env}@${scope.server.id}`)
        const outcomes = await runPlan(scope.policy, scope.server, store, plan, { DEPLOY_PUBLIC_KEY: key.publicKey }, context.progress)
        if (outcomes.some((outcome) => outcome.outcome === "failed")) return planResult(plan, outcomes)
        const member = scope.policy.grant.member
        const sealed = await withPrivateDir(async (dir) => {
            const values = { VPS_HOST: scope.server.host, VPS_USER: user, privateKey: key.privateKey, knownHosts }
            for (const [name, value] of Object.entries(values)) writeFileSync(join(dir, name), value, { mode: 0o600 })
            const args = ["set", "--env", flags.env, member, ...Object.keys(values), ...Object.keys(values).flatMap((name) => ["--from-file", `${name}=${join(dir, name)}`])]
            return runHfs({ ...context, cwd: app.root, treeRoot: app.root }, "secret", args, false)
        })
        const failed = sealed.exitCode !== undefined && sealed.exitCode !== 0
        return planResult(plan, [...outcomes, { id: "seal", outcome: failed ? "failed" : "changed", detail: failed ? "starci app secret set refused; the server already holds the new key, run the grant again" : `${app.root}/.starcistacks/${flags.env}/secrets/${member}.enc.yaml` }])
    },
})

/** `starci vps revoke <id> --app <path> --env <env> [--execute]`: the deploy user goes, and its key stops working. */
export const vpsRevokeVerb = defineVerb({
    path: ["vps", "revoke"],
    summary: "take an app environment's deploy access off a managed server: its deploy user and home are removed, so the sealed key in the app no longer logs in; a dry run until --execute, idempotent",
    effect: "remote",
    roles: OWNER,
    schema: "starci/vps-revoke@1",
    flags: { id: SERVER_ID, ...APP_AND_ENV, execute: EXECUTE },
    run: async (context, flags): Promise<VerbResult<VpsData>> => {
        const scope = scopeOf(flags.id)
        const project = basename(resolve(flags.app)).toLowerCase()
        const plan = revokePlan(scope.policy, scope.server, project, flags.env)
        if (!flags.execute) return planResult(plan, undefined)
        return planResult(plan, await runPlan(scope.policy, scope.server, await ownerStore(), plan, {}, context.progress))
    },
})
