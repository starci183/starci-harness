import type { ResolvedTables } from "./tables.ts"

/** Every statement the outbox runs, written once over the resolved table names; parameters are positional, never spliced. */
export interface Statements {
    readonly enqueue: string
    readonly onceKeyId: string
    readonly candidates: string
    readonly lockDue: string
    readonly lockSlot: string
    readonly slotsOf: string
    readonly freeSlotsOf: string
    readonly takeSlot: string
    readonly start: string
    readonly done: string
    readonly requeue: string
    readonly park: string
    readonly renew: string
    readonly resumeOne: string
    readonly resumeTransient: string
    readonly resumeBuild: string
    readonly close: string
    readonly parked: string
    readonly armTimer: string
    readonly cancelTimer: string
    readonly cancelTimersByPrefix: string
    readonly sweepTimers: string
    readonly purge: string
    readonly stats: string
}

const CLAIMED_COLUMNS = "id::text as id, scope::text as scope, queue, name, payload, once_key, attempts, fence::text as fence, resume_count"
const PARKED_COLUMNS =
    "id::text as id, scope::text as scope, queue, name, payload, attempts, last_error, failure_class, park_reason, parked_at, parked_build, resume_count"

/** The statements over these tables. */
export const statementsOf = (t: ResolvedTables): Statements => {
    const { jobs: J, slots: S, timers: T, scopeType: ST } = t
    const releaseSlots = `s as (update ${S} set job_id = null, lease_until = null where job_id in (select id from j) returning 1)`
    const fenced = `id = $1::uuid and fence = $2::bigint and state = 'running'`
    const resumeSet = (pick: string): string => `with pick as (${pick} for update skip locked),
j as (update ${J} t set state = 'queued', attempts = 0, not_before = $1, resume_count = t.resume_count + 1, failure_class = null,
    park_reason = null, parked_at = null, parked_build = null, finished_at = null,
    alerted_at = case when $2::boolean then null else t.alerted_at end
  from pick where t.id = pick.id returning t.id)
select count(*)::int as n from j`
    return {
        enqueue: `with ins as (
  insert into ${J} (scope, queue, name, payload, once_key, not_before)
  values ($1::${ST}, $2, $3, $4::jsonb, $5, $6)
  on conflict (once_key) do nothing returning id)
select id::text as id, true as created from ins
union all
select id::text as id, false as created from ${J} where once_key = $5 and not exists (select 1 from ins)`,
        onceKeyId: `select id::text as id from ${J} where once_key = $1`,
        candidates: `with due as (
  select j.id, j.queue, j.scope, j.not_before, j.created_at,
    row_number() over (partition by j.queue, j.scope order by j.not_before, j.created_at, j.id) as rank
  from ${J} j
  where (j.state = 'queued' and j.not_before <= $1) or (j.state = 'running' and j.lease_until < $1)
), busy as (
  select s.queue, s.scope, count(*) as held from ${S} s
  where s.job_id is not null and s.lease_until >= $1 group by s.queue, s.scope
)
select due.id::text as id from due
left join busy on busy.queue = due.queue and busy.scope = due.scope
where due.scope is null or due.rank <= coalesce(($2::jsonb ->> due.queue)::int, $3::int) - coalesce(busy.held, 0)
order by due.rank, due.not_before, due.created_at, due.id
limit $4`,
        lockDue: `select j.id::text as id, j.scope::text as scope, j.queue from ${J} j
where j.id = any($1::uuid[]) and ((j.state = 'queued' and j.not_before <= $2) or (j.state = 'running' and j.lease_until < $2))
for update skip locked`,
        lockSlot: `select pg_advisory_xact_lock(hashtextextended($1, 0)) as locked`,
        slotsOf: `select slot, job_id::text as job_id, lease_until from ${S} where queue = $1 and scope = $2::${ST}`,
        freeSlotsOf: `update ${S} set job_id = null, lease_until = null where job_id = any($1::uuid[])`,
        takeSlot: `insert into ${S} (queue, scope, slot, job_id, lease_until) values ($1, $2::${ST}, $3, $4::uuid, $5)
on conflict (queue, scope, slot) do update set job_id = excluded.job_id, lease_until = excluded.lease_until`,
        start: `update ${J} set state = 'running', attempts = attempts + 1, fence = fence + 1, lease_until = $2, claimed_by = $3, finished_at = null
where id = any($1::uuid[])
returning ${CLAIMED_COLUMNS}`,
        done: `with j as (update ${J} set state = 'done', lease_until = null, claimed_by = null, last_error = null, failure_class = null,
    park_reason = null, finished_at = $3
  where ${fenced} returning id),
${releaseSlots}
select count(*)::int as n from j`,
        requeue: `with j as (update ${J} set state = 'queued', not_before = $3, lease_until = null, claimed_by = null,
    attempts = case when $4::boolean then attempts else greatest(attempts - 1, 0) end,
    last_error = coalesce($5::text, last_error), failure_class = coalesce($6::text, failure_class)
  where ${fenced} returning id),
${releaseSlots}
select count(*)::int as n from j`,
        park: `with old as (select id, alerted_at from ${J} where ${fenced} for update),
j as (update ${J} t set state = 'parked', lease_until = null, claimed_by = null, last_error = $4, failure_class = $5, park_reason = $6,
    parked_at = $3, parked_build = $7, finished_at = $3, alerted_at = coalesce(t.alerted_at, $3)
  from old where t.id = old.id returning t.id, old.alerted_at is null as alert),
${releaseSlots}
select alert from j`,
        renew: `with j as (update ${J} set lease_until = $3 where ${fenced} returning id),
s as (update ${S} set lease_until = $3 where job_id in (select id from j) returning 1)
select count(*)::int as n from j`,
        resumeOne: resumeSet(`select id from ${J} where id = $3::uuid and state = 'parked'`),
        resumeTransient: resumeSet(
            `select id from ${J} where state = 'parked' and failure_class = 'transient' and resume_count < $3 and parked_at <= $4 order by parked_at limit $5`,
        ),
        resumeBuild: resumeSet(`select id from ${J} where state = 'parked' and parked_build is distinct from $3 order by parked_at limit $4`),
        close: `with j as (update ${J} set state = 'closed', last_error = $2, finished_at = $3 where id = $1::uuid and state = 'parked' returning id)
select count(*)::int as n from j`,
        parked: `select ${PARKED_COLUMNS} from ${J}
where state = 'parked' and ($1::text is null or scope::text = $1::text)
order by parked_at, id limit $2`,
        armTimer: `insert into ${T} (scope, key, due_at, queue, name, payload) values ($1::${ST}, $2, $3, $4, $5, $6::jsonb)
on conflict ((coalesce(scope::text, '')), key) where fired_at is null and cancelled_at is null
do update set due_at = excluded.due_at, queue = excluded.queue, name = excluded.name, payload = excluded.payload`,
        cancelTimer: `with c as (update ${T} set cancelled_at = $3
  where scope is not distinct from $1::${ST} and key = $2 and fired_at is null and cancelled_at is null returning 1)
select count(*)::int as n from c`,
        cancelTimersByPrefix: `with c as (update ${T} set cancelled_at = $3
  where scope is not distinct from $1::${ST} and starts_with(key, $2) and fired_at is null and cancelled_at is null returning 1)
select count(*)::int as n from c`,
        sweepTimers: `with due as (select id from ${T} where due_at <= $1 and fired_at is null and cancelled_at is null
    order by due_at limit $2 for update skip locked),
fired as (update ${T} t set fired_at = $1 from due where t.id = due.id returning t.id, t.scope, t.key, t.queue, t.name, t.payload),
ins as (insert into ${J} (scope, queue, name, payload, once_key, not_before)
  select scope, queue, name, jsonb_build_object('timerId', id, 'key', key, 'data', payload), 'timer:' || id::text, $1 from fired
  on conflict (once_key) do nothing returning 1)
select (select count(*) from fired)::int as n`,
        purge: `with d as (select id from ${J} where state in ('done', 'closed') and finished_at < $1 order by finished_at limit $2 for update skip locked),
x as (delete from ${J} t using d where t.id = d.id returning 1),
y as (delete from ${T} where (fired_at < $1 or cancelled_at < $1) returning 1)
select (select count(*) from x)::int as n`,
        stats: `select queue, state, count(*)::int as n from ${J} group by queue, state order by queue, state`,
    }
}
