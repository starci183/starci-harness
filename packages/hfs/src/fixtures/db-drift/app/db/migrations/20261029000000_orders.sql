create type public.order_kind as enum ('standard', 'gift');

create table public.orders (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null,
    total_cents bigint not null,
    status varchar(32) not null,
    kind public.order_kind not null,
    note text,
    tags text[] not null default '{}',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
