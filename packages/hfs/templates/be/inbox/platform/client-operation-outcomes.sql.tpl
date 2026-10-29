-- Extend the one shared inbox; provider and broker claims keep null client fields.
alter table public.inbox
    add column request_fingerprint varchar(64),
    add column outcome jsonb;

create index inbox_client_retention_idx on public.inbox (claimed_at, source, event_id)
where source like 'client:%' and request_fingerprint is not null and outcome is not null;

create policy "inbox_app_be_update"
on public.inbox for update to app_be
using (source like 'client:%')
with check (source like 'client:%');

create policy "inbox_app_be_delete"
on public.inbox for delete to app_be
using (source like 'client:%' and request_fingerprint is not null and outcome is not null);

grant update, delete on table public.inbox to app_be;

-- The client claim, its saved outcome and the bounded retention sweep, called through callDbFunction of platform/database (R334).
-- A conflicting claim locks the existing row and returns its committed fingerprint and outcome after the winner commits.
create function public.inbox_claim_client(p_source text, p_event_id text, p_fingerprint varchar, p_claimed_at timestamptz)
returns table (request_fingerprint varchar, outcome jsonb, incomplete boolean)
language sql
as $$
    insert into public.inbox as i (source, event_id, request_fingerprint, claimed_at)
    values (p_source, p_event_id, p_fingerprint, p_claimed_at)
    on conflict (source, event_id) do update set outcome = coalesce(i.outcome, '{}'::jsonb)
    returning i.request_fingerprint, i.outcome,
        (i.outcome is not null and (jsonb_typeof(i.outcome) <> 'object' or not (i.outcome ? 'value')))
$$;

create function public.inbox_save_client_outcome(p_source text, p_event_id text, p_outcome jsonb)
returns table (outcome jsonb)
language sql
as $$
    update public.inbox as i set outcome = p_outcome
     where i.source = p_source and i.event_id = p_event_id
    returning i.outcome
$$;

-- Retention never deletes delivery rows or an incomplete claim; its bounded batch skips rows held by active retries.
create function public.inbox_sweep_clients(p_cutoff timestamptz, p_limit integer)
returns table (deleted_count integer)
language sql
as $$
    with expired as (
        select source, event_id from public.inbox
         where source like 'client:%' and request_fingerprint is not null and outcome is not null
           and jsonb_typeof(outcome) = 'object' and outcome ? 'value' and claimed_at < p_cutoff
         order by claimed_at, source, event_id limit p_limit for update skip locked
    ), deleted as (
        delete from public.inbox as claims using expired
         where claims.source = expired.source and claims.event_id = expired.event_id
        returning claims.event_id
    )
    select count(*)::integer from deleted
$$;

revoke all on function public.inbox_claim_client(text, text, varchar, timestamptz) from public;
grant execute on function public.inbox_claim_client(text, text, varchar, timestamptz) to app_be;
revoke all on function public.inbox_save_client_outcome(text, text, jsonb) from public;
grant execute on function public.inbox_save_client_outcome(text, text, jsonb) to app_be;
revoke all on function public.inbox_sweep_clients(timestamptz, integer) from public;
grant execute on function public.inbox_sweep_clients(timestamptz, integer) to app_be;
