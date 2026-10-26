import { createHash } from "node:crypto"
import { existsSync, mkdirSync, realpathSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { Refusal } from "../shared/errors.js"
import { captureToolSync } from "../shared/exec.js"

/** The ledger schema version this build writes. */
export const LEDGER_VERSION = 6

/**
 * The tables of a project ledger: the nine of the task protocol, plus the workflow graph (plan_nodes, edges and
 * graph_versions, one set per graph version, since version 4). Status rules live in the code's one state machine, not in
 * triggers; the tables only keep facts (contracts, results and recorded graphs are immutable once written). Provider health is host-wide and lives in
 * machine.sqlite since version 3; a ledger from before keeps its unused provider_health table, since a migration never drops.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY, goal_json TEXT NOT NULL, goal_version INTEGER NOT NULL DEFAULT 1,
  graph_version INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, workflow_id TEXT REFERENCES workflows(id), label TEXT NOT NULL,
  contract_json TEXT NOT NULL, contract_hash TEXT NOT NULL, try_no INTEGER NOT NULL DEFAULT 1,
  retry_of TEXT REFERENCES tasks(id), status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), seq INTEGER NOT NULL,
  pick_json TEXT, agent TEXT, model TEXT, outcome TEXT, verdict TEXT,
  started_at TEXT NOT NULL, ended_at TEXT, UNIQUE (task_id, seq));
CREATE TABLE IF NOT EXISTS results (
  attempt_id TEXT PRIMARY KEY REFERENCES attempts(id), status TEXT NOT NULL,
  output_json TEXT NOT NULL, filed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS check_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, attempt_id TEXT, contract_hash TEXT NOT NULL,
  name TEXT NOT NULL, runner TEXT NOT NULL, status TEXT NOT NULL, exit_code INTEGER,
  detail TEXT NOT NULL, ran_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS leases (
  path TEXT NOT NULL, task_id TEXT NOT NULL REFERENCES tasks(id), token TEXT NOT NULL,
  expires_at TEXT NOT NULL, PRIMARY KEY (path, task_id));
CREATE TABLE IF NOT EXISTS seats (
  id TEXT PRIMARY KEY, role TEXT NOT NULL, agent TEXT, handle TEXT, task_id TEXT,
  status TEXT NOT NULL, last_pong_at TEXT, started_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, seat_id TEXT NOT NULL, command TEXT NOT NULL, correlation_id TEXT,
  deadline_at TEXT NOT NULL, sent_at TEXT NOT NULL, answered_at TEXT, answer_json TEXT);
CREATE TABLE IF NOT EXISTS plan_nodes (
  workflow_id TEXT NOT NULL REFERENCES workflows(id), graph_version INTEGER NOT NULL, plan_key TEXT NOT NULL,
  contract_json TEXT NOT NULL, contract_hash TEXT NOT NULL, node_hash TEXT NOT NULL, route_json TEXT NOT NULL, round INTEGER NOT NULL,
  PRIMARY KEY (workflow_id, graph_version, plan_key));
CREATE TABLE IF NOT EXISTS edges (
  workflow_id TEXT NOT NULL REFERENCES workflows(id), graph_version INTEGER NOT NULL, plan_key TEXT NOT NULL,
  depends_on TEXT NOT NULL, PRIMARY KEY (workflow_id, graph_version, plan_key, depends_on));
CREATE TABLE IF NOT EXISTS graph_versions (
  workflow_id TEXT NOT NULL REFERENCES workflows(id), graph_version INTEGER NOT NULL, goal_version INTEGER NOT NULL,
  reason TEXT, classification_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (workflow_id, graph_version));
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL,
  subject TEXT, data_json TEXT NOT NULL);
`

/**
 * Columns added after a table was first created, by the ledger version that added them. A migration is additive only: a
 * missing column is added (ALTER TABLE ADD COLUMN) to a new and an old ledger alike, so this list is the one owner of them.
 */
const ADDED_COLUMNS: readonly { readonly table: string; readonly column: string; readonly type: string; readonly since: number }[] = [
    { table: "seats", column: "attempt_id", type: "TEXT", since: 2 },
    { table: "seats", column: "model", type: "TEXT", since: 2 },
    { table: "seats", column: "ended_at", type: "TEXT", since: 2 },
    { table: "seats", column: "request_id", type: "TEXT", since: 2 },
    { table: "seats", column: "run_id", type: "TEXT", since: 2 },
    { table: "seats", column: "launch_json", type: "TEXT", since: 2 },
    { table: "workflows", column: "reason", type: "TEXT", since: 4 },
    { table: "workflows", column: "updated_at", type: "TEXT", since: 4 },
    { table: "tasks", column: "plan_key", type: "TEXT", since: 4 },
    { table: "tasks", column: "plan_hash", type: "TEXT", since: 4 },
    { table: "seats", column: "last_ping_at", type: "TEXT", since: 5 },
    { table: "seats", column: "last_activity_at", type: "TEXT", since: 5 },
    { table: "seats", column: "terminal", type: "TEXT", since: 6 },
    { table: "workflows", column: "kernel_run_id", type: "TEXT", since: 6 },
    { table: "workflows", column: "kernel_task_id", type: "TEXT", since: 6 },
    { table: "workflows", column: "kernel_terminal", type: "TEXT", since: 6 },
    { table: "workflows", column: "kernel_terminal_owned", type: "INTEGER", since: 6 },
    { table: "workflows", column: "kernel_closed_at", type: "TEXT", since: 6 },
]

const missingColumns = (db: DatabaseSync): typeof ADDED_COLUMNS => {
    const tables = new Map<string, Set<string>>()
    const columnsOf = (table: string): Set<string> => {
        const known = tables.get(table) ?? new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => String(row.name)))
        tables.set(table, known)
        return known
    }
    return ADDED_COLUMNS.filter(({ table, column }) => !columnsOf(table).has(column))
}

// The check repeats under BEGIN IMMEDIATE, so two processes opening an old ledger at once never both add the same column.
const migrate = (db: DatabaseSync): void => {
    if (missingColumns(db).length === 0) return
    db.exec("BEGIN IMMEDIATE")
    try {
        for (const { table, column, type } of missingColumns(db)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
        db.exec("COMMIT")
    } catch (error: unknown) {
        db.exec("ROLLBACK")
        throw error
    }
}

/** Replaces the whole state base (`<runtime root>/.runtime`): tests and probes point it at a temp directory. */
export const LOCAL_ROOT_ENV = "STARCI_LOCAL_ROOT"

/** Replaces only the projects directory of the state base, the one holding `<ledger_id>/runtime.sqlite`. */
export const PROJECTS_ROOT_ENV = "STARCI_PROJECTS_ROOT"

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

/** The runtime root, found like ops/: the harness checkout holding cli/ and ops/, else the installed package carrying ops/ itself. */
export const runtimeRoot = (): string => {
    const checkout = resolve(packageRoot, "..")
    return existsSync(join(checkout, "ops", "checks.yaml")) && existsSync(join(checkout, "cli")) ? checkout : resolve(packageRoot)
}

/** The host's harness state, outside every product repository: STARCI_LOCAL_ROOT, else `<runtime root>/.runtime` (git-ignored). */
export const stateBase = (): string => {
    const local = process.env[LOCAL_ROOT_ENV]
    return local === undefined || local === "" ? join(runtimeRoot(), ".runtime") : resolve(local)
}

const projectsRoot = (): string => {
    const projects = process.env[PROJECTS_ROOT_ENV]
    return projects === undefined || projects === "" ? join(stateBase(), "projects") : resolve(projects)
}

/** The host store, `<state base>/machine.sqlite`. */
export const machinePath = (): string => join(stateBase(), "machine.sqlite")

/**
 * The host store keeps only host-wide state: the registry of project ledgers (the legacy `ledgers` columns plus
 * repo_common_dir, the lookup key) and provider health, since a provider's rate limit or circuit is the same for every project.
 */
const MACHINE_SCHEMA = `
CREATE TABLE IF NOT EXISTS ledgers (
  ledger_id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, repo_common_dir TEXT NOT NULL UNIQUE, repo_root TEXT NOT NULL,
  file TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'idle', 'retired')),
  schema_version INTEGER, registered_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS provider_health (
  provider TEXT PRIMARY KEY, status TEXT NOT NULL, strikes INTEGER NOT NULL DEFAULT 0,
  failure_kind TEXT, circuit_open_until TEXT, updated_at TEXT NOT NULL);
`

interface Project {
    readonly root: string
    readonly key: string
}

const projects = new Map<string, Project>()

// One spelling per directory, so the registry matches it however git or the caller wrote the path.
const pathKey = (path: string): string => {
    let real = resolve(path)
    try {
        real = realpathSync.native(real)
    } catch {
        // A path that does not resolve keeps its resolved spelling.
    }
    const slashed = real.replaceAll("\\", "/")
    return process.platform === "win32" ? slashed.toLowerCase() : slashed
}

// A project is its git common dir, so every linked worktree of a repository is the same project with the same ledger.
// A folder outside git is a project of its own, keyed by its path.
const projectOf = (root: string): Project => {
    const at = resolve(root)
    const known = projects.get(at)
    if (known !== undefined) return known
    let project: Project = { root: at, key: pathKey(at) }
    const dirs = captureToolSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], at)
    const commonDir = dirs.stdout.trim()
    if (dirs.exitCode === 0 && commonDir !== "") {
        // The first entry of the worktree list is the main checkout (the repository itself when it is bare).
        const main = /^worktree (.+)$/m.exec(captureToolSync("git", ["worktree", "list", "--porcelain"], at).stdout)?.[1]
        project = { root: main === undefined ? dirname(resolve(commonDir)) : resolve(main.trim()), key: pathKey(commonDir) }
    }
    projects.set(at, project)
    return project
}

const connect = (file: string): DatabaseSync => {
    // The busy timeout must hold before the WAL switch, or a concurrent open fails with "database is locked".
    const db = new DatabaseSync(file, { timeout: 5000 })
    db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
    return db
}

const registered = (db: DatabaseSync, project: Project): string | undefined => {
    const row = db.prepare("SELECT ledger_id FROM ledgers WHERE repo_common_dir = ?").get(project.key)
    return row === undefined ? undefined : String(row.ledger_id)
}

// The main checkout's folder name, readable in listings; the id adds a hash of the common dir so it is stable and unique.
// Drops leading dashes and dots and trailing dashes by scanning, which a backtracking regex would do in super-linear time.
const trimDashes = (text: string): string => {
    let start = 0
    let end = text.length
    while (start < end && (text[start] === "-" || text[start] === ".")) start += 1
    while (end > start && text[end - 1] === "-") end -= 1
    return text.slice(start, end)
}

const nameOf = (project: Project): string => trimDashes(basename(project.root).replaceAll(/[^\w.-]+/g, "-")) || "project"

const mintLedgerId = (project: Project): string => `${nameOf(project)}-${createHash("sha256").update(project.key).digest("hex").slice(0, 10)}`

const ledgerFile = (id: string): string => join(projectsRoot(), id, "runtime.sqlite")

/** Opens (creating it) the host store with its base tables, for modules that add host-wide tables of their own; the caller closes it. */
export const openMachine = (): DatabaseSync => {
    mkdirSync(stateBase(), { recursive: true })
    const db = connect(machinePath())
    try {
        db.exec(MACHINE_SCHEMA)
    } catch (error: unknown) {
        db.close()
        throw error
    }
    return db
}

/** How many project ledgers the host registry lists, read-only; undefined when there is no machine.sqlite (or no registry) yet. */
export const ledgerCount = (): number | undefined => {
    const file = machinePath()
    if (!existsSync(file)) return undefined
    const db = new DatabaseSync(file, { readOnly: true, timeout: 5000 })
    try {
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ledgers'").get() === undefined) return undefined
        return Number(db.prepare("SELECT COUNT(*) AS n FROM ledgers").get()?.n ?? 0)
    } finally {
        db.close()
    }
}

/** The ledger id the host registry holds for a repository, without creating anything; undefined when it has none. */
export const findLedgerId = (root: string): string | undefined => {
    const file = machinePath()
    if (!existsSync(file)) return undefined
    const db = connect(file)
    try {
        db.exec(MACHINE_SCHEMA)
        return registered(db, projectOf(root))
    } finally {
        db.close()
    }
}

/** The repository's ledger id, registered in the host registry on first use; this module is the one writer of `machine.sqlite`. */
export const ensureLedgerId = (root: string): string => {
    const project = projectOf(root)
    mkdirSync(stateBase(), { recursive: true })
    const db = connect(machinePath())
    try {
        db.exec(MACHINE_SCHEMA)
        db.exec("BEGIN IMMEDIATE")
        try {
            let id = registered(db, project)
            if (id === undefined) {
                id = mintLedgerId(project)
                // Two repositories may share a folder name; the second is listed under its id instead.
                const taken = db.prepare("SELECT 1 FROM ledgers WHERE name = ?").get(nameOf(project)) !== undefined
                db.prepare("INSERT INTO ledgers (ledger_id, name, repo_common_dir, repo_root, file, schema_version, registered_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
                    id,
                    taken ? id : nameOf(project),
                    project.key,
                    project.root,
                    ledgerFile(id),
                    LEDGER_VERSION,
                    now(),
                )
            } else {
                db.prepare("UPDATE ledgers SET schema_version = ? WHERE ledger_id = ? AND schema_version IS NOT ?").run(LEDGER_VERSION, id, LEDGER_VERSION)
            }
            db.exec("COMMIT")
            return id
        } catch (error: unknown) {
            db.exec("ROLLBACK")
            throw error
        }
    } finally {
        db.close()
    }
}

/** A project's state folder under the state base: its ledger plus briefs/, contracts/, preserved/ and outputs/. Created on first use. */
export const projectDir = (root: string): string => {
    const dir = dirname(ledgerFile(ensureLedgerId(root)))
    mkdirSync(dir, { recursive: true })
    return dir
}

/** The project's ledger file when the host registry knows it and it exists, else undefined; creates nothing. */
export const ledgerPath = (root: string): string | undefined => {
    const id = findLedgerId(root)
    const file = id === undefined ? undefined : ledgerFile(id)
    return file !== undefined && existsSync(file) ? file : undefined
}

/**
 * Opens (and creates or migrates) the project's ledger, `<state base>/projects/<ledger_id>/runtime.sqlite`, shared by every
 * linked worktree of the repository; with WAL and a busy timeout for concurrent seats.
 */
export const openLedger = (root: string): DatabaseSync => {
    const dir = projectDir(root)
    const id = basename(dir)
    const file = join(dir, "runtime.sqlite")
    const db = connect(file)
    try {
        db.exec(SCHEMA)
        migrate(db)
        db.prepare("INSERT INTO meta (key, value) VALUES ('version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(LEDGER_VERSION))
        db.prepare("INSERT INTO meta (key, value) VALUES ('ledger_id', ?) ON CONFLICT(key) DO NOTHING").run(id)
        const own = db.prepare("SELECT value FROM meta WHERE key = 'ledger_id'").get()?.value
        if (own !== id) throw new Refusal("LEDGER_MISMATCH", `${file} carries ledger id ${String(own)}, not ${id}; keep the file and fix the registry`)
    } catch (error: unknown) {
        db.close()
        throw error
    }
    return db
}

/** Opens the project's ledger only when it exists, creating and migrating nothing; for reads that must leave no ledger behind. */
export const openExistingLedger = (root: string): DatabaseSync | undefined => {
    const file = ledgerPath(root)
    return file === undefined ? undefined : connect(file)
}

/** The current time as the ledger stores it. */
export const now = (): string => new Date().toISOString()
