import { cpSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isMap, isScalar, isSeq, parseDocument } from "yaml"
import type { Document, ToStringOptions } from "yaml"
import { Refusal, asRefusal } from "../shared/errors.js"
import { loadCoordinatorLiveness } from "./coordinator-liveness.js"
import { loadHost } from "./host.js"
import { LANES_SCHEMA, loadLanes } from "./lanes.js"
import { loadLiveness } from "./liveness.js"
import { loadOps, locateOps } from "./ops.js"
import { ROUTES_SCHEMA, loadRoutes } from "./routes.js"
import { loadRouting } from "./routing.js"
import { loadStallRules } from "./stall.js"
import { loadUat } from "./uat.js"

/**
 * Every settings file of ops/ by name, with the validated view its own loaders give of a folder holding it. A key is a
 * setting when it resolves in that view, so the loaders' schemas decide the key set; nothing here restates them.
 */
const SETTINGS: Readonly<Record<string, (dir: string) => unknown>> = {
    routing: (dir) => loadRouting(dir),
    lanes: (dir) => ({ schema: LANES_SCHEMA, lanes: loadLanes(loadOps(dir)) }),
    routes: (dir) => ({ schema: ROUTES_SCHEMA, routes: loadRoutes(loadOps(dir)) }),
    liveness: (dir) => ({ ...loadLiveness(dir), coordinators: loadCoordinatorLiveness(dir), stall: loadStallRules(dir) }),
    checks: (dir) => ({ presets: loadOps(dir).presets }),
    host: (dir) => loadHost(dir),
    uat: (dir) => loadUat(dir),
}

/** The names of the settings files, `<name>.yaml` in ops/. */
export const SETTINGS_FILES: readonly string[] = Object.keys(SETTINGS)

/** One step of a key's path: a map key or a sequence index. */
type Segment = string | number

/** One setting: its dotted key, its value as the file writes it, and the file that owns it. */
export interface Setting {
    readonly key: string
    readonly value: unknown
    readonly file: string
}

// The writer keeps a file byte for byte except the value it sets; a file it cannot reprint unchanged is refused, never reformatted.
const PRINT: ToStringOptions = { lineWidth: 0, flowCollectionPadding: false }

const PLAIN_KEY = /^[A-Za-z_][\w-]*$/

const keyOf = (file: string, path: readonly Segment[]): string =>
    file + path.map((segment) => (typeof segment === "number" ? `[${String(segment)}]` : PLAIN_KEY.test(segment) ? `.${segment}` : `[${JSON.stringify(segment)}]`)).join("")

const KEY_TOKEN = /\.([A-Za-z_][\w-]*)|\[(\d+)\]|\[("(?:[^"\\]|\\.)*")\]/y

/** Splits `routing.tiers.high[0].effort` into its file and path; a key that is not of that shape is CONFIG_KEY_UNKNOWN. */
const parseKey = (key: string): { readonly file: string; readonly path: readonly Segment[] } => {
    const file = /^[a-z]+/.exec(key)?.[0] ?? ""
    if (!(file in SETTINGS)) throw new Refusal("CONFIG_KEY_UNKNOWN", `${key} names no settings file (files: ${SETTINGS_FILES.join(", ")})`)
    const path: Segment[] = []
    KEY_TOKEN.lastIndex = file.length
    while (KEY_TOKEN.lastIndex < key.length) {
        const token = KEY_TOKEN.exec(key)
        if (token === null) throw new Refusal("CONFIG_KEY_UNKNOWN", `${key} is no key: write it as <file>.<key>[<index>]... (e.g. routing.tiers.high[0].effort)`)
        const [, name, index, quoted] = token
        path.push(name ?? (index === undefined ? (JSON.parse(quoted ?? "\"\"") as string) : Number(index)))
    }
    if (path.length === 0) throw new Refusal("CONFIG_KEY_UNKNOWN", `${key} names a file, not a setting in it`)
    return { file, path }
}

/** A settings file name as `--file` gives it (`routing` or `routing.yaml`); refuses one ops/ does not hold. */
export const settingsFileOf = (name: string): string => {
    const file = name.replace(/\.yaml$/, "")
    if (!(file in SETTINGS)) throw new Refusal("CONFIG_FILE_UNKNOWN", `no settings file ${name} (files: ${SETTINGS_FILES.join(", ")})`)
    return file
}

const pathOf = (dir: string, file: string): string => join(dir, `${file}.yaml`)

const documentOf = (file: string, text: string): Document => {
    const doc = parseDocument(text)
    if (doc.errors.length > 0) throw new Refusal("OPS_INVALID", `${file} is not readable yaml: ${doc.errors.map((error) => error.message).join("; ")}`)
    return doc
}

const resolve = (value: unknown, path: readonly Segment[]): unknown =>
    path.reduce<unknown>((at, segment) => (typeof at === "object" && at !== null && Object.hasOwn(at, segment) ? (at as Record<string, unknown>)[String(segment)] : undefined), value)

// The leaves of a node: every scalar and every empty collection, each with its path.
const leavesOf = (node: unknown, path: readonly Segment[]): { readonly path: readonly Segment[]; readonly node: unknown }[] => {
    if (isMap(node) && node.items.length > 0) return node.items.flatMap((pair) => leavesOf(pair.value, [...path, String(isScalar(pair.key) ? pair.key.value : pair.key)]))
    if (isSeq(node) && node.items.length > 0) return node.items.flatMap((item, index) => leavesOf(item, [...path, index]))
    return [{ path, node }]
}

const jsonOf = (node: unknown): unknown => (typeof node === "object" && node !== null && "toJSON" in node && typeof node.toJSON === "function" ? (node.toJSON as () => unknown)() : node)

/** Every setting of the named files (default all) in ops/: each leaf the file writes that its loaders read, the root `schema` tag aside. */
export const listSettings = (files: readonly string[] = SETTINGS_FILES, dir: string = locateOps()): Setting[] =>
    files.flatMap((file) => {
        const path = pathOf(dir, file)
        const view = SETTINGS[file]?.(dir)
        return leavesOf(documentOf(path, readFileSync(path, "utf8")).contents, [])
            .filter((leaf) => leaf.path[0] !== "schema" && resolve(view, leaf.path) !== undefined)
            .map((leaf) => ({ key: keyOf(file, leaf.path), value: jsonOf(leaf.node), file: path }))
    })

/** One setting by its key: the value its file writes there (a whole block for a key that names one). */
export const getSetting = (key: string, dir: string = locateOps()): Setting => {
    const { file, path } = parseKey(key)
    const filePath = pathOf(dir, file)
    const node = documentOf(filePath, readFileSync(filePath, "utf8")).getIn(path, true)
    if (node === undefined || resolve(SETTINGS[file]?.(dir), path) === undefined) throw new Refusal("CONFIG_KEY_UNKNOWN", `${filePath} holds no setting ${key}`)
    return { key: keyOf(file, path), value: jsonOf(node), file: filePath }
}

/** A value as the command line gives it: JSON when it parses (a number, true, null, an array, a quoted string), else the text itself. */
export const parseValue = (raw: string): unknown => {
    try {
        return JSON.parse(raw) as unknown
    } catch {
        return raw
    }
}

/**
 * Sets one key in the file that owns it. The new text keeps every comment and every other byte; the whole file is validated
 * by its own loaders on a copy of ops/ before anything is written, and the write is a rename over the file. A key the
 * loaders do not read is CONFIG_KEY_UNKNOWN and a value they refuse CONFIG_INVALID; either leaves the file untouched.
 */
export const setSetting = (key: string, value: unknown, dir: string = locateOps()): Setting & { readonly previous: unknown } => {
    const { file, path } = parseKey(key)
    const filePath = pathOf(dir, file)
    const text = readFileSync(filePath, "utf8")
    const doc = documentOf(filePath, text)
    if (doc.toString(PRINT) !== text) throw new Refusal("CONFIG_UNPRESERVED", `${filePath} does not reprint byte for byte, so a write would reformat it; edit it by hand`)
    const previous = doc.getIn(path, true)
    const before = previous === undefined ? null : jsonOf(previous)
    if (previous === undefined && !isMap(doc.getIn(path.slice(0, -1), true))) throw new Refusal("CONFIG_KEY_UNKNOWN", `${filePath} holds no setting ${key}`)
    doc.setIn(path, value)
    const next = doc.toString(PRINT)
    const scratch = mkdtempSync(join(tmpdir(), "starci-config-"))
    try {
        cpSync(dir, scratch, { recursive: true })
        writeFileSync(pathOf(scratch, file), next)
        let view: unknown
        try {
            view = SETTINGS[file]?.(scratch)
        } catch (error: unknown) {
            throw new Refusal("CONFIG_INVALID", `${key} = ${JSON.stringify(value)} is refused and the file is unchanged: ${asRefusal(error).message.replaceAll(scratch, dir)}`)
        }
        if (resolve(view, path) === undefined) throw new Refusal("CONFIG_KEY_UNKNOWN", `${filePath} reads no setting ${key}; the file is unchanged`)
    } finally {
        rmSync(scratch, { recursive: true, force: true })
    }
    const staged = `${filePath}.${String(process.pid)}.tmp`
    writeFileSync(staged, next)
    renameSync(staged, filePath)
    return { key: keyOf(file, path), value, file: filePath, previous: before }
}
