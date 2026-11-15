-- @starci/outbox: the job outbox, its concurrency slots and its keyed timers (forward-only).
-- A job is enqueued in the caller's transaction and kept once by its once key; a claim locks due rows skip-locked and takes a free
-- slot of its (queue, scope) under advisory locks taken in one sorted order; every claim bumps the fence that guards each later write.
create table "public"."outbox_jobs" (
    id uuid primary key default gen_random_uuid(),
    scope text,
    queue text not null check (queue <> ''),
    name text not null check (name <> ''),
    payload jsonb not null default '{}'::jsonb,
    once_key text not null check (position(':' in once_key) > 0),
    state text not null default 'queued' check (state in ('queued', 'running', 'done', 'parked', 'closed')),
    attempts integer not null default 0 check (attempts >= 0),
    fence bigint not null default 0,
    not_before timestamptz not null default now(),
    lease_until timestamptz,
    claimed_by text,
    last_error text,
    failure_class text check (failure_class in ('transient', 'input', 'code', 'config')),
    park_reason text check (park_reason in ('class', 'exhausted')),
    parked_at timestamptz,
    parked_build text,
    alerted_at timestamptz,
    resume_count integer not null default 0,
    created_at timestamptz not null default now(),
    finished_at timestamptz,
    constraint outbox_jobs_once_key_key unique (once_key)
);
create index outbox_jobs_due_idx on "public"."outbox_jobs" (not_before) where state = 'queued';
create index outbox_jobs_lease_idx on "public"."outbox_jobs" (lease_until) where state = 'running';
create index outbox_jobs_parked_idx on "public"."outbox_jobs" (parked_at) where state = 'parked';
create index outbox_jobs_finished_idx on "public"."outbox_jobs" (finished_at) where state in ('done', 'closed');

create table "public"."outbox_slots" (
    queue text not null,
    scope text not null,
    slot integer not null check (slot >= 0),
    job_id uuid references "public"."outbox_jobs" (id) on delete set null,
    lease_until timestamptz,
    primary key (queue, scope, slot)
);
create index outbox_slots_job_idx on "public"."outbox_slots" (job_id) where job_id is not null;

create table "public"."outbox_timers" (
    id uuid primary key default gen_random_uuid(),
    scope text,
    key text not null check (key <> ''),
    due_at timestamptz not null,
    queue text not null check (queue <> ''),
    name text not null check (name <> ''),
    payload jsonb not null default '{}'::jsonb,
    fired_at timestamptz,
    cancelled_at timestamptz,
    created_at timestamptz not null default now()
);
create unique index outbox_timers_open_key on "public"."outbox_timers" ((coalesce(scope::text, '')), key) where fired_at is null and cancelled_at is null;
create index outbox_timers_due_idx on "public"."outbox_timers" (due_at) where fired_at is null and cancelled_at is null;
