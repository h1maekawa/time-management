-- DAYLOOP Cloud — initial schema.
--
-- Canonical owner id は auth.users.id (uuid)。アプリ独自のUser IDは作らない。
-- 既存Local(timebox-os/v1)のTask ID (text) との互換性を保つため、
-- tasks/captures/ai_analyses/executions/skills/automation_candidates の id は text。
--
-- 追加のみ(additive)のマイグレーション。既存Local/Providerデータには一切触れない。

-- ─────────────────────────────────────────────────────────────
-- 共通: updated_at / version を自動更新するトリガー関数
-- ─────────────────────────────────────────────────────────────
-- version は「楽観的並行制御(Optimistic Concurrency)」に使う。
-- クライアントは UPDATE 時に必ず `.eq('version', knownVersion)` を条件に含める。
-- 一致しなければ 0 行更新となり、クライアント側でConflictとして扱う。
create or replace function public.daylock_touch_row()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.version := coalesce(old.version, 0) + 1;
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- profiles
-- ─────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  timezone text,
  locale text,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_profiles_touch
  before update on public.profiles
  for each row execute function public.daylock_touch_row();

-- ─────────────────────────────────────────────────────────────
-- user_preferences
-- ─────────────────────────────────────────────────────────────
create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_storage_provider text,
  default_category text,
  -- Provider固有Secret・Device固有パス(例: Obsidian File System Access Handle)は
  -- 端末専用のためここへ保存しない。「Obsidianを使う」というPreferenceだけ持たせる。
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_user_preferences_touch
  before update on public.user_preferences
  for each row execute function public.daylock_touch_row();

-- ─────────────────────────────────────────────────────────────
-- tasks
-- ─────────────────────────────────────────────────────────────
create table if not exists public.tasks (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  title text not null default '',
  minutes integer not null default 30,
  priority integer not null default 3,
  triage text not null default 'today',
  planned_date date,
  deadline date,
  category text not null default 'work',
  time_hint text not null default 'any',
  done boolean not null default false,
  carry_count integer not null default 0,
  carried_from text,
  pinned_start text,
  origin text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  primary key (user_id, id)
);

create index if not exists idx_tasks_user_id on public.tasks (user_id);
create index if not exists idx_tasks_user_updated_at on public.tasks (user_id, updated_at);
create index if not exists idx_tasks_user_deleted_at on public.tasks (user_id, deleted_at);
create index if not exists idx_tasks_user_planned_date on public.tasks (user_id, planned_date);

create trigger trg_tasks_touch
  before update on public.tasks
  for each row execute function public.daylock_touch_row();

-- ─────────────────────────────────────────────────────────────
-- day_plans
-- ─────────────────────────────────────────────────────────────
create table if not exists public.day_plans (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  windows jsonb not null default '[]'::jsonb,
  blocks jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  primary key (user_id, date)
);

create index if not exists idx_day_plans_user_id on public.day_plans (user_id);
create index if not exists idx_day_plans_user_date on public.day_plans (user_id, date);

create trigger trg_day_plans_touch
  before update on public.day_plans
  for each row execute function public.daylock_touch_row();

-- ─────────────────────────────────────────────────────────────
-- captures
-- ─────────────────────────────────────────────────────────────
create table if not exists public.captures (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  raw_text text not null default '',
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  primary key (user_id, id)
);

create index if not exists idx_captures_user_id on public.captures (user_id);
create index if not exists idx_captures_user_updated_at on public.captures (user_id, updated_at);
create index if not exists idx_captures_user_deleted_at on public.captures (user_id, deleted_at);

create trigger trg_captures_touch
  before update on public.captures
  for each row execute function public.daylock_touch_row();

-- ─────────────────────────────────────────────────────────────
-- ai_analyses
-- ─────────────────────────────────────────────────────────────
create table if not exists public.ai_analyses (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  capture_id text,
  suggestions jsonb not null default '{}'::jsonb,
  model text,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  primary key (user_id, id)
);

create index if not exists idx_ai_analyses_user_id on public.ai_analyses (user_id);
create index if not exists idx_ai_analyses_user_updated_at on public.ai_analyses (user_id, updated_at);
create index if not exists idx_ai_analyses_user_deleted_at on public.ai_analyses (user_id, deleted_at);

create trigger trg_ai_analyses_touch
  before update on public.ai_analyses
  for each row execute function public.daylock_touch_row();

-- ─────────────────────────────────────────────────────────────
-- executions
-- ─────────────────────────────────────────────────────────────
create table if not exists public.executions (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  task_id text,
  date date,
  planned_start text,
  planned_end text,
  planned_minutes integer,
  actual_start text,
  actual_end text,
  actual_minutes integer,
  completed boolean not null default false,
  carry_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  primary key (user_id, id)
);

create index if not exists idx_executions_user_id on public.executions (user_id);
create index if not exists idx_executions_user_updated_at on public.executions (user_id, updated_at);
create index if not exists idx_executions_user_deleted_at on public.executions (user_id, deleted_at);
create index if not exists idx_executions_user_date on public.executions (user_id, date);

create trigger trg_executions_touch
  before update on public.executions
  for each row execute function public.daylock_touch_row();

-- ─────────────────────────────────────────────────────────────
-- skills
-- ─────────────────────────────────────────────────────────────
create table if not exists public.skills (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  name text not null default '',
  description text not null default '',
  steps jsonb not null default '[]'::jsonb,
  source_task_ids jsonb not null default '[]'::jsonb,
  confidence real not null default 0,
  status text not null default 'suggested',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  primary key (user_id, id)
);

create index if not exists idx_skills_user_id on public.skills (user_id);
create index if not exists idx_skills_user_updated_at on public.skills (user_id, updated_at);
create index if not exists idx_skills_user_deleted_at on public.skills (user_id, deleted_at);

create trigger trg_skills_touch
  before update on public.skills
  for each row execute function public.daylock_touch_row();

-- ─────────────────────────────────────────────────────────────
-- automation_candidates
-- ─────────────────────────────────────────────────────────────
create table if not exists public.automation_candidates (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  type text not null default 'routine',
  title text not null default '',
  reason text not null default '',
  evidence text not null default '',
  confidence real not null default 0,
  status text not null default 'suggested',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  primary key (user_id, id)
);

create index if not exists idx_automation_candidates_user_id on public.automation_candidates (user_id);
create index if not exists idx_automation_candidates_user_updated_at on public.automation_candidates (user_id, updated_at);
create index if not exists idx_automation_candidates_user_deleted_at on public.automation_candidates (user_id, deleted_at);

create trigger trg_automation_candidates_touch
  before update on public.automation_candidates
  for each row execute function public.daylock_touch_row();

-- ─────────────────────────────────────────────────────────────
-- devices
-- ─────────────────────────────────────────────────────────────
create table if not exists public.devices (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  device_name text,
  last_seen_at timestamptz not null default now(),
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

create index if not exists idx_devices_user_id on public.devices (user_id);

create trigger trg_devices_touch
  before update on public.devices
  for each row execute function public.daylock_touch_row();

-- ─────────────────────────────────────────────────────────────
-- integrations（将来: Google Calendar / Drive 等）
-- ─────────────────────────────────────────────────────────────
create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  external_account_id text,
  status text not null default 'disconnected',
  scopes jsonb not null default '[]'::jsonb,
  -- OAuth Refresh Token等の秘密情報はここへ保存しない(Frontendから読めるため)。
  -- 秘密情報を扱う実装をする場合は別のservice_role専用テーブルへ分離すること。
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create index if not exists idx_integrations_user_id on public.integrations (user_id);

create trigger trg_integrations_touch
  before update on public.integrations
  for each row execute function public.daylock_touch_row();

-- ─────────────────────────────────────────────────────────────
-- subscriptions（将来の有料プラン。今回は課金実装なし、Schemaのみ）
-- ─────────────────────────────────────────────────────────────
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text,
  plan_code text not null default 'free',
  status text not null default 'active',
  external_customer_id text,
  external_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_subscriptions_user_id on public.subscriptions (user_id);

create trigger trg_subscriptions_touch
  before update on public.subscriptions
  for each row execute function public.daylock_touch_row();
