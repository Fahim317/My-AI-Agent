-- Run this in Supabase: Project -> SQL Editor -> New query -> Run
-- Safe to re-run: every statement uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
-- If you already ran the v1 schema before, just run this whole file again —
-- it will only add what's missing (new reminder columns + push_subscriptions table).

-- Notes / tasks / reminders
create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  type text default 'note',           -- 'note' | 'task' | 'reminder'
  content text not null,
  created_at timestamptz default now()
);
create index if not exists notes_user_id_idx on notes (user_id);

-- Reminder scheduling columns (v2 — push notifications)
alter table notes add column if not exists remind_at timestamptz;
alter table notes add column if not exists sent boolean default false;
create index if not exists notes_due_reminders_idx on notes (remind_at) where type = 'reminder' and sent = false;

-- Chat history (for cross-device sync)
create table if not exists messages (
  id bigint generated always as identity primary key,
  user_id text not null,
  role text not null,                 -- 'user' | 'model'
  content text not null,
  created_at timestamptz default now()
);
create index if not exists messages_user_id_idx on messages (user_id, created_at);

-- Push notification subscriptions (one row per device that enabled notifications)
create table if not exists push_subscriptions (
  id bigint generated always as identity primary key,
  user_id text not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);
create index if not exists push_subscriptions_user_id_idx on push_subscriptions (user_id);

-- We only ever talk to these tables from the backend using the service_role key,
-- which bypasses Row Level Security entirely. RLS is enabled anyway as a safety net
-- in case the wrong (anon) key is ever used by mistake — it will simply be denied.
alter table notes enable row level security;
alter table messages enable row level security;
alter table push_subscriptions enable row level security;
