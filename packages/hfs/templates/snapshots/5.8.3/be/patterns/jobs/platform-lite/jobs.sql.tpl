-- The fenced jobs: one row per delivery key. A claim bumps the fencing token and every
-- other write of a worker carries the token it holds, so a worker that lost its claim
-- changes nothing. Only the app_be connection reaches it.
create table public.jobs (
    id uuid primary key default gen_random_uuid(),
    kind varchar(200) not null,
    job_key varchar(200) not null,
    status varchar(16) not null,
    current_step varchar(200),
    fencing_token bigint not null,
    claimed_by varchar(200),
    lease_expires_at timestamptz,
    payload jsonb not null,
    error text,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    constraint jobs_job_key_key unique (job_key),
    constraint jobs_status_check check (status in ('running', 'failed', 'done')),
    constraint jobs_fencing_token_check check (fencing_token >= 1)
);

alter table public.jobs enable row level security;
alter table public.jobs force row level security;

create trigger jobs_set_updated_at
before update on public.jobs
for each row
execute function private.set_updated_at();

create policy jobs_app_be_select
on public.jobs for select to app_be
using (kind is not null);

create policy jobs_app_be_insert
on public.jobs for insert to app_be
with check (kind is not null);

create policy jobs_app_be_update
on public.jobs for update to app_be
using (kind is not null)
with check (kind is not null);

revoke all on table public.jobs from public, anon, authenticated;
grant select, insert, update on table public.jobs to app_be;

-- The claim and the guarded writes, called through callDbFunction of platform/database (R334). A claim inserts a new key with
-- token 1 or claims a failed or expired one again, bumping the token; a done job or a live claim returns no row. Every other
-- write matches only the token the caller holds, so a worker that lost its claim changes nothing and gets no row back.
create function public.job_claim(p_kind varchar, p_job_key varchar, p_worker varchar, p_lease_end timestamptz, p_payload jsonb, p_now timestamptz)
returns table (id uuid, kind varchar, fencing_token bigint, current_step varchar, payload jsonb)
language sql
as $$
    insert into public.jobs as j (kind, job_key, status, fencing_token, claimed_by, lease_expires_at, payload, created_at, updated_at)
    values (p_kind, p_job_key, 'running', 1, p_worker, p_lease_end, p_payload, p_now, p_now)
    on conflict (job_key) do update
       set fencing_token = j.fencing_token + 1, claimed_by = p_worker, lease_expires_at = p_lease_end, status = 'running', error = null, updated_at = p_now
     where j.status = 'failed' or (j.status = 'running' and j.lease_expires_at < p_now)
    returning j.id, j.kind, j.fencing_token, j.current_step, j.payload
$$;

create function public.job_advance(p_id uuid, p_token bigint, p_step varchar, p_now timestamptz)
returns table (id uuid)
language sql
as $$
    update public.jobs as j set current_step = p_step, updated_at = p_now
     where j.id = p_id and j.fencing_token = p_token and j.status = 'running'
    returning j.id
$$;

create function public.job_complete(p_id uuid, p_token bigint, p_now timestamptz)
returns table (id uuid)
language sql
as $$
    update public.jobs as j set status = 'done', lease_expires_at = null, updated_at = p_now
     where j.id = p_id and j.fencing_token = p_token and j.status = 'running'
    returning j.id
$$;

create function public.job_fail(p_id uuid, p_token bigint, p_reason text, p_now timestamptz)
returns table (id uuid)
language sql
as $$
    update public.jobs as j set status = 'failed', error = p_reason, lease_expires_at = null, updated_at = p_now
     where j.id = p_id and j.fencing_token = p_token and j.status = 'running'
    returning j.id
$$;

revoke all on function public.job_claim(varchar, varchar, varchar, timestamptz, jsonb, timestamptz) from public;
grant execute on function public.job_claim(varchar, varchar, varchar, timestamptz, jsonb, timestamptz) to app_be;
revoke all on function public.job_advance(uuid, bigint, varchar, timestamptz) from public;
grant execute on function public.job_advance(uuid, bigint, varchar, timestamptz) to app_be;
revoke all on function public.job_complete(uuid, bigint, timestamptz) from public;
grant execute on function public.job_complete(uuid, bigint, timestamptz) to app_be;
revoke all on function public.job_fail(uuid, bigint, text, timestamptz) from public;
grant execute on function public.job_fail(uuid, bigint, text, timestamptz) to app_be;

-- The scheduler ticks of platform/jobs (R335): one row per tick holds the last UTC minute it fired. Every replica's
-- @nestjs/schedule fires the tick; under advisoryXactLock('tick:<name>') job_tick_claim moves the row to the new minute and
-- answers claimed, so exactly one replica enqueues the tick's job per minute and a replica that comes later answers not claimed.
create table public.job_ticks (
    name varchar(200) not null,
    minute varchar(16) not null,
    constraint job_ticks_pkey primary key (name)
);

alter table public.job_ticks enable row level security;
alter table public.job_ticks force row level security;

create policy job_ticks_app_be_select
on public.job_ticks for select to app_be
using (name is not null);

create policy job_ticks_app_be_insert
on public.job_ticks for insert to app_be
with check (name is not null);

create policy job_ticks_app_be_update
on public.job_ticks for update to app_be
using (name is not null)
with check (name is not null);

revoke all on table public.job_ticks from public, anon, authenticated;
grant select, insert, update on table public.job_ticks to app_be;

create function public.job_tick_claim(p_name varchar, p_minute varchar)
returns table (claimed boolean)
language sql
as $$
    with moved as (
        insert into public.job_ticks as t (name, minute) values (p_name, p_minute)
        on conflict (name) do update set minute = excluded.minute
         where t.minute < excluded.minute
        returning true as claimed
    )
    select coalesce((select m.claimed from moved as m), false)
$$;

revoke all on function public.job_tick_claim(varchar, varchar) from public;
grant execute on function public.job_tick_claim(varchar, varchar) to app_be;
