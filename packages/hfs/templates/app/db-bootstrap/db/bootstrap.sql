-- Managed by starci app sync (slot app.db.bootstrap); do not edit: run "npx starci app sync --write".
-- The pre-migration bootstrap of a lite app's self-hosted PostgreSQL (ruling lite-self-hosted-postgres-passport-minio), run on the official
-- postgres image of .starcistacks/images/db/Dockerfile (ruling lite-official-postgres-image). Migrations written for Supabase reference objects GoTrue and Supabase
-- Storage created: the browser roles, the `auth` schema (auth.users, auth.identities, auth.sessions, auth.uid/jwt/role) and the `storage`
-- schema (storage.buckets, storage.objects). A lite app runs neither GoTrue nor storage-api: auth is the app's own (integrations/passport) and
-- storage is the S3 endpoint of integrations/object-storage. This file gives the migrations those objects, EMPTY, and the `extensions` schema
-- every allowed extension is created in (`create extension ... with schema extensions`, the app role's search_path is `public, extensions`);
-- nothing else of Supabase (supabase_admin, the realtime publication) exists. It is idempotent; `starci app db migrate` applies it as the
-- database owner before the first migration of an empty database.
--
-- auth.users keeps the GoTrue column set so restored rows and foreign keys from public tables stay valid; encrypted_password holds bcrypt hashes.
-- auth.uid(), auth.role() and auth.jwt() read the request.jwt.claims setting; the API connects as app_be and sets none, so they return NULL and
-- every policy that names them denies the browser roles, which have no door in lite.

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;

do $roles$
begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end
$roles$;

grant usage on schema auth, storage to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;

-- auth.users: the full GoTrue column set (a copy an earlier database carries is extended in place).
create table if not exists auth.users (id uuid primary key);
alter table auth.users
    add column if not exists instance_id uuid,
    add column if not exists aud varchar(255),
    add column if not exists role varchar(255),
    add column if not exists email varchar(255),
    add column if not exists encrypted_password varchar(255),
    add column if not exists email_confirmed_at timestamptz,
    add column if not exists invited_at timestamptz,
    add column if not exists confirmation_token varchar(255),
    add column if not exists confirmation_sent_at timestamptz,
    add column if not exists recovery_token varchar(255),
    add column if not exists recovery_sent_at timestamptz,
    add column if not exists email_change_token_new varchar(255),
    add column if not exists email_change varchar(255),
    add column if not exists email_change_sent_at timestamptz,
    add column if not exists last_sign_in_at timestamptz,
    add column if not exists raw_app_meta_data jsonb,
    add column if not exists raw_user_meta_data jsonb,
    add column if not exists is_super_admin boolean,
    add column if not exists created_at timestamptz,
    add column if not exists updated_at timestamptz,
    add column if not exists phone text,
    add column if not exists phone_confirmed_at timestamptz,
    add column if not exists confirmed_at timestamptz,
    add column if not exists banned_until timestamptz,
    add column if not exists deleted_at timestamptz,
    add column if not exists is_anonymous boolean not null default false;
create unique index if not exists users_email_partial_key on auth.users (email) where is_anonymous = false;

create table if not exists auth.identities (
    provider_id text not null,
    user_id uuid not null references auth.users (id) on delete cascade,
    identity_data jsonb not null,
    provider text not null,
    last_sign_in_at timestamptz,
    created_at timestamptz,
    updated_at timestamptz,
    email text generated always as (lower(identity_data ->> 'email')) stored,
    id uuid not null default gen_random_uuid() primary key,
    unique (provider_id, provider)
);

create table if not exists auth.sessions (
    id uuid primary key,
    user_id uuid not null references auth.users (id) on delete cascade,
    created_at timestamptz,
    updated_at timestamptz,
    factor_id uuid,
    aal text,
    not_after timestamptz,
    refreshed_at timestamp,
    user_agent text,
    ip inet,
    tag text
);
create index if not exists sessions_user_id_idx on auth.sessions (user_id);

create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $$;

create or replace function auth.role() returns text language sql stable as
$$ select nullif(coalesce(current_setting('request.jwt.claim.role', true), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')), '')::text $$;

create or replace function auth.jwt() returns jsonb language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;

grant execute on function auth.uid(), auth.role(), auth.jwt() to public;

-- storage: the two tables the migrations seed and police; the objects live in MinIO, these stay empty bookkeeping.
create table if not exists storage.buckets (
    id text primary key,
    name text not null,
    owner uuid,
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    public boolean default false,
    avif_autodetection boolean default false,
    file_size_limit bigint,
    allowed_mime_types text[],
    owner_id text
);
create unique index if not exists bname on storage.buckets (name);

create table if not exists storage.objects (
    id uuid not null default gen_random_uuid() primary key,
    bucket_id text references storage.buckets (id),
    name text,
    owner uuid,
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    last_accessed_at timestamptz default now(),
    metadata jsonb,
    path_tokens text[] generated always as (string_to_array(name, '/')) stored,
    version text,
    owner_id text,
    user_metadata jsonb
);
create unique index if not exists bucketid_objname on storage.objects (bucket_id, name);
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;

grant select, insert, update, delete on storage.objects, storage.buckets to authenticated, service_role;
grant select on storage.objects, storage.buckets to anon;
