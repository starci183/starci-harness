import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { captureToolSync } from "../shared/exec.js"

/** The ledger schema version this build writes. */
export const LEDGER_VERSION = 1

/**
 * The ten tables of the harness ledger. Status rules live in the code's one state machine, not in triggers;
 * the tables only keep facts (contracts and results are immutable once written).
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
CREATE TABLE IF NOT EXISTS provider_health (
  provider TEXT PRIMARY KEY, status TEXT NOT NULL, strikes INTEGER NOT NULL DEFAULT 0,
  failure_kind TEXT, circuit_open_until TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL,
  subject TEXT, data_json TEXT NOT NULL);
`

/** The project's work folder, which holds its ledger. */
export const WORK_DIR = ".starciwork"

interface Project {
    readonly root: string
    readonly commonDir: string | undefined
}

const projects = new Map<string, Project>()

// Every linked worktree shares the main checkout's git common dir, so it shares that checkout's work folder too;
// a worktree opening a ledger of its own would see none of the project's tasks.
const projectOf = (root: string): Project => {
    const key = resolve(root)
    const known = projects.get(key)
    if (known !== undefined) return known
    let project: Project = { root: key, commonDir: undefined }
    const dirs = captureToolSync("git", ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"], key)
    const [gitDir, commonDir] = dirs.stdout.split("\n").map((line) => line.trim())
    if (dirs.exitCode === 0 && gitDir !== undefined && commonDir !== undefined && commonDir !== "") {
        if (resolve(gitDir) === resolve(commonDir)) {
            project = { root: key, commonDir: resolve(commonDir) }
        } else {
            // The first entry of the worktree list is the main checkout (the repository itself when it is bare).
            const main = /^worktree (.+)$/m.exec(captureToolSync("git", ["worktree", "list", "--porcelain"], key).stdout)?.[1]
            project = { root: main === undefined ? dirname(resolve(commonDir)) : resolve(main.trim()), commonDir: resolve(commonDir) }
        }
    }
    projects.set(key, project)
    return project
}

/** The project a repository checkout belongs to: the main checkout for a linked worktree, else the checkout itself. */
export const projectRoot = (root: string): string => projectOf(root).root

/** The ledger of a project: <project>/.starciwork/runtime.sqlite, one per project and shared by its linked worktrees, never committed. */
export const ledgerPath = (root: string): string => join(projectRoot(root), WORK_DIR, "runtime.sqlite")

const WORK_DIR_LINES = [WORK_DIR, `${WORK_DIR}/`, `/${WORK_DIR}`, `/${WORK_DIR}/`]

// The work folder holds briefs, contract copies, outputs and the ledger; untracked, it would turn every files check red,
// so it is excluded locally (info/exclude is never committed) unless the repository already ignores it.
const excluded = new Set<string>()

const excludeWorkDir = (project: Project): void => {
    if (project.commonDir === undefined || excluded.has(project.root)) return
    excluded.add(project.root)
    if (captureToolSync("git", ["check-ignore", "-q", "--no-index", `${WORK_DIR}/`], project.root).exitCode === 0) return
    const exclude = join(project.commonDir, "info", "exclude")
    const current = existsSync(exclude) ? readFileSync(exclude, "utf8") : ""
    if (current.split(/\r?\n/).some((line) => WORK_DIR_LINES.includes(line.trim()))) return
    mkdirSync(dirname(exclude), { recursive: true })
    appendFileSync(exclude, `${current === "" || current.endsWith("\n") ? "" : "\n"}/${WORK_DIR}/\n`)
}

/** Creates the project's work folder, excluded from git locally, and returns its path. */
export const ensureWorkDir = (root: string): string => {
    const project = projectOf(root)
    const dir = join(project.root, WORK_DIR)
    mkdirSync(dir, { recursive: true })
    excludeWorkDir(project)
    return dir
}

const connect = (file: string): DatabaseSync => {
    // The busy timeout must hold before the WAL switch, or a concurrent open fails with "database is locked".
    const db = new DatabaseSync(file, { timeout: 5000 })
    db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
    return db
}

/** Opens (and creates or migrates) the project's ledger, with WAL and a busy timeout for concurrent seats. */
export const openLedger = (root: string): DatabaseSync => {
    ensureWorkDir(root)
    const db = connect(ledgerPath(root))
    db.exec(SCHEMA)
    db.prepare("INSERT INTO meta (key, value) VALUES ('version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(LEDGER_VERSION))
    return db
}

/** Opens the project's ledger only when it exists, creating and migrating nothing; for reads that must leave no ledger behind. */
export const openExistingLedger = (root: string): DatabaseSync | undefined => {
    const file = ledgerPath(root)
    return existsSync(file) ? connect(file) : undefined
}

/** The current time as the ledger stores it. */
export const now = (): string => new Date().toISOString()
