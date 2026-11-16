-- @starci/outbox: the job outbox, its concurrency slots, its keyed timers and the events clients follow (forward-only).
-- A job is enqueued in the caller's transaction and kept once by its once key; a claim locks due rows skip-locked and takes a free
-- slot of its (queue, scope) under advisory locks taken in one sorted order; every claim bumps the fence that guards each later write.
-- An event is written in the caller's transaction under the advisory lock of its scope, so the events of one scope commit in seq order.
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
    notify_topic text check (notify_topic <> ''),
    notify_on text[] check (notify_on <@ array['claimed', 'done', 'failed', 'parked']::text[]),
    constraint outbox_jobs_notify_check check ((notify_topic is null) = (notify_on is null) and (notify_topic is null or scope is not null)),
    constraint outbox_jobs_once_key_key unique (once_key)
);
create index outbox_jobs_due_idx on "public"."outbox_jobs" (not_before) where state = 'queued';
create index outbox_jobs_lease_idx on "public"."outbox_jobs" (lease_until) where state = 'running';
create index outbox_jobs_parked_idx on "public"."outbox_jobs" (parked_at) where state = 'parked';
create index outbox_jobs_finished_idx on "public"."outbox_jobs" (finished_at) where state in ('done', 'closed');

create table "public"."outbox_slots" (
    id uuid primary key default gen_random_uuid(),
    queue text not null,
    scope text not null,
    slot integer not null check (slot >= 0),
    outbox_job_id uuid constraint outbox_slots_outbox_job_id_fkey references "public"."outbox_jobs" (id) on delete set null,
    lease_until timestamptz,
    constraint outbox_slots_queue_scope_slot_key unique (queue, scope, slot)
);
create index outbox_slots_outbox_job_id_idx on "public"."outbox_slots" (outbox_job_id) where outbox_job_id is not null;

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

create table "public"."outbox_events" (
    id uuid primary key default gen_random_uuid(),
    seq bigint generated always as identity,
    scope text not null,
    topic text not null check (topic <> ''),
    type text not null check (type <> ''),
    data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    constraint outbox_events_seq_key unique (seq)
);
create index outbox_events_scope_seq_idx on "public"."outbox_events" (scope, seq);
create index outbox_events_created_idx on "public"."outbox_events" (created_at);
