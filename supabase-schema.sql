-- Run this once in Supabase: Project -> SQL Editor -> New query -> Run
-- Creates two tables: one for saved notes/tasks/reminders, one for synced chat history.

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  type text default 'note',           -- 'note' | 'task' | 'reminder'
  content text not null,
  created_at timestamptz default now()
);
create index if not exists notes_user_id_idx on notes (user_id);

create table if not exists messages (
  id bigint generated always as identity primary key,
  user_id text not null,
  role text not null,                 -- 'user' | 'model'
  content text not null,
  created_at timestamptz default now()
);
create index if not exists messages_user_id_idx on messages (user_id, created_at);

-- We only ever talk to these tables from the backend using the service_role key,
-- which bypasses Row Level Security entirely. RLS is enabled anyway as a safety net
-- in case the wrong (anon) key is ever used by mistake — it will simply be denied.
alter table notes enable row level security;
alter table messages enable row level security;
