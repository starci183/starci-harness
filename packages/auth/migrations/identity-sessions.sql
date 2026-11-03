-- The device sessions and rotating refresh tokens of @starci/auth. A token is stored by its sha256 only; a rotated token stays,
-- marked used, so a replay is detected (a replay inside the grace window is a racing tab, an older one ends the session).
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

alter table public.identity_sessions enable row level security;
alter table public.identity_sessions force row level security;
alter table public.identity_refresh_tokens enable row level security;
alter table public.identity_refresh_tokens force row level security;

revoke all on table public.identity_sessions from public;
revoke all on table public.identity_refresh_tokens from public;
grant select, insert, update, delete on table public.identity_sessions to app_be;
grant select, insert, update, delete on table public.identity_refresh_tokens to app_be;

create policy identity_sessions_app_be_all on public.identity_sessions
    for all to app_be using (current_user = 'app_be') with check (current_user = 'app_be');
create policy identity_refresh_tokens_app_be_all on public.identity_refresh_tokens
    for all to app_be using (current_user = 'app_be') with check (current_user = 'app_be');
