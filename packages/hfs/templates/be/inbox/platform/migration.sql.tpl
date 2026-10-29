-- The claim and the receipt event share the intake transaction; a consumer reads the event from its pgmq queue after commit.
create table public.inbox (
    source text not null check (source <> ''),
    event_id text not null check (event_id <> ''),
    claimed_at timestamptz not null default now(),
    primary key (source, event_id)
);

alter table public.inbox enable row level security;
alter table public.inbox force row level security;

create policy "inbox_app_be_select"
on public.inbox for select to app_be
using (source <> '');

create policy "inbox_app_be_insert"
on public.inbox for insert to app_be
with check (source <> '');

revoke all on table public.inbox from public, anon, authenticated;
grant select, insert on table public.inbox to app_be;

-- The event bus is pgmq (ruling lite-pgmq-bus-bullmq-jobs; it installs into its own schema pgmq): a publish sends the typed envelope
-- once to its topic, the event name, in the publisher's own transaction, and pgmq copies it into every consumer queue bound to that
-- name, so a rolled-back change sends nothing and no relay runs. A reactor's migration declares its consumer: pgmq.create of
-- '<topic>__<consumer>' and of its dead-letter queue '<topic>__<consumer>__dead', then pgmq.bind_topic('<topic>', '<topic>__<consumer>')
-- (R258). Each consumer reads its own queue with a visibility timeout, archives a handled message, and moves one past its
-- maxDeliveries to its dead-letter queue.
create extension if not exists pgmq;

-- The claim of one delivery and the bus operations, called through callDbFunction of platform/database (R334). The bus functions are
-- security definer over pgmq, so the application role holds no grant on the pgmq schema; a read names only a queue bound to a topic.
create function public.inbox_claim_event(p_source text, p_event_id text)
returns table (event_id text)
language sql
as $$
    insert into public.inbox as i (source, event_id) values (p_source, p_event_id)
    on conflict (source, event_id) do nothing
    returning i.event_id
$$;

create function public.event_bus_send(p_event_name text, p_envelope jsonb)
returns integer
language sql
security definer
set search_path = pg_catalog, pg_temp
as $$
    select pgmq.send_topic(p_event_name, p_envelope)
$$;

create function public.event_bus_read(p_queue text, p_visibility_seconds integer, p_batch integer)
returns table (msg_id bigint, read_ct integer, message jsonb)
language sql
security definer
set search_path = pg_catalog, pg_temp
as $$
    select m.msg_id, m.read_ct, m.message
      from (select distinct b.queue_name from pgmq.topic_bindings as b where b.queue_name = p_queue) as bound
     cross join lateral pgmq.read(bound.queue_name, p_visibility_seconds, p_batch) as m
$$;

create function public.event_bus_archive(p_queue text, p_msg_id bigint)
returns boolean
language sql
security definer
set search_path = pg_catalog, pg_temp
as $$
    select pgmq.archive(p_queue, p_msg_id)
$$;

create function public.event_bus_bury(p_queue text, p_msg_id bigint, p_read_ct integer, p_message jsonb, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
    if not exists (select 1 from pgmq.topic_bindings as b where b.queue_name = p_queue) then
        raise exception 'event_bus_bury: % is no consumer queue bound to a topic', p_queue;
    end if;
    perform pgmq.send(p_queue || '__dead', jsonb_build_object('readCount', p_read_ct, 'reason', p_reason, 'message', p_message));
    return pgmq.archive(p_queue, p_msg_id);
end
$$;

create function public.event_bus_dead_letters(p_queue text, p_batch integer)
returns table (msg_id bigint, message jsonb)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
    if not exists (select 1 from pgmq.topic_bindings as b where b.queue_name = p_queue) then
        raise exception 'event_bus_dead_letters: % is no consumer queue bound to a topic', p_queue;
    end if;
    return query execute format('select d.msg_id, d.message from pgmq.%I as d order by d.msg_id limit $1', 'q_' || p_queue || '__dead') using p_batch;
end
$$;

create function public.event_bus_requeue(p_queue text, p_msg_id bigint)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
    v_dead jsonb;
begin
    if not exists (select 1 from pgmq.topic_bindings as b where b.queue_name = p_queue) then
        raise exception 'event_bus_requeue: % is no consumer queue bound to a topic', p_queue;
    end if;
    execute format('delete from pgmq.%I as d where d.msg_id = $1 returning d.message', 'q_' || p_queue || '__dead') into v_dead using p_msg_id;
    if v_dead is null then
        return false;
    end if;
    perform pgmq.send(p_queue, v_dead -> 'message');
    return true;
end
$$;

revoke all on function public.inbox_claim_event(text, text) from public;
grant execute on function public.inbox_claim_event(text, text) to app_be;
revoke all on function public.event_bus_send(text, jsonb) from public;
grant execute on function public.event_bus_send(text, jsonb) to app_be;
revoke all on function public.event_bus_read(text, integer, integer) from public;
grant execute on function public.event_bus_read(text, integer, integer) to app_be;
revoke all on function public.event_bus_archive(text, bigint) from public;
grant execute on function public.event_bus_archive(text, bigint) to app_be;
revoke all on function public.event_bus_bury(text, bigint, integer, jsonb, text) from public;
grant execute on function public.event_bus_bury(text, bigint, integer, jsonb, text) to app_be;
revoke all on function public.event_bus_dead_letters(text, integer) from public;
grant execute on function public.event_bus_dead_letters(text, integer) to app_be;
revoke all on function public.event_bus_requeue(text, bigint) from public;
grant execute on function public.event_bus_requeue(text, bigint) to app_be;
