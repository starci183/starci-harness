-- The outbox of the queues: a producer's business transaction writes one row here, so the job exists exactly when
-- the change commits; the relay hands each unsent row to BullMQ on the declared Redis with the row id as the job id
-- and the correlation id of the request that wrote it.
create table public.queue (
    id uuid primary key default gen_random_uuid(),
    queue varchar(200) not null,
    payload jsonb not null,
    created_at timestamptz not null,
    sent_at timestamptz,
    correlation_id varchar(128) not null
);

create index queue_unsent_idx on public.queue (created_at, id) where sent_at is null;

alter table public.queue enable row level security;
alter table public.queue force row level security;

create policy queue_app_be_select
on public.queue for select to app_be
using (queue is not null);

create policy queue_app_be_insert
on public.queue for insert to app_be
with check (queue is not null);

create policy queue_app_be_update
on public.queue for update to app_be
using (queue is not null)
with check (queue is not null);

revoke all on table public.queue from public, anon, authenticated;
grant select, insert, update on table public.queue to app_be;
