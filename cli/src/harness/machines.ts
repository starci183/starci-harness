import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join, resolve, sep } from "node:path"
import { parse, stringify } from "yaml"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { LOCAL_ROOT_ENV, mainCheckoutOf, runtimeRoot } from "./ledger.js"
import { harnessHomeOf } from "./secret-env.js"

/**
 * The machines of THIS harness host: config.yaml in the harness home's state (`<main checkout>/.runtime/config.yaml`, or STARCI_LOCAL_ROOT; machinesBase),
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

/**
 * The settings of this host as a machine (contexts/harness/host.md "Host settings"): the one place every CLI copy on the machine (the harness checkout,
 * its lane worktrees, a CLI installed in an app's node_modules) reads them from, fresh at each use (harness/host-settings.ts).
 */
const hostSettingsSchema = z.strictObject({
    // The free space a heavy command's drive keeps, in MB; over ops/liveness.yaml heavy.diskFloorMb, which is only the default of a host that sets none.
    diskFloorMb: z.number().int().nonnegative().optional(),
})

const fileSchema = z.strictObject({
    schema: z.literal("starci/machines@1"),
    host: hostSettingsSchema.optional(),
    machines: z.record(z.string().regex(MACHINE_NAME), machineSchema).default({}),
})

/** The `host` block of config.yaml. */
export type HostSettingsBlock = z.infer<typeof hostSettingsSchema>

/** One machine of config.yaml. */
export type Machine = z.infer<typeof machineSchema>
/** config.yaml, validated. */
export type MachinesFile = z.infer<typeof fileSchema>

/** The name of this harness host. */
export const LOCAL = "local"

/** Where machinesBaseOf looks, in order; each is a folder or undefined. */
export interface MachinesBaseInputs {
    /** STARCI_LOCAL_ROOT: the whole state base, as for every other host state. */
    readonly localRoot?: string | undefined
    /** STARCI_OPS_DIR: the harness ops/ folder, whose checkout holds the state. */
    readonly opsDir?: string | undefined
    /** The harness home of the working folder (secret-env.ts harnessHomeOf): the checkout itself or an ancestor's `.claude`. */
    readonly home?: string | undefined
    /** The harness checkout this CLI is built in; undefined for a published CLI (its own package is never the home). */
    readonly checkout?: string | undefined
}

const insideNodeModules = (path: string): boolean => resolve(path).split(sep).some((part) => part.toLowerCase() === "node_modules")

/**
 * The folder of config.yaml and the machines' sealed files: STARCI_LOCAL_ROOT, else the `.runtime` of the harness main checkout found as the
 * fleet's ops/ is (vps/policy.ts locateFleetOps): STARCI_OPS_DIR's checkout, else the harness home of the working folder, else the checkout
 * the CLI is built in. A published CLI's own package copy is never it, and no folder inside node_modules is: with none found it is refused.
 */
export const machinesBaseOf = (inputs: MachinesBaseInputs): string => {
    const local = inputs.localRoot ?? ""
    if (local !== "") {
        if (insideNodeModules(local)) throw new Refusal("HOST_STATE_NOT_FOUND", `${LOCAL_ROOT_ENV}=${local} is inside node_modules; config.yaml is never written into a package`)
        return resolve(local)
    }
    const homes = [inputs.opsDir === undefined || inputs.opsDir === "" ? undefined : dirname(resolve(inputs.opsDir)), inputs.home, inputs.checkout]
    const found = homes.find((home): home is string => home !== undefined && !insideNodeModules(home))
    const looked = homes.filter((home) => home !== undefined).join(", ")
    if (found === undefined) throw new Refusal("HOST_STATE_NOT_FOUND", `no harness home holds config.yaml (looked at ${looked === "" ? "STARCI_OPS_DIR, the working folder's harness home and the CLI's checkout" : looked}): run from the harness checkout (or below the folder whose .claude is one), or set STARCI_OPS_DIR or ${LOCAL_ROOT_ENV}; a published CLI never writes into its own package`)
    return join(mainCheckoutOf(found), ".runtime")
}

/** The checkout this CLI is built in (cli/ and ops/checks.yaml side by side), or undefined for a published copy. */
const builtCheckout = (): string | undefined => {
    const root = runtimeRoot()
    return existsSync(join(root, "cli", "package.json")) && existsSync(join(root, "ops", "checks.yaml")) ? root : undefined
}

/** The folder of config.yaml for this process: machinesBaseOf of its environment, working folder and CLI. */
export const machinesBase = (cwd: string = process.cwd()): string =>
    machinesBaseOf({ localRoot: process.env[LOCAL_ROOT_ENV], opsDir: process.env.STARCI_OPS_DIR, home: harnessHomeOf(cwd), checkout: builtCheckout() })

/** config.yaml of this host: `<machinesBase>/config.yaml`. */
export const machinesFile = (): string => join(machinesBase(), "config.yaml")

/** The sealed file a machine's generated keys are sealed in when it is no managed server of ops/vps/servers: `<machinesBase>/machines/<name>.enc.yaml`. */
export const machineSealedFile = (name: string): string => join(machinesBase(), "machines", `${name}.enc.yaml`)

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
 * The fields an ops/vps/servers/<id>.yaml contributes when `vps add --import` turns it into a machine: its host, login user, ssh port and os,
 * and the link to it (`server`), so its sealed login keeps serving the session. Nothing is read from its sealed file; a user or port the file
 * holds in another shape is refused, never guessed.
 */
export const importedFields = (raw: unknown, file: string): Pick<Machine, "host" | "user" | "port" | "os" | "server"> => {
    const doc = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {}
    if (doc.schema !== "starci/vps-server@1" || typeof doc.id !== "string" || typeof doc.host !== "string") throw new Refusal("HOST_IMPORT_INVALID", `${file} is no managed server file (schema starci/vps-server@1 with id and host)`)
    const port = doc.sshPort === undefined ? 22 : Number(doc.sshPort)
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Refusal("HOST_IMPORT_INVALID", `${file}: sshPort ${String(doc.sshPort)} is no port`)
    if (doc.user !== undefined && (typeof doc.user !== "string" || !ACCOUNT.test(doc.user))) throw new Refusal("HOST_IMPORT_INVALID", `${file}: user is no POSIX account name`)
    return { host: doc.host, ...(typeof doc.user === "string" ? { user: doc.user } : {}), port, ...(typeof doc.os === "string" ? { os: doc.os } : {}), server: doc.id }
}
