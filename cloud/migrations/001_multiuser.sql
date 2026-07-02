-- Veyra multi-user migration (W1)
-- Run ONCE in the Supabase SQL editor (out-of-band). The app's runtime DSN has no DDL rights.
-- Adds user_id to every content table + creates the new workspace tables, then turns on RLS.
--
-- Enforcement model:
--   * Primary: the FastAPI backend filters every query by the per-request user_id
--     (contextvar set from the verified Supabase JWT). See backend/veyra/kernel/context.py.
--   * Defense-in-depth: RLS below blocks any direct PostgREST/anon access that isn't the owner.
--     The backend's service role bypasses RLS, which is why app-level filtering is mandatory.
--
-- user_id is NULL for legacy single-user rows; a one-time backfill can assign them to the
-- owner account once it exists (see bottom).

begin;

-- ---------------------------------------------------------------------------
-- 1. Add user_id to existing content tables (idempotent)
-- ---------------------------------------------------------------------------
alter table if exists notes           add column if not exists user_id uuid;
alter table if exists memory          add column if not exists user_id uuid;
alter table if exists emails          add column if not exists user_id uuid;
alter table if exists conversations   add column if not exists user_id uuid;
alter table if exists alerts          add column if not exists user_id uuid;
alter table if exists mail_messages   add column if not exists user_id uuid;
alter table if exists scheduled_tasks add column if not exists user_id uuid;
alter table if exists code_sessions   add column if not exists user_id uuid;
alter table if exists improvements    add column if not exists user_id uuid;

create index if not exists idx_notes_user         on notes(user_id);
create index if not exists idx_memory_user        on memory(user_id);
create index if not exists idx_conversations_user on conversations(user_id);
create index if not exists idx_alerts_user        on alerts(user_id);
create index if not exists idx_mail_user          on mail_messages(user_id);
create index if not exists idx_sched_user         on scheduled_tasks(user_id);

-- ---------------------------------------------------------------------------
-- 2. New workspace tables
-- ---------------------------------------------------------------------------

-- User profile / onboarding answers (one row per user)
create table if not exists profiles (
    user_id     uuid primary key references auth.users(id) on delete cascade,
    display_name text not null default '',
    role        text not null default '',      -- "what you do"
    tone        text not null default 'warm, concise, decisive',
    onboarded   boolean not null default false,
    quiet_start text not null default '22:00',
    quiet_end   text not null default '07:00',
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

-- Composio connections (mirror of Composio state, for fast UI + audit)
create table if not exists connections (
    id          bigserial primary key,
    user_id     uuid not null references auth.users(id) on delete cascade,
    toolkit     text not null,                 -- gmail | github | youtube | instagram | ...
    status      text not null default 'connected',
    account_ref text,                          -- Composio connected-account id
    calls_used  integer not null default 0,    -- free-tier metering
    created_at  timestamptz not null default now(),
    unique (user_id, toolkit)
);

-- Notion-style pages
create table if not exists pages (
    id          bigserial primary key,
    user_id     uuid not null references auth.users(id) on delete cascade,
    title       text not null default 'Untitled',
    blocks      jsonb not null default '[]'::jsonb,
    icon        text not null default '',
    archived    boolean not null default false,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
create index if not exists idx_pages_user on pages(user_id, updated_at desc);

-- Calendar events (native; Google Calendar syncs in via Composio)
create table if not exists calendar_events (
    id          bigserial primary key,
    user_id     uuid not null references auth.users(id) on delete cascade,
    title       text not null default '',
    starts_at   timestamptz not null,
    ends_at     timestamptz,
    all_day     boolean not null default false,
    source      text not null default 'veyra', -- veyra | google
    external_id text,
    remind_secs integer,                        -- lead time for heartbeat reminder
    created_at  timestamptz not null default now()
);
create index if not exists idx_cal_user on calendar_events(user_id, starts_at);

-- User-defined automations (recurring proactive tasks)
create table if not exists automations (
    id          bigserial primary key,
    user_id     uuid not null references auth.users(id) on delete cascade,
    title       text not null default '',
    instruction text not null default '',       -- natural-language task for the agent
    every_secs  integer not null default 86400,
    next_run    timestamptz not null default now(),
    enabled     boolean not null default true,
    quiet_aware boolean not null default true,
    last_run    timestamptz,
    last_result text,
    created_at  timestamptz not null default now()
);
create index if not exists idx_auto_user on automations(user_id, next_run);

-- ---------------------------------------------------------------------------
-- 3. Row-Level Security (defense-in-depth for direct REST/anon access)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'notes','memory','emails','conversations','alerts','mail_messages',
    'scheduled_tasks','code_sessions','improvements',
    'profiles','connections','pages','calendar_events','automations'
  ]
  loop
    execute format('alter table if exists %I enable row level security', t);
    execute format('drop policy if exists owner_all on %I', t);
    -- profiles keys on user_id (= auth.uid()); everything else too
    execute format(
      'create policy owner_all on %I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t
    );
  end loop;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- 4. One-time backfill (run manually AFTER the owner account exists)
-- Replace <OWNER_UUID> with the owner's auth.users id, then run:
--
--   update notes           set user_id = '<OWNER_UUID>' where user_id is null;
--   update memory          set user_id = '<OWNER_UUID>' where user_id is null;
--   update conversations   set user_id = '<OWNER_UUID>' where user_id is null;
--   update alerts          set user_id = '<OWNER_UUID>' where user_id is null;
--   update mail_messages   set user_id = '<OWNER_UUID>' where user_id is null;
--   update scheduled_tasks set user_id = '<OWNER_UUID>' where user_id is null;
--   update emails          set user_id = '<OWNER_UUID>' where user_id is null;
--   update code_sessions   set user_id = '<OWNER_UUID>' where user_id is null;
--   update improvements    set user_id = '<OWNER_UUID>' where user_id is null;
-- ---------------------------------------------------------------------------
