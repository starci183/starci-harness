import { OutboxError, OutboxErrorCode } from "./errors.ts"

/** The SQL type of the scope column: `text` (any key) or `uuid` (a key the app can reference from its own table). */
export type ScopeType = "text" | "uuid"

/** Where the four tables live and what a scope is; every name is a plain lower-case identifier. */
export interface OutboxTables {
    /** The schema; `public` by default. */
    readonly schema?: string
    /** The job table; `outbox_jobs` by default. */
    readonly jobs?: string
    /** The concurrency slots; `outbox_slots` by default. */
    readonly slots?: string
    /** The keyed timers; `outbox_timers` by default. */
    readonly timers?: string
    /** The events a client follows (job notifications and the app's own); `outbox_events` by default. */
    readonly events?: string
    /** The type of `scope`; `text` by default. */
    readonly scopeType?: ScopeType
}

/** The resolved names: each one quoted and schema-qualified, ready for SQL, plus the bare names for constraints, lock keys and the channel. */
export interface ResolvedTables {
    readonly jobs: string
    readonly slots: string
    readonly timers: string
    readonly events: string
    readonly bare: { readonly schema: string; readonly jobs: string; readonly slots: string; readonly timers: string; readonly events: string }
    /** The slot table's foreign key to the job table: `<jobs singular>_id` (`outbox_job_id`), the key rule of BE-PERSISTENCE-20. */
    readonly jobRef: string
    /** The `LISTEN` channel the events of these tables are announced on, one per schema and table. */
    readonly channel: string
    readonly scopeType: ScopeType
}

const SCOPE_TYPES: readonly string[] = ["text", "uuid"]

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,47}$/u

/** The words the singular rule leaves as they are: they end in s and are singular already (`status`, `address`, `analysis`). */
const SINGULAR_ALREADY = /(?:ss|us|is)$/u

const identifier = (value: string, what: string): string => {
    if (!IDENTIFIER.test(value)) throw new OutboxError({ code: OutboxErrorCode.OptionsInvalid, params: { option: what, value } })
    return value
}

const singularWord = (word: string): string => {
    if (SINGULAR_ALREADY.test(word)) return word
    if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`
    if (/(?:sses|xes|ches|shes)$/u.test(word)) return word.slice(0, -2)
    return word.endsWith("s") ? word.slice(0, -1) : word
}

/**
 * The singular of a table name by the fixed rule set of BE-PERSISTENCE-20 on its last `_` word: `outbox_jobs` outbox_job, `entries`
 * entry, `boxes` box; a word in `ss`, `us` or `is` stays.
 */
export const tableSingular = (table: string): string => {
    const words = table.split("_")
    const last = words.pop() ?? table
    return [...words, singularWord(last)].join("_")
}

/** Resolves and checks the table names; a name that is no plain identifier is refused `OUTBOX_OPTIONS_INVALID`. */
export const resolveTables = (tables: OutboxTables = {}): ResolvedTables => {
    const schema = identifier(tables.schema ?? "public", "schema")
    const jobs = identifier(tables.jobs ?? "outbox_jobs", "jobs")
    const slots = identifier(tables.slots ?? "outbox_slots", "slots")
    const timers = identifier(tables.timers ?? "outbox_timers", "timers")
    const events = identifier(tables.events ?? "outbox_events", "events")
    const scopeType = tables.scopeType ?? "text"
    if (!SCOPE_TYPES.includes(scopeType)) throw new OutboxError({ code: OutboxErrorCode.OptionsInvalid, params: { option: "scopeType", value: scopeType } })
    const qualify = (name: string): string => `"${schema}"."${name}"`
    return {
        jobs: qualify(jobs),
        slots: qualify(slots),
        timers: qualify(timers),
        events: qualify(events),
        bare: { schema, jobs, slots, timers, events },
        jobRef: `${tableSingular(jobs)}_id`,
        channel: `outbox:${schema}.${events}`,
        scopeType,
    }
}

/** What the DDL adds beside the tables. */
export interface OutboxDdlOptions extends OutboxTables {
    /** A role granted select, insert, update and delete on the tables (the app's runtime role); none by default. */
    readonly grantTo?: string
}

/** The job states a notification may be asked for. */
export const NOTIFY_STATES = ["claimed", "done", "failed", "parked"] as const

const notifyStatesSql = NOTIFY_STATES.map((state) => `'${state}'`).join(", ")

/** The notification columns of the job table, the topic its state changes are published on and which of them, and their check. */
const notifyColumns: readonly string[] = [
    `notify_topic text check (notify_topic <> '')`,
    `notify_on text[] check (notify_on <@ array[${notifyStatesSql}]::text[])`,
]

const notifyCheck = (t: ResolvedTables): string =>
    `constraint ${t.bare.jobs}_notify_check check ((notify_topic is null) = (notify_on is null) and (notify_topic is null or scope is not null))`

const jobsTable = (t: ResolvedTables): readonly string[] => {
    const { jobs } = t.bare
    return [
        `create table ${t.jobs} (`,
        `    id uuid primary key default gen_random_uuid(),`,
        `    scope ${t.scopeType},`,
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
        ...notifyColumns.map((column) => `    ${column},`),
        `    ${notifyCheck(t)},`,
        `    constraint ${jobs}_once_key_key unique (once_key)`,
        `);`,
        `create index ${jobs}_due_idx on ${t.jobs} (not_before) where state = 'queued';`,
        `create index ${jobs}_lease_idx on ${t.jobs} (lease_until) where state = 'running';`,
        `create index ${jobs}_parked_idx on ${t.jobs} (parked_at) where state = 'parked';`,
        `create index ${jobs}_finished_idx on ${t.jobs} (finished_at) where state in ('done', 'closed');`,
    ]
}

const eventsTable = (t: ResolvedTables): readonly string[] => {
    const { events } = t.bare
    return [
        `create table ${t.events} (`,
        `    id uuid primary key default gen_random_uuid(),`,
        `    seq bigint generated always as identity,`,
        `    scope ${t.scopeType} not null,`,
        `    topic text not null check (topic <> ''),`,
        `    type text not null check (type <> ''),`,
        `    data jsonb not null default '{}'::jsonb,`,
        `    created_at timestamptz not null default now(),`,
        `    constraint ${events}_seq_key unique (seq)`,
        `);`,
        `create index ${events}_scope_seq_idx on ${t.events} (scope, seq);`,
        `create index ${events}_created_idx on ${t.events} (created_at);`,
    ]
}

const grant = (options: OutboxDdlOptions, tables: readonly string[]): readonly string[] => {
    if (options.grantTo === undefined) return []
    const role = identifier(options.grantTo, "grantTo")
    return [``, `grant select, insert, update, delete on table ${tables.join(", ")} to "${role}";`]
}

/**
 * The DDL of the outbox: the forward-only migration an app copies into its own migrations (or renders with its names), the contract
 * every statement of the package reads. `gen_random_uuid()` is a built-in from PostgreSQL 13. Row level security, a foreign key from
 * `scope` to the app's own table and the retention of finished jobs are the app's, added in its own migration.
 */
export const outboxDdl = (options: OutboxDdlOptions = {}): string => {
    const t = resolveTables(options)
    const { slots, timers } = t.bare
    const lines = [
        `-- @starci/outbox: the job outbox, its concurrency slots, its keyed timers and the events clients follow (forward-only).`,
        `-- A job is enqueued in the caller's transaction and kept once by its once key; a claim locks due rows skip-locked and takes a free`,
        `-- slot of its (queue, scope) under advisory locks taken in one sorted order; every claim bumps the fence that guards each later write.`,
        `-- An event is written in the caller's transaction under the advisory lock of its scope, so the events of one scope commit in seq order.`,
        ...jobsTable(t),
        ``,
        `create table ${t.slots} (`,
        `    id uuid primary key default gen_random_uuid(),`,
        `    queue text not null,`,
        `    scope ${t.scopeType} not null,`,
        `    slot integer not null check (slot >= 0),`,
        `    ${t.jobRef} uuid constraint ${slots}_${t.jobRef}_fkey references ${t.jobs} (id) on delete set null,`,
        `    lease_until timestamptz,`,
        `    constraint ${slots}_queue_scope_slot_key unique (queue, scope, slot)`,
        `);`,
        `create index ${slots}_${t.jobRef}_idx on ${t.slots} (${t.jobRef}) where ${t.jobRef} is not null;`,
        ``,
        `create table ${t.timers} (`,
        `    id uuid primary key default gen_random_uuid(),`,
        `    scope ${t.scopeType},`,
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
        ``,
        ...eventsTable(t),
        ...grant(options, [t.jobs, t.slots, t.timers, t.events]),
    ]
    return `${lines.join("\n")}\n`
}

/**
 * The upgrade of a database on 0.1.0 to 0.2.0, one `*_contract_*` migration (BE-PERSISTENCE-19: it replaces the slot table's key and
 * renames a column): `outbox_slots` takes the key `id uuid` with its natural key `(queue, scope, slot)` unique beside it and `job_id`
 * becomes `outbox_job_id` with its index (BE-PERSISTENCE-20); `outbox_jobs` gains the notification columns; `outbox_events` is created.
 * Every job, slot and timer is kept. Rendered with the same options as `outboxDdl`, so an app that renamed its tables upgrades them.
 */
export const outboxUpgradeDdl = (options: OutboxDdlOptions = {}): string => {
    const t = resolveTables(options)
    const { schema, slots } = t.bare
    const added = [...notifyColumns.map((column) => `add column ${column}`), `add ${notifyCheck(t)}`]
    const lines = [
        `-- @starci/outbox 0.1.0 -> 0.2.0 (contract): the slot table takes the key \`id uuid\` with its natural key unique beside it and its`,
        `-- foreign key \`job_id\` becomes \`${t.jobRef}\` with its index; the job table gains its notification columns; the events table is`,
        `-- created. Every job, slot and timer is kept. Run it while no 0.1.0 worker claims: a 0.1.0 worker writes \`job_id\`.`,
        `alter table ${t.slots} add column id uuid not null default gen_random_uuid();`,
        `alter table ${t.slots} drop constraint ${slots}_pkey;`,
        `alter table ${t.slots} add constraint ${slots}_pkey primary key (id);`,
        `alter table ${t.slots} add constraint ${slots}_queue_scope_slot_key unique (queue, scope, slot);`,
        `alter table ${t.slots} rename column job_id to ${t.jobRef};`,
        `alter table ${t.slots} rename constraint ${slots}_job_id_fkey to ${slots}_${t.jobRef}_fkey;`,
        `drop index "${schema}"."${slots}_job_idx";`,
        `create index ${slots}_${t.jobRef}_idx on ${t.slots} (${t.jobRef}) where ${t.jobRef} is not null;`,
        ``,
        `alter table ${t.jobs}`,
        ...added.map((clause, index) => `    ${clause}${index === added.length - 1 ? ";" : ","}`),
        ``,
        ...eventsTable(t),
        ...grant(options, [t.events]),
    ]
    return `${lines.join("\n")}\n`
}
