-- @starci/outbox 0.1.0 -> 0.2.0 (contract): the slot table takes the key `id uuid` with its natural key unique beside it and its
-- foreign key `job_id` becomes `outbox_job_id` with its index; the job table gains its notification columns; the events table is
-- created. Every job, slot and timer is kept. Run it while no 0.1.0 worker claims: a 0.1.0 worker writes `job_id`.
alter table "public"."outbox_slots" add column id uuid not null default gen_random_uuid();
alter table "public"."outbox_slots" drop constraint outbox_slots_pkey;
alter table "public"."outbox_slots" add constraint outbox_slots_pkey primary key (id);
alter table "public"."outbox_slots" add constraint outbox_slots_queue_scope_slot_key unique (queue, scope, slot);
alter table "public"."outbox_slots" rename column job_id to outbox_job_id;
alter table "public"."outbox_slots" rename constraint outbox_slots_job_id_fkey to outbox_slots_outbox_job_id_fkey;
drop index "public"."outbox_slots_job_idx";
create index outbox_slots_outbox_job_id_idx on "public"."outbox_slots" (outbox_job_id) where outbox_job_id is not null;

alter table "public"."outbox_jobs"
    add column notify_topic text check (notify_topic <> ''),
    add column notify_on text[] check (notify_on <@ array['claimed', 'done', 'failed', 'parked']::text[]),
    add constraint outbox_jobs_notify_check check ((notify_topic is null) = (notify_on is null) and (notify_topic is null or scope is not null));

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
