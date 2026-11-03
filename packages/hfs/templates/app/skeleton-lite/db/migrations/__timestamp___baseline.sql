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

-- The device sessions and rotating refresh tokens of @starci/auth. A token is stored by its sha256 only; a rotated token stays,
-- marked used, so a replay is detected (a replay inside the grace window is a racing tab, an older one ends the session).
-- identity_attempts counts the sign-in attempts of one address in a window every replica shares (the budget of failures).
-- The app owns auth.users (db/bootstrap.sql) and the role app_be.

create table public.identity_sessions (
    id uuid primary key,
    user_id uuid not null references auth.users (id) on delete cascade,
    created_at timestamptz not null default now(),
    refreshed_at timestamptz not null default now(),
    user_agent text,
    ip text
);

create index identity_sessions_user_idx on public.identity_sessions (user_id);

create table public.identity_refresh_tokens (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.identity_sessions (id) on delete cascade,
    user_id uuid not null,
    token_hash text not null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    used_at timestamptz,
    constraint identity_refresh_tokens_hash_key unique (token_hash)
);

create index identity_refresh_tokens_session_idx on public.identity_refresh_tokens (session_id);
create index identity_refresh_tokens_expiry_idx on public.identity_refresh_tokens (user_id, expires_at);

create table public.identity_attempts (
    key varchar(128) primary key,
    hits integer not null,
    reset_at timestamptz not null
);

create index identity_attempts_reset_idx on public.identity_attempts (reset_at);

alter table public.identity_sessions enable row level security;
alter table public.identity_sessions force row level security;
alter table public.identity_refresh_tokens enable row level security;
alter table public.identity_refresh_tokens force row level security;
alter table public.identity_attempts enable row level security;
alter table public.identity_attempts force row level security;

revoke all on table public.identity_sessions from public;
revoke all on table public.identity_refresh_tokens from public;
revoke all on table public.identity_attempts from public;
grant select, insert, update, delete on table public.identity_sessions to app_be;
grant select, insert, update, delete on table public.identity_refresh_tokens to app_be;
grant select, insert, update, delete on table public.identity_attempts to app_be;

create policy identity_sessions_app_be_all on public.identity_sessions
    for all to app_be using (current_user = 'app_be') with check (current_user = 'app_be');
create policy identity_refresh_tokens_app_be_all on public.identity_refresh_tokens
    for all to app_be using (current_user = 'app_be') with check (current_user = 'app_be');
create policy identity_attempts_app_be_all on public.identity_attempts
    for all to app_be using (current_user = 'app_be') with check (current_user = 'app_be');

{{> app/auth-doors.sql.partial}}

-- The single-use links that confirm a mailbox or reset a password (the email doors of sign-in): only the sha256 of the token is
-- stored, a spent link stays marked used, and a new link of the same purpose ends the older ones.
create table public.identity_email_tokens (
    id uuid primary key,
    user_id uuid not null references auth.users (id) on delete cascade,
    purpose varchar(16) not null check (purpose in ('confirm', 'reset')),
    token_hash varchar(64) not null,
    expires_at timestamptz not null,
    used_at timestamptz,
    created_at timestamptz not null,
    constraint identity_email_tokens_hash_key unique (token_hash)
);

create index identity_email_tokens_user_idx on public.identity_email_tokens (user_id, purpose);

alter table public.identity_email_tokens enable row level security;
alter table public.identity_email_tokens force row level security;
revoke all on table public.identity_email_tokens from public;
grant select, insert, update, delete on table public.identity_email_tokens to app_be;
create policy identity_email_tokens_app_be_all on public.identity_email_tokens
    for all to app_be using (current_user = 'app_be') with check (current_user = 'app_be');

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
