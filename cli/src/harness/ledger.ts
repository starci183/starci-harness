import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { Refusal } from "../shared/errors.js"
import { captureGitSync } from "../shared/git.js"

/** The ledger schema version this build writes. */
export const LEDGER_VERSION = 9

/** The additive host schema version: 3 keys the Supervisors by project (`project_supervisors`). */
export const MACHINE_VERSION = 3

/**
 * How long an open of a ledger waits on another process's write lock before SQLite answers "database is locked": every
 * coordinator, worker verb and governor shares these files, and a host at full CPU stretches each write past seconds.
 */
export const LEDGER_BUSY_MS = 30_000

/**
 * The tables of a project ledger: the eight of the task protocol, plus the workflow graph (plan_nodes, edges and
 * graph_versions, one set per graph version, since version 4). Status rules live in the code's one state machine, not in
 * triggers; the tables only keep facts (contracts, results and recorded graphs are immutable once written). Provider health is host-wide and lives in
 * machine.sqlite since version 3, and a task holds no path lease (a land lock serialises landing, harness/land.ts); a ledger from
 * before keeps its unused provider_health and leases tables, since a migration never drops.
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
CREATE TABLE IF NOT EXISTS prior_work (
  workflow_id TEXT NOT NULL, plan_key TEXT NOT NULL, contract_hash TEXT NOT NULL, attempt_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('preserved', 'committed')), sha256 TEXT NOT NULL, task_id TEXT NOT NULL REFERENCES tasks(id),
  base TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (workflow_id, plan_key, contract_hash, attempt_id, kind, sha256));
CREATE TABLE IF NOT EXISTS commands (
  cmd_id TEXT PRIMARY KEY, scope TEXT NOT NULL, workflow_id TEXT NOT NULL, kind TEXT NOT NULL, based_on_json TEXT NOT NULL,
  sha256 TEXT NOT NULL, body_json TEXT NOT NULL, status TEXT NOT NULL, outcome_json TEXT, received_at TEXT NOT NULL, applied_at TEXT);
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL, workflow_id TEXT NOT NULL, kind TEXT NOT NULL, subject TEXT NOT NULL,
  evidence_json TEXT NOT NULL, raised_at TEXT NOT NULL, answered_by TEXT, answered_at TEXT,
  UNIQUE (scope, workflow_id, kind, subject));
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
    { table: "tasks", column: "intent", type: "TEXT", since: 7 },
    { table: "tasks", column: "intent_json", type: "TEXT", since: 7 },
    { table: "tasks", column: "worktree", type: "TEXT", since: 7 },
    { table: "tasks", column: "settle_commit", type: "TEXT", since: 7 },
    // Replan: a task's settled result hash and the dependency tasks it ran on; a graph version's command id.
    { table: "tasks", column: "result_hash", type: "TEXT", since: 7 },
    { table: "tasks", column: "plan_inputs_json", type: "TEXT", since: 7 },
    { table: "graph_versions", column: "cmd_id", type: "TEXT", since: 7 },
    // Version 8: a Kernel is a seat (role kernel) of its workflow, and every seat holds a TTL lease.
    { table: "seats", column: "workflow_id", type: "TEXT", since: 8 },
    { table: "seats", column: "lease_until", type: "TEXT", since: 8 },
    // One workflow = one worktree: the checkout every Op, verify and relaunched Kernel of the workflow uses.
    { table: "workflows", column: "worktree", type: "TEXT", since: 8 },
    // Version 9: why a seat's launch failed (harness/launch-failure.ts), kept on the seat for seat list and the tick.
    { table: "seats", column: "failure_json", type: "TEXT", since: 9 },
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
 * The main checkout of the harness at `root`: a linked worktree's `.git` is a file naming `<main>/.git/worktrees/<name>`; a main
 * checkout (a `.git` folder) or an installed package is its own.
 */
export const mainCheckoutOf = (root: string): string => {
    const dotGit = join(root, ".git")
    if (!existsSync(dotGit) || statSync(dotGit).isDirectory()) return root
    const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"))?.[1]?.trim().replaceAll("\\", "/")
    const main = gitdir === undefined ? undefined : /^(.*)\/\.git\/worktrees\/[^/]+$/.exec(gitdir)?.[1]
    return main !== undefined && existsSync(join(main, "cli")) ? main : root
}

/**
 * The store of the host's heavy-command governor (harness/heavy.ts): `STARCI_LOCAL_ROOT`'s machine.sqlite when it is set, else
 * the machine.sqlite of the harness's main checkout, so a CLI run from any worktree of the harness takes the same slots.
 */
export const governorStorePath = (): string => {
    const local = process.env[LOCAL_ROOT_ENV]
    return local === undefined || local === "" ? join(mainCheckoutOf(runtimeRoot()), ".runtime", "machine.sqlite") : machinePath()
}

/** A launcher of a host service's schedule (`starci host install`): `<state base>/host/<service>.cmd`, and the `.vbs` that runs it hidden. */
export const hostLauncherPath = (service: string, extension: "cmd" | "vbs"): string => join(stateBase(), "host", `${service}.${extension}`)

/** The output of one workspace dependency's build, kept by its content key (core/check/workspace-deps.ts): `<state base>/cache/workspace-builds/<key>`. */
export const workspaceBuildCachePath = (key: string): string => join(stateBase(), "cache", "workspace-builds", key)

/** One shared npm install, kept by its key (lockfile, Node and npm versions; harness/install-cache.ts): `<state base>/cache/installs/<key>`. */
export const installCachePath = (key: string): string => join(stateBase(), "cache", "installs", key)

/**
 * The folder every clean-verify and wave checkout is made in: `<state base>/checkouts`, outside every product repository, the
 * system temp folder and the project folders whose `worktrees/` the collector judges (harness/worktree-gc.ts).
 */
export const cleanCheckoutsPath = (): string => join(stateBase(), "checkouts")

/** A coordinator's immutable launch brief, in its project's state folder, outside every product repository. */
export const coordinatorBriefPath = (role: "supervisor" | "kernel", launchId: string, root: string): string => join(projectDir(root), "briefs", `${role}-${launchId}.md`)

/**
 * The host store keeps only host-wide state: the registry of project ledgers (the legacy `ledgers` columns plus
 * repo_common_dir, the lookup key), provider health, since a provider's rate limit or circuit is the same for every project, and
 * the Supervisors, one live row per project (`project` is the ledger id of the repository owning its Work, `ended_by` who
 * retired a row: owner, gone, stalled). A host store from version 2 keeps its `supervisors` table of one host Supervisor,
 * which only the adoption of its workflows reads (`harness/supervisor.ts`).
 */
const MACHINE_SCHEMA = `
CREATE TABLE IF NOT EXISTS machine_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO machine_meta (key, value) VALUES ('version', '${String(MACHINE_VERSION)}')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
CREATE TABLE IF NOT EXISTS project_supervisors (
  id TEXT PRIMARY KEY, project TEXT NOT NULL, project_root TEXT NOT NULL, terminal TEXT, run_id TEXT, task_id TEXT,
  agent TEXT NOT NULL, model TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, ended_by TEXT, lease_until TEXT,
  launch_op TEXT, launch_json TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS one_live_supervisor_per_project ON project_supervisors (project) WHERE ended_at IS NULL;
CREATE TABLE IF NOT EXISTS ledgers (
  ledger_id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, repo_common_dir TEXT NOT NULL UNIQUE, repo_root TEXT NOT NULL,
  file TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'idle', 'retired')),
  schema_version INTEGER, registered_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS provider_health (
  provider TEXT PRIMARY KEY, status TEXT NOT NULL, strikes INTEGER NOT NULL DEFAULT 0,
  failure_kind TEXT, circuit_open_until TEXT, updated_at TEXT NOT NULL);
`

const applyMachineSchema = (db: DatabaseSync): void => {
    db.exec(MACHINE_SCHEMA)
}

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
    const dirs = captureGitSync(["rev-parse", "--path-format=absolute", "--git-common-dir"], at)
    const commonDir = dirs.stdout.trim()
    if (dirs.exitCode === 0 && commonDir !== "") {
        // The first entry of the worktree list is the main checkout (the repository itself when it is bare).
        const main = /^worktree (.+)$/m.exec(captureGitSync(["worktree", "list", "--porcelain"], at).stdout)?.[1]
        project = { root: main === undefined ? dirname(resolve(commonDir)) : resolve(main.trim()), key: pathKey(commonDir) }
    }
    projects.set(at, project)
    return project
}

// SQLite's result codes for a file that is no database or a damaged one (SQLITE_NOTADB, SQLITE_CORRUPT).
const DAMAGED = new Set([26, 11])

/**
 * LEDGER_CORRUPT for an error SQLite raised because `file` is no readable database, naming the file and its recovery; any other
 * error as it was. The file is never written or replaced: it stays as it is for the Debug role.
 */
const damaged = (file: string, error: unknown): unknown => {
    const code = typeof error === "object" && error !== null && "errcode" in error ? error.errcode : undefined
    if (typeof code !== "number" || !DAMAGED.has(code)) return error
    const why = error instanceof Error ? error.message : String(error)
    const after =
        file === machinePath()
            ? "the host store starts empty and each project's ledger is registered again, under the same id, by its next writing verb"
            : "the project starts a new empty ledger, and its history stays readable only in the moved file"
    return new Refusal("LEDGER_CORRUPT", `${file} is not a readable SQLite database (${why}); it is kept as it is. To recover, move it aside (rename it to ${basename(file)}.corrupt) and run the verb again: ${after}`)
}

/**
 * Opens a host or project store and reads its header, so a damaged file is refused LEDGER_CORRUPT at the open (damaged); a
 * writable open switches to WAL with foreign keys on. Every store of the harness is opened here.
 */
const connect = (file: string, readOnly = false): DatabaseSync => {
    // The busy timeout must hold before the WAL switch, or a concurrent open fails with "database is locked".
    const db = new DatabaseSync(file, { readOnly, timeout: LEDGER_BUSY_MS })
    try {
        if (readOnly) db.prepare("SELECT 1 FROM sqlite_master LIMIT 1").get()
        else db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
    } catch (error: unknown) {
        db.close()
        throw damaged(file, error)
    }
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

/** Opens (creating it) the host store (or the store at `file`, the governor's) with its base tables, for modules that add host-wide tables of their own; the caller closes it. */
export const openMachine = (file: string = machinePath()): DatabaseSync => {
    mkdirSync(dirname(file), { recursive: true })
    const db = connect(file)
    try {
        applyMachineSchema(db)
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
    const db = connect(file, true)
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
        applyMachineSchema(db)
        return registered(db, projectOf(root))
    } finally {
        db.close()
    }
}

/** The registry row of a project read without any lock or write: its id and the schema version it records; undefined when not registered. */
const lookUp = (project: Project): { readonly id: string; readonly version: number } | undefined => {
    const file = machinePath()
    if (!existsSync(file)) return undefined
    const db = connect(file, true)
    try {
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ledgers'").get() === undefined) return undefined
        const row = db.prepare("SELECT ledger_id, schema_version FROM ledgers WHERE repo_common_dir = ?").get(project.key)
        return row === undefined ? undefined : { id: String(row.ledger_id), version: Number(row.schema_version ?? 0) }
    } finally {
        db.close()
    }
}

/**
 * The repository's ledger id, registered in the host registry on first use; this module is the one writer of `machine.sqlite`.
 * A registered project at this build's version (or newer) is read without a write lock, so opening a ledger never queues on
 * the host store; only a first registration or a version raise takes BEGIN IMMEDIATE, and a version is never lowered.
 */
export const ensureLedgerId = (root: string): string => {
    const project = projectOf(root)
    const known = lookUp(project)
    if (known !== undefined && known.version >= LEDGER_VERSION) return known.id
    mkdirSync(stateBase(), { recursive: true })
    const db = connect(machinePath())
    try {
        applyMachineSchema(db)
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
                db.prepare("UPDATE ledgers SET schema_version = ? WHERE ledger_id = ? AND (schema_version IS NULL OR schema_version < ?)").run(LEDGER_VERSION, id, LEDGER_VERSION)
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

/** A project's state folder under the state base: its ledger plus briefs/, contracts/, preserved/, prior/ and outputs/. Created on first use. */
export const projectDir = (root: string): string => {
    const dir = dirname(ledgerFile(ensureLedgerId(root)))
    mkdirSync(dir, { recursive: true })
    return dir
}

/**
 * The project's prior-work store, `prior/<sha256>.patch` of its state folder: every attempt's work (a preserved or a committed
 * patch) named by the sha256 of its bytes and indexed in the ledger's prior_work table. Nothing deletes from it.
 */
export const priorDir = (root: string): string => join(projectDir(root), "prior")

/** The command file an owner's write through `starci ui` becomes (a ruling by its decision id, a goal by its cmdId), kept in the project's state folder. */
export const ownerCommandPath = (root: string, name: string): string => join(projectDir(root), "owner-commands", `${name}.json`)

/**
 * The repository's local package-source record (`starci deps source --local`): which `@starci` packages its installs copy
 * from a local folder. It sits in the project's state folder, never in the repository, so every worktree and clean-verify
 * checkout of the repository reads the same one and nothing of it can be committed.
 */
export const depsLocalPath = (root: string): string => join(projectDir(root), "deps-local.json")

/** The same record's path without registering anything: undefined when the host registry does not know the repository. */
export const existingDepsLocalPath = (root: string): string | undefined => {
    const id = findLedgerId(root)
    return id === undefined ? undefined : join(dirname(ledgerFile(id)), "deps-local.json")
}

/** The project's ledger file when the host registry knows it and it exists, else undefined; creates nothing. */
export const ledgerPath = (root: string): string | undefined => {
    const id = findLedgerId(root)
    const file = id === undefined ? undefined : ledgerFile(id)
    return file !== undefined && existsSync(file) ? file : undefined
}

/** The version a ledger's meta records; 0 for a new file (no meta table or no row yet). */
const metaVersion = (db: DatabaseSync): number => {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get() === undefined) return 0
    return Number(db.prepare("SELECT value FROM meta WHERE key = 'version'").get()?.value ?? 0)
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
        const recorded = metaVersion(db)
        if (recorded > LEDGER_VERSION) {
            throw new Refusal("LEDGER_NEWER", `${file} is ledger version ${String(recorded)}, newer than this build's ${String(LEDGER_VERSION)}; update the harness (cd cli && npm run build) before using it`)
        }
        db.exec(SCHEMA)
        migrate(db)
        // Written only when it rises, so an older build never lowers it and a current one writes nothing.
        if (recorded < LEDGER_VERSION) db.prepare("INSERT INTO meta (key, value) VALUES ('version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE CAST(meta.value AS INTEGER) < CAST(excluded.value AS INTEGER)").run(String(LEDGER_VERSION))
        db.prepare("INSERT INTO meta (key, value) VALUES ('ledger_id', ?) ON CONFLICT(key) DO NOTHING").run(id)
        const own = db.prepare("SELECT value FROM meta WHERE key = 'ledger_id'").get()?.value
        if (own !== id) throw new Refusal("LEDGER_MISMATCH", `${file} carries ledger id ${String(own)}, not ${id}; keep the file and fix the registry`)
    } catch (error: unknown) {
        db.close()
        throw error
    }
    return db
}

/**
 * Opens the project's ledger only when it exists, for reads that must leave no ledger behind. An existing ledger is brought to
 * this build's schema first (the same additive tables and columns openLedger adds), so a read never meets a column a newer
 * build expects; a ledger newer than the build is refused.
 */
export const openExistingLedger = (root: string): DatabaseSync | undefined => {
    const file = ledgerPath(root)
    if (file === undefined) return undefined
    const db = connect(file)
    try {
        const recorded = metaVersion(db)
        if (recorded > LEDGER_VERSION) {
            throw new Refusal("LEDGER_NEWER", `${file} is ledger version ${String(recorded)}, newer than this build's ${String(LEDGER_VERSION)}; update the harness (cd cli && npm run build) before using it`)
        }
        db.exec(SCHEMA)
        migrate(db)
    } catch (error: unknown) {
        db.close()
        throw error
    }
    return db
}

/** The current time as the ledger stores it. */
export const now = (): string => new Date().toISOString()

/**
 * Runs `work` atomically. Outside a transaction it takes the write lock up front (BEGIN IMMEDIATE), so a read
 * followed by a write cannot lose a race to another seat; inside one it nests as a savepoint.
 */
export const inTransaction = <T>(db: DatabaseSync, work: () => T): T => {
    const nested = db.isTransaction
    db.exec(nested ? "SAVEPOINT starci_tx" : "BEGIN IMMEDIATE")
    try {
        const value = work()
        db.exec(nested ? "RELEASE starci_tx" : "COMMIT")
        return value
    } catch (error: unknown) {
        db.exec(nested ? "ROLLBACK TO starci_tx; RELEASE starci_tx" : "ROLLBACK")
        throw error
    }
}
