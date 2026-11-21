import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { parse, stringify } from "yaml"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { sharedStateBase } from "./ledger.js"

/**
 * The machines of THIS harness host: config.yaml in the shared state base (`<main checkout>/.runtime/config.yaml`, or STARCI_LOCAL_ROOT),
 * written only by the CLI (`starci vps add|set|remove`) and never pushed. The owner's words: "phải lưu máy lại ở config.yaml kiểu starci vps
 * add -- vì cái này là push xài chung" — the repository is shared, so an address, a user, a port or a key path lives here and nowhere else.
 * A secret never does: the keys stay in the sealed stores (a managed server's <id>.enc.yaml, or <state>/machines/<name>.enc.yaml), named only.
 * The machine `local` (this host) is always present: when the file does not list it, it reads as the catalog's `local` entry.
 */

/** A machine name: the label of its DNS names and the id the vps verbs take. */
export const MACHINE_NAME = /^[a-z][a-z0-9-]{0,30}[a-z0-9]$/
const HOST = /^(?:(?:\d{1,3}\.){3}\d{1,3}|[0-9a-fA-F:]+|[a-z0-9-]+(?:\.[a-z0-9-]+)*)$/
const ACCOUNT = /^[a-z_][a-z0-9_-]{0,31}$/

const adoptedSchema = z.strictObject({ as: z.string().min(1), image: z.string(), at: z.string().min(1) })

const machineSchema = z.strictObject({
    host: z.string().regex(HOST, "a host is an IP address or a DNS name").optional(),
    user: z.string().regex(ACCOUNT, "a login user is a POSIX account name").optional(),
    port: z.number().int().min(1).max(65535).optional(),
    // The private key file ssh logs in with (never its content); the host keys come from the user's known_hosts.
    sshKey: z.string().min(1).optional(),
    os: z.string().regex(/^[a-z]+$/).optional(),
    // The managed server of ops/vps/servers/<server>.yaml this machine is (its sealed login and choices), when it was imported from one.
    server: z.string().regex(MACHINE_NAME).optional(),
    roles: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)).min(1, "a machine hosts at least one role"),
    services: z.record(z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/), z.boolean()).default({}),
    // Services found running under another name and adopted by `host up`: recorded and checked, never redeployed.
    adopted: z.record(z.string(), adoptedSchema).default({}),
})

const fileSchema = z.strictObject({
    schema: z.literal("starci/machines@1"),
    machines: z.record(z.string().regex(MACHINE_NAME), machineSchema).default({}),
})

/** One machine of config.yaml. */
export type Machine = z.infer<typeof machineSchema>
/** config.yaml, validated. */
export type MachinesFile = z.infer<typeof fileSchema>

/** The name of this harness host. */
export const LOCAL = "local"

/** config.yaml of this host: `<shared state base>/config.yaml`. */
export const machinesFile = (): string => join(sharedStateBase(), "config.yaml")

/** The sealed file a machine's generated keys are sealed in when it is no managed server of ops/vps/servers: `<shared state>/machines/<name>.enc.yaml`. */
export const machineSealedFile = (name: string): string => join(sharedStateBase(), "machines", `${name}.enc.yaml`)

/** What config.yaml holds, as read: the file, whether it exists, and its machines (without the synthesized `local`). */
export interface MachinesRead {
    readonly file: string
    readonly exists: boolean
    readonly doc: MachinesFile
}

/** Reads config.yaml; an absent file is an empty one. A file that is not the schema is refused naming the problem (never a value). */
export const readMachines = (file: string = machinesFile()): MachinesRead => {
    if (!existsSync(file)) return { file, exists: false, doc: { schema: "starci/machines@1", machines: {} } }
    let raw: unknown
    try {
        raw = parse(readFileSync(file, "utf8"))
    } catch (error: unknown) {
        throw new Refusal("MACHINES_INVALID", `${file} is not readable yaml: ${error instanceof Error ? error.message : String(error)}`)
    }
    const parsed = fileSchema.safeParse(raw)
    if (!parsed.success) throw new Refusal("MACHINES_INVALID", `${file} is invalid: ${z.prettifyError(parsed.error)}`)
    return { file, exists: true, doc: parsed.data }
}

/** Every machine: the file's, with `local` read as `fallback` when the file does not list it. */
export const allMachines = (read: MachinesRead, fallback: Pick<Machine, "roles" | "services">): Record<string, Machine> => ({
    [LOCAL]: read.doc.machines[LOCAL] ?? { roles: [...fallback.roles], services: { ...fallback.services }, adopted: {} },
    ...Object.fromEntries(Object.entries(read.doc.machines).filter(([name]) => name !== LOCAL)),
})

/** Writes config.yaml atomically (a temp file renamed over it), with its header; the folder is made when absent. */
export const writeMachines = (file: string, doc: MachinesFile): void => {
    mkdirSync(dirname(file), { recursive: true })
    const header = "# The machines of this harness host, written by `starci vps add|set|remove` (contexts/harness/host.md \"Machines\").\n# Never pushed: it holds addresses, users, ports and key paths. No secret is ever written here.\n"
    const temp = `${file}.${String(process.pid)}.tmp`
    writeFileSync(temp, header + stringify(doc), "utf8")
    renameSync(temp, file)
}

/** Whether a machine is this host (`local`) or a server. */
export const siteOf = (name: string): "local" | "remote" => (name === LOCAL ? "local" : "remote")

/** One machine by name, refused (HOST_MACHINE_UNKNOWN) naming the known ones and how to add it. */
export const machineNamed = (machines: Readonly<Record<string, Machine>>, name: string): Machine => {
    const found = machines[name]
    if (found === undefined) throw new Refusal("HOST_MACHINE_UNKNOWN", `no machine ${name} in config.yaml (machines: ${Object.keys(machines).join(", ")}); add it with \`starci vps add ${name} --host <addr> --user <user> --roles <r1,r2>\``)
    return found
}

/** A key path as config.yaml keeps it: absolute, forward slashes. */
export const keyPath = (path: string): string => resolve(path).replaceAll("\\", "/")

/**
 * The fields an ops/vps/servers/<id>.yaml contributes when `vps add --import` turns it into a machine: its host, ssh port and os, and the link
 * to it (`server`), so its sealed login keeps serving the session. Nothing is read from its sealed file.
 */
export const importedFields = (raw: unknown, file: string): Pick<Machine, "host" | "port" | "os" | "server"> => {
    const doc = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {}
    if (doc.schema !== "starci/vps-server@1" || typeof doc.id !== "string" || typeof doc.host !== "string") throw new Refusal("HOST_IMPORT_INVALID", `${file} is no managed server file (schema starci/vps-server@1 with id and host)`)
    return { host: doc.host, port: typeof doc.sshPort === "number" ? doc.sshPort : 22, ...(typeof doc.os === "string" ? { os: doc.os } : {}), server: doc.id }
}
