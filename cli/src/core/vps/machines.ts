import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"
import { applyRoles, loadHostRoles, machineServices } from "../../harness/host-roles.js"
import type { HostRoles } from "../../harness/host-roles.js"
import { allMachines, importedFields, keyPath, LOCAL, MACHINE_NAME, machineNamed, machineSealedFile, readMachines, siteOf, writeMachines } from "../../harness/machines.js"
import type { Machine, MachinesRead } from "../../harness/machines.js"
import { inventoryDir, loadVpsPolicy, locateFleetOps } from "../../harness/vps/policy.js"
import { Refusal, UsageError } from "../../shared/errors.js"
import { defineVerb, EVERYONE } from "../../shared/verb.js"
import type { VerbResult } from "../../shared/verb.js"
import { OWNER } from "./shared.js"
import type { VpsData } from "./shared.js"

/**
 * The machines of this harness host (config.yaml, harness/machines.ts): `vps add <name> --host --user [--port] [--ssh-key] --roles r1,r2` registers
 * one with no question asked, `vps set` changes its roles (`+starci.sonar,-starci.embed`) or its login, `vps show` prints one with the services
 * its roles turn on, `vps remove` forgets one. They write config.yaml only: no server is reached, and no secret is read or written.
 */

/** One machine as the verbs print it: its entry, its site and the services its roles turn on. */
export type MachineView = Readonly<{
    name: string
    site: "local" | "remote"
    host: string | null
    user: string | null
    port: number | null
    sshKey: string | null
    server: string | null
    roles: readonly string[]
    toggles: Readonly<Record<string, boolean>>
    services: readonly string[]
    adopted: Machine["adopted"]
    sealedFile: string | null
}>

/** The view of one machine of config.yaml. */
export const machineView = (catalog: HostRoles, name: string, machine: Machine): MachineView => ({
    name,
    site: siteOf(name),
    host: machine.host ?? (name === LOCAL ? "this host" : null),
    user: machine.user ?? null,
    port: machine.port ?? (machine.host === undefined ? null : 22),
    sshKey: machine.sshKey ?? null,
    server: machine.server ?? null,
    roles: machine.roles,
    toggles: machine.services,
    services: machineServices(catalog, machine),
    adopted: machine.adopted,
    sealedFile: machine.server === undefined && name !== LOCAL ? machineSealedFile(name) : null,
})

const viewLines = (view: MachineView): string[] => {
    const login = view.host === null || view.site === "local" ? "" : ` ${view.user ?? "?"}@${view.host}${view.port === null ? "" : `:${String(view.port)}`}`
    const toggles = Object.entries(view.toggles).map(([id, on]) => `${on ? "+" : "-"}${id}`)
    const adopted = Object.entries(view.adopted).map(([id, entry]) => `${id} as ${entry.as}`)
    return [
        `${view.name} (${view.site})${login}${view.server === null ? "" : `, the managed server ${view.server}`}`,
        `  roles ${view.roles.join(", ")}${toggles.length === 0 ? "" : ` (${toggles.join(", ")})`}`,
        `  services ${view.services.join(", ") || "none"}`,
        ...(adopted.length === 0 ? [] : [`  adopted ${adopted.join(", ")}`]),
    ]
}

/** The login fields a flag set gives a machine. */
interface LoginFlags {
    readonly host?: string | undefined
    readonly user?: string | undefined
    readonly port?: string | undefined
    readonly "ssh-key"?: string | undefined
}

const loginOf = (flags: LoginFlags): Partial<Machine> => {
    const port = flags.port === undefined ? undefined : Number(flags.port)
    if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new UsageError(`--port ${String(flags.port)} is no port`)
    if (flags["ssh-key"] !== undefined && !existsSync(flags["ssh-key"])) throw new Refusal("HOST_SSH_KEY_MISSING", `--ssh-key ${flags["ssh-key"]} does not exist (config.yaml keeps the path, never the key)`)
    return {
        ...(flags.host === undefined ? {} : { host: flags.host }),
        ...(flags.user === undefined ? {} : { user: flags.user }),
        ...(port === undefined ? {} : { port }),
        ...(flags["ssh-key"] === undefined ? {} : { sshKey: keyPath(flags["ssh-key"]) }),
    }
}

/** Writes one machine of config.yaml, the file's other machines kept; the entry is validated by reading the file back. */
const putMachine = (read: MachinesRead, name: string, machine: Machine): void => {
    writeMachines(read.file, { ...read.doc, machines: { ...read.doc.machines, [name]: machine } })
    readMachines(read.file)
}

/** What `vps add` with --roles (or --import) registers. */
export interface RegisterInput extends LoginFlags {
    readonly name: string
    readonly roles?: string | undefined
    readonly import?: string | undefined
    readonly os?: string | undefined
}

/**
 * Registers a machine in config.yaml: its login from the flags, or from an ops/vps/servers/<id>.yaml it imports (`--import <file>`, or the
 * inventory file of the same name when it exists and no --host is given), and its roles. A name config.yaml holds is refused (`vps set`
 * changes it); `local` is this host, registered already.
 */
export const registerMachine = (input: RegisterInput, opsDir: string = locateFleetOps()): { readonly data: VpsData; readonly lines: string[] } => {
    if (!MACHINE_NAME.test(input.name)) throw new UsageError(`${input.name} is no machine name (lower-case letters, digits and dashes, 2 to 32 long)`)
    const catalog = loadHostRoles(opsDir)
    const read = readMachines()
    if (input.name === LOCAL && read.doc.machines[LOCAL] === undefined && input.host !== undefined) throw new Refusal("HOST_MACHINE_LOCAL", "local is this harness host; it needs no address (`starci vps set local --roles ...` changes its roles)")
    if (read.doc.machines[input.name] !== undefined) throw new Refusal("HOST_MACHINE_EXISTS", `${input.name} is in config.yaml already; \`starci vps set ${input.name} --roles ...\` changes it, \`starci vps remove ${input.name}\` forgets it`)
    const policy = loadVpsPolicy(opsDir)
    const inventoryFile = join(inventoryDir(policy, opsDir), `${input.name}.yaml`)
    const importFile = input.import ?? (input.host === undefined && existsSync(inventoryFile) ? inventoryFile : undefined)
    const imported = importFile === undefined ? {} : importedFields(parse(readFileSync(importFile, "utf8")), importFile)
    const login = { ...imported, ...loginOf(input), ...(input.os === undefined ? {} : { os: input.os }) }
    if (input.name !== LOCAL && login.host === undefined) throw new UsageError(`starci vps add ${input.name} takes --host <addr> (or --import <ops/vps/servers/<id>.yaml>)`)
    if (input.roles === undefined) throw new UsageError(`starci vps add ${input.name} takes --roles <r1,r2> (roles: ${Object.keys(catalog.roles).join(", ")})`)
    const choice = applyRoles(catalog, input.name === LOCAL ? catalog.local : undefined, input.roles)
    const machine: Machine = { ...login, roles: [...choice.roles], services: { ...choice.services }, adopted: {} }
    putMachine(read, input.name, machine)
    const view = machineView(catalog, input.name, machine)
    const next = input.name === LOCAL ? `starci host up --host local --execute` : `starci host status --host ${input.name}, then starci host up --host ${input.name} --execute`
    return { data: { machine: view, file: read.file, imported: importFile ?? null }, lines: [`registered ${input.name} in ${read.file} (never pushed)${importFile === undefined ? "" : `, imported from ${importFile}`}`, ...viewLines(view), `  next: ${next}`] }
}

const NAME_FLAG = { kind: "string", summary: "the machine's name in config.yaml (local is this host)", required: true, positional: true } as const

/** `starci vps show <name>`: one machine of config.yaml with the services its roles turn on; reads only the file. */
export const vpsShowVerb = defineVerb({
    path: ["vps", "show"],
    summary: "show one machine of this host's config.yaml (never pushed): its login, roles and toggles, the services they turn on (ops/host-roles.yaml) and what host up adopted; reads only the file",
    effect: "read",
    roles: EVERYONE,
    schema: "starci/vps-show@1",
    flags: { name: NAME_FLAG },
    run: (_context, flags): Promise<VerbResult<VpsData>> => {
        const catalog = loadHostRoles()
        const machines = allMachines(readMachines(), catalog.local)
        const view = machineView(catalog, flags.name, machineNamed(machines, flags.name))
        return Promise.resolve({ data: { machine: view }, message: viewLines(view).join("\n") })
    },
})

/** `starci vps remove <name>`: forgets a machine of config.yaml; the server, its stacks and its sealed files are untouched. */
export const vpsRemoveVerb = defineVerb({
    path: ["vps", "remove"],
    summary: "forget a machine of this host's config.yaml; nothing on the server, no stack and no sealed file is touched (local cannot be removed)",
    effect: "local-write",
    roles: OWNER,
    schema: "starci/vps-remove@1",
    flags: { name: NAME_FLAG },
    run: (_context, flags): Promise<VerbResult<VpsData>> => {
        if (flags.name === LOCAL) throw new Refusal("HOST_MACHINE_LOCAL", "local is this harness host and always present; `starci vps set local --roles ...` changes its roles")
        const read = readMachines()
        if (read.doc.machines[flags.name] === undefined) throw new Refusal("HOST_MACHINE_UNKNOWN", `no machine ${flags.name} in ${read.file}`)
        const rest = Object.fromEntries(Object.entries(read.doc.machines).filter(([name]) => name !== flags.name))
        writeMachines(read.file, { ...read.doc, machines: rest })
        return Promise.resolve({ data: { removed: flags.name, file: read.file }, message: `removed ${flags.name} from ${read.file}; the server and its sealed files are untouched` })
    },
})

/** `starci vps set <name> --roles ... [--host] [--user] [--port] [--ssh-key]`: changes a machine of config.yaml. */
export const vpsSetVerb = defineVerb({
    path: ["vps", "set"],
    summary: "change a machine of this host's config.yaml: --roles app-host,starci replaces its roles, --roles +monitor,-edge adds and removes roles, --roles +starci.sonar,-starci.embed turns one service on or off against its role's default; --host, --user, --port, --ssh-key change its login; at least one role stays; no server is reached",
    effect: "local-write",
    roles: OWNER,
    schema: "starci/vps-set@1",
    flags: {
        name: NAME_FLAG,
        roles: { kind: "string", summary: "a comma list: plain roles replace the list; +role/-role add or remove one; +role.service/-role.service toggle one service" },
        host: { kind: "string", summary: "its address (an IP or a DNS name)" },
        user: { kind: "string", summary: "the login user" },
        port: { kind: "string", summary: "its ssh port" },
        "ssh-key": { kind: "string", summary: "the private key file ssh logs in with (the path is kept, never the key)" },
    },
    run: (_context, flags): Promise<VerbResult<VpsData>> => {
        const catalog = loadHostRoles()
        const read = readMachines()
        const current = allMachines(read, catalog.local)[flags.name]
        if (current === undefined) throw new Refusal("HOST_MACHINE_UNKNOWN", `no machine ${flags.name} in ${read.file}; \`starci vps add ${flags.name} --host <addr> --user <user> --roles <r1,r2>\` registers it`)
        if (flags.roles === undefined && flags.host === undefined && flags.user === undefined && flags.port === undefined && flags["ssh-key"] === undefined) throw new UsageError("starci vps set takes --roles, --host, --user, --port or --ssh-key")
        if (flags.name === LOCAL && flags.host !== undefined) throw new Refusal("HOST_MACHINE_LOCAL", "local is this harness host; it needs no address")
        const choice = flags.roles === undefined ? current : applyRoles(catalog, current, flags.roles)
        const machine: Machine = { ...current, ...loginOf(flags), roles: [...choice.roles], services: { ...choice.services } }
        putMachine(read, flags.name, machine)
        const view = machineView(catalog, flags.name, machine)
        return Promise.resolve({ data: { machine: view, file: read.file }, message: [`changed ${flags.name} in ${read.file}`, ...viewLines(view)].join("\n") })
    },
})

/** The machines of config.yaml as `vps list` shows them, `local` first. */
export const machineRows = (): { readonly views: MachineView[]; readonly lines: string[]; readonly file: string; readonly exists: boolean } => {
    const catalog = loadHostRoles()
    const read = readMachines()
    const views = Object.entries(allMachines(read, catalog.local)).map(([name, machine]) => machineView(catalog, name, machine))
    return { views, lines: views.flatMap(viewLines), file: read.file, exists: read.exists }
}
