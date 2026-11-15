import { OutboxError, OutboxErrorCode } from "./errors.ts"

/** The SQL type of the scope column: `text` (any key) or `uuid` (a key the app can reference from its own table). */
export type ScopeType = "text" | "uuid"

/** Where the three tables live and what a scope is; every name is a plain lower-case identifier. */
export interface OutboxTables {
    /** The schema; `public` by default. */
    readonly schema?: string
    /** The job table; `outbox_jobs` by default. */
    readonly jobs?: string
    /** The concurrency slots; `outbox_slots` by default. */
    readonly slots?: string
    /** The keyed timers; `outbox_timers` by default. */
    readonly timers?: string
    /** The type of `scope`; `text` by default. */
    readonly scopeType?: ScopeType
}

/** The resolved names: each one quoted and schema-qualified, ready for SQL, plus the bare names for constraints and lock keys. */
export interface ResolvedTables {
    readonly jobs: string
    readonly slots: string
    readonly timers: string
    readonly bare: { readonly schema: string; readonly jobs: string; readonly slots: string; readonly timers: string }
    readonly scopeType: ScopeType
}

const SCOPE_TYPES: readonly string[] = ["text", "uuid"]

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,47}$/u

const identifier = (value: string, what: string): string => {
    if (!IDENTIFIER.test(value)) throw new OutboxError({ code: OutboxErrorCode.OptionsInvalid, params: { option: what, value } })
    return value
}

/** Resolves and checks the table names; a name that is no plain identifier is refused `OUTBOX_OPTIONS_INVALID`. */
export const resolveTables = (tables: OutboxTables = {}): ResolvedTables => {
    const schema = identifier(tables.schema ?? "public", "schema")
    const jobs = identifier(tables.jobs ?? "outbox_jobs", "jobs")
    const slots = identifier(tables.slots ?? "outbox_slots", "slots")
    const timers = identifier(tables.timers ?? "outbox_timers", "timers")
    const scopeType = tables.scopeType ?? "text"
    if (!SCOPE_TYPES.includes(scopeType)) throw new OutboxError({ code: OutboxErrorCode.OptionsInvalid, params: { option: "scopeType", value: scopeType } })
    const qualify = (name: string): string => `"${schema}"."${name}"`
    return { jobs: qualify(jobs), slots: qualify(slots), timers: qualify(timers), bare: { schema, jobs, slots, timers }, scopeType }
}

/** What the DDL adds beside the tables. */
export interface OutboxDdlOptions extends OutboxTables {
    /** A role granted select, insert, update and delete on the three tables (the app's runtime role); none by default. */
    readonly grantTo?: string
}

/**
 * The DDL of the outbox: the forward-only migration an app copies into its own migrations (or renders with its names), the contract
 * every statement of the package reads. `gen_random_uuid()` is a built-in from PostgreSQL 13. Row level security, a foreign key from
 * `scope` to the app's own table and the retention of finished rows are the app's, added in its own migration.
 */
export const outboxDdl = (options: OutboxDdlOptions = {}): string => {
    const t = resolveTables(options)
    const { jobs, slots, timers } = t.bare
    const scope = t.scopeType
    const lines = [
        `-- @starci/outbox: the job outbox, its concurrency slots and its keyed timers (forward-only).`,
        `-- A job is enqueued in the caller's transaction and kept once by its once key; a claim locks due rows skip-locked and takes a free`,
        `-- slot of its (queue, scope) under advisory locks taken in one sorted order; every claim bumps the fence that guards each later write.`,
        `create table ${t.jobs} (`,
        `    id uuid primary key default gen_random_uuid(),`,
        `    scope ${scope},`,
        `    queue text not null check (queue <> ''),`,
        `    name text not null check (name <> ''),`,
        `    payload jsonb not null default '{}'::jsonb,`,
        `    once_key text not null check (position(':' in once_key) > 0),`,
        `    state text not null default 'queued' check (state in ('queued', 'running', 'done', 'parked', 'closed')),`,
        `    attempts integer not null default 0 check (attempts >= 0),`,
        `    fence bigint not null default 0,`,
        `    not_before timestamptz not null default now(),`,
        `    lease_until timestamptz,`,
        `    claimed_by text,`,
        `    last_error text,`,
        `    failure_class text check (failure_class in ('transient', 'input', 'code', 'config')),`,
        `    park_reason text check (park_reason in ('class', 'exhausted')),`,
        `    parked_at timestamptz,`,
        `    parked_build text,`,
        `    alerted_at timestamptz,`,
        `    resume_count integer not null default 0,`,
        `    created_at timestamptz not null default now(),`,
        `    finished_at timestamptz,`,
        `    constraint ${jobs}_once_key_key unique (once_key)`,
        `);`,
        `create index ${jobs}_due_idx on ${t.jobs} (not_before) where state = 'queued';`,
        `create index ${jobs}_lease_idx on ${t.jobs} (lease_until) where state = 'running';`,
        `create index ${jobs}_parked_idx on ${t.jobs} (parked_at) where state = 'parked';`,
        `create index ${jobs}_finished_idx on ${t.jobs} (finished_at) where state in ('done', 'closed');`,
        ``,
        `create table ${t.slots} (`,
        `    queue text not null,`,
        `    scope ${scope} not null,`,
        `    slot integer not null check (slot >= 0),`,
        `    job_id uuid references ${t.jobs} (id) on delete set null,`,
        `    lease_until timestamptz,`,
        `    primary key (queue, scope, slot)`,
        `);`,
        `create index ${slots}_job_idx on ${t.slots} (job_id) where job_id is not null;`,
        ``,
        `create table ${t.timers} (`,
        `    id uuid primary key default gen_random_uuid(),`,
        `    scope ${scope},`,
        `    key text not null check (key <> ''),`,
        `    due_at timestamptz not null,`,
        `    queue text not null check (queue <> ''),`,
        `    name text not null check (name <> ''),`,
        `    payload jsonb not null default '{}'::jsonb,`,
        `    fired_at timestamptz,`,
        `    cancelled_at timestamptz,`,
        `    created_at timestamptz not null default now()`,
        `);`,
        `create unique index ${timers}_open_key on ${t.timers} ((coalesce(scope::text, '')), key) where fired_at is null and cancelled_at is null;`,
        `create index ${timers}_due_idx on ${t.timers} (due_at) where fired_at is null and cancelled_at is null;`,
    ]
    if (options.grantTo !== undefined) {
        const role = identifier(options.grantTo, "grantTo")
        lines.push(``, `grant select, insert, update, delete on table ${t.jobs}, ${t.slots}, ${t.timers} to "${role}";`)
    }
    return `${lines.join("\n")}\n`
}
