-- jobs-failed-awaiting-fix: forward-only. A job a retry cannot fix parks as failed_awaiting_fix with its class, the build it ran
-- under and its one alert, and is resumed at a new build, by the sweep or on demand (contexts/code/be/resilience.md BE-RESILIENCE-2).
-- Expand only: widen the status, add nullable columns and a defaulted counter, replace the claim so it takes a parked row again.

alter table public.jobs alter column status type varchar(32);
alter table public.jobs drop constraint jobs_status_check;
alter table public.jobs add constraint jobs_status_check check (status in ('running', 'failed', 'failed_awaiting_fix', 'done'));
alter table public.jobs add column failure_class varchar(16);
alter table public.jobs add constraint jobs_failure_class_check check (failure_class in ('transient', 'input', 'code', 'config'));
alter table public.jobs add column parked_build varchar(200);
alter table public.jobs add column parked_at timestamptz;
alter table public.jobs add column alerted_at timestamptz;
alter table public.jobs add column resume_count integer not null default 0;

create or replace function public.job_claim(p_kind varchar, p_job_key varchar, p_worker varchar, p_lease_end timestamptz, p_payload jsonb, p_now timestamptz)
returns table (id uuid, kind varchar, fencing_token bigint, current_step varchar, payload jsonb)
language sql
as $$
    insert into public.jobs as j (kind, job_key, status, fencing_token, claimed_by, lease_expires_at, payload, created_at, updated_at)
    values (p_kind, p_job_key, 'running', 1, p_worker, p_lease_end, p_payload, p_now, p_now)
    on conflict (job_key) do update
       set fencing_token = j.fencing_token + 1, claimed_by = p_worker, lease_expires_at = p_lease_end, status = 'running', error = null, updated_at = p_now
     where j.status in ('failed', 'failed_awaiting_fix') or (j.status = 'running' and j.lease_expires_at < p_now)
    returning j.id, j.kind, j.fencing_token, j.current_step, j.payload
$$;

-- Park, resume and list (BE-RESILIENCE-2). A failure a retry cannot fix parks the job as failed_awaiting_fix under the build that
-- ran it; job_park answers whether its one alert is still due. job_resume marks the parked jobs it selects (one by id, those of an
-- earlier build, or every one for the sweep, which keeps the alert raised) and answers each with its next resume number, so the
-- caller hands it back under `<job_key>:r<n>`; the claim takes a failed_awaiting_fix row again like a failed one.
create function public.job_park(p_id uuid, p_token bigint, p_class varchar, p_reason text, p_build varchar, p_now timestamptz)
returns table (alert_due boolean)
language sql
as $$
    with before as (select j.alerted_at from public.jobs as j where j.id = p_id),
    parked as (
        update public.jobs as j
           set status = 'failed_awaiting_fix', failure_class = p_class, error = p_reason, parked_build = p_build, parked_at = p_now,
               alerted_at = coalesce(j.alerted_at, p_now), lease_expires_at = null, updated_at = p_now
         where j.id = p_id and j.fencing_token = p_token and j.status = 'running'
        returning j.id
    )
    select (select b.alerted_at from before as b) is null from parked
$$;

create function public.job_resume(p_id uuid, p_build varchar, p_sweep boolean, p_now timestamptz)
returns table (id uuid, kind varchar, job_key varchar, payload jsonb, resume_count integer)
language sql
as $$
    update public.jobs as j
       set resume_count = j.resume_count + 1, alerted_at = case when p_sweep then j.alerted_at end, updated_at = p_now
     where j.status = 'failed_awaiting_fix'
       and (p_sweep or j.id = p_id or (p_build is not null and j.parked_build is distinct from p_build))
    returning j.id, j.kind, j.job_key, j.payload, j.resume_count
$$;

create function public.job_awaiting_fix()
returns table (id uuid, kind varchar, failure_class varchar, error text, parked_at timestamptz, parked_build varchar, resume_count integer)
language sql
stable
as $$
    select j.id, j.kind, j.failure_class, coalesce(j.error, ''), j.parked_at, coalesce(j.parked_build, ''), j.resume_count
      from public.jobs as j
     where j.status = 'failed_awaiting_fix'
     order by j.parked_at, j.id
$$;

revoke all on function public.job_park(uuid, bigint, varchar, text, varchar, timestamptz) from public;
grant execute on function public.job_park(uuid, bigint, varchar, text, varchar, timestamptz) to app_be;
revoke all on function public.job_resume(uuid, varchar, boolean, timestamptz) from public;
grant execute on function public.job_resume(uuid, varchar, boolean, timestamptz) to app_be;
revoke all on function public.job_awaiting_fix() from public;
grant execute on function public.job_awaiting_fix() to app_be;
