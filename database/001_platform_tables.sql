create extension if not exists pgcrypto;

create table if not exists public.platform_users (
  id uuid primary key,
  email text not null unique,
  name text not null default '',
  role text not null default 'user' check (role in ('admin','user')),
  provider text not null default 'local' check (provider in ('local','google')),
  salt text,
  password_hash text,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_integrations (
  id uuid primary key,
  name text not null,
  type text not null default 'webhook',
  endpoint text not null,
  enabled boolean not null default true,
  secret text not null,
  created_at timestamptz not null default now()
);

create index if not exists platform_users_email_idx on public.platform_users(email);
create index if not exists platform_integrations_created_at_idx on public.platform_integrations(created_at desc);

alter table public.platform_users enable row level security;
alter table public.platform_integrations enable row level security;

-- Backend access uses SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS.
-- No public policies are created for these private platform tables.
