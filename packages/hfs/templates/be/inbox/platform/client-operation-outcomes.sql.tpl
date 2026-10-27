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
