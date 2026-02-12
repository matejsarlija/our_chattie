-- Supabase schema for analysis history

create extension if not exists "pgcrypto";

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists analysis_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  oib text not null,
  status text not null default 'running',
  result_text text,
  result_format text default 'markdown',
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists analysis_runs_user_id_idx on analysis_runs(user_id);
create index if not exists analysis_runs_created_at_idx on analysis_runs(created_at desc);

create table if not exists analysis_events (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references analysis_runs(id) on delete cascade,
  event_type text not null,
  message text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analysis_events_analysis_id_idx on analysis_events(analysis_id);

create table if not exists trial_runs (
  id uuid primary key default gen_random_uuid(),
  trial_id uuid not null,
  oib text not null,
  status text not null default 'running',
  result_text text,
  result_format text default 'markdown',
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists trial_runs_trial_id_idx on trial_runs(trial_id);
create index if not exists trial_runs_created_at_idx on trial_runs(created_at desc);

create table if not exists trial_events (
  id uuid primary key default gen_random_uuid(),
  trial_run_id uuid not null references trial_runs(id) on delete cascade,
  event_type text not null,
  message text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists trial_events_run_id_idx on trial_events(trial_run_id);

alter table profiles enable row level security;
alter table analysis_runs enable row level security;
alter table analysis_events enable row level security;

alter table trial_runs enable row level security;
alter table trial_events enable row level security;

create policy "Profiles are self-readable" on profiles
  for select using (id = auth.uid());

create policy "Profiles are self-updatable" on profiles
  for update using (id = auth.uid());

create policy "Runs are user-owned" on analysis_runs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Events are visible to run owner" on analysis_events
  for select using (
    exists (
      select 1 from analysis_runs
      where analysis_runs.id = analysis_events.analysis_id
        and analysis_runs.user_id = auth.uid()
    )
  );

create policy "Events insert by run owner" on analysis_events
  for insert with check (
    exists (
      select 1 from analysis_runs
      where analysis_runs.id = analysis_events.analysis_id
        and analysis_runs.user_id = auth.uid()
    )
  );

-- Trial tables are server-only; no client policies.
