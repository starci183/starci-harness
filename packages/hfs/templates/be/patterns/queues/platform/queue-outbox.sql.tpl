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

-- The outbox write, the relay's locked read of the waiting rows and its mark, called through callDbFunction of platform/database
-- (R334). The read locks the rows it returns for the caller's transaction and skips rows another relay holds.
create function public.queue_write(p_queue varchar, p_payload jsonb, p_created_at timestamptz, p_correlation_id varchar)
returns void
language sql
as $$
    insert into public.queue (queue, payload, created_at, correlation_id) values (p_queue, p_payload, p_created_at, p_correlation_id)
$$;

create function public.queue_waiting(p_batch integer)
returns table (id uuid, queue varchar, payload jsonb, "correlationId" varchar)
language sql
as $$
    select q.id, q.queue, q.payload, coalesce(q.correlation_id, q.id::text)
      from public.queue as q
     where q.sent_at is null
     order by q.created_at, q.id
     limit p_batch
       for update skip locked
$$;

create function public.queue_mark_sent(p_ids uuid[], p_sent_at timestamptz)
returns void
language sql
as $$
    update public.queue set sent_at = p_sent_at where id = any(p_ids)
$$;

revoke all on function public.queue_write(varchar, jsonb, timestamptz, varchar) from public;
grant execute on function public.queue_write(varchar, jsonb, timestamptz, varchar) to app_be;
revoke all on function public.queue_waiting(integer) from public;
grant execute on function public.queue_waiting(integer) to app_be;
revoke all on function public.queue_mark_sent(uuid[], timestamptz) from public;
grant execute on function public.queue_mark_sent(uuid[], timestamptz) to app_be;
