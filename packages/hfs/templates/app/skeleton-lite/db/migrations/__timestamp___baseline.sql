do $$
begin
    if not exists (select 1 from pg_catalog.pg_roles where rolname = 'app_be') then
        create role app_be login noinherit nosuperuser nobypassrls nocreatedb nocreaterole;
    end if;
end;
$$;

-- The attributes a migration may change: SUPERUSER and BYPASSRLS stay as create role set them.
alter role app_be login noinherit nocreatedb nocreaterole;

create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

-- The rotating refresh sessions of integrations/passport (auth.users comes from db/bootstrap.sql).
-- One row per issued refresh token, stored by its sha256 only. A family is one sign-in; rotation revokes the presented row
-- and inserts its successor, and presenting a revoked row revokes the whole family (reuse detection).
create table auth.refresh_sessions (
    id uuid primary key default gen_random_uuid(),
    family_id uuid not null,
    user_id uuid not null references auth.users (id) on delete cascade,
    token_hash char(64) not null unique,
    expires_at timestamptz not null,
    revoked_at timestamptz,
    created_at timestamptz not null default now()
);

create index refresh_sessions_family_idx on auth.refresh_sessions (family_id);

grant usage on schema auth to app_be;
grant select, insert, update on table auth.users to app_be;
grant select, insert on table auth.identities to app_be;
grant select, insert, update on table auth.refresh_sessions to app_be;

create table public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    display_name text not null check (char_length(display_name) between 1 and 120),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function private.set_updated_at();

create policy profiles_app_be_select
on public.profiles
for select
to app_be
using (current_user = 'app_be');

create policy profiles_app_be_insert
on public.profiles
for insert
to app_be
with check (current_user = 'app_be');

create policy profiles_app_be_update
on public.profiles
for update
to app_be
using (current_user = 'app_be')
with check (current_user = 'app_be');

grant usage on schema public to app_be;
revoke all on table public.profiles from public, anon, authenticated;
grant select, insert on table public.profiles to app_be;
grant update (display_name) on table public.profiles to app_be;

-- The rate limit windows of platform/http-security: every api replica counts a caller's hits in the same row, and a hit
-- that opens a fresh window prunes a bounded batch of the ended ones.
create table public.http_security_rate_windows (
    key varchar(128) primary key,
    hits integer not null check (hits > 0),
    reset_at timestamptz not null
);

create index http_security_rate_windows_reset_at_idx on public.http_security_rate_windows (reset_at);

alter table public.http_security_rate_windows enable row level security;
alter table public.http_security_rate_windows force row level security;

create policy http_security_rate_windows_app_be_select
on public.http_security_rate_windows
for select
to app_be
using (current_user = 'app_be');

create policy http_security_rate_windows_app_be_insert
on public.http_security_rate_windows
for insert
to app_be
with check (current_user = 'app_be');

create policy http_security_rate_windows_app_be_update
on public.http_security_rate_windows
for update
to app_be
using (current_user = 'app_be')
with check (current_user = 'app_be');

create policy http_security_rate_windows_app_be_delete
on public.http_security_rate_windows
for delete
to app_be
using (current_user = 'app_be');

revoke all on table public.http_security_rate_windows from public, anon, authenticated;
grant select, insert, update, delete on table public.http_security_rate_windows to app_be;
